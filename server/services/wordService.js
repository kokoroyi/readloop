import { UTF8_BOM, toCsv } from '../lib/csv.js'
import { AppError } from '../lib/errors.js'
import { nowIso } from '../lib/time.js'

/**
 * 词库服务：收藏（词典自动补字段、lemma 幂等）、列表、删除、CSV/JSON 导出。
 * 词典缺失/未收录分别抛 DICT_UNAVAILABLE / NOT_FOUND。
 */

/** CSV 固定表头（Lead 约定） */
export const WORD_EXPORT_HEADERS = [
  'lemma',
  'display',
  'phonetic',
  'translation',
  'pos',
  'collins',
  'bnc',
  'frq',
  'createdAt'
]

/**
 * @param {object} row words 仓库 join 后的行
 * @returns {object}
 */
function mapWord(row) {
  return {
    id: row.id,
    lemma: row.lemma,
    display: row.display,
    phonetic: row.phonetic ?? null,
    translation: row.translation ?? null,
    pos: row.pos ?? null,
    collins: row.collins ?? null,
    bnc: row.bnc ?? null,
    frq: row.frq ?? null,
    sourceArticleId: row.source_article_id ?? null,
    sourceArticleTitle: row.source_article_title ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/**
 * @param {{
 *   words: ReturnType<typeof import('../db/repositories/words.js').createWordsRepository>,
 *   articles: ReturnType<typeof import('../db/repositories/articles.js').createArticlesRepository>,
 *   dictionary: ReturnType<typeof import('../lib/dictionary.js').createDictionary>,
 *   logger?: { info: (module: string, message: string, detail?: unknown) => void }
 * }} deps
 */
export function createWordService({ words, articles, dictionary, logger }) {
  return {
    /**
     * GET /api/words
     * @param {{ q?: string, sort?: 'created' | 'alpha' }} [query]
     * @returns {{ items: object[], total: number }}
     */
    list(query = {}) {
      return { items: words.list(query).map(mapWord), total: words.count(query) }
    },

    /**
     * POST /api/words：收藏词；已收藏按 lemma 幂等返回已有记录。
     * @param {{ word: string, articleId?: number }} input
     * @returns {{ word: object, duplicated: boolean }}
     */
    add(input) {
      const entry = dictionary.lookup(input.word)
      if (input.articleId !== undefined) {
        const article = articles.get(input.articleId)
        if (!article) throw new AppError('NOT_FOUND', '来源文章不存在')
      }
      const lemma = String(entry.lemma || input.word)
        .trim()
        .toLowerCase()
      const existing = words.getByLemma(lemma)
      if (existing) return { word: mapWord(existing), duplicated: true }

      const now = nowIso()
      const id = words.insert({
        lemma,
        display: String(input.word).trim(),
        phonetic: entry.phonetic || null,
        translation: entry.translation || null,
        pos: entry.pos || null,
        collins: entry.collins ?? null,
        bnc: entry.bnc ?? null,
        frq: entry.frq ?? null,
        sourceArticleId: input.articleId ?? null,
        createdAt: now,
        updatedAt: now
      })
      logger?.info('words', '收藏词', {
        id,
        lemma,
        sourceArticleId: input.articleId ?? null
      })
      return { word: mapWord(words.get(id)), duplicated: false }
    },

    /**
     * DELETE /api/words/:id
     * @param {number} id
     * @returns {{ removed: boolean }}
     */
    remove(id) {
      const existing = words.get(id)
      if (!existing) throw new AppError('NOT_FOUND', '收藏词不存在')
      words.remove(id)
      return { removed: true }
    },

    /**
     * GET /api/words/export
     * @param {'csv' | 'json'} format
     * @returns {{ format: 'csv' | 'json', body: string, filename: string } | { format: 'json', items: object[] }}
     */
    exportWords(format) {
      const items = words.list({ sort: 'created' }).map(mapWord)
      if (format === 'json') return { format: 'json', items }
      const rows = items.map((item) => [
        item.lemma,
        item.display,
        item.phonetic,
        item.translation,
        item.pos,
        item.collins,
        item.bnc,
        item.frq,
        item.createdAt
      ])
      const date = new Date().toISOString().slice(0, 10)
      return {
        format: 'csv',
        body: `${UTF8_BOM}${toCsv(WORD_EXPORT_HEADERS, rows)}`,
        filename: `readloop-words-${date}.csv`
      }
    }
  }
}

export default createWordService
