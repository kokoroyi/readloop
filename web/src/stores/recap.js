/**
 * 复盘（C 回合卡片）store：会话加载/出题、逐题作答与点评、跳题、结束生成小结、
 * 自由提问消息（SSE 在 RecapChat 组件内，消息读写走这里）。
 */

import { computed, reactive } from 'vue'
import { ApiError, describeError, get, post } from '../lib/api.js'
import {
  countRecapProgress,
  firstUnanswered,
  normalizeAnswer,
  normalizeRecap,
  normalizeRecapMessage
} from '../lib/recap.js'

export const recapStore = reactive({
  articleId: null,
  recap: null,
  questions: [],
  answers: [],
  messages: [],
  nextQuestion: null,
  status: 'asking',
  total: 0,
  degraded: false,
  createdAt: null,
  finishedAt: null,
  loading: true,
  error: null,
  notFound: false,
  answeringQuestionId: null,
  answerError: null,
  skippingQuestionId: null,
  finishing: false,
  finishError: null,
  liveMessage: ''
})

let announceTimer = null

function announce(message) {
  recapStore.liveMessage = ''
  if (announceTimer) clearTimeout(announceTimer)
  announceTimer = setTimeout(() => {
    recapStore.liveMessage = message
  }, 30)
}

export const answeredCount = computed(
  () => countRecapProgress(recapStore.questions, recapStore.answers).answered
)

export const skippedCount = computed(
  () => countRecapProgress(recapStore.questions, recapStore.answers).skipped
)

export const currentQuestion = computed(
  () => recapStore.nextQuestion || firstUnanswered(recapStore.questions, recapStore.answers)
)

export const currentNumber = computed(() => {
  const question = currentQuestion.value
  if (!question) return recapStore.total
  const index = recapStore.questions.findIndex((item) => item.id === question.id)
  return index >= 0 ? index + 1 : recapStore.total
})

export const progressDots = computed(() =>
  recapStore.questions.map((question, index) => {
    const answer = recapStore.answers.find((item) => item.questionId === question.id)
    const state = answer
      ? answer.skipped
        ? 'skipped'
        : 'answered'
      : currentQuestion.value && currentQuestion.value.id === question.id
        ? 'current'
        : 'todo'
    return {
      id: question.id,
      number: index + 1,
      state,
      question
    }
  })
)

export const isFinished = computed(() => recapStore.status === 'finished')

/** 最近一次作答（未跳过）的题目 id，用于在评估卡上显示「下一题」。 */
export const lastAnsweredId = computed(() => {
  let lastId = null
  let lastTime = ''
  for (const answer of recapStore.answers) {
    if (answer.skipped) continue
    const time = answer.answeredAt || ''
    if (!lastTime || time >= lastTime) {
      lastId = answer.questionId
      lastTime = time
    }
  }
  return lastId
})

/** 结束复盘确认文案（含未答题数量提醒）。 */
export const finishConfirmDescription = computed(() => {
  const unanswered = recapStore.total - answeredCount.value - skippedCount.value
  if (unanswered > 0) {
    return `还有 ${unanswered} 题未作答，将不纳入点评。生成学习小结后文章进入「已复盘」。`
  }
  return '将生成学习小结，文章进入「已复盘」。之后如需重做要使用「重新精读」。'
})

export const recapDurationText = computed(() => {
  if (!recapStore.createdAt) return '—'
  const start = new Date(recapStore.createdAt).getTime()
  const end = recapStore.finishedAt ? new Date(recapStore.finishedAt).getTime() : Date.now()
  if (Number.isNaN(start) || Number.isNaN(end)) return '—'
  const minutes = Math.max(0, Math.round((end - start) / 60000))
  if (minutes < 1) return '不到 1 分钟'
  return `${minutes} 分钟`
})

function applyRecap(raw) {
  const recap = normalizeRecap(raw)
  if (!recap) return false
  recapStore.recap = recap
  recapStore.questions = recap.questions
  recapStore.answers = recap.answers
  recapStore.messages = recap.messages
  recapStore.nextQuestion = recap.nextQuestion
  recapStore.status = recap.status
  recapStore.total = recap.total
  recapStore.degraded = recap.degraded
  recapStore.createdAt = recap.createdAt
  recapStore.finishedAt = recap.finishedAt
  return true
}

function resetState(articleId) {
  recapStore.articleId = articleId
  recapStore.recap = null
  recapStore.questions = []
  recapStore.answers = []
  recapStore.messages = []
  recapStore.nextQuestion = null
  recapStore.status = 'asking'
  recapStore.total = 0
  recapStore.degraded = false
  recapStore.createdAt = null
  recapStore.finishedAt = null
  recapStore.loading = true
  recapStore.error = null
  recapStore.notFound = false
  recapStore.answeringQuestionId = null
  recapStore.answerError = null
  recapStore.skippingQuestionId = null
  recapStore.finishing = false
  recapStore.finishError = null
}

/** 打开复盘（刷新恢复走这里，GET 与 start 同构）。 */
export async function loadRecap(articleId) {
  resetState(Number(articleId))
  try {
    const data = await get(`/api/articles/${recapStore.articleId}/recap`, { timeoutMs: 30000 })
    applyRecap(data.recap)
    recapStore.error = null
  } catch (err) {
    if (err instanceof ApiError && err.code === 'NOT_FOUND') recapStore.notFound = true
    else recapStore.error = err
  } finally {
    recapStore.loading = false
  }
}

/** 生成/恢复复盘（正文页面「进入复盘」）；成功返回 recap 数据，失败抛出。 */
export async function startRecap(articleId, { signal } = {}) {
  const data = await post(`/api/articles/${articleId}/recap/start`, undefined, {
    timeoutMs: 60000,
    signal
  })
  applyRecap(data.recap)
  return data.recap
}

