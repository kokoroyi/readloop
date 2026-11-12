import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import { startTestApp } from '../helpers/temp-db.js'

describe('M1-05 GET/PUT /api/settings（SET-01~04）', () => {
  /** @type {Awaited<ReturnType<typeof startTestApp>>} */
  let ctx

  before(async () => {
    ctx = await startTestApp()
  })

  beforeEach(() => {
    ctx.db.prepare('DELETE FROM settings').run()
  })

  after(async () => {
    await ctx.close()
  })

  it('SET-04 默认值深合并：空库返回完整默认值', async () => {
    const response = await ctx.request('GET', '/api/settings')
    assert.equal(response.status, 200)
    assert.equal(response.json.ok, true)
    const settings = response.json.settings
    assert.deepEqual(settings.ai, {
      baseUrl: 'https://api.deepseek.com',
      apiKey: '',
      model: '',
      timeoutMs: 60000,
      retry: 2,
      apiKeySet: false
    })
    assert.deepEqual(settings.appearance, {
      theme: 'light',
      fontSize: 19,
      lineHeight: 1.9,
      maxWidth: 720,
      adhd: {
        mode: 'off',
        semanticDensity: 0.25,
        splitRatio: 0.35,
        leadScale: 1.12,
        letterSpacing: 0.04,
        wordSpacing: 0.1,
        baseScale: 1.08
      }
    })
    assert.deepEqual(settings.recap, {
      questions: 'auto',
      showReference: true,
      floatWindowDefaultOpen: true
    })
  })

  it('SET-01 保存合法配置：分区合并写库并返回打码 Key', async () => {
    const response = await ctx.request('PUT', '/api/settings', {
      ai: {
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: 'sk-test-1234567890abcd',
        model: 'deepseek-chat',
        timeoutMs: 30000,
        retry: 3
      },
      appearance: { theme: 'dark', fontSize: 20, lineHeight: 2, maxWidth: 800 },
      recap: { questions: 5, showReference: false }
    })
    assert.equal(response.status, 200)
    assert.equal(response.json.ok, true)
    const settings = response.json.settings
    assert.equal(settings.ai.baseUrl, 'https://api.deepseek.com/v1')
    assert.equal(settings.ai.apiKey, '****abcd')
    assert.equal(settings.ai.apiKeySet, true)
    assert.equal(settings.ai.model, 'deepseek-chat')
    assert.equal(settings.ai.timeoutMs, 30000)
    assert.equal(settings.ai.retry, 3)
    assert.equal(settings.appearance.theme, 'dark')
    assert.equal(settings.appearance.fontSize, 20)
    assert.equal(settings.appearance.maxWidth, 800)
    assert.equal(settings.recap.questions, 5)
    assert.equal(settings.recap.showReference, false)

    // 库内保存的是明文 Key（只有响应打码）
    const stored = JSON.parse(
      ctx.db.prepare("SELECT value FROM settings WHERE key = 'ai'").get().value
    )
    assert.equal(stored.apiKey, 'sk-test-1234567890abcd')

    // 再 GET 一次与 PUT 响应一致
    const reread = await ctx.request('GET', '/api/settings')
    assert.deepEqual(reread.json.settings, settings)
  })

  it('SET-02 非法 URL / 空模型 / 超范围数值返回 400 VALIDATION，detail 含字段路径', async () => {
    const invalidUrl = await ctx.request('PUT', '/api/settings', {
      ai: { baseUrl: 'ftp://example.com/api' }
    })
    assert.equal(invalidUrl.status, 400)
    assert.equal(invalidUrl.json.ok, false)
    assert.equal(invalidUrl.json.error.code, 'VALIDATION')
    assert.equal(invalidUrl.json.error.retryable, false)
    assert.ok(
      invalidUrl.json.error.detail.fields.some((field) => field.path === 'ai.baseUrl'),
      `detail 应包含 ai.baseUrl，实际为 ${JSON.stringify(invalidUrl.json.error.detail)}`
    )

    const emptyModel = await ctx.request('PUT', '/api/settings', { ai: { model: '   ' } })
    assert.equal(emptyModel.status, 400)
    assert.ok(emptyModel.json.error.detail.fields.some((field) => field.path === 'ai.model'))

    const badTimeout = await ctx.request('PUT', '/api/settings', { ai: { timeoutMs: 999 } })
    assert.equal(badTimeout.status, 400)
    assert.ok(badTimeout.json.error.detail.fields.some((field) => field.path === 'ai.timeoutMs'))

    const badRetry = await ctx.request('PUT', '/api/settings', { ai: { retry: 6 } })
    assert.equal(badRetry.status, 400)
    assert.ok(badRetry.json.error.detail.fields.some((field) => field.path === 'ai.retry'))

    const badAppearance = await ctx.request('PUT', '/api/settings', {
      appearance: { fontSize: 30, theme: 'sepia' }
    })
    assert.equal(badAppearance.status, 400)
    const paths = badAppearance.json.error.detail.fields.map((field) => field.path)
    assert.ok(paths.includes('appearance.fontSize'))
    assert.ok(paths.includes('appearance.theme'))

    const emptyBody = await ctx.request('PUT', '/api/settings', {})
    assert.equal(emptyBody.status, 400)
    assert.equal(emptyBody.json.error.code, 'VALIDATION')
  })

  it('SET-10 appearance.adhd.mode 支持 highlight：保存回读；非法值仍 400', async () => {
    // 四种模式全部可保存（highlight 为 M6 新增枚举）
    for (const mode of ['off', 'semantic', 'bionic', 'highlight']) {
      const response = await ctx.request('PUT', '/api/settings', {
        appearance: {
          adhd: {
            mode,
            semanticDensity: 0.5,
            splitRatio: 0.5,
            leadScale: 1.2,
            letterSpacing: 0.1,
            wordSpacing: 0.3,
            baseScale: 1.2
          }
        }
      })
      assert.equal(response.status, 200, `${mode}: ${response.text}`)
      assert.equal(response.json.settings.appearance.adhd.mode, mode)
    }

    // 最后一次保存的是 highlight，回读确认持久化与参数完整
    const readBack = await ctx.request('GET', '/api/settings')
    assert.equal(readBack.status, 200)
    assert.equal(readBack.json.settings.appearance.adhd.mode, 'highlight')
    assert.deepEqual(readBack.json.settings.appearance.adhd, {
      mode: 'highlight',
      semanticDensity: 0.5,
      splitRatio: 0.5,
      leadScale: 1.2,
      letterSpacing: 0.1,
      wordSpacing: 0.3,
      baseScale: 1.2
    })

    // 非法枚举仍 400；错误详情带字段路径
    const invalid = await ctx.request('PUT', '/api/settings', {
      appearance: { adhd: { mode: 'highlight-plus' } }
    })
    assert.equal(invalid.status, 400)
    assert.equal(invalid.json.error.code, 'VALIDATION')
    const paths = invalid.json.error.detail.fields.map((field) => field.path)
    assert.ok(paths.includes('appearance.adhd.mode'))
    assert.match(invalid.json.error.message, /off\/semantic\/bionic\/highlight/)

    // 其余参数范围保持不变（示例：semanticDensity 越界）
    const invalidRange = await ctx.request('PUT', '/api/settings', {
      appearance: { adhd: { mode: 'highlight', semanticDensity: 1.5 } }
    })
    assert.equal(invalidRange.status, 400)
    assert.ok(
      invalidRange.json.error.detail.fields.some(
        (field) => field.path === 'appearance.adhd.semanticDensity'
      )
    )
  })

  it('SET-03 Key 打码：GET 不回传明文、打码值回传保留原 Key、空串清空', async () => {
    const plaintext = 'sk-secret-plaintext-9876'
    await ctx.request('PUT', '/api/settings', { ai: { apiKey: plaintext } })

    const got = await ctx.request('GET', '/api/settings')
    assert.equal(got.json.settings.ai.apiKey, '****9876')
    assert.equal(got.json.settings.ai.apiKeySet, true)
    assert.doesNotMatch(got.text, new RegExp(plaintext))

    // 前端把打码值原样回传 → 保留原 Key
    await ctx.request('PUT', '/api/settings', { ai: { apiKey: '****9876' } })
    let stored = JSON.parse(
      ctx.db.prepare("SELECT value FROM settings WHERE key = 'ai'").get().value
    )
    assert.equal(stored.apiKey, plaintext)

    // 空串 → 清空
    const cleared = await ctx.request('PUT', '/api/settings', { ai: { apiKey: '' } })
    assert.equal(cleared.json.settings.ai.apiKey, '')
    assert.equal(cleared.json.settings.ai.apiKeySet, false)
    stored = JSON.parse(ctx.db.prepare("SELECT value FROM settings WHERE key = 'ai'").get().value)
    assert.equal(stored.apiKey, '')

    // 新明文 → 覆盖
    await ctx.request('PUT', '/api/settings', { ai: { apiKey: 'sk-brand-new-4321' } })
    const replaced = await ctx.request('GET', '/api/settings')
    assert.equal(replaced.json.settings.ai.apiKey, '****4321')
  })

  it('SET-04 默认值合并且保留未知键（未知嵌套键 / 未知顶层分区）', async () => {
    ctx.db
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai', ?)")
      .run(JSON.stringify({ model: 'stored-model', customFlag: true }))
    ctx.db
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('appearance', ?)")
      .run(JSON.stringify({ theme: 'dark', fontFamily: 'serif' }))
    ctx.db
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('experimental', ?)")
      .run(JSON.stringify({ foo: 'bar' }))

    const merged = await ctx.request('GET', '/api/settings')
    const settings = merged.json.settings
    // 缺失键补默认值
    assert.equal(settings.ai.baseUrl, 'https://api.deepseek.com')
    assert.equal(settings.ai.timeoutMs, 60000)
    assert.equal(settings.ai.model, 'stored-model')
    assert.equal(settings.appearance.fontSize, 19)
    assert.equal(settings.appearance.adhd.mode, 'off')
    // 未知键保留
    assert.equal(settings.ai.customFlag, true)
    assert.equal(settings.appearance.fontFamily, 'serif')
    assert.deepEqual(settings.experimental, { foo: 'bar' })

    // 局部保存只改提交字段，未知键与未提交分区不丢
    const saved = await ctx.request('PUT', '/api/settings', { appearance: { fontSize: 21 } })
    assert.equal(saved.status, 200)
    assert.equal(saved.json.settings.appearance.fontSize, 21)
    assert.equal(saved.json.settings.appearance.theme, 'dark')
    assert.equal(saved.json.settings.appearance.fontFamily, 'serif')
    assert.equal(saved.json.settings.ai.customFlag, true)
    assert.equal(saved.json.settings.ai.model, 'stored-model')
    assert.deepEqual(saved.json.settings.experimental, { foo: 'bar' })

    // 提交未知分区会被忽略（不落库）
    await ctx.request('PUT', '/api/settings', {
      appearance: { maxWidth: 700 },
      unknownSection: { x: 1 }
    })
    const afterUnknown = await ctx.request('GET', '/api/settings')
    assert.equal(afterUnknown.json.settings.appearance.maxWidth, 700)
    assert.equal(afterUnknown.json.settings.unknownSection, undefined)
  })
})
