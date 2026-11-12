/**
 * sentences 仓库：导入时固化句子（02-DATA-API §2）。
 */

/**
 * @param {import('better-sqlite3').Database} db
 */
export function createSentencesRepository(db) {
  const selectByArticle = db.prepare(
    'SELECT article_id, idx, text, start_off, end_off FROM sentences WHERE article_id = ? ORDER BY idx ASC'
  )
  const insertStmt = db.prepare(
    'INSERT INTO sentences (article_id, idx, text, start_off, end_off) VALUES (?, ?, ?, ?, ?)'
  )
  const countStmt = db.prepare('SELECT COUNT(*) AS total FROM sentences WHERE article_id = ?')
  const selectOne = db.prepare(
    'SELECT article_id, idx, text, start_off, end_off FROM sentences WHERE article_id = ? AND idx = ?'
  )

  const bulkCreate = db.transaction((articleId, sentences) => {
    for (const sentence of sentences) {
      insertStmt.run(articleId, sentence.idx, sentence.text, sentence.start, sentence.end)
    }
    return sentences.length
  })

  return {
    /**
     * @param {number} articleId
     * @returns {{ article_id: number, idx: number, text: string, start_off: number, end_off: number }[]}
     */
    listByArticle(articleId) {
      return selectByArticle.all(articleId)
    },

    /**
     * 批量写入句子（事务）。
     * @param {number} articleId
     * @param {{ idx: number, text: string, start: number, end: number }[]} sentences
     * @returns {number}
     */
    bulkCreate(articleId, sentences) {
      return bulkCreate(articleId, sentences)
    },

    /**
     * 读取单句。
     * @param {number} articleId
     * @param {number} idx
     * @returns {object | undefined}
     */
    get(articleId, idx) {
      return selectOne.get(articleId, idx)
    },

    /**
     * @param {number} articleId
     * @returns {number}
     */
    countByArticle(articleId) {
      return Number(countStmt.get(articleId)?.total ?? 0)
    }
  }
}
