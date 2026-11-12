import { CancelledError } from '../lib/aiQueue.js'
import { AppError } from '../lib/errors.js'
import { nowIso } from '../lib/time.js'
import {
  CORRECT_REPAIR_HINT,
  MAX_TOKENS as CORRECT_MAX_TOKENS,
  PROMPT_ID as CORRECT_PROMPT_ID,
  PROMPT_VERSION as CORRECT_PROMPT_VERSION,
  TEMPERATURE as CORRECT_TEMPERATURE,
  buildCorrectMessages,
  buildCorrectTask,
  buildDegradedCorrection,
  parseCorrection
} from '../prompts/correct-v1.js'
import {
  MAX_TOKENS as FOLLOWUP_MAX_TOKENS,
  PROMPT_ID as FOLLOWUP_PROMPT_ID,
  PROMPT_VERSION as FOLLOWUP_PROMPT_VERSION,
  TEMPERATURE as FOLLOWUP_TEMPERATURE,
  buildFollowupMessages
} from '../prompts/followup-v1.js'
import { isAiConfigured } from './settingsService.js'

/**
 * 阅读服务（M3）：逐句提交批改/跳过/工作台读取/句内追问；
 * 以及 M2 的阅读计时 tick/end。事务边界在本层；AI 调用不在事务内（04-ENGINEERING §5.3）。
 */

const MIN_TICK_SECONDS = 1
const MAX_TICK_SECONDS = 60

/**
 * 解析 correction_json；非法 JSON 返回 null。
 * @param {unknown} json
 * @returns {object | null}
 */
function parseCorrectionJson(json) {
  if (typeof json !== 'string' || json.length === 0) return null
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}

/**
 * 计算进度（0–1）。
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
 *   chats: ReturnType<typeof import('../db/repositories/sentenceChats.js').createSentenceChatsRepository>,
 *   reading: ReturnType<typeof import('../db/repositories/reading.js').createReadingSessionsRepository>,
 *   settingsService: ReturnType<typeof import('./settingsService.js').createSettingsService>,
 *   aiClient: ReturnType<typeof import('../lib/aiClient.js').createAiClient>,
 *   logger?: { info: (module: string, message: string, detail?: unknown) => void }
 * }} deps
 */
