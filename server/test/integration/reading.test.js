import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { startTestApp } from '../helpers/temp-db.js'

let contentCounter = 0

/**
 * @param {string} label
 * @returns {string}
 */
function uniqueContent(label) {
  contentCounter += 1
  return `${label} sentence ${contentCounter}. Reading timer test sentence two.`
}

describe('M2-10 阅读计时（STAT-01/02）', () => {
  /** @type {Awaited<ReturnType<typeof startTestApp>>} */
  let ctx
  /** @type {number} */
  let articleId

  before(async () => {
    ctx = await startTestApp()
    const created = await ctx.request('POST', '/api/articles', {
      title: 'timing-article',
      content: uniqueContent('timing')
    })
    articleId = created.json.article.id
  })

  after(async () => {
    await ctx.close()
  })

  it('STAT-01 start 返回 sessionId，tick 累计且秒数 clamp 1–60', async () => {
    const started = await ctx.request('POST', `/api/articles/${articleId}/start`)
    assert.equal(started.status, 200)
    const sessionId = started.json.sessionId
    assert.equal(typeof sessionId, 'number')

    const first = await ctx.request('POST', '/api/reading/tick', { sessionId, seconds: 15 })
    assert.equal(first.status, 200)
    assert.equal(first.json.activeSeconds, 15)

    const clampedHigh = await ctx.request('POST', '/api/reading/tick', { sessionId, seconds: 100 })
    assert.equal(clampedHigh.json.activeSeconds, 75)

    const clampedLow = await ctx.request('POST', '/api/reading/tick', { sessionId, seconds: 0 })
    assert.equal(clampedLow.json.activeSeconds, 76)

    const fraction = await ctx.request('POST', '/api/reading/tick', { sessionId, seconds: 2.4 })
    assert.equal(fraction.json.activeSeconds, 78)

    const row = ctx.db.prepare('SELECT * FROM reading_sessions WHERE id = ?').get(sessionId)
    assert.equal(row.active_seconds, 78)
    assert.equal(row.ended_at, null)
    // 清理：结束本会话，避免下一用例 start 时复用它（会复用未结束会话）
    await ctx.request('POST', '/api/reading/end', { sessionId })
  })

  it('end 写 ended_at 与 processed_at_end，幂等；结束后 tick 404', async () => {
    const started = await ctx.request('POST', `/api/articles/${articleId}/start`)
    const sessionId = started.json.sessionId
    await ctx.request('POST', '/api/reading/tick', { sessionId, seconds: 20 })

    const ended = await ctx.request('POST', '/api/reading/end', { sessionId })
    assert.equal(ended.status, 200)
    assert.equal(ended.json.seconds, 20)
    assert.equal(ended.json.sessionId, sessionId)

    const row = ctx.db.prepare('SELECT * FROM reading_sessions WHERE id = ?').get(sessionId)
    assert.ok(row.ended_at)
    assert.equal(row.processed_at_end, 0)

    const again = await ctx.request('POST', '/api/reading/end', { sessionId })
    assert.equal(again.status, 200)
    assert.equal(again.json.seconds, 20)

    const tickAfterEnd = await ctx.request('POST', '/api/reading/tick', { sessionId, seconds: 10 })
    assert.equal(tickAfterEnd.status, 404)
    assert.equal(tickAfterEnd.json.error.code, 'NOT_FOUND')
  })

  it('tick/end 支持 articleId 定位未结束会话', async () => {
    const started = await ctx.request('POST', `/api/articles/${articleId}/start`)
    assert.equal(started.status, 200)

    const ticked = await ctx.request('POST', '/api/reading/tick', { articleId, seconds: 10 })
    assert.equal(ticked.status, 200)
    assert.equal(ticked.json.activeSeconds, 10)

    const ended = await ctx.request('POST', '/api/reading/end', { articleId })
    assert.equal(ended.status, 200)
    assert.equal(ended.json.seconds, 10)
  })

  it('无会话 / 参数非法返回错误信封', async () => {
    const missingTick = await ctx.request('POST', '/api/reading/tick', {
      sessionId: 999999,
      seconds: 5
    })
    assert.equal(missingTick.status, 404)
    assert.equal(missingTick.json.error.code, 'NOT_FOUND')

    const missingEnd = await ctx.request('POST', '/api/reading/end', { sessionId: 999999 })
    assert.equal(missingEnd.status, 404)

    const noSeconds = await ctx.request('POST', '/api/reading/tick', { sessionId: 1 })
    assert.equal(noSeconds.status, 400)
    assert.equal(noSeconds.json.error.code, 'VALIDATION')

    const badSeconds = await ctx.request('POST', '/api/reading/tick', {
      sessionId: 1,
      seconds: 'abc'
    })
    assert.equal(badSeconds.status, 400)
  })
})
