/**
 * articles 仓库：只写 SQL，不写业务规则（04-ENGINEERING §5.3）。
 */

const LIST_COLUMNS =
  'id, title, status, source_format, source_name, sentence_count, processed_count, skipped_count, created_at, started_at, completed_at, updated_at'

/**
 * @param {import('better-sqlite3').Database} db
 */
export function createArticlesRepository(db) {
  const selectById = db.prepare('SELECT * FROM articles WHERE id = ?')
  const selectByHash = db.prepare('SELECT * FROM articles WHERE content_hash = ?')
  const selectDetail = db.prepare(`
    SELECT a.*,
      EXISTS(SELECT 1 FROM recap_sessions r WHERE r.article_id = a.id) AS has_recap,
      EXISTS(SELECT 1 FROM summaries s WHERE s.article_id = a.id) AS has_summary
    FROM articles a WHERE a.id = ?
  `)
  const nextQueueOrderStmt = db.prepare(
    'SELECT COALESCE(MAX(queue_order), 0) + 1 AS next FROM articles'
  )
  const insertStmt = db.prepare(`
    INSERT INTO articles
      (title, content, content_hash, source_format, source_name, status, queue_order,
       sentence_count, processed_count, skipped_count, created_at, started_at, completed_at, updated_at)
    VALUES (@title, @content, @contentHash, @sourceFormat, @sourceName, @status, @queueOrder,
       @sentenceCount, 0, 0, @createdAt, NULL, NULL, @updatedAt)
  `)
  const updateTitleStmt = db.prepare('UPDATE articles SET title = ?, updated_at = ? WHERE id = ?')
  const markReadingStmt = db.prepare(
    "UPDATE articles SET status = 'reading', started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ?"
  )
  const markRecapStmt = db.prepare(
    "UPDATE articles SET status = 'recap', updated_at = ? WHERE id = ? AND status = 'reading'"
  )
  const markDoneStmt = db.prepare(
    "UPDATE articles SET status = 'done', completed_at = ?, updated_at = ? WHERE id = ?"
  )
  const resetForReReadStmt = db.prepare(`
    UPDATE articles
    SET status = 'reading', started_at = ?, completed_at = NULL, processed_count = 0,
      skipped_count = 0, updated_at = ?
    WHERE id = ?
  `)
  const touchStmt = db.prepare('UPDATE articles SET updated_at = ? WHERE id = ?')
  const deleteStmt = db.prepare('DELETE FROM articles WHERE id = ?')
  const randomStmt = db.prepare(
    `SELECT ${LIST_COLUMNS} FROM articles WHERE status = ? ORDER BY RANDOM() LIMIT 1`
  )
  const reorderStmt = db.prepare('UPDATE articles SET queue_order = ? WHERE id = ?')
  const recalcStmt = db.prepare(`
    UPDATE articles SET
      processed_count = (SELECT COUNT(*) FROM sentence_work w WHERE w.article_id = articles.id AND w.status IN ('corrected', 'skipped')),
      skipped_count = (SELECT COUNT(*) FROM sentence_work w WHERE w.article_id = articles.id AND w.status = 'skipped'),
      updated_at = ?
    WHERE id = ?
  `)

  /**
   * @param {{ status?: string, q?: string, sort?: 'queue' | 'updated' }} [options]
   * @returns {{ where: string, params: unknown[], order: string }}
   */
  function buildQuery(options = {}) {
    const clauses = []
    /** @type {unknown[]} */
    const params = []
    if (options.status) {
      clauses.push('status = ?')
      params.push(options.status)
    }
    if (options.q) {
      clauses.push('(title LIKE ? OR content LIKE ?)')
      const like = `%${options.q}%`
      params.push(like, like)
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
    const order =
      options.sort === 'updated'
        ? 'updated_at DESC, id DESC'
        : "CASE WHEN status = 'queued' THEN 0 ELSE 1 END, queue_order ASC, updated_at DESC"
    return { where, params, order }
  }

  const reorder = db.transaction((ids) => {
    ids.forEach((id, index) => {
      reorderStmt.run(index + 1, id)
    })
    return ids.length
  })

  return {
    /**
     * @param {{ status?: string, q?: string, sort?: 'queue' | 'updated' }} [options]
     * @returns {object[]}
     */
    list(options = {}) {
      const { where, params, order } = buildQuery(options)
      return db
        .prepare(`SELECT ${LIST_COLUMNS} FROM articles ${where} ORDER BY ${order}`)
        .all(...params)
    },

    /**
     * @param {{ status?: string, q?: string }} [options]
     * @returns {number}
     */
    count(options = {}) {
      const { where, params } = buildQuery(options)
      const row = db.prepare(`SELECT COUNT(*) AS total FROM articles ${where}`).get(...params)
      return Number(row?.total ?? 0)
    },

    /**
     * @param {number} id
     * @returns {object | undefined}
     */
    get(id) {
      return selectById.get(id)
    },

    /**
     * @param {number} id
     * @returns {object | undefined}
     */
    getDetail(id) {
      return selectDetail.get(id)
    },

    /**
     * @param {string} hash
     * @returns {object | undefined}
     */
    getByHash(hash) {
      return selectByHash.get(hash)
    },

    /**
     * @returns {number}
     */
    nextQueueOrder() {
      return Number(nextQueueOrderStmt.get().next)
    },

    /**
     * @param {{ title: string, content: string, contentHash: string, sourceFormat: string, sourceName?: string | null, status?: string, queueOrder: number, sentenceCount: number, createdAt: string, updatedAt: string }} input
     * @returns {number}
     */
    create(input) {
      const result = insertStmt.run({
        title: input.title,
        content: input.content,
        contentHash: input.contentHash,
        sourceFormat: input.sourceFormat,
        sourceName: input.sourceName ?? null,
        status: input.status ?? 'queued',
        queueOrder: input.queueOrder,
        sentenceCount: input.sentenceCount,
        createdAt: input.createdAt,
        updatedAt: input.updatedAt
      })
      return Number(result.lastInsertRowid)
    },

    /**
     * @param {number} id
     * @param {string} title
     * @param {string} now
     * @returns {number}
     */
    updateTitle(id, title, now) {
      return updateTitleStmt.run(title, now, id).changes
    },

    /**
     * 首次进入精读：status=reading、写 started_at（保留已有 started_at）。
     * @param {number} id
     * @param {string} now
     * @returns {number}
     */
    markReading(id, now) {
      return markReadingStmt.run(now, now, id).changes
    },

    /**
     * @param {number} id
     * @param {string} now
     * @returns {number}
     */
    touch(id, now) {
      return touchStmt.run(now, id).changes
    },

    /**
     * reading → recap（仅复盘开始事务内调用）。
     * @param {number} id
     * @param {string} now
     * @returns {number}
     */
    markRecap(id, now) {
      return markRecapStmt.run(now, id).changes
    },

    /**
     * recap → done（仅小结写入事务内调用，I5/I6）。
     * @param {number} id
     * @param {string} now
     * @returns {number}
     */
    markDone(id, now) {
      return markDoneStmt.run(now, now, id).changes
    },

    /**
     * 重新精读：清空进度与完成时间，回到 reading（清空关联表由 service 事务负责）。
     * @param {number} id
     * @param {string} now
     * @returns {number}
     */
    resetForReRead(id, now) {
      return resetForReReadStmt.run(now, now, id).changes
    },

    /**
     * @param {number} id
     * @returns {number}
     */
    remove(id) {
      return deleteStmt.run(id).changes
    },

    /**
     * 事务重写 queue_order（按数组顺序从 1 开始）。
     * @param {number[]} ids
     * @returns {number}
     */
    reorder(ids) {
      return reorder(ids)
    },

    /**
     * id 都存在时返回数量（reorder 前校验用）。占位符按实际数量生成，避免定长参数绑定错误。
     * @param {number[]} ids
     * @returns {number}
     */
    countExisting(ids) {
      if (ids.length === 0) return 0
      const placeholders = ids.map(() => '?').join(', ')
      const row = db
        .prepare(`SELECT COUNT(*) AS total FROM articles WHERE id IN (${placeholders})`)
        .get(...ids)
      return Number(row?.total ?? 0)
    },

    /**
     * 随机抽一篇指定状态的文章（随机回顾）。
     * @param {string} status
     * @returns {object | undefined}
     */
    randomByStatus(status) {
      return randomStmt.get(status)
    },

    /**
     * 事务内重算 processed_count / skipped_count（不变式 I3）。
     * @param {number} id
     * @param {string} now
     * @returns {void}
     */
    recalculateCounts(id, now) {
      recalcStmt.run(now, id)
    }
  }
}
