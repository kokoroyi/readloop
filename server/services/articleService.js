import { AppError } from '../lib/errors.js'
import { contentHash as hashContent } from '../lib/hash.js'
import { parseImport } from '../lib/importParser.js'
import { splitSentences } from '../lib/sentenceSplitter.js'
import { normalizeContent } from '../lib/text.js'
import { nowIso } from '../lib/time.js'

/**
 * 文章服务：创建/列表/详情/改标题/删除/重排/开始精读/工作台读取/导入预览与提交。
 * 事务边界全部在本层（04-ENGINEERING §5.3）；路由不写 SQL。
 */

const MAX_TITLE_CHARS = 100

/**
 * 计算进度（0–1，保留 4 位小数）。
 * @param {number} processed
 * @param {number} total
 * @returns {number}
 */
function computeProgress(processed, total) {
  if (!Number.isFinite(total) || total <= 0) return 0
  return Math.round((Math.max(0, processed) / total) * 10000) / 10000
}

/**
 * @param {{
 *   db: import('better-sqlite3').Database,
 *   articles: ReturnType<typeof import('../db/repositories/articles.js').createArticlesRepository>,
 *   sentences: ReturnType<typeof import('../db/repositories/sentences.js').createSentencesRepository>,
 *   work: ReturnType<typeof import('../db/repositories/work.js').createSentenceWorkRepository>,
 *   reading: ReturnType<typeof import('../db/repositories/reading.js').createReadingSessionsRepository>,
 *   chats: ReturnType<typeof import('../db/repositories/sentenceChats.js').createSentenceChatsRepository>,
 *   recapSessions: ReturnType<typeof import('../db/repositories/recapSessions.js').createRecapSessionsRepository>,
 *   summaries: ReturnType<typeof import('../db/repositories/summaries.js').createSummariesRepository>,
 *   logger?: { info: (module: string, message: string, detail?: unknown) => void }
 * }} deps
 */
