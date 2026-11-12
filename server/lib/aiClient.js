import { AppError } from './errors.js'
import { CancelledError } from './aiQueue.js'
import { nowIso } from './time.js'

/**
 * AI 客户端（03-AI-SPEC §1）：
 * - OpenAI 兼容 /v1/chat/completions，支持 JSON 与流式；
 * - 传输重试（超时/5xx/网络，最多 ai.retry 次，退回 500/1500ms…）；
 * - 429 自动退避 1 次后重试一次；
 * - 格式非法时「格式修复重试」1 次，仍失败按调用方策略降级；
 * - 每次逻辑调用写一条 ai_calls（重试合并；status ok/error/degraded）；
 * - 排队由 aiQueue 负责；取消抛 CancelledError。
 */

const DEFAULT_TIMEOUT_MS = 60000
const MIN_TIMEOUT_MS = 1000
const MAX_TIMEOUT_MS = 600000
const STREAM_IDLE_TIMEOUT_MS = 30000
const STREAM_TOTAL_TIMEOUT_MS = 180000
const RATE_LIMIT_DELAY_MS = 1000
const RETRY_DELAYS = [500, 1500, 3000, 5000, 5000]
const MAX_PROMPT_PREVIEW_CHARS = 500
const MAX_ERROR_CHARS = 1000

/**
 * 把配置里的 timeoutMs 夹到合法区间。
 * @param {unknown} value
 * @returns {number}
 */
function clampTimeout(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return DEFAULT_TIMEOUT_MS
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.round(number)))
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function clampRetry(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  return Math.min(5, Math.max(0, Math.trunc(number)))
}

/**
 * 规范化 OpenAI 兼容 baseUrl：去末尾斜杠；路径不含版本段（v1/v2…）时自动补 /v1。
 * @param {unknown} baseUrl
 * @returns {string}
 */
export function resolveBaseUrl(baseUrl) {
  const text = typeof baseUrl === 'string' ? baseUrl.trim() : ''
  if (text.length === 0) return ''
  const withoutTrailing = text.replace(/\/+$/, '')
  try {
    const url = new URL(withoutTrailing)
    const pathname = url.pathname.replace(/\/+$/, '')
    const versioned = pathname
      .split('/')
      .filter((segment) => segment.length > 0)
      .some((segment) => /^v\d+(?:\.\d+)?$/.test(segment))
    url.pathname = versioned ? pathname : `${pathname}/v1`
    return url.toString().replace(/\/+$/, '')
  } catch {
    // URL 不合法时交给上层校验，这里只做字符串兜底
    return withoutTrailing
  }
}

/**
 * 校验基础配置（baseUrl + apiKey）。
 * @param {{ baseUrl?: unknown, apiKey?: unknown, model?: unknown, timeoutMs?: unknown, retry?: unknown }} ai
 * @returns {{ baseUrl: string, apiKey: string, model: string, timeoutMs: number, retry: number }}
 */
function requireBase(ai) {
  const baseUrl = typeof ai?.baseUrl === 'string' ? ai.baseUrl.trim() : ''
  const apiKey = typeof ai?.apiKey === 'string' ? ai.apiKey.trim() : ''
  if (baseUrl.length === 0) {
    throw new AppError('AI_NOT_CONFIGURED', 'AI 未配置：请先在设置中填写接口地址')
  }
  if (apiKey.length === 0) {
    throw new AppError('AI_NOT_CONFIGURED', 'AI 未配置：请先在设置中填写 API Key')
  }
  return {
    baseUrl: resolveBaseUrl(baseUrl),
    apiKey,
    model: typeof ai?.model === 'string' ? ai.model.trim() : '',
    timeoutMs: clampTimeout(ai?.timeoutMs),
    retry: clampRetry(ai?.retry)
  }
}

/**
 * 校验可用于对话的配置（额外要求 model 非空）。
 * @param {{ baseUrl?: unknown, apiKey?: unknown, model?: unknown, timeoutMs?: unknown, retry?: unknown }} ai
 * @returns {{ baseUrl: string, apiKey: string, model: string, timeoutMs: number, retry: number }}
 */
function requireChat(ai) {
  const config = requireBase(ai)
  if (config.model.length === 0) {
    throw new AppError('AI_NOT_CONFIGURED', 'AI 未配置：请先在设置中选择模型')
  }
  return config
}

