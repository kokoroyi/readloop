/**
 * sentence_chats 仓库：句内追问的 user/assistant 消息（追加、不修改）。
 */

/**
 * @param {import('better-sqlite3').Database} db
 */
export function createSentenceChatsRepository(db) {
  const insertStmt = db.prepare(
    'INSERT INTO sentence_chats (article_id, idx, role, content, partial, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  )
  const listStmt = db.prepare(
    'SELECT id, article_id, idx, role, content, partial, created_at FROM sentence_chats WHERE article_id = ? ORDER BY id ASC'
  )
  const deleteStmt = db.prepare('DELETE FROM sentence_chats WHERE article_id = ?')

  return {
    /**
     * @param {{ articleId: number, idx: number, role: 'user' | 'assistant', content: string, partial?: 0 | 1, createdAt: string }} input
     * @returns {number} message id
     */
    create(input) {
      const result = insertStmt.run(
        input.articleId,
        input.idx,
        input.role,
        input.content,
        input.partial ?? 0,
        input.createdAt
      )
      return Number(result.lastInsertRowid)
    },

    /**
     * @param {number} articleId
     * @returns {object[]}
     */
    listByArticle(articleId) {
      return listStmt.all(articleId)
    },

    /**
     * 重新精读时清空句内追问。
     * @param {number} articleId
     * @returns {number}
     */
    deleteByArticle(articleId) {
      return deleteStmt.run(articleId).changes
    }
  }
}
