/**
 * words 仓库：收藏词（按 lemma 唯一，来源文章删除后 source_article_id 置 NULL）。
 */

const WORD_COLUMNS = `w.id, w.lemma, w.display, w.phonetic, w.translation, w.pos, w.collins, w.bnc, w.frq,
  w.source_article_id, w.created_at, w.updated_at`
const JOIN_ARTICLE = 'FROM words w LEFT JOIN articles a ON a.id = w.source_article_id'

/**
 * @param {import('better-sqlite3').Database} db
 */
export function createWordsRepository(db) {
  const selectById = db.prepare(
    `SELECT ${WORD_COLUMNS}, a.title AS source_article_title ${JOIN_ARTICLE} WHERE w.id = ?`
  )
  const selectByLemma = db.prepare(
    `SELECT ${WORD_COLUMNS}, a.title AS source_article_title ${JOIN_ARTICLE} WHERE w.lemma = ?`
  )
  const insertStmt = db.prepare(`
    INSERT INTO words
      (lemma, display, phonetic, translation, pos, collins, bnc, frq, source_article_id, created_at, updated_at)
    VALUES (@lemma, @display, @phonetic, @translation, @pos, @collins, @bnc, @frq, @sourceArticleId, @createdAt, @updatedAt)
  `)
  const deleteStmt = db.prepare('DELETE FROM words WHERE id = ?')

  /**
   * @param {{ q?: string, sort?: 'created' | 'alpha' }} [options]
   * @returns {{ where: string, params: unknown[], order: string }}
   */
  function buildQuery(options = {}) {
    /** @type {string[]} */
    const clauses = []
    /** @type {unknown[]} */
    const params = []
    if (options.q) {
      clauses.push('(w.lemma LIKE ? OR w.display LIKE ? OR w.translation LIKE ? OR a.title LIKE ?)')
      const like = `%${options.q}%`
      params.push(like, like, like, like)
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
    const order =
      options.sort === 'alpha'
        ? 'w.lemma COLLATE NOCASE ASC, w.id ASC'
        : 'w.created_at DESC, w.id DESC'
    return { where, params, order }
  }

  return {
    /**
     * @param {{ q?: string, sort?: 'created' | 'alpha' }} [options]
     * @returns {object[]}
     */
    list(options = {}) {
      const { where, params, order } = buildQuery(options)
      return db
        .prepare(
          `SELECT ${WORD_COLUMNS}, a.title AS source_article_title ${JOIN_ARTICLE} ${where} ORDER BY ${order}`
        )
        .all(...params)
    },

    /**
     * @param {{ q?: string }} [options]
     * @returns {number}
     */
    count(options = {}) {
      const { where, params } = buildQuery(options)
      const row = db.prepare(`SELECT COUNT(*) AS total ${JOIN_ARTICLE} ${where}`).get(...params)
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
     * @param {string} lemma
     * @returns {object | undefined}
     */
    getByLemma(lemma) {
      return selectByLemma.get(lemma)
    },

    /**
     * @param {{ lemma: string, display: string, phonetic: string | null, translation: string | null, pos: string | null, collins: number | null, bnc: number | null, frq: number | null, sourceArticleId: number | null, createdAt: string, updatedAt: string }} input
     * @returns {number}
     */
    insert(input) {
      const result = insertStmt.run(input)
      return Number(result.lastInsertRowid)
    },

    /**
     * @param {number} id
     * @returns {number}
     */
    remove(id) {
      return deleteStmt.run(id).changes
    }
  }
}
