/**
 * sentence_work 仓库：逐句工作状态机（02-DATA-API §4.2）。
 * pending → submitting → corrected / error；pending|error → skipped。
 * corrected 不可再提交（服务层校验，仓库层用条件 UPDATE 兜底并发）。
 */

/**
 * @param {import('better-sqlite3').Database} db
 */
export function createSentenceWorkRepository(db) {
  const WORK_COLUMNS = `article_id, idx, my_translation, status, correction_json, model, prompt_version,
    submitted_at, corrected_at, updated_at`
  const selectByArticle = db.prepare(
    `SELECT ${WORK_COLUMNS} FROM sentence_work WHERE article_id = ? ORDER BY idx ASC`
  )
  const selectOne = db.prepare(
    `SELECT ${WORK_COLUMNS} FROM sentence_work WHERE article_id = ? AND idx = ?`
  )
  const insertPendingStmt = db.prepare(
    "INSERT OR IGNORE INTO sentence_work (article_id, idx, status, updated_at) VALUES (?, ?, 'pending', ?)"
  )
  const countStmt = db.prepare(
    "SELECT COUNT(*) AS total FROM sentence_work WHERE article_id = ? AND status IN ('corrected', 'skipped')"
  )
  const markSubmittingStmt = db.prepare(`
    UPDATE sentence_work
    SET status = 'submitting', my_translation = ?, submitted_at = ?, updated_at = ?
    WHERE article_id = ? AND idx = ? AND status IN ('pending', 'error')
  `)
  const markCorrectedStmt = db.prepare(`
    UPDATE sentence_work
    SET status = 'corrected', correction_json = ?, model = ?, prompt_version = ?,
      corrected_at = ?, updated_at = ?
    WHERE article_id = ? AND idx = ?
  `)
  const markErrorStmt = db.prepare(`
    UPDATE sentence_work SET status = 'error', updated_at = ?
    WHERE article_id = ? AND idx = ? AND status = 'submitting'
  `)
  const markPendingStmt = db.prepare(`
    UPDATE sentence_work SET status = 'pending', updated_at = ?
    WHERE article_id = ? AND idx = ? AND status = 'submitting'
  `)
  const markSkippedStmt = db.prepare(`
    UPDATE sentence_work SET status = 'skipped', updated_at = ?
    WHERE article_id = ? AND idx = ? AND status IN ('pending', 'error')
  `)
  const deleteByArticleStmt = db.prepare('DELETE FROM sentence_work WHERE article_id = ?')

  const ensurePending = db.transaction((articleId, idxList, now) => {
    let created = 0
    for (const idx of idxList) {
      created += insertPendingStmt.run(articleId, idx, now).changes
    }
    return created
  })

  return {
    /**
     * @param {number} articleId
     * @returns {object[]}
     */
    listByArticle(articleId) {
      return selectByArticle.all(articleId)
    },

    /**
     * @param {number} articleId
     * @param {number} idx
     * @returns {object | undefined}
     */
    get(articleId, idx) {
      return selectOne.get(articleId, idx)
    },

    /**
     * 为缺失的句子批量补 pending work（不变式 I2：每句最多一条）。
     * @param {number} articleId
     * @param {number[]} idxList
     * @param {string} now
     * @returns {number} 新建行数
     */
    ensurePending(articleId, idxList, now) {
      return ensurePending(articleId, idxList, now)
    },

    /**
     * 条件更新 pending|error → submitting（并发保护）。
     * @param {number} articleId
     * @param {number} idx
     * @param {string} translation
     * @param {string} now
     * @returns {number} 受影响行数
     */
    markSubmitting(articleId, idx, translation, now) {
      return markSubmittingStmt.run(translation, now, now, articleId, idx).changes
    },

    /**
     * @param {number} articleId
     * @param {number} idx
     * @param {{ correctionJson: string, model: string, promptVersion: string, correctedAt: string, now: string }} input
     * @returns {number}
     */
    markCorrected(articleId, idx, input) {
      return markCorrectedStmt.run(
        input.correctionJson,
        input.model,
        input.promptVersion,
        input.correctedAt,
        input.now,
        articleId,
        idx
      ).changes
    },

    /**
     * submitting → error（AI 失败）。
     * @param {number} articleId
     * @param {number} idx
     * @param {string} now
     * @returns {number}
     */
    markError(articleId, idx, now) {
      return markErrorStmt.run(now, articleId, idx).changes
    },

    /**
     * submitting → pending（客户端取消）。
     * @param {number} articleId
     * @param {number} idx
     * @param {string} now
     * @returns {number}
     */
    markPending(articleId, idx, now) {
      return markPendingStmt.run(now, articleId, idx).changes
    },

    /**
     * 条件更新 pending|error → skipped。
     * @param {number} articleId
     * @param {number} idx
     * @param {string} now
     * @returns {number}
     */
    markSkipped(articleId, idx, now) {
      return markSkippedStmt.run(now, articleId, idx).changes
    },

    /**
     * 已处理句数（corrected + skipped）。
     * @param {number} articleId
     * @returns {number}
     */
    countProcessed(articleId) {
      return Number(countStmt.get(articleId)?.total ?? 0)
    },

    /**
     * 重新精读时清空逐句工作。
     * @param {number} articleId
     * @returns {number}
     */
    deleteByArticle(articleId) {
      return deleteByArticleStmt.run(articleId).changes
    }
  }
}
