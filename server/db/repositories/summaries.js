/**
 * summaries 仓库：学习小结（每篇文章最多一条，仅复盘 finished 后写入）。
 */

const COLUMNS = `id, article_id, data_json, user_notes, prompt_version, model, degraded, created_at, updated_at`

/**
 * @param {import('better-sqlite3').Database} db
 */
export function createSummariesRepository(db) {
  const selectByArticle = db.prepare(`SELECT ${COLUMNS} FROM summaries WHERE article_id = ?`)
  const insertStmt = db.prepare(`
    INSERT INTO summaries
      (article_id, data_json, user_notes, prompt_version, model, degraded, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const updateNotesStmt = db.prepare(
    'UPDATE summaries SET user_notes = ?, updated_at = ? WHERE article_id = ?'
  )
  const deleteStmt = db.prepare('DELETE FROM summaries WHERE article_id = ?')

  return {
    /**
     * @param {number} articleId
     * @returns {object | undefined}
     */
    getByArticle(articleId) {
      return selectByArticle.get(articleId)
    },

    /**
     * @param {{ articleId: number, dataJson: string, userNotes?: string, promptVersion?: string | null, model?: string | null, degraded?: 0 | 1, createdAt: string, updatedAt: string }} input
     * @returns {number}
     */
    create(input) {
      const result = insertStmt.run(
        input.articleId,
        input.dataJson,
        input.userNotes ?? '',
        input.promptVersion ?? null,
        input.model ?? null,
        input.degraded ? 1 : 0,
        input.createdAt,
        input.updatedAt
      )
      return Number(result.lastInsertRowid)
    },

    /**
     * @param {number} articleId
     * @param {string} userNotes
     * @param {string} updatedAt
     * @returns {number}
     */
    updateUserNotes(articleId, userNotes, updatedAt) {
      return updateNotesStmt.run(userNotes, updatedAt, articleId).changes
    },

    /**
     * 重新精读时删除小结（I6：done 当且仅当存在 summary）。
     * @param {number} articleId
     * @returns {number}
     */
    deleteByArticle(articleId) {
      return deleteStmt.run(articleId).changes
    }
  }
}
