/**
 * ReadLoop API 客户端。
 * 统一 JSON 请求、30s 默认超时、错误信封 { ok:false, error:{ code, message, retryable, detail } }。
 */

export const DEFAULT_TIMEOUT_MS = 30000

const HTTP_STATUS_CODE = {
  400: 'VALIDATION',
  404: 'NOT_FOUND',
  409: 'STATE_CONFLICT',
  413: 'FILE_TOO_LARGE',
  415: 'UNSUPPORTED_FORMAT',
  429: 'AI_RATE_LIMIT',
  500: 'INTERNAL',
  502: 'AI_UPSTREAM',
  503: 'DICT_UNAVAILABLE',
  504: 'AI_TIMEOUT'
}

/** 统一错误对象：code 为错误码，message 为可直接展示的中文原因。 */
export class ApiError extends Error {
  constructor({ code = 'INTERNAL', message = '请求失败', retryable = false, detail = null, status = 0 }) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.retryable = retryable
    this.detail = detail
    this.status = status
  }
}

function envelopeError(data, status) {
  const error = data && typeof data === 'object' ? data.error : null
  if (error && typeof error === 'object') {
    return new ApiError({
      code: error.code || HTTP_STATUS_CODE[status] || 'INTERNAL',
      message: error.message || '请求失败',
      retryable: Boolean(error.retryable),
      detail: error.detail ?? null,
      status
    })
  }
  return new ApiError({
    code: HTTP_STATUS_CODE[status] || (status >= 500 ? 'INTERNAL' : 'VALIDATION'),
    message: `本地服务返回错误（HTTP ${status}）`,
    retryable: status >= 500,
    status
  })
}

/**
 * 发起一次 JSON 请求。
 * @param {'GET'|'POST'|'PUT'|'PATCH'|'DELETE'} method
 * @param {string} path 以 /api 开头的路径
 * @param {{ body?: unknown, timeoutMs?: number, signal?: AbortSignal }} [options]
 * @returns {Promise<any>} 解析后的 JSON（成功信封）
 */
export async function request(method, path, { body, timeoutMs = DEFAULT_TIMEOUT_MS, signal } = {}) {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  try {
    const headers = { Accept: 'application/json' }
    let payload
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
      payload = JSON.stringify(body)
    }
    const res = await fetch(path, {
      method,
      headers,
      body: payload,
      signal: controller.signal,
      credentials: 'same-origin'
    })
    const text = await res.text()
    let data = null
    if (text) {
      try {
        data = JSON.parse(text)
      } catch {
        data = null
      }
    }
    if (!res.ok) throw envelopeError(data, res.status)
    if (data && typeof data === 'object' && data.ok === false) throw envelopeError(data, res.status)
    return data
  } catch (err) {
    if (err instanceof ApiError) throw err
    if (timedOut) {
      throw new ApiError({
        code: 'CLIENT_TIMEOUT',
        message: `请求超时（${Math.round(timeoutMs / 1000)} 秒未响应）`,
        retryable: true
      })
    }
    if (err && err.name === 'AbortError') {
      throw new ApiError({ code: 'ABORTED', message: '请求已取消', retryable: false })
    }
    throw new ApiError({
      code: 'NETWORK',
      message: '无法连接本地服务，请确认 ReadLoop 服务正在运行',
      retryable: true
    })
  } finally {
    clearTimeout(timer)
  }
}

export function get(path, options) {
  return request('GET', path, options)
}

export function post(path, body, options) {
  return request('POST', path, { ...options, body })
}

export function put(path, body, options) {
  return request('PUT', path, { ...options, body })
}

export function patch(path, body, options) {
  return request('PATCH', path, { ...options, body })
}

export function del(path, options) {
  return request('DELETE', path, options)
}

export function isApiError(err) {
  return err instanceof ApiError
}

/** 把任意异常转成可展示的中文原因（不含技术堆栈）。 */
export function describeError(err) {
  if (err instanceof ApiError) return err.message
  if (err && typeof err === 'object' && typeof err.message === 'string' && err.message) return err.message
  return '发生未预期错误'
}