/**
 * HTTP 状态码 → 业务错误（02-DATA-API §6.5 / 03-AI-SPEC §1.4）。
 * 401/403 映射 AI_NOT_CONFIGURED，前端按「去设置」处理（与 M1 约定一致）。
 * @param {number} status
 * @returns {AppError}
 */
function mapHttpError(status) {
  if (status === 429) {
    return new AppError('AI_RATE_LIMIT', 'AI 服务请求过于频繁（HTTP 429），请稍后重试', {
      detail: { status }
    })
  }
  if (status === 401 || status === 403) {
    return new AppError(
      'AI_NOT_CONFIGURED',
      `API Key 无效或无访问权限（HTTP ${status}），请到设置检查`,
      { detail: { status } }
    )
  }
  const error = new AppError('AI_UPSTREAM', `AI 服务暂时不可用（HTTP ${status}），请稍后重试`, {
    detail: { status }
  })
  error.upstreamStatus = status
  error.transportRetryable = status >= 500
  if (status === 404) {
    error.message = 'AI 接口地址不正确（HTTP 404），请检查接口地址是否包含正确的版本路径'
  } else if (status >= 400 && status < 500) {
    error.message = `AI 服务拒绝了请求（HTTP ${status}），请检查接口地址与模型配置`
  }
  return error
}

/**
 * 可被 signal 取消的 sleep。
 * @param {number} ms
 * @param {AbortSignal | undefined} signal
 * @returns {Promise<void>}
 */
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new CancelledError())
      return
    }
    const timer = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      cleanup()
      reject(new CancelledError())
    }
    const cleanup = () => {
      if (signal) signal.removeEventListener('abort', onAbort)
    }
    if (signal) signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * 带超时/取消的普通请求，返回 { status, text }。
 * @param {string} url
 * @param {{ method: 'GET' | 'POST', headers?: Record<string, string>, body?: string, timeoutMs: number, signal?: AbortSignal }} options
 * @returns {Promise<{ status: number, text: string }>}
 */
async function fetchText(url, options) {
  const controller = new AbortController()
  let timedOut = false
  const onAbort = () => controller.abort()
  if (options.signal) {
    if (options.signal.aborted) throw new CancelledError()
    options.signal.addEventListener('abort', onAbort, { once: true })
  }
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, options.timeoutMs)
  try {
    const response = await fetch(url, {
      method: options.method,
      headers: options.headers,
      body: options.body,
      signal: controller.signal
    })
    const text = await response.text()
    return { status: response.status, text }
  } catch (error) {
    if (error instanceof AppError) throw error
    if (options.signal?.aborted) throw new CancelledError()
    if (timedOut || error?.name === 'AbortError') {
      throw new AppError(
        'AI_TIMEOUT',
        `AI 服务响应超时（${Math.round(options.timeoutMs / 1000)} 秒），请检查网络或调大超时时间`,
        { cause: error }
      )
    }
    throw new AppError('AI_UPSTREAM', '无法连接 AI 服务，请检查接口地址与网络', { cause: error })
  } finally {
    clearTimeout(timer)
    if (options.signal) options.signal.removeEventListener('abort', onAbort)
  }
}

/**
 * 解析非流式 chat 响应。
 * @param {string} text
 * @returns {{ content: string, usage: object | null }}
 */
function parseChatResponse(text) {
  let payload
  try {
    payload = JSON.parse(text)
  } catch (error) {
    throw new AppError('AI_UPSTREAM', 'AI 服务返回数据格式异常', { cause: error })
  }
  const content = payload?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || content.length === 0) {
    throw new AppError('AI_UPSTREAM', 'AI 服务返回内容为空')
  }
  return { content, usage: payload?.usage ?? null }
}

/**
 * 规范化 usage 累加。
 * @param {{ input: number, output: number }} totals
 * @param {object | null} usage
 * @returns {{ input: number, output: number }}
 */
function addUsage(totals, usage) {
  const input = Number(usage?.prompt_tokens)
  const output = Number(usage?.completion_tokens)
  return {
    input: totals.input + (Number.isFinite(input) ? input : 0),
    output: totals.output + (Number.isFinite(output) ? output : 0)
  }
}