/** 提交一题答案（评估阻塞，最长 90s）；成功返回 {answer, degraded}。 */
export async function submitAnswer(questionId, answer) {
  const text = String(answer ?? '').trim()
  if (!text) return { ok: false, error: { message: '先写下你的回答' } }
  if (recapStore.answeringQuestionId !== null) return { ok: false }
  recapStore.answeringQuestionId = questionId
  recapStore.answerError = null
  try {
    const data = await post(
      `/api/articles/${recapStore.articleId}/recap/answer`,
      { questionId, answer: text },
      { timeoutMs: 90000 }
    )
    const normalized = normalizeAnswer(data.answer) || {
      questionId,
      answer: text,
      evaluation: null,
      skipped: false,
      degraded: Boolean(data.degraded),
      answeredAt: new Date().toISOString()
    }
    normalized.degraded = normalized.degraded || Boolean(data.degraded)
    const existingIndex = recapStore.answers.findIndex((item) => item.questionId === questionId)
    if (existingIndex >= 0) recapStore.answers.splice(existingIndex, 1, normalized)
    else recapStore.answers.push(normalized)
    if (data.nextQuestion) recapStore.nextQuestion = normalizeAnswerQuestion(data.nextQuestion)
    else recapStore.nextQuestion = firstUnanswered(recapStore.questions, recapStore.answers)
    if (normalized.degraded && !normalized.evaluation) {
      announce(`第 ${questionId} 题点评生成失败`)
    } else {
      announce(`第 ${questionId} 题点评完成：${normalized.evaluation ? normalized.evaluation.verdict : '已记录'}`)
    }
    return { ok: true, answer: normalized, degraded: normalized.degraded }
  } catch (err) {
    const message = describeError(err)
    recapStore.answerError = {
      questionId,
      code: err instanceof ApiError ? err.code : 'NETWORK',
      message,
      conflict: err instanceof ApiError && err.code === 'ALREADY_ANSWERED'
    }
    announce(`第 ${questionId} 题点评失败`)
    if (recapStore.answerError.conflict) await reloadRecap()
    return { ok: false, error: recapStore.answerError }
  } finally {
    recapStore.answeringQuestionId = null
  }
}

function normalizeAnswerQuestion(raw) {
  const question = raw && typeof raw === 'object' ? raw : {}
  return {
    id: Number(question.id) || 0,
    type: ['理解', '语法', '翻译'].includes(question.type) ? question.type : '理解',
    stem: typeof question.stem === 'string' ? question.stem : '',
    intent: typeof question.intent === 'string' ? question.intent : '',
    sentenceRefs: Array.isArray(question.sentenceRefs)
      ? question.sentenceRefs.map((item) => Number(item)).filter((item) => Number.isInteger(item))
      : []
  }
}

/** 跳过一题（不计入已答；重复 skip 幂等）。 */
export async function skipQuestion(questionId) {
  if (recapStore.skippingQuestionId !== null) return { ok: false }
  recapStore.skippingQuestionId = questionId
  try {
    const data = await post(`/api/articles/${recapStore.articleId}/recap/skip`, { questionId })
    const existing = recapStore.answers.find((item) => item.questionId === questionId)
    const skipped = {
      questionId,
      answer: '',
      evaluation: null,
      skipped: true,
      degraded: false,
      answeredAt: new Date().toISOString()
    }
    if (existing) Object.assign(existing, skipped)
    else recapStore.answers.push(skipped)
    recapStore.nextQuestion = data.nextQuestion
      ? normalizeAnswerQuestion(data.nextQuestion)
      : firstUnanswered(recapStore.questions, recapStore.answers)
    announce(`第 ${questionId} 题已跳过`)
    return { ok: true }
  } catch (err) {
    recapStore.answerError = {
      questionId,
      code: err instanceof ApiError ? err.code : 'NETWORK',
      message: describeError(err)
    }
    return { ok: false }
  } finally {
    recapStore.skippingQuestionId = null
  }
}

/** 结束复盘并生成学习小结；成功返回 summary 元信息。 */
export async function finishRecap() {
  if (recapStore.finishing) return { ok: false }
  recapStore.finishing = true
  recapStore.finishError = null
  try {
    const data = await post(`/api/articles/${recapStore.articleId}/recap/finish`, undefined, {
      timeoutMs: 120000
    })
    recapStore.status = 'finished'
    recapStore.finishedAt = new Date().toISOString()
    announce('学习小结已生成')
    return { ok: true, summary: data.summary }
  } catch (err) {
    recapStore.finishError = {
      code: err instanceof ApiError ? err.code : 'NETWORK',
      message: describeError(err)
    }
    announce('生成学习小结失败')
    return { ok: false, error: recapStore.finishError }
  } finally {
    recapStore.finishing = false
  }
}

export async function reloadRecap() {
  if (!recapStore.articleId) return false
  try {
    const data = await get(`/api/articles/${recapStore.articleId}/recap`, { timeoutMs: 30000 })
    applyRecap(data.recap)
    return true
  } catch {
    return false
  }
}

export function ensureMessages() {
  if (!Array.isArray(recapStore.messages)) recapStore.messages = []
  return recapStore.messages
}

export function appendMessage(message) {
  const list = ensureMessages()
  list.push(normalizeRecapMessage(message))
  return list.length - 1
}

export function updateMessage(index, patch) {
  const list = ensureMessages()
  if (!list[index]) return
  list[index] = { ...list[index], ...patch }
}

export function leaveRecap() {
  recapStore.answeringQuestionId = null
  recapStore.answerError = null
  recapStore.finishError = null
}

/** 供组件播报（自由提问完成/中断等）。 */
export function announceRecap(message) {
  announce(message)
}
