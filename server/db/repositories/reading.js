/**
 * reading_sessions 仓库：阅读计时会话（02-DATA-API §5 / TECH-DESIGN §4.9）。
 */

/**
 * @param {import('better-sqlite3').Database} db
 */
export function createReadingSessionsRepository(db) {
  const selectById = db.prepare('SELECT * FROM reading_sessions WHERE id = ?')
  const selectOpenByArticle = db.prepare(
    'SELECT * FROM reading_sessions WHERE article_id = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1'
  )
  const selectLatestOpen = db.prepare(
    'SELECT * FROM reading_sessions WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1'
  )
  const insertStmt = db.prepare(
    'INSERT INTO reading_sessions (article_id, started_at, ended_at, active_seconds, processed_at_end) VALUES (?, ?, NULL, 0, 0)'
  )
  const addSecondsStmt = db.prepare(
    'UPDATE reading_sessions SET active_seconds = active_seconds + ? WHERE id = ?'
  )
  const endStmt = db.prepare(
    'UPDATE reading_sessions SET ended_at = COALESCE(ended_at, ?) WHERE id = ?'
  )
  const processedAtEndStmt = db.prepare(
    'UPDATE reading_sessions SET processed_at_end = ? WHERE id = ?'
  )

  return {
    /**
     * 创建一次计时会话。
     * @param {{ articleId: number | null, startedAt: string }} input
     * @returns {number} session id
     */
    create({ articleId, startedAt }) {
      const result = insertStmt.run(articleId ?? null, startedAt)
      return Number(result.lastInsertRowid)
    },

    /**
     * @param {number} id
     * @returns {object | undefined}
     */
    get(id) {
      return selectById.get(id)
    },

    /**
     * 该文章最近一个未结束会话（重复 start 复用它）。
     * @param {number} articleId
     * @returns {object | undefined}
     */
    findOpenByArticle(articleId) {
      return selectOpenByArticle.get(articleId)
    },

    /**
     * 全局最近一个未结束会话（tick/end 未带 id 时兜底）。
     * @returns {object | undefined}
     */
    findLatestOpen() {
      return selectLatestOpen.get()
    },

    /**
     * 累加有效秒数。
     * @param {number} id
     * @param {number} seconds
     * @returns {number}
     */
    addSeconds(id, seconds) {
      return addSecondsStmt.run(seconds, id).changes
    },

    /**
     * 结束会话（幂等：已结束不覆盖 ended_at）。
     * @param {number} id
     * @param {string} endedAt
     * @returns {number}
     */
    end(id, endedAt) {
      return endStmt.run(endedAt, id).changes
    },

    /**
     * 记录结束时的已处理句数。
     * @param {number} id
     * @param {number} processed
     * @returns {number}
     */
    setProcessedAtEnd(id, processed) {
      return processedAtEndStmt.run(processed, id).changes
    }
  }
}