/**
 * 创建 AI 客户端（每个应用实例一个；共享全局串行队列与 ai_calls 仓库）。
 * @param {{
 *   aiCalls: ReturnType<typeof import('../db/repositories/aiCalls.js').createAiCallsRepository>,
 *   queue: ReturnType<typeof import('./aiQueue.js').createAiQueue>,
 *   logger?: { warn: (module: string, message: string, detail?: unknown) => void }
 * }} deps
 */
export function createAiClient({ aiCalls, queue, logger }) {
  /**
   * 写一条 ai_calls；失败不影响主流程。
   * @param {{ purpose: string, promptId?: string | null, promptVersion?: string | null, model?: string | null, status: 'ok' | 'error' | 'degraded', promptPreview?: string | null, error?: string | null, durationMs?: number, inputTokens?: number | null, outputTokens?: number | null }} entry
   */
  function record(entry) {
    try {
      aiCalls.insert({
        purpose: entry.purpose,
        promptId: entry.promptId ?? null,
        promptVersion: entry.promptVersion ?? null,
        model: entry.model ?? null,
        status: entry.status,
        promptPreview:
          typeof entry.promptPreview === 'string'
            ? entry.promptPreview.slice(0, MAX_PROMPT_PREVIEW_CHARS)
            : null,
        error: entry.error ? String(entry.error).slice(0, MAX_ERROR_CHARS) : null,
        durationMs: entry.durationMs ?? null,
        inputTokens: entry.inputTokens ?? null,
        outputTokens: entry.outputTokens ?? null,
        createdAt: nowIso()
      })
    } catch (error) {
      if (logger) {
        logger.warn('ai', '写入 ai_calls 失败', {
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
  }

  /**
   * 错误转可存储字符串（带上业务错误码，便于排查）。
   * @param {unknown} error
   * @returns {string}
   */
  function errorToText(error) {
    if (error && typeof error === 'object' && typeof error.code === 'string') {
      return `${error.code}: ${error.message}`
    }
    if (error instanceof Error) return `${error.name}: ${error.message}`
    return String(error)
  }

  /**
   * 拉取 OpenAI 兼容 /models（不记录 ai_calls、不入队，由调用方统一处理）。
   * @param {ReturnType<typeof requireBase>} config
   * @returns {Promise<{ models: string[], baseUrl: string, endpoint: string }>}
   */
  async function fetchModels(config) {
    const endpoint = `${config.baseUrl}/models`
    const response = await fetchText(endpoint, {
      method: 'GET',
      headers: { Authorization: `Bearer ${config.apiKey}`, Accept: 'application/json' },
      timeoutMs: config.timeoutMs
    })
    if (response.status < 200 || response.status >= 300) throw mapHttpError(response.status)
    let payload
    try {
      payload = JSON.parse(response.text)
    } catch (error) {
      throw new AppError('AI_UPSTREAM', 'AI 服务返回的模型列表数据格式异常', { cause: error })
    }
    const data = payload?.data
    if (!Array.isArray(data)) {
      throw new AppError('AI_UPSTREAM', 'AI 服务返回的模型列表格式异常（缺少 data 数组）')
    }
    return {
      models: data
        .map((item) => (typeof item === 'string' ? item : item?.id))
        .filter((id) => typeof id === 'string' && id.length > 0),
      baseUrl: config.baseUrl,
      endpoint
    }
  }

  /**
   * 一次上游 HTTP 请求（非流式）。
   * @param {ReturnType<typeof requireChat>} config
   * @param {{ messages: object[], temperature: number, maxTokens: number, jsonMode: boolean }} body
   * @param {AbortSignal | undefined} signal
   * @param {number} [timeoutMs] 本次调用的超时覆盖（默认用 settings.ai.timeoutMs）
   * @returns {Promise<{ content: string, usage: object | null }>}
   */
  async function requestJsonOnce(config, body, signal, timeoutMs) {
    const endpoint = `${config.baseUrl}/chat/completions`
    const payload = {
      model: config.model,
      messages: body.messages,
      temperature: body.temperature,
      max_tokens: body.maxTokens
    }
    if (body.jsonMode) payload.response_format = { type: 'json_object' }
    const response = await fetchText(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(payload),
      timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : config.timeoutMs,
      signal
    })
    if (response.status < 200 || response.status >= 300) throw mapHttpError(response.status)
    return parseChatResponse(response.text)
  }

  /**
   * 一次流式上游请求（SSE）。
   * @param {ReturnType<typeof requireChat>} config
   * @param {{ messages: object[], temperature: number, maxTokens: number }} body
   * @param {{ signal?: AbortSignal, onDelta?: (text: string) => void }} options
   * @returns {Promise<{ content: string, usage: object | null }>}
   */
  async function requestStreamOnce(config, body, options) {
    const controller = new AbortController()
    let timedOut = false
    let totalTimedOut = false
    /** @type {NodeJS.Timeout | null} */
    let idleTimer = null
    const onAbort = () => controller.abort()
    if (options.signal) {
      if (options.signal.aborted) throw new CancelledError()
      options.signal.addEventListener('abort', onAbort, { once: true })
    }
    const totalTimer = setTimeout(() => {
      totalTimedOut = true
      controller.abort()
    }, STREAM_TOTAL_TIMEOUT_MS)
    const resetIdle = () => {
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, STREAM_IDLE_TIMEOUT_MS)
    }
    const endpoint = `${config.baseUrl}/chat/completions`
    /** @type {ReadableStreamDefaultReader<Uint8Array> | null} */
    let reader = null
    try {
      resetIdle()
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream'
        },
        body: JSON.stringify({
          model: config.model,
          messages: body.messages,
          temperature: body.temperature,
          max_tokens: body.maxTokens,
          stream: true
        }),
        signal: controller.signal
      })
      if (response.status < 200 || response.status >= 300) {
        throw mapHttpError(response.status)
      }
      if (!response.body) throw new AppError('AI_UPSTREAM', 'AI 服务未返回流式响应')
      reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let content = ''
      let usage = null
      let done = false
      while (!done) {
        const chunk = await reader.read()
        if (chunk.done) break
        resetIdle()
        buffer += decoder.decode(chunk.value, { stream: true })
        let lineEnd = buffer.indexOf('\n')
        while (lineEnd >= 0) {
          const line = buffer.slice(0, lineEnd).trim()
          buffer = buffer.slice(lineEnd + 1)
          lineEnd = buffer.indexOf('\n')
          if (line.length === 0 || line.startsWith(':')) continue
          if (!line.startsWith('data:')) continue
          const data = line.slice(5).trim()
          if (data === '[DONE]') {
            done = true
            break
          }
          let frame
          try {
            frame = JSON.parse(data)
          } catch {
            // 单个坏帧跳过，不中断整段回答
            continue
          }
          if (frame?.usage) usage = frame.usage
          const delta = frame?.choices?.[0]?.delta?.content
          if (typeof delta === 'string' && delta.length > 0) {
            content += delta
            options.onDelta?.(delta)
          }
        }
      }
      if (content.length === 0) throw new AppError('AI_UPSTREAM', 'AI 流式响应为空')
      return { content, usage }
    } catch (error) {
      if (error instanceof AppError) throw error
      if (options.signal?.aborted) throw new CancelledError()
      if (timedOut || totalTimedOut || error?.name === 'AbortError') {
        throw new AppError('AI_TIMEOUT', 'AI 应答超时（流式空闲超过 30 秒或总时长超过 180 秒）', {
          cause: error
        })
      }
      throw new AppError('AI_UPSTREAM', 'AI 流式应答中断，请重试', { cause: error })
    } finally {
      clearTimeout(totalTimer)
      if (idleTimer) clearTimeout(idleTimer)
      if (options.signal) options.signal.removeEventListener('abort', onAbort)
      if (reader) {
        try {
          await reader.cancel()
        } catch {
          // 中断后 reader 已关闭
        }
      }
    }
  }

  /**
   * 传输层重试（超时/5xx/网络；429 退避 1 次）；流式仅在尚未输出时重试。
   * @param {ReturnType<typeof requireChat>} config
   * @param {Object} options
   * @returns {Promise<{ content: string, usage: object | null }>}
   */
  async function callTransport(config, options) {
    let transportRetries = 0
    let rateLimitRetried = false
    let emitted = false
    const onDelta = options.onDelta
      ? (text) => {
          emitted = true
          options.onDelta(text)
        }
      : undefined
    while (true) {
      try {
        if (options.stream) {
          return await requestStreamOnce(
            config,
            {
              messages: options.messages,
              temperature: options.temperature,
              maxTokens: options.maxTokens
            },
            { signal: options.signal, onDelta }
          )
        }
        return await requestJsonOnce(
          config,
          {
            messages: options.messages,
            temperature: options.temperature,
            maxTokens: options.maxTokens,
            jsonMode: options.jsonMode
          },
          options.signal,
          options.timeoutMs
        )
      } catch (error) {
        if (error instanceof CancelledError) throw error
        if (error instanceof AppError && error.code === 'AI_RATE_LIMIT' && !rateLimitRetried) {
          rateLimitRetried = true
          await sleep(RATE_LIMIT_DELAY_MS, options.signal)
          continue
        }
        const retryable =
          error instanceof AppError &&
          (error.code === 'AI_TIMEOUT' ||
            (error.code === 'AI_UPSTREAM' && error.transportRetryable !== false)) &&
          (!options.stream || !emitted)
        if (retryable && transportRetries < config.retry) {
          const delay = RETRY_DELAYS[Math.min(transportRetries, RETRY_DELAYS.length - 1)]
          transportRetries += 1
          await sleep(delay, options.signal)
          continue
        }
        throw error
      }
    }
  }

  return {
    /**
     * 非流式 JSON 任务：重试合并、格式修复 1 次、可按策略降级；一条 ai_calls。
     * @param {{
     *   ai: object,
     *   messages: object[],
     *   purpose: string,
     *   promptId?: string,
     *   promptVersion?: string,
     *   promptPreview?: string,
     *   temperature?: number,
     *   maxTokens?: number,
     *   jsonMode?: boolean,
     *   timeoutMs?: number,
     *   parse?: (raw: string) => unknown,
     *   repairHint?: string,
     *   onFormat?: 'throw' | 'degrade',
     *   signal?: AbortSignal
     * }} options
     * @returns {Promise<{ status: 'ok' | 'degraded', value: unknown, rawText: string, usage: { input: number, output: number }, durationMs: number }>}
     */
    async chatJson(options) {
      const startedAt = Date.now()
      const config = requireChat(options.ai)
      const meta = {
        purpose: options.purpose,
        promptId: options.promptId ?? null,
        promptVersion: options.promptVersion ?? null,
        model: config.model,
        promptPreview:
          options.promptPreview ??
          (options.messages.length > 0
            ? String(options.messages[options.messages.length - 1].content ?? '')
            : null)
      }
      let usageTotals = { input: 0, output: 0 }
      try {
        const outcome = await queue.run(
          async () => {
            const messages = [...options.messages]
            let formatRetried = false
            while (true) {
              const attempt = await callTransport(config, {
                messages,
                temperature: options.temperature ?? 0.2,
                maxTokens: options.maxTokens ?? 500,
                jsonMode: options.jsonMode ?? false,
                timeoutMs: options.timeoutMs,
                signal: options.signal,
                stream: false
              })
              usageTotals = addUsage(usageTotals, attempt.usage)
              if (typeof options.parse !== 'function') {
                return { status: 'ok', value: attempt.content, rawText: attempt.content }
              }
              try {
                return {
                  status: 'ok',
                  value: options.parse(attempt.content),
                  rawText: attempt.content
                }
              } catch (formatError) {
                if (!formatRetried) {
                  formatRetried = true
                  messages.push({
                    role: 'user',
                    content:
                      options.repairHint ??
                      '上次输出不是合法 JSON，请只输出 JSON 对象，不要任何多余文字。'
                  })
                  continue
                }
                if (options.onFormat === 'degrade') {
                  return { status: 'degraded', value: null, rawText: attempt.content }
                }
                throw formatError instanceof AppError
                  ? formatError
                  : new AppError('AI_FORMAT', 'AI 输出格式不合法', { cause: formatError })
              }
            }
          },
          { signal: options.signal }
        )
        const durationMs = Date.now() - startedAt
        record({
          ...meta,
          status: outcome.status,
          durationMs,
          inputTokens: usageTotals.input,
          outputTokens: usageTotals.output
        })
        return { ...outcome, usage: usageTotals, durationMs }
      } catch (error) {
        record({
          ...meta,
          status: 'error',
          error: errorToText(error),
          durationMs: Date.now() - startedAt,
          inputTokens: usageTotals.input,
          outputTokens: usageTotals.output
        })
        throw error
      }
    },

    /**
     * 流式 Markdown 任务（追问/复盘自由提问）。
     * @param {{
     *   ai: object,
     *   messages: object[],
     *   purpose: string,
     *   promptId?: string,
     *   promptVersion?: string,
     *   promptPreview?: string,
     *   temperature?: number,
     *   maxTokens?: number,
     *   onDelta?: (text: string) => void,
     *   signal?: AbortSignal
     * }} options
     * @returns {Promise<{ content: string, usage: { input: number, output: number }, durationMs: number }>}
     */
    async chatStream(options) {
      const startedAt = Date.now()
      const config = requireChat(options.ai)
      const meta = {
        purpose: options.purpose,
        promptId: options.promptId ?? null,
        promptVersion: options.promptVersion ?? null,
        model: config.model,
        promptPreview: options.promptPreview ?? null
      }
      try {
        const outcome = await queue.run(
          () =>
            callTransport(config, {
              messages: options.messages,
              temperature: options.temperature ?? 0.4,
              maxTokens: options.maxTokens ?? 1200,
              stream: true,
              onDelta: options.onDelta,
              signal: options.signal
            }),
          { signal: options.signal }
        )
        const durationMs = Date.now() - startedAt
        const usage = addUsage({ input: 0, output: 0 }, outcome.usage)
        record({
          ...meta,
          status: 'ok',
          durationMs,
          inputTokens: usage.input,
          outputTokens: usage.output
        })
        return { content: outcome.content, usage, durationMs }
      } catch (error) {
        record({
          ...meta,
          status: 'error',
          error: errorToText(error),
          durationMs: Date.now() - startedAt
        })
        throw error
      }
    },

    /**
     * 模型列表（GET /models，一条 ai_calls，purpose=models）。
     * @param {object} ai
     * @returns {Promise<{ models: string[], baseUrl: string, endpoint: string, latencyMs: number }>}
     */
    async listModels(ai) {
      const startedAt = Date.now()
      let config
      try {
        config = requireBase(ai)
        const result = await queue.run(async () => {
          const modelsResult = await fetchModels(config)
          return { ...modelsResult, latencyMs: Date.now() - startedAt }
        })
        record({
          purpose: 'models',
          model: config.model || null,
          status: 'ok',
          durationMs: Date.now() - startedAt
        })
        return result
      } catch (error) {
        record({
          purpose: 'models',
          model: config?.model || null,
          status: 'error',
          error: errorToText(error),
          durationMs: Date.now() - startedAt
        })
        throw error
      }
    },

    /**
     * 测试连接：优先 /models，失败退化为最小对话；一条 ai_calls，purpose=test。
     * @param {object} ai
     * @returns {Promise<{ mode: 'models' | 'chat', models: string[], model: string, latencyMs: number }>}
     */
    async testConnection(ai) {
      const startedAt = Date.now()
      let config
      try {
        config = requireBase(ai)
        const result = await queue.run(async () => {
          let modelsResult
          try {
            modelsResult = await fetchModels(config)
          } catch (modelsError) {
            if (modelsError instanceof AppError && modelsError.code === 'AI_NOT_CONFIGURED') {
              throw modelsError
            }
            if (!config.model) throw modelsError
            // /models 不可用时退化为一次最小对话请求（TECH-DESIGN §4.2 #4）
            const response = await fetchText(`${config.baseUrl}/chat/completions`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${config.apiKey}`,
                'Content-Type': 'application/json',
                Accept: 'application/json'
              },
              body: JSON.stringify({
                model: config.model,
                messages: [{ role: 'user', content: 'ping' }],
                max_tokens: 1,
                temperature: 0
              }),
              timeoutMs: config.timeoutMs
            })
            if (response.status < 200 || response.status >= 300) throw mapHttpError(response.status)
            return { mode: 'chat', models: [] }
          }
          return { mode: 'models', models: modelsResult.models }
        })
        record({
          purpose: 'test',
          model: config.model || null,
          status: 'ok',
          durationMs: Date.now() - startedAt
        })
        return {
          mode: result.mode,
          models: result.models,
          model: config.model || '',
          latencyMs: Date.now() - startedAt
        }
      } catch (error) {
        record({
          purpose: 'test',
          model: config?.model || null,
          status: 'error',
          error: errorToText(error),
          durationMs: Date.now() - startedAt
        })
        throw error
      }
    }
  }
}

export default createAiClient
