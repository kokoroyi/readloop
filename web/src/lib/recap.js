/**
 * 复盘（C 回合卡片）数据归一化与展示辅助（M4）：
 * 题组/作答/点评/自由提问消息、进度统计、判定标签与题型文案。
 */

export const RECAP_QUESTION_COUNTS = [
  { value: 'auto', label: '自动（4–6 题）' },
  { value: '3', label: '3 题' },
  { value: '4', label: '4 题' },
  { value: '5', label: '5 题' },
  { value: '6', label: '6 题' },
  { value: '8', label: '8 题' }
]

export const VERDICT_TONE = {
  正确: 'tag-green',
  部分正确: 'tag-green',
  不正确: 'tag-rust'
}

export function normalizeEvaluation(raw) {
  if (!raw || typeof raw !== 'object') return null
  const verdict = ['正确', '部分正确', '不正确'].includes(raw.verdict) ? raw.verdict : '部分正确'
  return {
    verdict,
    comment: typeof raw.comment === 'string' ? raw.comment : '',
    extension: typeof raw.extension === 'string' ? raw.extension : ''
  }
}

export function normalizeQuestion(raw) {
  const question = raw && typeof raw === 'object' ? raw : {}
  const refs = Array.isArray(question.sentenceRefs)
    ? question.sentenceRefs.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item >= 0)
    : []
  return {
    id: Number(question.id) || 0,
    type: ['理解', '语法', '翻译'].includes(question.type) ? question.type : '理解',
    stem: typeof question.stem === 'string' ? question.stem : '',
    intent: typeof question.intent === 'string' ? question.intent : '',
    sentenceRefs: refs
  }
}

export function normalizeAnswer(raw) {
  if (!raw || typeof raw !== 'object') return null
  const questionId = Number(raw.questionId)
  if (!Number.isInteger(questionId)) return null
  return {
    questionId,
    answer: typeof raw.answer === 'string' ? raw.answer : '',
    evaluation: normalizeEvaluation(raw.evaluation),
    skipped: Boolean(raw.skipped),
    degraded: Boolean(raw.degraded),
    answeredAt: raw.answeredAt || null
  }
}

export function normalizeRecapMessage(raw) {
  const message = raw && typeof raw === 'object' ? raw : {}
  return {
    id: message.id ?? null,
    role: message.role === 'user' ? 'user' : 'assistant',
    content: typeof message.content === 'string' ? message.content : '',
    partial: Boolean(message.partial),
    createdAt: message.createdAt || null
  }
}

/**
 * GET recap / recap start 同构归一化。
 * @returns {null|{id:number|null,status:string,total:number,questions:Array,answers:Array,messages:Array,nextQuestion:object|null,degraded:boolean,createdAt:string|null,finishedAt:string|null}}
 */
export function normalizeRecap(raw) {
  if (!raw || typeof raw !== 'object') return null
  const questions = Array.isArray(raw.questions) ? raw.questions.map(normalizeQuestion) : []
  const answers = Array.isArray(raw.answers) ? raw.answers.map(normalizeAnswer).filter(Boolean) : []
  const messages = Array.isArray(raw.messages) ? raw.messages.map(normalizeRecapMessage) : []
  const total = Number.isFinite(raw.total) ? raw.total : questions.length
  return {
    id: raw.id ?? null,
    status: raw.status === 'finished' ? 'finished' : 'asking',
    total,
    questions,
    answers,
    messages,
    nextQuestion: raw.nextQuestion ? normalizeQuestion(raw.nextQuestion) : null,
    degraded: Boolean(raw.degraded),
    createdAt: raw.createdAt || null,
    finishedAt: raw.finishedAt || null
  }
}

export function answerFor(answers, questionId) {
  return (answers || []).find((answer) => answer.questionId === questionId) || null
}

/** 第一道未作答且未跳过的题（后端 nextQuestion 缺失时兜底）。 */
export function firstUnanswered(questions, answers) {
  const handled = new Set((answers || []).map((answer) => answer.questionId))
  return (questions || []).find((question) => !handled.has(question.id)) || null
}

export function countRecapProgress(questions, answers) {
  let answered = 0
  let skipped = 0
  for (const answer of answers || []) {
    if (answer.skipped) skipped += 1
    else answered += 1
  }
  return { answered, skipped, total: (questions || []).length || 0 }
}

export function questionTypeLabel(question) {
  return question.intent ? `${question.type} · ${question.intent}` : question.type
}

/** 折叠态题干摘要（中文按字符截断）。 */
export function questionStemSummary(stem, max = 42) {
  const text = String(stem || '').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** 复盘用时（秒）：asking 用当前时间，finished 用 finishedAt。 */
export function recapDurationSeconds(createdAt, finishedAt, now = Date.now()) {
  if (!createdAt) return 0
  const start = new Date(createdAt).getTime()
  const end = finishedAt ? new Date(finishedAt).getTime() : now
  if (Number.isNaN(start) || Number.isNaN(end)) return 0
  return Math.max(0, Math.round((end - start) / 1000))
}
