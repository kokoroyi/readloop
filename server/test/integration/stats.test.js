import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import { startTestApp } from '../helpers/temp-db.js'

let counter = 0

/**
 * 本地时间 → UTC ISO（相对今天）。
 * @param {number} daysAgo
 * @param {number} hour
 * @param {number} minute
 * @returns {string}
 */
function localIsoDaysAgo(daysAgo, hour = 12, minute = 0) {
  const date = new Date()
  date.setDate(date.getDate() - daysAgo)
  date.setHours(hour, minute, 0, 0)
  return date.toISOString()
}

/**
 * 固定本地日期/时间 → UTC ISO。
 * @param {number} year
 * @param {number} month 1-based
 * @param {number} day
 * @param {number} hour
 * @param {number} minute
 * @returns {string}
 */
function localIso(year, month, day, hour = 12, minute = 0) {
  return new Date(year, month - 1, day, hour, minute, 0, 0).toISOString()
}

describe('M5 统计：overview / calendar / random / logs（STAT-01~08）', () => {
  /** @type {Awaited<ReturnType<typeof startTestApp>>} */
  let ctx

  before(async () => {
    ctx = await startTestApp()
  })

  after(async () => {
    await ctx.close()
  })

  beforeEach(() => {
    // 统计测试独立数据；settings 保留
    ctx.db.exec(
      'DELETE FROM reading_sessions; DELETE FROM articles; DELETE FROM ai_calls; DELETE FROM logs; DELETE FROM words;'
    )
    counter = 0
  })

  /**
   * 通过 API 建文章，返回 id（可按需改状态/完成时间）。
   * @param {string} status
   * @param {string | null} [completedAt]
   * @returns {Promise<number>}
   */
  async function createArticle(status = 'queued', completedAt = null) {
    counter += 1
    const response = await ctx.request('POST', '/api/articles', {
      title: `STAT ${counter}`,
      content: `Statistical sample number ${counter} is here. Another sentence follows it.`
    })
    assert.equal(response.status, 200, response.text)
    const id = response.json.article.id
    ctx.db
      .prepare('UPDATE articles SET status = ?, completed_at = ? WHERE id = ?')
      .run(status, completedAt, id)
    return id
  }

  /**
   * @param {string} startedAt
   * @param {number} activeSeconds
   */
  function seedSession(startedAt, activeSeconds) {
    ctx.db
      .prepare(
        'INSERT INTO reading_sessions (article_id, started_at, ended_at, active_seconds, processed_at_end) VALUES (NULL, ?, ?, ?, 0)'
      )
      .run(startedAt, startedAt, activeSeconds)
  }

  /**
   * 直接 seed 句子工作状态（无需 sentences 行）。
   * @param {number} articleId
   * @param {('corrected'|'skipped'|'pending')[]} statuses
   * @param {string} [dateIso]
   */
  function seedWork(articleId, statuses, dateIso = new Date().toISOString()) {
    const stmt = ctx.db.prepare(
      `INSERT OR REPLACE INTO sentence_work (article_id, idx, my_translation, status, correction_json, updated_at, corrected_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    statuses.forEach((status, index) => {
      const corrected = status === 'corrected'
      stmt.run(
        articleId,
        index,
        status === 'skipped' ? null : `译文 ${index}`,
        status,
        corrected ? '{"issues":[],"referenceTranslation":"参考"}' : null,
        dateIso,
        status === 'skipped' ? null : dateIso
      )
    })
  }

  it('STAT-08 空数据：overview 全 0、calendar 空数组、不报错', async () => {
    const overview = await ctx.request('GET', '/api/stats/overview')
    assert.equal(overview.status, 200)
    assert.deepEqual(overview.json, {
      ok: true,
      reviewedArticles: 0,
      totalSeconds: 0,
      totalSentences: 0,
      streakDays: 0,
      queueCount: 0
    })
    const calendar = await ctx.request('GET', '/api/stats/calendar')
    assert.equal(calendar.status, 200)
    assert.equal(calendar.json.ok, true)
    assert.equal(calendar.json.month, null)
    assert.deepEqual(calendar.json.days, [])
  })

  it('STAT-03/07 overview：仅 done 计篇数、仅 ≥30s 会话计时长、句子计数、队列数', async () => {
    await createArticle('done')
    const readingId = await createArticle('reading')
    await createArticle('recap')
    await createArticle('queued')
    seedWork(readingId, ['corrected', 'corrected', 'skipped', 'pending'])
    seedSession(localIsoDaysAgo(0), 60)
    seedSession(localIsoDaysAgo(1), 30)
    seedSession(localIsoDaysAgo(2), 29) // 不足 30s 不计入

    const response = await ctx.request('GET', '/api/stats/overview')
    assert.equal(response.status, 200)
    assert.equal(response.json.reviewedArticles, 1)
    assert.equal(response.json.totalSeconds, 90)
    assert.equal(response.json.totalSentences, 3)
    assert.equal(response.json.queueCount, 1)
    assert.equal(response.json.streakDays, 2)
  })

  it('STAT-04 本地日期聚合：23:30 与次日 00:10 分属两天', async () => {
    seedSession(localIso(2025, 3, 10, 23, 30), 240)
    seedSession(localIso(2025, 3, 11, 0, 10), 120)
    const monthResponse = await ctx.request('GET', '/api/stats/calendar?year=2025&month=3')
    assert.equal(monthResponse.status, 200)
    assert.equal(monthResponse.json.year, 2025)
    assert.equal(monthResponse.json.month, 3)
    assert.deepEqual(
      monthResponse.json.days.map((day) => day.date),
      ['2025-03-10', '2025-03-11']
    )
    assert.deepEqual(
      monthResponse.json.days.map((day) => day.minutes),
      [4, 2]
    )
    assert.deepEqual(
      monthResponse.json.days.map((day) => day.score),
      [4, 2]
    )

    const yearResponse = await ctx.request('GET', '/api/stats/calendar?year=2025')
    assert.equal(yearResponse.json.month, null)
    assert.equal(yearResponse.json.days.length, 2)
  })

  it('STAT-05 连续天数：今天无记录从昨天起算，昨天也断则归零', async () => {
    seedSession(localIsoDaysAgo(0), 60)
    seedSession(localIsoDaysAgo(1), 60)
    seedSession(localIsoDaysAgo(2), 60)
    assert.equal((await ctx.request('GET', '/api/stats/overview')).json.streakDays, 3)
    ctx.db
      .prepare(
        "DELETE FROM reading_sessions WHERE date(started_at, 'localtime') = date('now', 'localtime')"
      )
      .run()
    // 今天无记录 → 从昨天起算，昨天+前天 = 2
    assert.equal((await ctx.request('GET', '/api/stats/overview')).json.streakDays, 2)
    ctx.db
      .prepare(
        "DELETE FROM reading_sessions WHERE date(started_at, 'localtime') = date('now', 'localtime', '-1 day')"
      )
      .run()
    // 昨天也断 → 0
    assert.equal((await ctx.request('GET', '/api/stats/overview')).json.streakDays, 0)
  })

  it('STAT-06 日历色阶：分钟/句数/完成文章共同计分并映射 0–4 档', async () => {
    const year = new Date().getFullYear()
    const month = new Date().getMonth() + 1
    const days = [
      { day: 3, seconds: 240, expected: { score: 4, level: 1, minutes: 4 } },
      { day: 5, seconds: 600, expected: { score: 10, level: 2, minutes: 10 } },
      { day: 7, seconds: 1200, expected: { score: 20, level: 3, minutes: 20 } },
      { day: 9, seconds: 2400, expected: { score: 40, level: 4, minutes: 40 } },
      { day: 11, seconds: 5400, expected: { score: 90, level: 4, minutes: 90 } }
    ]
    for (const item of days) seedSession(localIso(year, month, item.day), item.seconds)
    // 第 3 天再加 2 句（+1 分）与 1 篇完成文章（+5 分）→ 4+1+5=10
    const articleId = await createArticle('done', localIso(year, month, 3))
    seedWork(articleId, ['corrected', 'skipped'], localIso(year, month, 3))

    const response = await ctx.request('GET', `/api/stats/calendar?year=${year}&month=${month}`)
    assert.equal(response.status, 200)
    for (const item of days) {
      const found = response.json.days.find((day) =>
        day.date.endsWith(`-${String(item.day).padStart(2, '0')}`)
      )
      assert.ok(found, `缺少第 ${item.day} 天`)
      if (item.day === 3) {
        assert.equal(found.score, 10)
        assert.equal(found.level, 2)
        assert.equal(found.sentences, 2)
      } else {
        assert.equal(found.score, item.expected.score)
        assert.equal(found.level, item.expected.level)
        assert.equal(found.minutes, item.expected.minutes)
      }
    }
  })

  it('calendar 参数校验：month 超界/非数字、year 超界 → 400 VALIDATION', async () => {
    for (const query of ['month=13', 'month=abc', 'year=1999', 'year=2101']) {
      const response = await ctx.request('GET', `/api/stats/calendar?${query}`)
      assert.equal(response.status, 400, query)
      assert.equal(response.json.error.code, 'VALIDATION')
    }
    // 未来月份 → 空 days
    const futureYear = new Date().getFullYear() + 1
    const future = await ctx.request('GET', `/api/stats/calendar?year=${futureYear}&month=1`)
    assert.equal(future.status, 200)
    assert.deepEqual(future.json.days, [])
  })

  it('随机回顾：默认抽 done；status 可指定；无数据 404 NOT_FOUND', async () => {
    const doneId = await createArticle('done', new Date().toISOString())
    await createArticle('queued')
    const random = await ctx.request('GET', '/api/articles/random')
    assert.equal(random.status, 200)
    assert.equal(random.json.ok, true)
    assert.equal(random.json.article.id, doneId)
    assert.equal(random.json.article.status, 'done')
    assert.equal(random.json.article.sentenceCount >= 1, true)

    const queued = await ctx.request('GET', '/api/articles/random?status=queued')
    assert.equal(queued.status, 200)
    assert.equal(queued.json.article.status, 'queued')

    const invalid = await ctx.request('GET', '/api/articles/random?status=bad')
    assert.equal(invalid.status, 400)
    assert.equal(invalid.json.error.code, 'VALIDATION')

    ctx.db.prepare("DELETE FROM articles WHERE status = 'done'").run()
    const empty = await ctx.request('GET', '/api/articles/random')
    assert.equal(empty.status, 404)
    assert.equal(empty.json.error.code, 'NOT_FOUND')
  })

  it('GET /api/logs：新→旧、limit 默认/上限、字段完整', async () => {
    const stmt = ctx.db.prepare(
      'INSERT INTO logs (level, module, message, detail, created_at) VALUES (?, ?, ?, NULL, ?)'
    )
    const base = Date.now()
    for (let index = 0; index < 3; index += 1) {
      stmt.run('info', 'test', `日志 ${index + 1}`, new Date(base + index).toISOString())
    }
    const response = await ctx.request('GET', '/api/logs?limit=2')
    assert.equal(response.status, 200)
    assert.equal(response.json.items.length, 2)
    assert.equal(response.json.items[0].message, '日志 3')
    assert.equal(response.json.items[1].message, '日志 2')
    for (const item of response.json.items) {
      assert.equal(typeof item.id, 'number')
      assert.equal(typeof item.level, 'string')
      assert.equal(typeof item.message, 'string')
      assert.equal(typeof item.createdAt, 'string')
    }
    for (const query of ['limit=0', 'limit=1001', 'limit=abc']) {
      const invalid = await ctx.request('GET', `/api/logs?${query}`)
      assert.equal(invalid.status, 400, query)
      assert.equal(invalid.json.error.code, 'VALIDATION')
    }
  })
})