export function createArticleService({
  db,
  articles,
  sentences,
  work,
  reading,
  chats,
  recapSessions,
  summaries,
  logger
}) {
  /**
   * 列表项映射（camelCase）。
   * @param {object} row
   * @returns {object}
   */
  function mapListItem(row) {
    return {
      id: row.id,
      title: row.title,
      status: row.status,
      sourceFormat: row.source_format,
      sourceName: row.source_name ?? null,
      sentenceCount: row.sentence_count,
      processedCount: row.processed_count,
      skippedCount: row.skipped_count,
      progress: computeProgress(row.processed_count, row.sentence_count),
      createdAt: row.created_at,
      startedAt: row.started_at ?? null,
      completedAt: row.completed_at ?? null,
      updatedAt: row.updated_at
    }
  }

  /**
   * 详情映射。
   * @param {object} row
   * @returns {object}
   */
  function mapDetail(row) {
    return {
      ...mapListItem(row),
      content: row.content,
      hasRecap: Boolean(row.has_recap),
      hasSummary: Boolean(row.has_summary)
    }
  }

  /**
   * 创建响应映射。
   * @param {object} row
   * @returns {object}
   */
  function mapCreated(row) {
    return {
      id: row.id,
      title: row.title,
      status: row.status,
      sourceFormat: row.source_format,
      sourceName: row.source_name ?? null,
      sentenceCount: row.sentence_count,
      queueOrder: row.queue_order,
      processedCount: row.processed_count,
      skippedCount: row.skipped_count,
      progress: computeProgress(row.processed_count, row.sentence_count),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  /**
   * 从正文首句生成标题（空标题兜底）。
   * @param {string} content
   * @param {{ text: string }[]} sentenceList
   * @returns {string}
   */
  function deriveTitle(content, sentenceList) {
    const base = sentenceList.length > 0 ? sentenceList[0].text : content
    const title = base.replace(/\s+/g, ' ').trim().slice(0, 40)
    return title.length > 0 ? title : '未命名文章'
  }

  /**
   * 规范化用户标题：空值回退首句。
   * @param {unknown} title
   * @param {string[]} fallbacks
   * @returns {string}
   */
  function resolveTitle(title, fallbacks) {
    if (typeof title === 'string' && title.trim().length > 0) {
      return title.trim().slice(0, MAX_TITLE_CHARS)
    }
    for (const fallback of fallbacks) {
      const text = String(fallback ?? '').trim()
      if (text.length > 0) return text.slice(0, MAX_TITLE_CHARS)
    }
    return '未命名文章'
  }

  const createArticleTx = db.transaction((input) => {
    const queueOrder = articles.nextQueueOrder()
    const id = articles.create({
      title: input.title,
      content: input.content,
      contentHash: input.contentHash,
      sourceFormat: input.sourceFormat,
      sourceName: input.sourceName ?? null,
      queueOrder,
      sentenceCount: input.sentences.length,
      createdAt: input.now,
      updatedAt: input.now
    })
    sentences.bulkCreate(id, input.sentences)
    return id
  })

  const startTx = db.transaction((id) => {
    const article = articles.get(id)
    if (!article) throw new AppError('NOT_FOUND', '文章不存在')
    if (article.status === 'recap') {
      throw new AppError('STATE_CONFLICT', '文章正在复盘中，不能进入精读')
    }
    if (article.status === 'done') {
      throw new AppError('STATE_CONFLICT', '文章已复盘，请使用回顾模式')
    }
    const now = nowIso()
    if (article.status === 'queued') articles.markReading(id, now)
    const sentenceRows = sentences.listByArticle(id)
    if (sentenceRows.length === 0) throw new AppError('STATE_CONFLICT', '文章缺少句子数据')
    work.ensurePending(
      id,
      sentenceRows.map((row) => row.idx),
      now
    )
    let openSession = reading.findOpenByArticle(id)
    // 超过 30 分钟无心跳的 open session 视为悬挂：关闭后重新开一个（02-DATA-API §5）
    if (openSession && now - Date.parse(openSession.started_at) > 30 * 60 * 1000) {
      reading.end(openSession.id, now)
      openSession = undefined
    }
    const sessionId = openSession
      ? openSession.id
      : reading.create({ articleId: id, startedAt: now })
    return {
      article: { id, status: article.status === 'queued' ? 'reading' : article.status },
      work: { processed: work.countProcessed(id), total: sentenceRows.length },
      sessionId,
      resumed: article.status !== 'queued' || Boolean(openSession)
    }
  })

  const reReadTx = db.transaction((id) => {
    const article = articles.get(id)
    if (!article) throw new AppError('NOT_FOUND', '文章不存在')
    if (article.status !== 'done') {
      throw new AppError('STATE_CONFLICT', '仅已复盘的文章可以重新精读')
    }
    const now = nowIso()
    const openSession = reading.findOpenByArticle(id)
    if (openSession) reading.end(openSession.id, now)
    work.deleteByArticle(id)
    chats.deleteByArticle(id)
    recapSessions.deleteByArticle(id)
    summaries.deleteByArticle(id)
    articles.resetForReRead(id, now)
    const sentenceRows = sentences.listByArticle(id)
    work.ensurePending(
      id,
      sentenceRows.map((row) => row.idx),
      now
    )
    const sessionId = reading.create({ articleId: id, startedAt: now })
    return {
      article: { id, status: 'reading' },
      work: { processed: 0, total: sentenceRows.length },
      sessionId,
      resumed: false
    }
  })

  const commitImportTx = db.transaction((items) => {
    /** @type {{ id: number, title: string }[]} */
    const created = []
    /** @type {{ index: number, reason: string, existingId: number }[]} */
    const skipped = []
    items.forEach((item, index) => {
      const content = normalizeContent(item.content)
      const hash = hashContent(content)
      const existing = articles.getByHash(hash)
      if (existing) {
        skipped.push({ index, reason: 'DUPLICATE_CONTENT', existingId: existing.id })
        return
      }
      const sentenceList = splitSentences(content)
      if (sentenceList.length === 0) {
        throw new AppError('VALIDATION', `第 ${index + 1} 篇正文无法切分句子`, {
          detail: { fields: [{ path: `items.${index}.content`, message: '无法切分句子' }] }
        })
      }
      const now = nowIso()
      const title = resolveTitle(item.title, [deriveTitle(content, sentenceList), content])
      const id = createArticleTx({
        title,
        content,
        contentHash: hash,
        sourceFormat: item.sourceFormat,
        sourceName: null,
        sentences: sentenceList,
        now
      })
      created.push({ id, title })
    })
    return { articles: created, count: created.length, skipped }
  })

  return {
    /**
     * GET /api/articles
     * @param {{ status?: string, q?: string, sort?: 'queue' | 'updated' }} [query]
     * @returns {{ items: object[], total: number }}
     */
    list(query = {}) {
      const rows = articles.list(query)
      return { items: rows.map(mapListItem), total: articles.count(query) }
    },

    /**
     * GET /api/articles/:id
     * @param {number} id
     * @returns {{ article: object }}
     */
    get(id) {
      const row = articles.getDetail(id)
      if (!row) throw new AppError('NOT_FOUND', '文章不存在')
      return { article: mapDetail(row) }
    },

    /**
     * POST /api/articles：粘贴创建；重复时按 force 决定 409 还是幂等 200。
     * @param {{ title?: string, content: string, force?: boolean }} input
     * @returns {object}
     */
    createPaste(input) {
      const content = normalizeContent(input.content)
      const hash = hashContent(content)
      const existing = articles.getByHash(hash)
      if (existing && input.force !== true) {
        throw new AppError('DUPLICATE_ARTICLE', '文章内容已存在', {
          detail: { existingId: existing.id }
        })
      }
      if (existing) {
        return {
          duplicate: true,
          existingId: existing.id,
          article: { ...mapCreated(existing), duplicate: true }
        }
      }
      const sentenceList = splitSentences(content)
      if (sentenceList.length === 0) {
        throw new AppError('VALIDATION', '正文无法切分出句子', {
          detail: { fields: [{ path: 'content', message: '无法切分句子' }] }
        })
      }
      const title = resolveTitle(input.title, [deriveTitle(content, sentenceList), content])
      const now = nowIso()
      const id = createArticleTx({
        title,
        content,
        contentHash: hash,
        sourceFormat: 'paste',
        sourceName: null,
        sentences: sentenceList,
        now
      })
      const row = articles.get(id)
      logger?.info('articles', '创建文章', {
        id,
        sourceFormat: 'paste',
        sentenceCount: sentenceList.length
      })
      return {
        duplicate: false,
        existingId: null,
        article: { ...mapCreated(row), duplicate: false }
      }
    },

    /**
     * PATCH /api/articles/:id
     * @param {number} id
     * @param {string} title
     * @returns {{ article: object }}
     */
    updateTitle(id, title) {
      const article = articles.get(id)
      if (!article) throw new AppError('NOT_FOUND', '文章不存在')
      const now = nowIso()
      articles.updateTitle(id, title.trim(), now)
      return { article: { id, title: title.trim(), updatedAt: now } }
    },

    /**
     * DELETE /api/articles/:id（级联句子/工作/复盘/小结；收藏词来源置空由 FK 完成）
     * @param {number} id
     * @returns {{ removed: boolean }}
     */
    remove(id) {
      const article = articles.get(id)
      if (!article) throw new AppError('NOT_FOUND', '文章不存在')
      articles.remove(id)
      logger?.info('articles', '删除文章', { id, status: article.status })
      return { removed: true }
    },

    /**
     * POST /api/articles/reorder
     * @param {number[]} ids
     * @returns {{ ids: number[] }}
     */
    reorder(ids) {
      const existing = articles.countExisting(ids)
      if (existing !== ids.length) {
        throw new AppError('NOT_FOUND', '部分文章不存在，无法重排')
      }
      articles.reorder(ids)
      return { ids }
    },

    /**
     * POST /api/articles/:id/start：进入/继续精读（幂等）。
     * @param {number} id
     * @returns {object}
     */
    start(id) {
      const result = startTx(id)
      logger?.info('articles', '开始精读', {
        id,
        work: result.work,
        sessionId: result.sessionId,
        resumed: result.resumed
      })
      return result
    },

    /**
     * POST /api/articles/:id/re-read：重新精读（清空逐句/追问/复盘/小结，回到 reading）。
     * @param {number} id
     * @returns {{ article: object, work: object, sessionId: number, resumed: boolean }}
     */
    reRead(id) {
      const result = reReadTx(id)
      logger?.info('articles', '重新精读', {
        id,
        sessionId: result.sessionId,
        total: result.work.total
      })
      return result
    },

    /**
     * GET /api/articles/random：随机回顾抽一篇（默认已复盘）。
     * @param {string} [status]
     * @returns {{ article: object }}
     */
    random(status = 'done') {
      const row = articles.randomByStatus(status)
      if (!row) throw new AppError('NOT_FOUND', '没有符合条件的文章')
      return { article: mapListItem(row) }
    },

    /**
     * POST /api/articles/import/preview
     * @param {{ filename: string, content: string }} input
     * @returns {{ format: string, warnings: string[], nodes: object[] }}
     */
    previewImport(input) {
      const parsed = parseImport(input.filename, input.content)
      if (parsed.nodes.length === 0) {
        throw new AppError('VALIDATION', '未能从文件中解析出可导入的内容', {
          detail: { fields: [{ path: 'content', message: '没有有效的候选文章' }] }
        })
      }
      return parsed
    },

    /**
     * POST /api/articles/import/commit：事务内批量创建，重复内容跳过。
     * @param {{ title?: string, content: string, sourceFormat: 'md' | 'txt' }[]} items
     * @returns {{ articles: object[], count: number, skipped: object[] }}
     */
    commitImport(items) {
      const result = commitImportTx(items)
      logger?.info('articles', '批量导入完成', {
        count: result.count,
        skipped: result.skipped.length,
        ids: result.articles.map((article) => article.id)
      })
      return result
    }
  }
}

export default createArticleService
