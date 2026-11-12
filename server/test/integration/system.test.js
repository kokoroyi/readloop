import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, beforeEach, describe, it } from 'node:test'
import Database from 'better-sqlite3'
import { startTestApp } from '../helpers/temp-db.js'

let counter = 0

describe('M5 数据管理：system info / backup / clear-data（SET-09）', () => {
  /** @type {Awaited<ReturnType<typeof startTestApp>>} */
  let ctx

  before(async () => {
    ctx = await startTestApp()
  })

  after(async () => {
    await ctx.close()
  })

  beforeEach(() => {
    ctx.db.exec(
      'DELETE FROM reading_sessions; DELETE FROM articles; DELETE FROM ai_calls; DELETE FROM logs; DELETE FROM words;'
    )
    counter = 0
  })

  /**
   * @param {string} [status]
   * @returns {Promise<number>}
   */
  async function createArticle(status = 'queued') {
    counter += 1
    const response = await ctx.request('POST', '/api/articles', {
      title: `SYS ${counter}`,
      content: `System sample number ${counter} is here. Another sentence follows it.`
    })
    assert.equal(response.status, 200, response.text)
    const id = response.json.article.id
    if (status !== 'queued') {
      ctx.db.prepare('UPDATE articles SET status = ? WHERE id = ?').run(status, id)
    }
    return id
  }

  /**
   * @param {string} lemma
   * @param {number | null} [articleId]
   */
  function seedWord(lemma = 'sample', articleId = null) {
    const now = new Date().toISOString()
    ctx.db
      .prepare(
        `INSERT OR REPLACE INTO words (lemma, display, phonetic, translation, pos, collins, bnc, frq, source_article_id, created_at, updated_at)
         VALUES (?, ?, NULL, '示例', NULL, NULL, NULL, NULL, ?, ?, ?)`
      )
      .run(lemma, lemma, articleId, now, now)
  }

  /**
   * @param {{ purpose?: string, status?: string, input?: number, output?: number, createdAt: string }} input
   */
  function seedAiCall(input) {
    ctx.db
      .prepare(
        `INSERT INTO ai_calls (purpose, prompt_id, prompt_version, model, status, prompt_preview, error, duration_ms, input_tokens, output_tokens, created_at)
         VALUES (?, 'correct', 'correct-v1', 'mock-model', ?, '预览', NULL, 12, ?, ?, ?)`
      )
      .run(
        input.purpose ?? 'correct',
        input.status ?? 'ok',
        input.input ?? 0,
        input.output ?? 0,
        input.createdAt
      )
  }

  it('GET /api/system/info：版本/端口/路径/db 大小/计数/本月 AI 用量（本地月份）', async () => {
    const doneId = await createArticle('done')
    await createArticle('queued')
    seedWord('sample', doneId)
    const now = new Date()
    seedAiCall({ input: 100, output: 50, createdAt: now.toISOString() })
    seedAiCall({ input: 200, output: 100, createdAt: now.toISOString() })
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15, 12, 0, 0)
    seedAiCall({ input: 999, output: 999, createdAt: lastMonth.toISOString() })

    const response = await ctx.request('GET', '/api/system/info')
    assert.equal(response.status, 200)
    const info = response.json
    assert.equal(info.ok, true)
    assert.equal(info.version, ctx.config.version)
    assert.equal(info.port, Number(new URL(ctx.baseUrl).port))
    assert.equal(info.dataDir, ctx.config.dataDir)
    assert.equal(info.dbPath, ctx.config.dbPath)
    assert.equal(info.dictPath, ctx.config.dictPath)
    assert.equal(typeof info.dictOk, 'boolean')
    assert.ok(info.dbSizeBytes > 0)
    assert.deepEqual(info.counts, { articles: 2, doneArticles: 1, words: 1, aiCalls: 3 })
    assert.deepEqual(info.aiUsageThisMonth, {
      calls: 2,
      inputTokens: 300,
      outputTokens: 150
    })
  })

  it('POST /api/system/backup：绝对路径、文件可打开、保留最近 5 份', async () => {
    await createArticle('done')
    const backupsDir = path.join(ctx.config.dataDir, 'backups')
    fs.mkdirSync(backupsDir, { recursive: true })
    for (let index = 0; index < 6; index += 1) {
      fs.writeFileSync(
        path.join(backupsDir, `readloop-20200101-00000${index}.db`),
        Buffer.from('fake-old-backup')
      )
    }
    const response = await ctx.request('POST', '/api/system/backup')
    assert.equal(response.status, 200, response.text)
    assert.equal(response.json.ok, true)
    const backupPath = response.json.path
    assert.ok(path.isAbsolute(backupPath))
    assert.match(path.basename(backupPath), /^readloop-\d{8}-\d{6}\.db$/)
    assert.ok(fs.existsSync(backupPath))
    assert.ok(response.json.sizeBytes > 0)
    assert.equal(response.json.deletedOld, 2)

    const backupDb = new Database(backupPath, { readonly: true })
    try {
      assert.equal(backupDb.pragma('user_version', { simple: true }), 1)
      assert.equal(backupDb.prepare('SELECT COUNT(*) AS c FROM articles').get().c, 1)
    } finally {
      backupDb.close()
    }
    const remaining = fs
      .readdirSync(backupsDir)
      .filter((name) => /^readloop-\d{8}-\d{6}\.db$/.test(name))
    assert.equal(remaining.length, 5)
    assert.ok(!remaining.includes('readloop-20200101-000000.db'))
  })

  it('POST /api/system/clear-data：无 confirm → 400；confirm 后清空学习数据、保留 settings 与词库', async () => {
    const articleId = await createArticle('done')
    ctx.db
      .prepare(
        "INSERT INTO sentence_work (article_id, idx, status, updated_at) VALUES (?, 0, 'corrected', ?)"
      )
      .run(articleId, new Date().toISOString())
    ctx.db
      .prepare(
        "INSERT INTO sentence_chats (article_id, idx, role, content, partial, created_at) VALUES (?, 0, 'user', '问题', 0, ?)"
      )
      .run(articleId, new Date().toISOString())
    ctx.db
      .prepare(
        "INSERT INTO recap_sessions (article_id, questions_json, answers_json, messages_json, status, prompt_version, model, created_at) VALUES (?, '[]', '[]', '[]', 'asking', 'recap-q-v2', 'mock-model', ?)"
      )
      .run(articleId, new Date().toISOString())
    ctx.db
      .prepare(
        "INSERT INTO summaries (article_id, data_json, user_notes, degraded, created_at, updated_at) VALUES (?, '{}', '', 0, ?, ?)"
      )
      .run(articleId, new Date().toISOString(), new Date().toISOString())
    ctx.db
      .prepare(
        'INSERT INTO reading_sessions (article_id, started_at, ended_at, active_seconds, processed_at_end) VALUES (?, ?, ?, 60, 0)'
      )
      .run(articleId, new Date().toISOString(), new Date().toISOString())
    seedAiCall({ createdAt: new Date().toISOString() })
    ctx.db
      .prepare(
        'INSERT INTO logs (level, module, message, detail, created_at) VALUES (?, ?, ?, NULL, ?)'
      )
      .run('info', 'test', '待清理日志', new Date().toISOString())
    seedWord('keepme', articleId)

    const missingConfirm = await ctx.request('POST', '/api/system/clear-data', { keepWords: true })
    assert.equal(missingConfirm.status, 400)
    assert.equal(missingConfirm.json.error.code, 'VALIDATION')

    const response = await ctx.request('POST', '/api/system/clear-data', { confirm: true })
    assert.equal(response.status, 200, response.text)
    assert.equal(response.json.ok, true)
    assert.equal(response.json.keptWords, true)
    assert.equal(response.json.removed.articles, 1)
    assert.equal(response.json.removed.sentences >= 1, true)
    assert.equal(response.json.removed.sentenceWork, 1)
    assert.equal(response.json.removed.sentenceChats, 1)
    assert.equal(response.json.removed.recapSessions, 1)
    assert.equal(response.json.removed.summaries, 1)
    assert.equal(response.json.removed.readingSessions, 1)
    assert.equal(response.json.removed.aiCalls, 1)
    assert.equal(response.json.removed.logs >= 1, true)
    assert.equal(response.json.removed.words, 0)

    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS c FROM articles').get().c, 0)
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS c FROM words').get().c, 1)
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS c FROM ai_calls').get().c, 0)
    assert.equal((await ctx.request('GET', '/api/articles')).json.total, 0)
    // settings 保留（仍可按默认值返回）
    const settings = await ctx.request('GET', '/api/settings')
    assert.equal(settings.status, 200)
    assert.equal(settings.json.ok, true)
  })

  it('clear-data keepWords=false：词库一并删除并返回计数', async () => {
    await createArticle('done')
    seedWord('alpha')
    seedWord('beta')
    const response = await ctx.request('POST', '/api/system/clear-data', {
      confirm: true,
      keepWords: false
    })
    assert.equal(response.status, 200, response.text)
    assert.equal(response.json.keptWords, false)
    assert.equal(response.json.removed.words, 2)
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS c FROM words').get().c, 0)
  })
})
