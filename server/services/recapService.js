import { AppError } from '../lib/errors.js'
import { nowIso } from '../lib/time.js'
import {
  MAX_TOKENS as RECAP_Q_MAX_TOKENS,
  PROMPT_ID as RECAP_Q_PROMPT_ID,
  PROMPT_VERSION as RECAP_Q_PROMPT_VERSION,
  RECAP_Q_REPAIR_HINT,
  TEMPERATURE as RECAP_Q_TEMPERATURE,
  TIMEOUT_MS as RECAP_Q_TIMEOUT_MS,
  buildGenericQuestions,
  buildRecapQuestionsMessages,
  buildRecapQuestionsTask,
  parseRecapQuestions
} from '../prompts/recap-q-v2.js'
import {
  MAX_TOKENS as RECAP_EVAL_MAX_TOKENS,
  PROMPT_ID as RECAP_EVAL_PROMPT_ID,
  PROMPT_VERSION as RECAP_EVAL_PROMPT_VERSION,
  RECAP_EVAL_REPAIR_HINT,
  TEMPERATURE as RECAP_EVAL_TEMPERATURE,
  buildRecapEvalMessages,
  parseRecapEvaluation
} from '../prompts/recap-eval-v1.js'
import {
  MAX_TOKENS as RECAP_CHAT_MAX_TOKENS,
  PROMPT_ID as RECAP_CHAT_PROMPT_ID,
  PROMPT_VERSION as RECAP_CHAT_PROMPT_VERSION,
  TEMPERATURE as RECAP_CHAT_TEMPERATURE,
  buildRecapChatMessages,
  formatRecapQaSummary
} from '../prompts/recap-chat-v1.js'
import {
  MAX_TOKENS as SUMMARY_MAX_TOKENS,
  PROMPT_ID as SUMMARY_PROMPT_ID,
  PROMPT_VERSION as SUMMARY_PROMPT_VERSION,
  SUMMARY_REPAIR_HINT,
  TEMPERATURE as SUMMARY_TEMPERATURE,
  buildSimpleSummary,
  buildSummaryMessages,
  parseSummaryDraft
} from '../prompts/summary-v1.js'
import { isAiConfigured } from './settingsService.js'

/**
 * 复盘服务（M4）：出题/读取/作答评估/跳题/自由提问 SSE/结束生成小结。
 * 事务边界在本层；AI 调用不在事务内（04-ENGINEERING §5.3）。
 */

const ALLOWED_FIXED_QUESTION_COUNTS = new Set([3, 4, 5, 6, 8])

/**
 * @param {unknown} json
 * @param {unknown[]} [fallback]
 * @returns {any[]}
 */
