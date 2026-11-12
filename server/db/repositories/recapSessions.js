/**
 * recap_sessions 仓库：复盘会话（题组/作答/自由问答消息），一个文章最多一条。
 */

const COLUMNS = `id, article_id, questions_json, answers_json, messages_json, status, prompt_version, model, created_at, finished_at`

/**
 * @param {import('better-sqlite3').Database} db
 */
export function createRecapSessionsRepository(db) {
  const selectByArticle = db.prepare(`SELECT ${COLUMNS} FROM recap_sessions WHERE article_id = ?`)
  const selectById = db.prepare(`SELECT ${COLUMNS} FROM recap_sessions WHERE id = ?`)
  const insertStmt = db.prepare(`
    INSERT INTO recap_sessions
      (article_id, questions_json, answers_json, messages_json, status, prompt_version, model, created_at, finished_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `)
  const updateAnswersStmt = db.prepare('UPDATE recap_sessions SET answers_json = ? WHERE id = ?')
  const updateMessagesStmt = db.prepare('UPDATE recap_sessions SET messages_json = ? WHERE id = ?')
  const markFinishedStmt = db.prepare(
    "UPDATE recap_sessions SET status = 'finished', finished_at = ? WHERE id = ? AND status = 'asking'"
  )
  const deleteStmt = db.prepare('DELETE FROM recap_sessions WHERE article_id = ?')

  return {
    /**
     * @param {number} articleId
     * @returns {object | undefined}
     */
    getByArticle(articleId) {
      return selectByArticle.get(articleId)
    },

    /**
     * @param {number} id
     * @returns {object | undefined}
     */
    get(id) {
      return selectById.get(id)
    },

    /**
     * @param {{ articleId: number, questionsJson: string, answersJson?: string, messagesJson?: string, status?: string, promptVersion?: string | null, model?: string | null, createdAt: string }} input
     * @returns {number}
     */
    create(input) {
      const result = insertStmt.run(
        input.articleId,
        input.questionsJson,
        input.answersJson ?? '[]',
        input.messagesJson ?? '[]',
        input.status ?? 'asking',
        input.promptVersion ?? null,
        input.model ?? null,
        input.createdAt
      )
      return Number(result.lastInsertRowid)
    },

    /**
     * @param {number} id
     * @param {string} answersJson
     * @returns {number}
     */
    updateAnswers(id, answersJson) {
      return updateAnswersStmt.run(answersJson, id).changes
    },

    /**
     * @param {number} id
     * @param {string} messagesJson
     * @returns {number}
     */
    updateMessages(id, messagesJson) {
      return updateMessagesStmt.run(messagesJson, id).changes
    },

    /**
     * asking → finished（事务内与 summary/status 一起提交）。
     * @param {number} id
     * @param {string} finishedAt
     * @returns {number}
     */
    markFinished(id, finishedAt) {
      return markFinishedStmt.run(finishedAt, id).changes
    },

    /**
     * 重新精读时清空会话。
     * @param {number} articleId
     * @returns {number}
     */
    deleteByArticle(articleId) {
      return deleteStmt.run(articleId).changes
    }
  }
}
