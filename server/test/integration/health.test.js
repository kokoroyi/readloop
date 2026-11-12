import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { startTestApp } from '../helpers/temp-db.js'

describe('M1-03 GET /api/health 与静态托管', () => {
  /** @type {Awaited<ReturnType<typeof startTestApp>>} */
  let ctx

  before(async () => {
    ctx = await startTestApp()
  })

  after(async () => {
    await ctx.close()
  })

  it('health 返回 02 §6.3 规定的完整字段', async () => {
    const response = await ctx.request('GET', '/api/health')
    assert.equal(response.status, 200)
    assert.equal(response.json.ok, true)
    assert.equal(response.json.version, '0.1.0')
    assert.equal(response.json.port, ctx.app.locals.port)
    assert.equal(response.json.db, true)
    assert.equal(response.json.dict, false)
    assert.deepEqual(response.json.ai, { configured: false, model: '' })
    assert.equal(typeof response.json.uptimeSec, 'number')
    assert.ok(response.json.uptimeSec >= 0)
    assert.ok(response.headers.get('x-request-id'))
  })

  it('词典文件可读时 dict=true（只做可读探测，不做全表校验）', async () => {
    fs.mkdirSync(path.dirname(ctx.config.dictPath), { recursive: true })
    fs.writeFileSync(ctx.config.dictPath, Buffer.from('SQLite format 3\u0000', 'binary'))
    const response = await ctx.request('GET', '/api/health')
    assert.equal(response.json.dict, true)
    fs.rmSync(ctx.config.dictPath, { force: true })
  })

  it('保存 AI 配置后 health 的 ai.configured/model 更新', async () => {
    const saved = await ctx.request('PUT', '/api/settings', {
      ai: {
        baseUrl: 'https://api.deepseek.com',
        apiKey: 'sk-health-test-1234',
        model: 'deepseek-chat'
      }
    })
    assert.equal(saved.status, 200)
    const response = await ctx.request('GET', '/api/health')
    assert.deepEqual(response.json.ai, { configured: true, model: 'deepseek-chat' })
  })

  it('X-Request-Id：合法入参透传、非法入参重新生成', async () => {
    const passthrough = await ctx.request('GET', '/api/health', undefined, {
      'X-Request-Id': 'test-request-id-123456'
    })
    assert.equal(passthrough.headers.get('x-request-id'), 'test-request-id-123456')

    const regenerated = await ctx.request('GET', '/api/health', undefined, { 'X-Request-Id': 'x' })
    assert.notEqual(regenerated.headers.get('x-request-id'), 'x')
    assert.match(regenerated.headers.get('x-request-id'), /^[0-9a-f-]{36}$/)
  })

  it('安全响应头：CSP / nosniff / Referrer-Policy', async () => {
    const response = await ctx.request('GET', '/api/health')
    assert.match(response.headers.get('content-security-policy'), /default-src 'self'/)
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
  })

  it('未知 /api 路径返回 JSON 404 NOT_FOUND，不回退 index.html', async () => {
    const response = await ctx.request('GET', '/api/not-exist')
    assert.equal(response.status, 404)
    assert.equal(response.json.ok, false)
    assert.equal(response.json.error.code, 'NOT_FOUND')
    assert.equal(response.json.error.retryable, false)
  })

  it('前端未构建时 GET / 返回纯文本 404（不是 JSON 错误信封）', async () => {
    const response = await ctx.request('GET', '/')
    assert.equal(response.status, 404)
    assert.match(response.text, /Not Found/)
  })

  it('存在 index.html 时 GET 非 /api 路径回退 SPA', async () => {
    const publicDir = ctx.config.publicDir
    fs.mkdirSync(publicDir, { recursive: true })
    fs.writeFileSync(
      path.join(publicDir, 'index.html'),
      '<!doctype html><title>ReadLoop SPA</title>'
    )
    try {
      const root = await ctx.request('GET', '/')
      assert.equal(root.status, 200)
      assert.match(root.text, /ReadLoop SPA/)

      const deepLink = await ctx.request('GET', '/read/12')
      assert.equal(deepLink.status, 200)
      assert.match(deepLink.text, /ReadLoop SPA/)

      const apiMiss = await ctx.request('GET', '/api/still-not-exist')
      assert.equal(apiMiss.status, 404)
      assert.equal(apiMiss.json.error.code, 'NOT_FOUND')
    } finally {
      fs.rmSync(publicDir, { recursive: true, force: true })
    }
  })
})