function parseJsonArray(json, fallback = []) {
  if (typeof json !== 'string' || json.length === 0) return fallback
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

/**
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
 * 判断复盘题组是否降级（持久化标记在 prompt_version 后缀）。
 * @param {string | null} promptVersion
 * @returns {boolean}
 */
function isDegradedQuestions(promptVersion) {
  return typeof promptVersion === 'string' && promptVersion.endsWith('-degraded')
}

/**
 * @param {object[]} issues
 * @returns {string}
 */
function issueSummaryText(issues) {
  if (!Array.isArray(issues) || issues.length === 0) return '无'
  const counts = {}
  for (const issue of issues) {
    const type = issue?.type
    if (typeof type === 'string') counts[type] = (counts[type] ?? 0) + 1
  }
  return Object.entries(counts)
    .map(([type, count]) => `${type}×${count}`)
    .join('、')
}

/**
 * @typedef {Object} RecapDeps
 * @property {import('better-sqlite3').Database} db
 * @property {ReturnType<typeof import('../db/repositories/articles.js').createArticlesRepository>} articles
 * @property {ReturnType<typeof import('../db/repositories/sentences.js').createSentencesRepository>} sentences
 * @property {ReturnType<typeof import('../db/repositories/work.js').createSentenceWorkRepository>} work
 * @property {ReturnType<typeof import('../db/repositories/recapSessions.js').createRecapSessionsRepository>} recapSessions
 * @property {ReturnType<typeof import('../db/repositories/summaries.js').createSummariesRepository>} summaries
 * @property {ReturnType<typeof import('../db/repositories/reading.js').createReadingSessionsRepository>} reading
 * @property {ReturnType<typeof import('./settingsService.js').createSettingsService>} settingsService
 * @property {ReturnType<typeof import('../lib/aiClient.js').createAiClient>} aiClient
 * @property {{ info: (module: string, message: string, detail?: unknown) => void }} [logger]
 */

/**
 * @param {RecapDeps} deps
 */
export function createRecapService({
  db,
  articles,
  sentences,
  work,
  recapSessions,
  summaries,
  reading,
  settingsService,
  aiClient,
  logger
}) {
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
  function requireSession(articleId) {
    const session = recapSessions.getByArticle(articleId)
    if (!session) throw new AppError('NOT_FOUND', '尚未开始复盘')
    return session
  }

  /**
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
   * @returns {Record<string, unknown>}
   */
  function readAiConfig() {
    const raw = settingsService.getRaw()
    return /** @type {Record<string, unknown>} */ (raw.ai ?? {})
  }

  /**
   * 复盘题数：设置固定值直接用；auto 按句数 4–6（Lead 确认规则）。
   * @param {object} article
   * @returns {number}
   */
  function computeTargetQuestionCount(article) {
    const raw = settingsService.getRaw()
    const configured = raw?.recap?.questions
    if (typeof configured === 'number' && ALLOWED_FIXED_QUESTION_COUNTS.has(configured)) {
      return configured
    }
    const sentenceCount = Number(article.sentence_count) || 0
    if (sentenceCount < 15) return 4
    if (sentenceCount < 30) return 5
    return 6
  }

  /**
   * @param {number} articleId
   * @returns {{ sentenceRows: object[], workRows: object[], workByIndex: Map<number, object> }}
   */
  function loadArticleRecords(articleId) {
    const sentenceRows = sentences.listByArticle(articleId)
    const workRows = work.listByArticle(articleId)
    /** @type {Map<number, object>} */
    const workByIndex = new Map(workRows.map((row) => [row.idx, row]))
    return { sentenceRows, workRows, workByIndex }
  }

  /**
   * @param {object[]} sentenceRows
   * @param {Map<number, object>} workByIndex
   * @returns {{ idx: number, text: string, translation: string | null, issueSummary: string }[]}
   */
  function buildRecords(sentenceRows, workByIndex) {
    return sentenceRows.map((row) => {
      const workRow = workByIndex.get(row.idx)
      const correction = parseCorrectionJson(workRow?.correction_json)
      return {
        idx: row.idx,
        text: row.text,
        translation: workRow?.my_translation ?? null,
        issueSummary: issueSummaryText(correction?.issues ?? [])
      }
    })
  }

  /**
   * 服务端统计批改问题（issueSummary 不依赖模型）。
   * @param {object[]} sentenceRows
   * @param {Map<number, object>} workByIndex
   * @returns {{ issueSummary: Record<string, number>, records: object[], weakFindings: { idx: number, types: string[] }[] }}
   */
  function buildStats(sentenceRows, workByIndex) {
    /** @type {Record<string, number>} */
    const issueSummary = { 漏译: 0, 误译: 0, 理解偏差: 0 }
    /** @type {{ idx: number, types: string[] }[]} */
    const weakFindings = []
    const records = sentenceRows.map((row) => {
      const workRow = workByIndex.get(row.idx)
      const correction = parseCorrectionJson(workRow?.correction_json)
      const issues = Array.isArray(correction?.issues) ? correction.issues : []
      for (const issue of issues) {
        const type = issue?.type
        if (typeof type === 'string' && issueSummary[type] !== undefined) issueSummary[type] += 1
      }
      if (issues.length > 0)
        weakFindings.push({ idx: row.idx, types: issues.map((issue) => issue.type) })
      return {
        idx: row.idx,
        text: row.text,
        translation: workRow?.my_translation ?? null,
        reference: correction?.referenceTranslation ?? '',
        issueSummary: issueSummaryText(issues),
        issues
      }
    })
    return { issueSummary, records, weakFindings }
  }

  /**
   * @param {object} question
   * @returns {object}
   */
  function mapQuestion(question) {
    return {
      id: question.id,
      type: question.type,
      stem: question.stem,
      intent: question.intent,
      sentenceRefs: question.sentenceRefs
    }
  }

  /**
   * @param {object} answer
   * @returns {object}
   */
  function mapAnswer(answer) {
    return {
      questionId: answer.questionId,
      answer: answer.answer ?? '',
      evaluation: answer.evaluation ?? null,
      skipped: Boolean(answer.skipped),
      degraded: Boolean(answer.degraded),
      answeredAt: answer.answeredAt ?? null
    }
  }

  /**
   * @param {object[]} questions
   * @param {object[]} answers
   * @returns {object | null}
   */
  function findNextQuestion(questions, answers) {
    const handled = new Set(answers.map((answer) => answer.questionId))
    const next = questions.find((question) => !handled.has(question.id))
    return next ? mapQuestion(next) : null
  }

  /**
   * @param {object[]} questions
   * @param {object[]} answers
   * @returns {{ answered: number, total: number, skipped: number }}
   */
  function buildAnswerProgress(questions, answers) {
    return {
      answered: answers.filter((answer) => !answer.skipped).length,
      total: questions.length,
      skipped: answers.filter((answer) => answer.skipped).length
    }
  }

  /**
   * GET/start 同构响应（Lead 约定）。
   * @param {object} session
   * @returns {object}
   */
  function buildRecapPayload(session) {
    const questions = parseJsonArray(session.questions_json).map(mapQuestion)
    const answers = parseJsonArray(session.answers_json).map(mapAnswer)
    const messages = parseJsonArray(session.messages_json).map((message) => ({
      id: message.id ?? null,
      role: message.role,
      content: message.content,
      partial: message.partial ?? 0,
      createdAt: message.createdAt ?? null
    }))
    return {
      id: session.id,
      status: session.status,
      total: questions.length,
      questions,
      answers,
      nextQuestion: findNextQuestion(questions, answers),
      messages,
      degraded: isDegradedQuestions(session.prompt_version),
      progress: buildAnswerProgress(questions, answers),
      createdAt: session.created_at,
      finishedAt: session.finished_at ?? null
    }
  }

  const startTx = db.transaction((input) => {
    const article = articles.get(input.articleId)
    if (!article) throw new AppError('NOT_FOUND', '文章不存在')
    if (article.status !== 'reading') {
      throw new AppError('STATE_CONFLICT', '当前状态不能开始复盘')
    }
    const sessionId = recapSessions.create({
      articleId: input.articleId,
      questionsJson: input.questionsJson,
      answersJson: '[]',
      messagesJson: '[]',
      status: 'asking',
      promptVersion: input.promptVersion,
      model: input.model,
      createdAt: input.now
    })
    const changed = articles.markRecap(input.articleId, input.now)
    if (changed === 0) throw new AppError('STATE_CONFLICT', '文章状态已变化，请刷新后重试')
    return recapSessions.get(sessionId)
  })

  const appendAnswerTx = db.transaction((input) => {
    const session = recapSessions.get(input.sessionId)
    if (!session) throw new AppError('NOT_FOUND', '复盘会话不存在')
    if (session.status !== 'asking') throw new AppError('STATE_CONFLICT', '复盘已结束')
    const answers = parseJsonArray(session.answers_json)
    if (answers.some((answer) => answer.questionId === input.record.questionId)) {
      throw new AppError('ALREADY_ANSWERED', '该题已作答或已跳过')
    }
    const nextAnswers = [...answers, input.record]
    recapSessions.updateAnswers(session.id, JSON.stringify(nextAnswers))
    return nextAnswers
  })

  const appendMessageTx = db.transaction((input) => {
    const session = recapSessions.get(input.sessionId)
    if (!session) throw new AppError('NOT_FOUND', '复盘会话不存在')
    const messages = parseJsonArray(session.messages_json)
    const nextMessages = [...messages, input.message]
    recapSessions.updateMessages(session.id, JSON.stringify(nextMessages))
    return nextMessages
  })

  const finishTx = db.transaction((input) => {
    const session = recapSessions.get(input.sessionId)
    if (!session) throw new AppError('NOT_FOUND', '复盘会话不存在')
    if (session.status === 'finished') {
      const existing = summaries.getByArticle(input.articleId)
      if (existing) return existing
      throw new AppError('STATE_CONFLICT', '复盘已结束但缺少小结，请重试')
    }
    const summaryId = summaries.create({
      articleId: input.articleId,
      dataJson: JSON.stringify(input.data),
      userNotes: '',
      promptVersion: input.promptVersion,
      model: input.model,
      degraded: input.degraded ? 1 : 0,
      createdAt: input.now,
      updatedAt: input.now
    })
    recapSessions.markFinished(session.id, input.now)
    const changed = articles.markDone(input.articleId, input.now)
    if (changed === 0) throw new AppError('STATE_CONFLICT', '文章状态已变化，请刷新后重试')
    const openSession = reading.findOpenByArticle(input.articleId)
    if (openSession) reading.end(openSession.id, input.now)
    logger?.info('recap', '复盘结束并生成小结', {
      articleId: input.articleId,
      summaryId,
      degraded: input.degraded
    })
    return summaries.getByArticle(input.articleId)
  })

  return {
    /**
     * POST /api/articles/:id/recap/start：生成/恢复复盘（幂等）。
     * @param {number} articleId
     * @param {{ signal?: AbortSignal }} [options]
     * @returns {Promise<{ recap: object }>}
     */
    async start(articleId, options = {}) {
      const article = requireArticle(articleId)
      const existing = recapSessions.getByArticle(articleId)
      if (existing) return { recap: buildRecapPayload(existing) }
      if (article.sentence_count <= 0) {
        throw new AppError('STATE_CONFLICT', '文章没有句子，不能开始复盘')
      }
      if (
        article.status !== 'reading' ||
        article.processed_count < article.sentence_count ||
        work.countProcessed(articleId) < article.sentence_count
      ) {
        throw new AppError('STATE_CONFLICT', '还有句子未处理完，不能进入复盘')
      }
      const ai = requireAiConfig()
      const { sentenceRows, workByIndex } = loadArticleRecords(articleId)
      const records = buildRecords(sentenceRows, workByIndex)
      const targetCount = computeTargetQuestionCount(article)
      const promptMessages = buildRecapQuestionsMessages({ article, records, targetCount })
      let questions
      let degraded = false
      try {
        const outcome = await aiClient.chatJson({
          ai,
          messages: promptMessages,
          purpose: 'recap_questions',
          promptId: RECAP_Q_PROMPT_ID,
          promptVersion: RECAP_Q_PROMPT_VERSION,
          promptPreview: buildRecapQuestionsTask({ records, targetCount }),
          temperature: RECAP_Q_TEMPERATURE,
          maxTokens: RECAP_Q_MAX_TOKENS,
          timeoutMs: RECAP_Q_TIMEOUT_MS,
          jsonMode: true,
          parse: (raw) =>
            parseRecapQuestions(raw, {
              sentenceCount: sentenceRows.length,
              targetCount
            }),
          repairHint: RECAP_Q_REPAIR_HINT,
          onFormat: 'degrade',
          signal: options.signal
        })
        if (outcome.status === 'degraded') {
          degraded = true
          questions = buildGenericQuestions({
            title: article.title,
            sentenceCount: sentenceRows.length,
            firstSentence: sentenceRows[0]?.text
          })
        } else {
          questions = outcome.value
        }
      } catch (error) {
        if (error && typeof error === 'object' && error.code === 'CANCELLED') throw error
        degraded = true
        questions = buildGenericQuestions({
          title: article.title,
          sentenceCount: sentenceRows.length,
          firstSentence: sentenceRows[0]?.text
        })
        logger?.info('recap', '出题失败，已降级通用题', {
          articleId,
          code: error && typeof error === 'object' ? error.code : 'INTERNAL'
        })
      }
      const now = nowIso()
      const model = typeof ai.model === 'string' ? ai.model : ''
      const promptVersion = degraded ? `${RECAP_Q_PROMPT_VERSION}-degraded` : RECAP_Q_PROMPT_VERSION
      try {
        const session = startTx({
          articleId,
          questionsJson: JSON.stringify(questions),
          promptVersion,
          model,
          now
        })
        logger?.info('recap', '开始复盘', {
          articleId,
          sessionId: session.id,
          questionCount: questions.length,
          degraded
        })
        return { recap: buildRecapPayload(session) }
      } catch (error) {
        const raced = recapSessions.getByArticle(articleId)
        if (raced) return { recap: buildRecapPayload(raced) }
        throw error
      }
    },

    /**
     * GET /api/articles/:id/recap
     * @param {number} articleId
     * @returns {{ recap: object }}
     */
    get(articleId) {
      requireArticle(articleId)
      return { recap: buildRecapPayload(requireSession(articleId)) }
    },

    /**
     * POST /api/articles/:id/recap/answer
     * @param {{ articleId: number, questionId: number, answer: string, signal?: AbortSignal }} input
     * @returns {Promise<object>}
     */
    async answer(input) {
      const article = requireArticle(input.articleId)
      const session = requireSession(input.articleId)
      if (session.status !== 'asking') throw new AppError('STATE_CONFLICT', '复盘已结束')
      const questions = parseJsonArray(session.questions_json)
      const question = questions.find((item) => item.id === input.questionId)
      if (!question) {
        throw new AppError('VALIDATION', '题目不存在', {
          detail: { fields: [{ path: 'questionId', message: '题目不存在' }] }
        })
      }
      const answers = parseJsonArray(session.answers_json)
      const existing = answers.find((item) => item.questionId === input.questionId)
      if (existing) {
        throw new AppError(
          'ALREADY_ANSWERED',
          existing.skipped ? '该题已跳过，不能补答' : '该题已作答'
        )
      }
      const ai = requireAiConfig()
      const { sentenceRows, workByIndex } = loadArticleRecords(input.articleId)
      const sentenceByIndex = new Map(sentenceRows.map((row) => [row.idx, row]))
      const relatedSentences = question.sentenceRefs
        .map((idx) => sentenceByIndex.get(idx))
        .filter(Boolean)
        .map((row) => `第 ${row.idx + 1} 句：${row.text}`)
      const referenceInfo = question.sentenceRefs
        .map((idx) => {
          const sentence = sentenceByIndex.get(idx)
          if (!sentence) return null
          const workRow = workByIndex.get(idx)
          const correction = parseCorrectionJson(workRow?.correction_json)
          return `第 ${idx + 1} 句：${sentence.text}｜我的译文：${workRow?.my_translation ?? '（跳过）'}｜参考译文：${correction?.referenceTranslation ?? '（无）'}｜问题：${issueSummaryText(correction?.issues ?? [])}`
        })
        .filter(Boolean)
        .join('\n')
      const promptMessages = buildRecapEvalMessages({
        article,
        question,
        relatedSentences,
        answer: input.answer,
        referenceInfo: referenceInfo || '（无）'
      })
      /** @type {object | null} */
      let evaluation = null
      let degraded = false
      try {
        const outcome = await aiClient.chatJson({
          ai,
          messages: promptMessages,
          purpose: 'recap_evaluate',
          promptId: RECAP_EVAL_PROMPT_ID,
          promptVersion: RECAP_EVAL_PROMPT_VERSION,
          promptPreview: `【题目】${question.stem}\n【学生的回答】${input.answer}`,
          temperature: RECAP_EVAL_TEMPERATURE,
          maxTokens: RECAP_EVAL_MAX_TOKENS,
          jsonMode: true,
          parse: parseRecapEvaluation,
          repairHint: RECAP_EVAL_REPAIR_HINT,
          onFormat: 'degrade',
          signal: input.signal
        })
        if (outcome.status === 'degraded') {
          degraded = true
        } else {
          evaluation = outcome.value
        }
      } catch (error) {
        if (error && typeof error === 'object' && error.code === 'CANCELLED') throw error
        degraded = true
        logger?.info('recap', '评估失败，答案照存', {
          articleId: input.articleId,
          questionId: input.questionId,
          code: error && typeof error === 'object' ? error.code : 'INTERNAL'
        })
      }
      const record = {
        questionId: input.questionId,
        answer: input.answer,
        evaluation,
        skipped: false,
        ...(degraded ? { degraded: true } : {}),
        answeredAt: nowIso()
      }
      const nextAnswers = appendAnswerTx({ sessionId: session.id, record })
      const updatedQuestions = parseJsonArray(session.questions_json)
      return {
        answer: {
          questionId: record.questionId,
          answer: record.answer,
          evaluation: record.evaluation,
          skipped: false,
          degraded,
          answeredAt: record.answeredAt
        },
        nextQuestion: findNextQuestion(updatedQuestions, nextAnswers),
        progress: buildAnswerProgress(updatedQuestions, nextAnswers),
        degraded
      }
    },

    /**
     * POST /api/articles/:id/recap/skip（02 接口表未列，Lead 已同意新增）
     * @param {{ articleId: number, questionId: number }} input
     * @returns {{ nextQuestion: object | null, progress: object, skipped: boolean }}
     */
    skip(input) {
      requireArticle(input.articleId)
      const session = requireSession(input.articleId)
      if (session.status !== 'asking') throw new AppError('STATE_CONFLICT', '复盘已结束')
      const questions = parseJsonArray(session.questions_json)
      const question = questions.find((item) => item.id === input.questionId)
      if (!question) {
        throw new AppError('VALIDATION', '题目不存在', {
          detail: { fields: [{ path: 'questionId', message: '题目不存在' }] }
        })
      }
      const answers = parseJsonArray(session.answers_json)
      const existing = answers.find((item) => item.questionId === input.questionId)
      if (existing && !existing.skipped) {
        throw new AppError('ALREADY_ANSWERED', '该题已作答，不能跳过')
      }
      let nextAnswers = answers
      if (!existing) {
        nextAnswers = appendAnswerTx({
          sessionId: session.id,
          record: {
            questionId: input.questionId,
            answer: '',
            evaluation: null,
            skipped: true,
            answeredAt: nowIso()
          }
        })
      }
      return {
        nextQuestion: findNextQuestion(questions, nextAnswers),
        progress: buildAnswerProgress(questions, nextAnswers),
        skipped: true
      }
    },

    /**
     * 复盘自由提问前置校验（SSE 建连前调用）。
     * @param {number} articleId
     * @returns {{ article: object, session: object }}
     */
    prepareChat(articleId) {
      const article = requireArticle(articleId)
      const session = requireSession(articleId)
      if (session.status !== 'asking') {
        throw new AppError('STATE_CONFLICT', '复盘已结束，不能自由提问')
      }
      requireAiConfig()
      return { article, session }
    },

    /**
     * POST /api/articles/:id/recap/chat：SSE 流式自由提问，写 messages_json。
     * @param {{ articleId: number, message: string, signal?: AbortSignal, onDelta?: (text: string) => void }} input
     * @returns {Promise<{ messageId: number | null, content: string, usage: object }>}
     */
    async chat(input) {
      const article = requireArticle(input.articleId)
      const session = requireSession(input.articleId)
      if (session.status !== 'asking') {
        throw new AppError('STATE_CONFLICT', '复盘已结束，不能自由提问')
      }
      const ai = requireAiConfig()
      const questions = parseJsonArray(session.questions_json)
      const answers = parseJsonArray(session.answers_json)
      const history = parseJsonArray(session.messages_json)
        .slice(-10)
        .map((message) => ({ role: message.role, content: message.content }))
      const promptMessages = buildRecapChatMessages({
        article,
        questions,
        answers,
        history,
        message: input.message
      })
      const existingMessages = parseJsonArray(session.messages_json)
      appendMessageTx({
        sessionId: session.id,
        message: {
          id: existingMessages.length + 1,
          role: 'user',
          content: input.message,
          partial: 0,
          createdAt: nowIso()
        }
      })

      let accumulated = ''
      try {
        const outcome = await aiClient.chatStream({
          ai,
          messages: promptMessages,
          purpose: 'recap_chat',
          promptId: RECAP_CHAT_PROMPT_ID,
          promptVersion: RECAP_CHAT_PROMPT_VERSION,
          promptPreview: input.message,
          temperature: RECAP_CHAT_TEMPERATURE,
          maxTokens: RECAP_CHAT_MAX_TOKENS,
          signal: input.signal,
          onDelta: (text) => {
            accumulated += text
            input.onDelta?.(text)
          }
        })
        const content = outcome.content.length > 0 ? outcome.content : accumulated
        const currentMessages = parseJsonArray(recapSessions.get(session.id)?.messages_json)
        const assistantMessage = {
          id: currentMessages.length + 1,
          role: 'assistant',
          content,
          partial: 0,
          createdAt: nowIso()
        }
        appendMessageTx({ sessionId: session.id, message: assistantMessage })
        logger?.info('recap', '复盘自由提问完成', {
          articleId: input.articleId,
          messageId: assistantMessage.id
        })
        return { messageId: assistantMessage.id, content, usage: outcome.usage }
      } catch (error) {
        if (accumulated.length > 0) {
          try {
            const currentMessages = parseJsonArray(recapSessions.get(session.id)?.messages_json)
            appendMessageTx({
              sessionId: session.id,
              message: {
                id: currentMessages.length + 1,
                role: 'assistant',
                content: accumulated,
                partial: 1,
                createdAt: nowIso()
              }
            })
          } catch {
            // 会话已在中断期间结束时不阻塞错误返回
          }
        }
        throw error
      }
    },

    /**
     * POST /api/articles/:id/recap/finish：生成小结并置 done（AI 失败降级为简版）。
     * @param {number} articleId
     * @param {{ signal?: AbortSignal }} [options]
     * @returns {Promise<{ summary: { id: number, articleId: number, degraded: boolean } }>}
     */
    async finish(articleId, options = {}) {
      const article = requireArticle(articleId)
      const session = requireSession(articleId)
      if (session.status === 'finished') {
        const existing = summaries.getByArticle(articleId)
        if (existing) {
          return {
            summary: {
              id: existing.id,
              articleId,
              degraded: Boolean(existing.degraded)
            }
          }
        }
        throw new AppError('STATE_CONFLICT', '复盘已结束但缺少小结，请重试')
      }
      const questions = parseJsonArray(session.questions_json)
      const answers = parseJsonArray(session.answers_json)
      const { sentenceRows, workByIndex } = loadArticleRecords(articleId)
      const stats = buildStats(sentenceRows, workByIndex)
      const processed = article.processed_count
      const skipped = article.skipped_count
      const ai = readAiConfig()
      let draft = null
      let degraded = false
      if (isAiConfigured(ai)) {
        const promptMessages = buildSummaryMessages({
          article,
          records: stats.records,
          recapSummary: formatRecapQaSummary({ questions, answers })
        })
        try {
          const outcome = await aiClient.chatJson({
            ai,
            messages: promptMessages,
            purpose: 'summary',
            promptId: SUMMARY_PROMPT_ID,
            promptVersion: SUMMARY_PROMPT_VERSION,
            promptPreview: `【文章】${article.title}\n【复盘问答摘要】\n${formatRecapQaSummary({ questions, answers })}`,
            temperature: SUMMARY_TEMPERATURE,
            maxTokens: SUMMARY_MAX_TOKENS,
            jsonMode: true,
            parse: (raw) => parseSummaryDraft(raw, { sentenceCount: sentenceRows.length }),
            repairHint: SUMMARY_REPAIR_HINT,
            onFormat: 'degrade',
            signal: options.signal
          })
          if (outcome.status === 'degraded') {
            degraded = true
          } else {
            draft = outcome.value
          }
        } catch (error) {
          if (error && typeof error === 'object' && error.code === 'CANCELLED') throw error
          degraded = true
          logger?.info('recap', '小结生成失败，使用本地简版', {
            articleId,
            code: error && typeof error === 'object' ? error.code : 'INTERNAL'
          })
        }
      } else {
        degraded = true
      }

      const data = draft
        ? {
            overview: draft.overview,
            issueSummary: stats.issueSummary,
            knowledgePoints: draft.knowledgePoints,
            weakSentences: draft.weakSentences,
            suggestions: draft.suggestions,
            degraded: false
          }
        : {
            ...buildSimpleSummary({
              sentenceCount: sentenceRows.length,
              processed,
              skipped,
              issueSummary: stats.issueSummary,
              weakFindings: stats.weakFindings
            }),
            issueSummary: stats.issueSummary
          }

      const now = nowIso()
      let summary
      try {
        summary = finishTx({
          sessionId: session.id,
          articleId,
          data,
          promptVersion: degraded ? `${SUMMARY_PROMPT_VERSION}-degraded` : SUMMARY_PROMPT_VERSION,
          model: typeof ai.model === 'string' ? ai.model : null,
          degraded,
          now
        })
      } catch (error) {
        const existing = summaries.getByArticle(articleId)
        if (existing && session.status !== 'finished') {
          summary = existing
        } else {
          throw error
        }
      }
      return {
        summary: {
          id: summary.id,
          articleId,
          degraded: Boolean(summary.degraded)
        }
      }
    }
  }
}

export default createRecapService
