import assert from 'node:assert/strict'
import http from 'node:http'
import { after, before, beforeEach, describe, it } from 'node:test'
import { createAiClient } from '../../lib/aiClient.js'
import { createAiQueue } from '../../lib/aiQueue.js'
import { parseCorrection } from '../../prompts/correct-v1.js'

const CORRECT_JSON = JSON.stringify({
  issues: [{ type: '误译', fragment: '非常感兴趣', explain: '应译有趣' }],
  referenceTranslation: '这个图书馆非常安静。'
})

/**
 * 测试用 OpenAI 兼容上游：按 plan 队列逐次返回 JSON / SSE / HTTP 错误 / 挂起。
 * @param {number} port
 */
function startUpstream(port) {
  const state = {
    /** 收到的 chat 请求体 */
    requests: [],
    /** 每次 chat 请求的计划；为空时默认返回合法 JSON */
    plan: [],
    concurrent: 0,
    maxConcurrent: 0
  }

  /**
   * @param {import('node:http').ServerResponse} res
   * @param {unknown} payload
   * @param {number} status
   */
  function sendJson(res, payload, status = 200) {
    const body = JSON.stringify(payload)
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body)
    })
    res.end(body)
  }

  /**
   * @param {import('node:http').ServerResponse} res
   * @param {{ content: string, cancelAfter?: number | null }} plan
   */
  function streamSse(res, plan) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })
    const pieces = plan.content.match(/[\s\S]{1,6}/g) ?? ['']
    let index = 0
    const timer = setInterval(() => {
      if (plan.cancelAfter != null && index >= plan.cancelAfter) {
        clearInterval(timer)
        res.destroy()
        return
      }
      if (index >= pieces.length) {
        clearInterval(timer)
        res.write(
          `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 20 } })}\n\n`
        )
        res.write('data: [DONE]\n\n')
        res.end()
        return
      }
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { content: pieces[index++] } }] })}\n\n`
      )
    }, 5)
    res.on('close', () => clearInterval(timer))
  }

  /**
   * @param {import('node:http').ServerResponse} res
   * @param {object} plan
   */
  function handle(res, plan) {
    if (plan.type === 'http-error') {
      sendJson(res, { error: { message: 'boom' } }, plan.status)
      return
    }
    if (plan.type === 'hang') return
    if (plan.type === 'sse') {
      streamSse(res, { content: plan.content, cancelAfter: plan.cancelAfter ?? null })
      return
    }
    sendJson(res, {
      choices: [{ message: { content: plan.content ?? CORRECT_JSON } }],
      usage: { prompt_tokens: 100, completion_tokens: 80 }
    })
  }

  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      if (req.url === '/v1/models') {
        sendJson(res, { object: 'list', data: [{ id: 'mock-model' }, { id: 'mock-model-2' }] })
        return
      }
      if (req.url !== '/v1/chat/completions') {
        sendJson(res, { error: 'not found' }, 404)
        return
      }
      let body = {}
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      } catch {
        body = {}
      }
      state.requests.push(body)
      state.concurrent += 1
      state.maxConcurrent = Math.max(state.maxConcurrent, state.concurrent)
      res.on('close', () => {
        state.concurrent = Math.max(0, state.concurrent - 1)
      })
      const plan = state.plan.length > 0 ? state.plan.shift() : { type: 'json' }
      if (plan.delayMs) {
        setTimeout(() => handle(res, plan), plan.delayMs)
        return
      }
      handle(res, plan)
    })
  })

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      resolve({
        server,
        port,
        state,
        baseUrl: `http://127.0.0.1:${port}`,
        reset() {
          state.requests.length = 0
          state.plan.length = 0
          state.concurrent = 0
          state.maxConcurrent = 0
        }
      })
    })
  })
}

