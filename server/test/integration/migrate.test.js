import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { openTempDatabase } from '../helpers/temp-db.js'

/** 02-DATA-API §2 的全部用户表（DDL 共 11 张；sqlite_sequence 是 AUTOINCREMENT 内部表，不计） */
const EXPECTED_TABLES = [
  'ai_calls',
  'articles',
  'logs',
  'reading_sessions',
  'recap_sessions',
  'sentence_chats',
  'sentence_work',
  'sentences',
  'settings',
  'summaries',
  'words'
]

/** 02-DATA-API §2 命名索引 */
const EXPECTED_INDEXES = [
  'idx_ai_calls_created',
  'idx_articles_hash',
  'idx_articles_status_queue',
  'idx_articles_updated',
  'idx_logs_created',
  'idx_sentence_chats',
  'idx_sessions_started',
  'idx_words_created',
  'idx_work_status'
]

describe('M1-04 schema.sql 与 migrate', () => {
  /** @type {Awaited<ReturnType<typeof openTempDatabase>>} */
  let ctx

  before(async () => {
    ctx = await openTempDatabase()
  })

  after(() => {
    ctx.close()
  })

  it('migrate 首次执行建表并写入 user_version=1', () => {
    const result = ctx.modules.migrate(ctx.db)
    assert.equal(result.from, 0)
    assert.equal(result.to, 1)
    assert.deepEqual(result.applied, ['initial-schema-v1'])
    assert.equal(ctx.db.pragma('user_version', { simple: true }), 1)
  })

  it('migrate 重复执行幂等（版本不变、不重复建表）', () => {
    const second = ctx.modules.migrate(ctx.db)
    assert.equal(second.from, 1)
    assert.equal(second.to, 1)
    assert.deepEqual(second.applied, [])
    assert.equal(ctx.db.pragma('user_version', { simple: true }), 1)
  })

  it('schema 表齐全（与 02 §2 DDL 一致）', () => {
    const rows = ctx.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .all()
    assert.deepEqual(
      rows.map((row) => row.name),
      EXPECTED_TABLES
    )
  })

  it('schema 索引齐全、外键与 WAL 生效', () => {
    const indexes = ctx.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%' ORDER BY name"
      )
      .all()
      .map((row) => row.name)
    assert.deepEqual(indexes, EXPECTED_INDEXES)
    assert.equal(ctx.db.pragma('foreign_keys', { simple: true }), 1)
    assert.equal(String(ctx.db.pragma('journal_mode', { simple: true })).toLowerCase(), 'wal')
  })

  it('关键字段/默认值与 DDL 一致', () => {
    const articles = ctx.db.pragma('table_info(articles)')
    const articleStatus = articles.find((column) => column.name === 'status')
    assert.equal(articleStatus.dflt_value, "'queued'")
    const sourceFormat = articles.find((column) => column.name === 'source_format')
    assert.equal(sourceFormat.dflt_value, "'paste'")

    const work = ctx.db.pragma('table_info(sentence_work)')
    const workStatus = work.find((column) => column.name === 'status')
    assert.equal(workStatus.dflt_value, "'pending'")

    const settings = ctx.db.pragma('table_info(settings)')
    assert.deepEqual(
      settings.map((column) => column.name),
      ['key', 'value']
    )
  })

  it('外键级联配置存在（删除文章级联句子/工作）', () => {
    const now = '2026-11-09T00:00:00.000Z'
    const article = ctx.db
      .prepare(
        "INSERT INTO articles (title, content, content_hash, created_at, updated_at) VALUES ('t', 'body', 'fk-hash', ?, ?)"
      )
      .run(now, now)
    const articleId = Number(article.lastInsertRowid)
    ctx.db
      .prepare(
        "INSERT INTO sentences (article_id, idx, text, start_off, end_off) VALUES (?, 0, 'body', 0, 4)"
      )
      .run(articleId)
    ctx.db.prepare('DELETE FROM articles WHERE id = ?').run(articleId)
    const sentences = ctx.db
      .prepare('SELECT COUNT(*) AS count FROM sentences WHERE article_id = ?')
      .get(articleId)
    assert.equal(sentences.count, 0)
  })

  it('迁移失败回滚：user_version 不变、DDL 不残留', async () => {
    const broken = await openTempDatabase()
    try {
      assert.throws(() => {
        broken.modules.migrate(broken.db, {
          migrations: [
            {
              version: 1,
              name: 'broken-migration',
              sql: 'CREATE TABLE rollback_probe (id INTEGER PRIMARY KEY); CREATE TABLE rollback_bad (id INTEGER'
            }
          ]
        })
      })
      assert.equal(broken.db.pragma('user_version', { simple: true }), 0)
      const leftovers = broken.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'rollback_%'")
        .all()
      assert.deepEqual(leftovers, [])
    } finally {
      broken.close()
    }
  })
})

describe('M1-04 启动清理（04-ENGINEERING §5.1 / 02-DATA-API §7）', () => {
  /** @type {Awaited<ReturnType<typeof openTempDatabase>>} */
  let ctx

  before(async () => {
    ctx = await openTempDatabase({ migrateNow: true })
  })

  after(() => {
    ctx.close()
  })

  it('submitting→pending、悬挂阅读会话补 ended_at、可重复执行', () => {
    const now = '2026-11-09T00:00:00.000Z'
    const article = ctx.db
      .prepare(
        "INSERT INTO articles (title, content, content_hash, created_at, updated_at) VALUES ('cleanup', 'body', 'cleanup-hash', ?, ?)"
      )
      .run(now, now)
    const articleId = Number(article.lastInsertRowid)
    ctx.db
      .prepare(
        "INSERT INTO sentence_work (article_id, idx, status, updated_at) VALUES (?, 0, 'submitting', ?)"
      )
      .run(articleId, now)
    ctx.db
      .prepare(
        'INSERT INTO reading_sessions (article_id, started_at, active_seconds) VALUES (?, ?, 0)'
      )
      .run(articleId, now)

    const first = ctx.modules.runStartupCleanup(ctx.db, { now })
    assert.equal(first.submittingReset, 1)
    assert.equal(first.sessionsClosed, 1)

    const work = ctx.db
      .prepare('SELECT status, updated_at FROM sentence_work WHERE article_id = ? AND idx = 0')
      .get(articleId)
    assert.equal(work.status, 'pending')
    assert.equal(work.updated_at, now)

    const session = ctx.db
      .prepare(
        'SELECT ended_at FROM reading_sessions WHERE article_id = ? ORDER BY id DESC LIMIT 1'
      )
      .get(articleId)
    assert.equal(session.ended_at, now)

    const second = ctx.modules.runStartupCleanup(ctx.db, { now })
    assert.equal(second.submittingReset, 0)
    assert.equal(second.sessionsClosed, 0)
  })
})
