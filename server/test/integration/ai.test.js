import assert from 'node:assert/strict'
import http from 'node:http'
import { after, before, describe, it } from 'node:test'
import { startTestApp } from '../helpers/temp-db.js'

/**
 * 起一个本地 mock AI（OpenAI 兼容），用于验证 /api/ai/test 与 /api/ai/models。
 * 路径约定：/v1/models 正常；/fail/* 返回 500；/chatonly/* 仅 chat 可用；/hang/* 不响应。
 * @returns {Promise<{ server: import('node:http').Server, port: number, baseUrl: string, requests: object[] }>}
 */
async function startMockAi() {
  const requests = []
  const server = http.createServer((req, res) => {
    const pathname = String(req.url ?? '').split('?')[0]
    requests.push({ method: req.method, url: req.url, headers: req.headers })
    if (pathname.startsWith('/hang/')) return
    if (pathname === '/v1/models' || pathname === '/v1/chat/completions') {
      if (pathname === '/v1/models') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({ object: 'list', data: [{ id: 'mock-model' }, { id: 'mock-model-2' }] })
        )
      } else {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ choices: [{ message: { content: 'pong' } }] }))
      }
      return
    }
    if (pathname.startsWith('/chatonly/v1/models')) {
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end('{"error":"models unavailable"}')
      return
    }
    if (pathname.startsWith('/chatonly/v1/chat/completions')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: 'pong' } }] }))
      return
    }
    if (pathname.startsWith('/fail/')) {
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end('{"error":"upstream boom"}')
      return
    }
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end('{}')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  return { server, port, baseUrl: `http://127.0.0.1:${port}`, requests }
}

/**
 * @param {import('node:http').Server} server
 * @returns {Promise<void>}
 */
function stopMockAi(server) {
  return new Promise((resolve) => {
    server.close(() => resolve())
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections()
  })
}

describe('M1-05 AI 测试连接与模型列表（SET-05/06）', () => {
  /** @type {Awaited<ReturnType<typeof startTestApp>>} */
  let ctx
  /** @type {Awaited<ReturnType<typeof startMockAi>>} */
  let mock

  before(async () => {
    mock = await startMockAi()
    ctx = await startTestApp()
  })

  after(async () => {
    await ctx.close()
    await stopMockAi(mock.server)
  })

  /**
   * @param {Record<string, unknown>} ai
   */
  async function saveAi(ai) {
    const response = await ctx.request('PUT', '/api/settings', { ai })
    assert.equal(response.status, 200, `保存设置失败: ${response.text}`)
    return response
  }

  it('未配置 AI 时 /api/ai/models 与 /api/ai/test 返回 AI_NOT_CONFIGURED 400', async () => {
    const models = await ctx.request('GET', '/api/ai/models')
    assert.equal(models.status, 400)
    assert.equal(models.json.error.code, 'AI_NOT_CONFIGURED')
    assert.equal(models.json.error.retryable, false)
    assert.match(models.json.error.message, /设置/)

    const test = await ctx.request('POST', '/api/ai/test')
    assert.equal(test.status, 400)
    assert.equal(test.json.error.code, 'AI_NOT_CONFIGURED')
  })

  it('保存配置后 GET /api/ai/models 返回模型列表、耗时与归一化 baseUrl', async () => {
    await saveAi({ baseUrl: mock.baseUrl, apiKey: 'sk-mock-1234', model: 'mock-model' })
    const response = await ctx.request('GET', '/api/ai/models')
    assert.equal(response.status, 200)
    assert.equal(response.json.ok, true)
    assert.deepEqual(response.json.models, ['mock-model', 'mock-model-2'])
    assert.equal(response.json.count, 2)
    assert.match(response.json.baseUrl, /\/v1$/)
    assert.match(response.json.endpoint, /\/v1\/models$/)
    assert.equal(typeof response.json.latencyMs, 'number')

    const lastRequest = mock.requests.filter((item) => item.url === '/v1/models').at(-1)
    assert.equal(lastRequest.headers.authorization, 'Bearer sk-mock-1234')
  })

  it('POST /api/ai/test 空 body：优先 /models 成功，返回 mode=models', async () => {
    const response = await ctx.request('POST', '/api/ai/test')
    assert.equal(response.status, 200)
    assert.equal(response.json.ok, true)
    assert.equal(response.json.mode, 'models')
    assert.deepEqual(response.json.models, ['mock-model', 'mock-model-2'])
    assert.equal(response.json.model, 'mock-model')
    assert.equal(typeof response.json.latencyMs, 'number')
  })

  it('POST /api/ai/test 兼容前端回传已保存配置（打码 Key 视为保留原值）', async () => {
    const response = await ctx.request('POST', '/api/ai/test', {
      baseUrl: mock.baseUrl,
      apiKey: '****1234',
      model: 'mock-model'
    })
    assert.equal(response.status, 200)
    assert.equal(response.json.mode, 'models')
    const lastRequest = mock.requests.filter((item) => item.url === '/v1/models').at(-1)
    assert.equal(lastRequest.headers.authorization, 'Bearer sk-mock-1234')
  })

  it('上游 500 → /api/ai/models 返回 AI_UPSTREAM 502（retryable=true，中文 message）', async () => {
    await saveAi({ baseUrl: `${mock.baseUrl}/fail`, apiKey: 'sk-mock-1234', model: 'mock-model' })
    const response = await ctx.request('GET', '/api/ai/models')
    assert.equal(response.status, 502)
    assert.equal(response.json.error.code, 'AI_UPSTREAM')
    assert.equal(response.json.error.retryable, true)
    assert.match(response.json.error.message, /AI/)
  })

  it('/models 不可用时 /api/ai/test 退化为最小对话（mode=chat）', async () => {
    await saveAi({
      baseUrl: `${mock.baseUrl}/chatonly`,
      apiKey: 'sk-mock-1234',
      model: 'mock-model'
    })
    const models = await ctx.request('GET', '/api/ai/models')
    assert.equal(models.status, 502)
    assert.equal(models.json.error.code, 'AI_UPSTREAM')

    const test = await ctx.request('POST', '/api/ai/test')
    assert.equal(test.status, 200)
    assert.equal(test.json.mode, 'chat')
    assert.deepEqual(test.json.models, [])
    assert.equal(test.json.model, 'mock-model')
    const chatRequest = mock.requests
      .filter((item) => item.url === '/chatonly/v1/chat/completions')
      .at(-1)
    assert.equal(chatRequest.headers.authorization, 'Bearer sk-mock-1234')
  })

  it('上游无响应 → AI_TIMEOUT 504', async () => {
    await saveAi({
      baseUrl: `${mock.baseUrl}/hang`,
      apiKey: 'sk-mock-1234',
      model: 'mock-model',
      timeoutMs: 1000
    })
    const response = await ctx.request('GET', '/api/ai/models')
    assert.equal(response.status, 504)
    assert.equal(response.json.error.code, 'AI_TIMEOUT')
    assert.equal(response.json.error.retryable, true)
    assert.match(response.json.error.message, /超时/)
  })
})