export function createReadingService({
  db,
  articles,
  sentences,
  work,
  chats,
  reading,
  settingsService,
  aiClient,
  logger
}) {
  /**
   * 读取并校验 AI 配置；未配置抛 AI_NOT_CONFIGURED。
   * @returns {Record<string, unknown>}
   */
  function requireAiConfig() {
    const raw = settingsService.getRaw()
    const ai = /** @type {Record<string, unknown>} */ (raw.ai ?? {})
    if (!isAiConfigured(ai)) {
      throw new AppError('AI_NOT_CONFIGURED', 'AI 未配置：请先在设置中填写接口地址、API Key 与模型')
    }
    return ai
  }

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
   * @param {number} idx
   * @returns {object}
   */
  function requireSentence(articleId, idx) {
    const sentence = sentences.get(articleId, idx)
    if (!sentence) throw new AppError('NOT_FOUND', '句子不存在')
    return sentence
  }

  /**
   * @param {object} article
   * @returns {{ processed: number, total: number, skipped: number }}
   */
  function buildProgress(article) {
    return {
      processed: article.processed_count,
      total: article.sentence_count,
      skipped: article.skipped_count
    }
  }

  /**
   * sentence_work 行 → API work 对象。
   * @param {object} row
   * @returns {object}
   */
  function mapWork(row) {
    return {
      idx: row.idx,
      status: row.status,
      myTranslation: row.my_translation ?? null,
      correction: parseCorrectionJson(row.correction_json),
      model: row.model ?? null,
      promptVersion: row.prompt_version ?? null,
      submittedAt: row.submitted_at ?? null,
      correctedAt: row.corrected_at ?? null
    }
  }

  const finalizeCorrectedTx = db.transaction((articleId, idx, correction, meta) => {
    work.markCorrected(articleId, idx, {
      correctionJson: JSON.stringify(correction),
      model: meta.model,
      promptVersion: meta.promptVersion,
      correctedAt: meta.now,
      now: meta.now
    })
    articles.recalculateCounts(articleId, meta.now)
    const article = articles.get(articleId)
    return {
      work: mapWork(work.get(articleId, idx)),
      progress: buildProgress(article),
      article: { id: articleId, sentenceCount: article.sentence_count }
    }
  })

  const finalizeSkippedTx = db.transaction((articleId, idx, now) => {
    work.markSkipped(articleId, idx, now)
    articles.recalculateCounts(articleId, now)
    const article = articles.get(articleId)
    return { progress: buildProgress(article) }
  })

  /**
   * @param {number} value
   * @returns {number}
   */
  function clampSeconds(value) {
    if (!Number.isFinite(value)) {
      throw new AppError('VALIDATION', 'seconds 必须是数字', {
        detail: { fields: [{ path: 'seconds', message: '必须是数字' }] }
      })
    }
    return Math.min(MAX_TICK_SECONDS, Math.max(MIN_TICK_SECONDS, Math.round(value)))
  }

  /**
   * 定位进行中的会话：sessionId 优先，其次 articleId 的未结束会话，最后全局最近未结束会话。
   * @param {{ sessionId?: number, articleId?: number }} input
   * @returns {object}
   */
  function resolveOpenSession(input) {
    if (input.sessionId !== undefined) {
      const session = reading.get(input.sessionId)
      if (!session) throw new AppError('NOT_FOUND', '计时会话不存在')
      return session
    }
    if (input.articleId !== undefined) {
      const session = reading.findOpenByArticle(input.articleId)
      if (!session) {
        throw new AppError('NOT_FOUND', '该文章没有进行中的计时会话，请重新进入阅读')
      }
      return session
    }
    const session = reading.findLatestOpen()
    if (!session) throw new AppError('NOT_FOUND', '没有进行中的计时会话，请重新进入阅读')
    return session
  }

  return {
    /**
     * POST /api/reading/tick
     * @param {{ sessionId?: number, articleId?: number, seconds: number }} input
     * @returns {{ activeSeconds: number, sessionId: number }}
     */
    tick(input) {
      const session = resolveOpenSession(input)
      if (session.ended_at) {
        throw new AppError('NOT_FOUND', '计时会话已结束，请重新进入阅读')
      }
      const seconds = clampSeconds(input.seconds)
      reading.addSeconds(session.id, seconds)
      const updated = reading.get(session.id)
      return { activeSeconds: Number(updated?.active_seconds ?? 0), sessionId: session.id }
    },

    /**
     * POST /api/reading/end（幂等）
     * @param {{ sessionId?: number, articleId?: number }} [input]
     * @returns {{ seconds: number, sessionId: number }}
     */
    end(input = {}) {
      /** @type {object | undefined} */
      let session
      if (input.sessionId !== undefined) {
        session = reading.get(input.sessionId)
        if (!session) throw new AppError('NOT_FOUND', '计时会话不存在')
      } else {
        session = resolveOpenSession(input)
      }
      if (!session.ended_at) {
        reading.end(session.id, nowIso())
        if (session.article_id) {
          const article = articles.get(session.article_id)
          if (article) reading.setProcessedAtEnd(session.id, article.processed_count)
        }
        logger?.info('reading', '结束阅读计时', {
          sessionId: session.id,
          seconds: session.active_seconds
        })
      }
      const updated = reading.get(session.id)
      return { seconds: Number(updated?.active_seconds ?? 0), sessionId: session.id }
    },

    /**
     * POST /api/articles/:id/sentences/:idx/submit：阻塞至批改完成（03-AI-SPEC §3）。
     * @param {{ articleId: number, idx: number, translation: string, signal?: AbortSignal }} input
     * @returns {Promise<{ work: object, progress: object, article: object }>}
     */
    async submit(input) {
      const article = requireArticle(input.articleId)
      if (article.status === 'recap') {
        throw new AppError('STATE_CONFLICT', '文章正在复盘中，不能提交译文')
      }
      if (article.status === 'done') {
        throw new AppError('STATE_CONFLICT', '文章已复盘，请使用回顾模式')
      }
      const sentence = requireSentence(input.articleId, input.idx)
      let current = work.get(input.articleId, input.idx)
      if (!current) {
        work.ensurePending(input.articleId, [input.idx], nowIso())
        current = work.get(input.articleId, input.idx)
      }
      if (current.status === 'corrected') {
        throw new AppError('ALREADY_CORRECTED', '该句已批改，不能重复提交')
      }
      if (current.status === 'skipped') {
        throw new AppError('STATE_CONFLICT', '该句已跳过，不能提交译文')
      }
      if (current.status === 'submitting') {
        throw new AppError('STATE_CONFLICT', '该句正在批改中，请稍候')
      }
      // 未配置 AI 时不改变句子状态
      const ai = requireAiConfig()

      const submittedAt = nowIso()
      let changed = work.markSubmitting(input.articleId, input.idx, input.translation, submittedAt)
      if (changed === 0) {
        work.ensurePending(input.articleId, [input.idx], submittedAt)
        changed = work.markSubmitting(input.articleId, input.idx, input.translation, submittedAt)
      }
      if (changed === 0) {
        const latest = work.get(input.articleId, input.idx)
        if (latest?.status === 'corrected')
          throw new AppError('ALREADY_CORRECTED', '该句已批改，不能重复提交')
        throw new AppError('STATE_CONFLICT', '该句状态已变化，请刷新工作台')
      }

      try {
        const messages = buildCorrectMessages({
          article,
          sentence: sentence.text,
          translation: input.translation
        })
        const outcome = await aiClient.chatJson({
          ai,
          messages,
          purpose: 'correct',
          promptId: CORRECT_PROMPT_ID,
          promptVersion: CORRECT_PROMPT_VERSION,
          promptPreview: buildCorrectTask({
            sentence: sentence.text,
            translation: input.translation
          }),
          temperature: CORRECT_TEMPERATURE,
          maxTokens: CORRECT_MAX_TOKENS,
          jsonMode: true,
          parse: parseCorrection,
          repairHint: CORRECT_REPAIR_HINT,
          onFormat: 'degrade',
          signal: input.signal
        })
        const correction =
          outcome.status === 'degraded' ? buildDegradedCorrection(outcome.rawText) : outcome.value
        const settingsAi = settingsService.getRaw().ai ?? {}
        const model = typeof settingsAi.model === 'string' ? settingsAi.model : ''
        const result = finalizeCorrectedTx(input.articleId, input.idx, correction, {
          model,
          promptVersion: CORRECT_PROMPT_VERSION,
          now: nowIso()
        })
        logger?.info('reading', '提交批改完成', {
          articleId: input.articleId,
          idx: input.idx,
          degraded: outcome.status === 'degraded',
          durationMs: outcome.durationMs
        })
        return result
      } catch (error) {
        const failedAt = nowIso()
        if (error instanceof CancelledError) {
          work.markPending(input.articleId, input.idx, failedAt)
          logger?.info('reading', '批改被客户端取消，句子回 pending', {
            articleId: input.articleId,
            idx: input.idx
          })
          throw error
        }
        work.markError(input.articleId, input.idx, failedAt)
        logger?.info('reading', '批改失败，句子置 error', {
          articleId: input.articleId,
          idx: input.idx,
          code: error instanceof AppError ? error.code : 'INTERNAL'
        })
        throw error
      }
    },

    /**
     * POST /api/articles/:id/sentences/:idx/skip（幂等）
     * @param {{ articleId: number, idx: number }} input
     * @returns {{ progress: object }}
     */
    skip(input) {
      requireArticle(input.articleId)
      requireSentence(input.articleId, input.idx)
      let current = work.get(input.articleId, input.idx)
      if (!current) {
        work.ensurePending(input.articleId, [input.idx], nowIso())
        current = work.get(input.articleId, input.idx)
      }
      if (current.status === 'skipped') {
        return { progress: buildProgress(articles.get(input.articleId)) }
      }
      if (current.status === 'corrected') {
        throw new AppError('ALREADY_CORRECTED', '该句已批改，不能跳过')
      }
      if (current.status === 'submitting') {
        throw new AppError('STATE_CONFLICT', '该句正在批改中，不能跳过')
      }
      const result = finalizeSkippedTx(input.articleId, input.idx, nowIso())
      logger?.info('reading', '跳过句子', { articleId: input.articleId, idx: input.idx })
      return result
    },

    /**
     * GET /api/articles/:id/work：完整工作台（句子/批改/追问/当前句/进度）。
     * @param {number} articleId
     * @returns {object}
     */
    getWork(articleId) {
      const article = requireArticle(articleId)
      const sentenceRows = sentences.listByArticle(articleId)
      const workRows = work.listByArticle(articleId)
      /** @type {Map<number, object>} */
      const workByIndex = new Map(workRows.map((row) => [row.idx, row]))
      const mappedSentences = sentenceRows.map((row) => {
        const workRow = workByIndex.get(row.idx)
        return {
          idx: row.idx,
          text: row.text,
          start: row.start_off,
          end: row.end_off,
          work: workRow
            ? mapWork(workRow)
            : {
                idx: row.idx,
                status: 'pending',
                myTranslation: null,
                correction: null,
                model: null,
                promptVersion: null,
                submittedAt: null,
                correctedAt: null
              }
        }
      })
      let currentIdx = 0
      if (mappedSentences.length > 0) {
        const next = mappedSentences.find(
          (sentence) => sentence.work.status === 'pending' || sentence.work.status === 'error'
        )
        currentIdx = next ? next.idx : mappedSentences[mappedSentences.length - 1].idx
      }
      /** @type {Record<string, object[]>} */
      const chatsByIndex = {}
      for (const row of chats.listByArticle(articleId)) {
        const key = String(row.idx)
        if (!chatsByIndex[key]) chatsByIndex[key] = []
        chatsByIndex[key].push({
          id: row.id,
          role: row.role,
          content: row.content,
          partial: row.partial,
          createdAt: row.created_at
        })
      }
      const progress = buildProgress(article)
      return {
        article: {
          id: articleId,
          title: article.title,
          status: article.status,
          sentenceCount: article.sentence_count,
          processed: progress.processed,
          skipped: progress.skipped,
          currentIdx,
          progress: computeProgress(progress.processed, progress.total)
        },
        sentences: mappedSentences,
        chats: chatsByIndex,
        progress
      }
    },

    /**
     * 追问前置校验（SSE 建连前调用，失败按普通 JSON 错误返回）。
     * @param {{ articleId: number, idx: number }} input
     * @returns {{ article: object, sentence: object, ai: Record<string, unknown> }}
     */
    prepareChat(input) {
      const article = requireArticle(input.articleId)
      const sentence = requireSentence(input.articleId, input.idx)
      const ai = requireAiConfig()
      return { article, sentence, ai }
    },

    /**
     * 句内追问流式回答：持久化 user + assistant，中断保存 partial=1（03-AI-SPEC §4）。
     * @param {{ articleId: number, idx: number, message: string, signal?: AbortSignal, onDelta?: (text: string) => void }} input
     * @returns {Promise<{ messageId: number | null, content: string, usage: object }>}
     */
    async streamChat(input) {
      const article = requireArticle(input.articleId)
      if (article.status === 'recap' || article.status === 'done') {
        throw new AppError('STATE_CONFLICT', '复盘/已复盘文章不能做句内追问')
      }
      const sentence = requireSentence(input.articleId, input.idx)
      const ai = requireAiConfig()
      const workRow = work.get(input.articleId, input.idx)
      const historyRows = chats
        .listByArticle(input.articleId)
        .filter((row) => row.idx === input.idx)
        .slice(-10)
        .map((row) => ({ role: row.role, content: row.content }))
      const messages = buildFollowupMessages({
        article,
        sentence: sentence.text,
        translation: workRow?.my_translation ?? null,
        correction: parseCorrectionJson(workRow?.correction_json),
        history: historyRows,
        message: input.message
      })
      chats.create({
        articleId: input.articleId,
        idx: input.idx,
        role: 'user',
        content: input.message,
        partial: 0,
        createdAt: nowIso()
      })

      let accumulated = ''
      try {
        const outcome = await aiClient.chatStream({
          ai,
          messages,
          purpose: 'followup',
          promptId: FOLLOWUP_PROMPT_ID,
          promptVersion: FOLLOWUP_PROMPT_VERSION,
          promptPreview: input.message,
          temperature: FOLLOWUP_TEMPERATURE,
          maxTokens: FOLLOWUP_MAX_TOKENS,
          signal: input.signal,
          onDelta: (text) => {
            accumulated += text
            input.onDelta?.(text)
          }
        })
        const content = outcome.content.length > 0 ? outcome.content : accumulated
        const messageId = chats.create({
          articleId: input.articleId,
          idx: input.idx,
          role: 'assistant',
          content,
          partial: 0,
          createdAt: nowIso()
        })
        logger?.info('reading', '句内追问完成', {
          articleId: input.articleId,
          idx: input.idx,
          messageId,
          durationMs: outcome.durationMs
        })
        return { messageId, content, usage: outcome.usage }
      } catch (error) {
        if (accumulated.length > 0) {
          chats.create({
            articleId: input.articleId,
            idx: input.idx,
            role: 'assistant',
            content: accumulated,
            partial: 1,
            createdAt: nowIso()
          })
        }
        if (!(error instanceof CancelledError)) {
          logger?.info('reading', '句内追问失败', {
            articleId: input.articleId,
            idx: input.idx,
            code: error instanceof AppError ? error.code : 'INTERNAL'
          })
        }
        throw error
      }
    }
  }
}

export default createReadingService