describe('aiClient（03-AI-SPEC §1/§3/§4）', () => {
  /** @type {Awaited<ReturnType<typeof startUpstream>>} */
  let upstream

  before(async () => {
    upstream = await startUpstream(20000 + Math.floor(Math.random() * 10000))
  })

  after(async () => {
    upstream.server.closeAllConnections()
    await new Promise((resolve) => upstream.server.close(resolve))
  })

  beforeEach(() => {
    upstream.reset()
  })

  /**
   * @param {Record<string, unknown>} [aiOverrides]
   * @returns {{ client: ReturnType<typeof createAiClient>, aiCalls: { rows: object[] }, queue: ReturnType<typeof createAiQueue>, ai: Record<string, unknown> }}
   */
  function makeClient(aiOverrides = {}) {
    /** @type {{ rows: object[] }} */
    const aiCalls = {
      rows: [],
      insert(entry) {
        this.rows.push(entry)
        return this.rows.length
      }
    }
    const queue = createAiQueue({ capacity: 32, queueTimeoutMs: 5000 })
    const client = createAiClient({
      aiCalls,
      queue,
      logger: { warn() {} }
    })
    const ai = {
      baseUrl: upstream.baseUrl,
      apiKey: 'sk-unit-test',
      model: 'mock-model',
      timeoutMs: 2000,
      retry: 0,
      ...aiOverrides
    }
    return { client, aiCalls, queue, ai }
  }

  /**
   * @param {string} translation
   * @returns {Promise<{ status: string, value: object }>}
   */
  async function runCorrect(client, ai) {
    return client.chatJson({
      ai,
      messages: [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'article-prefix' },
        { role: 'user', content: 'task' }
      ],
      purpose: 'correct',
      promptId: 'correct',
      promptVersion: 'correct-v1',
      promptPreview: 'task',
      temperature: 0.2,
      maxTokens: 500,
      jsonMode: true,
      parse: parseCorrection,
      onFormat: 'degrade'
    })
  }

  it('chatJson 成功：请求参数正确、解析成功、写一条 ok ai_calls', async () => {
    const { client, aiCalls, ai } = makeClient()
    const result = await runCorrect(client, ai)
    assert.equal(result.status, 'ok')
    assert.equal(result.value.referenceTranslation, '这个图书馆非常安静。')
    assert.equal(result.usage.input, 100)
    assert.equal(result.usage.output, 80)

    const request = upstream.state.requests[0]
    assert.equal(request.model, 'mock-model')
    assert.equal(request.temperature, 0.2)
    assert.equal(request.max_tokens, 500)
    assert.deepEqual(request.response_format, { type: 'json_object' })

    assert.equal(aiCalls.rows.length, 1)
    const row = aiCalls.rows[0]
    assert.equal(row.purpose, 'correct')
    assert.equal(row.promptVersion, 'correct-v1')
    assert.equal(row.model, 'mock-model')
    assert.equal(row.status, 'ok')
    assert.equal(row.inputTokens, 100)
    assert.equal(row.outputTokens, 80)
    assert.ok(row.durationMs >= 0)
    assert.ok(typeof row.createdAt === 'string')
    assert.equal(row.promptPreview, 'task')
  })

  it('prompt_preview 最多 500 字（不存完整 prompt）', async () => {
    const { client, aiCalls, ai } = makeClient()
    await client.chatJson({
      ai,
      messages: [{ role: 'user', content: 'x'.repeat(2000) }],
      purpose: 'correct',
      promptPreview: 'p'.repeat(600),
      parse: parseCorrection,
      onFormat: 'degrade'
    })
    assert.equal(aiCalls.rows[0].promptPreview.length, 500)
    assert.doesNotMatch(JSON.stringify(aiCalls.rows[0]), /sk-unit-test/)
  })

  it('格式修复重试：非法 JSON → 追加严格提示重试 1 次后成功（合并一条 ai_calls）', async () => {
    const { client, aiCalls, ai } = makeClient()
    upstream.state.plan.push({ type: 'json', content: 'not json at all' }, { type: 'json' })
    const result = await runCorrect(client, ai)
    assert.equal(result.status, 'ok')
    assert.equal(upstream.state.requests.length, 2)
    assert.equal(aiCalls.rows.length, 1)
    assert.equal(aiCalls.rows[0].status, 'ok')
    const repairMessage = upstream.state.requests[1].messages.at(-1)
    assert.match(repairMessage.content, /请只输出 JSON 对象/)
    assert.equal(aiCalls.rows[0].inputTokens, 200)
  })

  it('格式修复后仍非法 → 降级（status=degraded，ai_calls=degraded，保留 rawText）', async () => {
    const { client, aiCalls, ai } = makeClient()
    upstream.state.plan.push(
      { type: 'json', content: 'not json' },
      { type: 'json', content: '{"wrong":true}' }
    )
    const result = await runCorrect(client, ai)
    assert.equal(result.status, 'degraded')
    assert.equal(result.rawText, '{"wrong":true}')
    assert.equal(upstream.state.requests.length, 2)
    assert.equal(aiCalls.rows.length, 1)
    assert.equal(aiCalls.rows[0].status, 'degraded')
  })

  it('不允许降级时格式非法 → AI_FORMAT 且 ai_calls=error', async () => {
    const { client, aiCalls, ai } = makeClient()
    upstream.state.plan.push({ type: 'json', content: 'bad' }, { type: 'json', content: 'bad' })
    await assert.rejects(
      runCorrectWithoutDegrade(client, ai),
      (error) => error.code === 'AI_FORMAT'
    )
    assert.equal(aiCalls.rows.length, 1)
    assert.equal(aiCalls.rows[0].status, 'error')
    assert.match(aiCalls.rows[0].error, /AI_FORMAT/)
  })

  it('5xx 按 retry 重试后成功；ai_calls 只记一条且耗时包含退避', async () => {
    const { client, aiCalls, ai } = makeClient({ retry: 1 })
    upstream.state.plan.push({ type: 'http-error', status: 500 })
    const startedAt = Date.now()
    const result = await runCorrect(client, ai)
    assert.equal(result.status, 'ok')
    assert.equal(upstream.state.requests.length, 2)
    assert.equal(aiCalls.rows.length, 1)
    assert.equal(aiCalls.rows[0].status, 'ok')
    assert.ok(Date.now() - startedAt >= 500)
  })

  it('429 退避 1 次后仍 429 → AI_RATE_LIMIT（一条 error ai_calls）', async () => {
    const { client, aiCalls, ai } = makeClient({ retry: 0 })
    upstream.state.plan.push(
      { type: 'http-error', status: 429 },
      { type: 'http-error', status: 429 }
    )
    const startedAt = Date.now()
    await assert.rejects(runCorrect(client, ai), (error) => error.code === 'AI_RATE_LIMIT')
    assert.equal(upstream.state.requests.length, 2)
    assert.ok(Date.now() - startedAt >= 1000)
    assert.equal(aiCalls.rows.length, 1)
    assert.equal(aiCalls.rows[0].status, 'error')
  })

  it('401 → AI_NOT_CONFIGURED 且不重试', async () => {
    const { client, aiCalls, ai } = makeClient({ retry: 2 })
    upstream.state.plan.push({ type: 'http-error', status: 401 })
    await assert.rejects(runCorrect(client, ai), (error) => error.code === 'AI_NOT_CONFIGURED')
    assert.equal(upstream.state.requests.length, 1)
    assert.equal(aiCalls.rows[0].status, 'error')
  })

  it('超时 → AI_TIMEOUT（ai_calls=error）', async () => {
    const { client, aiCalls, ai } = makeClient({ timeoutMs: 1000, retry: 0 })
    upstream.state.plan.push({ type: 'hang' })
    await assert.rejects(runCorrect(client, ai), (error) => error.code === 'AI_TIMEOUT')
    assert.equal(aiCalls.rows.length, 1)
    assert.equal(aiCalls.rows[0].status, 'error')
  })

  it('chatJson 的 timeoutMs 覆盖全局超时（出题 180s 场景）', async () => {
    const { client, aiCalls, ai } = makeClient({ timeoutMs: 60_000, retry: 0 })
    upstream.state.plan.push({ type: 'hang' })
    const startedAt = Date.now()
    await assert.rejects(
      client.chatJson({
        ai,
        messages: [{ role: 'user', content: 'recap questions' }],
        purpose: 'recap_questions',
        timeoutMs: 120,
        parse: parseCorrection,
        onFormat: 'degrade'
      }),
      (error) => error.code === 'AI_TIMEOUT'
    )
    // 覆盖生效：120ms 左右就失败，而不是等 60s 的全局超时
    assert.ok(Date.now() - startedAt < 2000, '应使用本次调用的 timeoutMs，而不是全局 60s')
    assert.equal(aiCalls.rows.length, 1)
    assert.equal(aiCalls.rows[0].status, 'error')
  })

  it('客户端取消 → CancelledError 且 ai_calls=error', async () => {
    const { client, aiCalls, ai } = makeClient()
    upstream.state.plan.push({ type: 'hang' })
    const controller = new AbortController()
    const pending = client.chatJson({
      ai,
      messages: [{ role: 'user', content: 'task' }],
      purpose: 'correct',
      parse: parseCorrection,
      onFormat: 'degrade',
      signal: controller.signal
    })
    setTimeout(() => controller.abort(), 100)
    await assert.rejects(pending, (error) => error.code === 'CANCELLED')
    assert.equal(aiCalls.rows.length, 1)
    assert.equal(aiCalls.rows[0].status, 'error')
    assert.match(aiCalls.rows[0].error, /CANCELLED/)
  })

  it('chatStream：SSE delta 拼接、usage、ai_calls ok', async () => {
    const { client, aiCalls, ai } = makeClient()
    upstream.state.plan.push({ type: 'sse', content: '这句话的讲解内容。' })
    /** @type {string[]} */
    const deltas = []
    const result = await client.chatStream({
      ai,
      messages: [
        { role: 'system', content: 'followup-system' },
        { role: 'user', content: 'article-prefix' },
        { role: 'user', content: 'question' }
      ],
      purpose: 'followup',
      promptId: 'followup',
      promptVersion: 'followup-v1',
      promptPreview: 'question',
      onDelta: (text) => deltas.push(text)
    })
    assert.equal(result.content, '这句话的讲解内容。')
    assert.equal(deltas.join(''), '这句话的讲解内容。')
    assert.equal(result.usage.output, 20)
    assert.equal(upstream.state.requests[0].stream, true)
    assert.equal(upstream.state.requests[0].temperature, 0.4)
    assert.equal(aiCalls.rows.length, 1)
    assert.equal(aiCalls.rows[0].status, 'ok')
    assert.equal(aiCalls.rows[0].purpose, 'followup')
  })

  it('chatStream 中断 → AI_UPSTREAM，已产出 delta 保留', async () => {
    const { client, aiCalls, ai } = makeClient()
    upstream.state.plan.push({
      type: 'sse',
      content: '中断测试内容需要更多分片才能触发中断',
      cancelAfter: 1
    })
    /** @type {string[]} */
    const deltas = []
    await assert.rejects(
      client.chatStream({
        ai,
        messages: [{ role: 'user', content: 'question' }],
        purpose: 'followup',
        onDelta: (text) => deltas.push(text)
      }),
      (error) => error.code === 'AI_UPSTREAM'
    )
    assert.ok(deltas.length >= 1)
    assert.equal(aiCalls.rows[0].status, 'error')
  })

  it('串行队列：并发两次调用上游最大并发为 1', async () => {
    const { client, ai } = makeClient()
    upstream.state.plan.push({ type: 'json', delayMs: 80 }, { type: 'json', delayMs: 80 })
    await Promise.all([runCorrect(client, ai), runCorrect(client, ai)])
    assert.equal(
      upstream.state.maxConcurrent,
      1,
      `requests=${upstream.state.requests.length} maxConcurrent=${upstream.state.maxConcurrent}`
    )
  })

  it('listModels / testConnection 各写一条 ai_calls', async () => {
    const { client, aiCalls, ai } = makeClient()
    const models = await client.listModels(ai)
    assert.deepEqual(models.models, ['mock-model', 'mock-model-2'])
    assert.match(models.endpoint, /\/v1\/models$/)
    const tested = await client.testConnection(ai)
    assert.equal(tested.mode, 'models')
    assert.equal(tested.model, 'mock-model')
    assert.equal(aiCalls.rows.length, 2)
    assert.deepEqual(
      aiCalls.rows.map((row) => row.purpose),
      ['models', 'test']
    )
    assert.ok(aiCalls.rows.every((row) => row.status === 'ok'))
  })
})

/**
 * 不允许降级的批改调用（AI_FORMAT 分支）。
 * @param {ReturnType<typeof createAiClient>} client
 * @param {Record<string, unknown>} ai
 */
async function runCorrectWithoutDegrade(client, ai) {
  return client.chatJson({
    ai,
    messages: [{ role: 'user', content: 'task' }],
    purpose: 'correct',
    parse: parseCorrection
  })
}
