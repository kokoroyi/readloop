import { AppError } from '../lib/errors.js'
import { renderSummaryMarkdown } from '../lib/markdownExporter.js'
import { nowIso } from '../lib/time.js'

/**
 * 小结服务（M4）：读取 / 保存我的笔记 / 导出 Markdown。
 * 小结的生成与状态机在 recapService.finish 事务中完成。
 */

/**
 * @param {unknown} json
 * @returns {object}
 */
function parseJsonObject(json) {
  if (typeof json !== 'string' || json.length === 0) return {}
  try {
    const parsed = JSON.parse(json)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * @param {{
 *   articles: ReturnType<typeof import('../db/repositories/articles.js').createArticlesRepository>,
 *   sentences: ReturnType<typeof import('../db/repositories/sentences.js').createSentencesRepository>,
 *   work: ReturnType<typeof import('../db/repositories/work.js').createSentenceWorkRepository>,
 *   summaries: ReturnType<typeof import('../db/repositories/summaries.js').createSummariesRepository>
 * }} deps
 */
export function createSummaryService({ articles, sentences, work, summaries }) {
  /**
   * @param {number} articleId
   * @returns {object}
   */
  function requireArticle(articleId) {
    const article = articles.get(articleId)
    if (!article) throw new AppError('NOT_FOUND', '文章不存在')
    return article
  }

  /**
   * @param {number} articleId
   * @returns {object}
   */
  function requireSummary(articleId) {
    const summary = summaries.getByArticle(articleId)
    if (!summary) throw new AppError('NOT_FOUND', '学习小结尚不存在')
    return summary
  }

  /**
   * @param {object} article
   * @returns {object}
   */
  function mapArticle(article) {
    return {
      id: article.id,
      title: article.title,
      status: article.status,
      sentenceCount: article.sentence_count,
      processedCount: article.processed_count,
      skippedCount: article.skipped_count,
      createdAt: article.created_at,
      startedAt: article.started_at ?? null,
      completedAt: article.completed_at ?? null,
      updatedAt: article.updated_at
    }
  }

  /**
   * @param {number} articleId
   * @returns {{ idx: number, text: string, myTranslation: string | null, referenceTranslation: string, issues: object[] }[]}
   */
  function buildSentenceDetails(articleId) {
    const sentenceRows = sentences.listByArticle(articleId)
    const workRows = work.listByArticle(articleId)
    /** @type {Map<number, object>} */
    const workByIndex = new Map(workRows.map((row) => [row.idx, row]))
    return sentenceRows.map((sentence) => {
      const workRow = workByIndex.get(sentence.idx)
      /** @type {object | null} */
      let correction = null
      if (typeof workRow?.correction_json === 'string' && workRow.correction_json.length > 0) {
        try {
          correction = JSON.parse(workRow.correction_json)
        } catch {
          correction = null
        }
      }
      return {
        idx: sentence.idx,
        text: sentence.text,
        myTranslation: workRow?.my_translation ?? null,
        referenceTranslation: correction?.referenceTranslation ?? '',
        issues: Array.isArray(correction?.issues) ? correction.issues : []
      }
    })
  }

  return {
    /**
     * GET /api/articles/:id/summary
     * @param {number} articleId
     * @returns {{ summary: object, article: object }}
     */
    get(articleId) {
      const article = requireArticle(articleId)
      const summary = requireSummary(articleId)
      return {
        summary: {
          id: summary.id,
          data: parseJsonObject(summary.data_json),
          userNotes: summary.user_notes ?? '',
          createdAt: summary.created_at,
          updatedAt: summary.updated_at,
          degraded: Boolean(summary.degraded),
          promptVersion: summary.prompt_version ?? null,
          model: summary.model ?? null
        },
        article: mapArticle(article)
      }
    },

    /**
     * PATCH /api/articles/:id/summary
     * @param {number} articleId
     * @param {string} userNotes
     * @returns {{ updatedAt: string }}
     */
    saveNotes(articleId, userNotes) {
      requireArticle(articleId)
      requireSummary(articleId)
      const updatedAt = nowIso()
      summaries.updateUserNotes(articleId, userNotes, updatedAt)
      return { updatedAt }
    },

    /**
     * GET /api/articles/:id/summary/export
     * @param {number} articleId
     * @returns {{ markdown: string, filename: string }}
     */
    exportMarkdown(articleId) {
      const article = requireArticle(articleId)
      const summary = requireSummary(articleId)
      const markdown = renderSummaryMarkdown({
        article: {
          id: article.id,
          title: article.title,
          sentenceCount: article.sentence_count,
          completedAt: article.completed_at ?? null
        },
        summary: {
          data: parseJsonObject(summary.data_json),
          userNotes: summary.user_notes ?? '',
          createdAt: summary.created_at,
          degraded: Boolean(summary.degraded),
          promptVersion: summary.prompt_version ?? null,
          model: summary.model ?? null
        },
        sentences: buildSentenceDetails(articleId)
      })
      return { markdown, filename: `readloop-summary-${articleId}.md` }
    }
  }
}

export default createSummaryService
