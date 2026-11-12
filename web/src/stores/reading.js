/**
 * 精读交互层（M3）：加载/恢复 work、提交批改（可取消）、跳过、下一句、阅读计时。
 * 状态与派生值在 stores/readingState.js；这里 re-export 以保持组件既有 import 路径不变。
 */

import { ApiError, describeError, get, post } from '../lib/api.js'
import { startReadingTimer, stopReadingTimer } from '../lib/readingTimer.js'
import {
  countSentenceProgress,
  firstPendingIndex,
  nextPendingIndex,
  normalizeChats,
  normalizeWork
} from '../lib/work.js'
import {
  announce,
  bumpNoteRevision,
  closeWordCard,
  loadDraftsFor,
  readingStore,
  setDraft
} from './readingState.js'

export * from './readingState.js'

let submitController = null
let submitGeneration = 0

function findSentence(idx) {
  return readingStore.sentences.find((sentence) => sentence.idx === idx) || null
}

function applyProgress(progress) {
  if (!progress || !readingStore.article) return
  if (Number.isFinite(progress.processed)) readingStore.article.processed = progress.processed
  if (Number.isFinite(progress.skipped)) readingStore.article.skipped = progress.skipped
  if (Number.isFinite(progress.total)) readingStore.article.sentenceCount = progress.total
}

function initExpandedNotes() {
  const expanded = new Set()
  let lastCorrected = -1
  for (const sentence of readingStore.sentences) {
    if (sentence.work && sentence.work.status === 'corrected') lastCorrected = sentence.idx
  }
  if (lastCorrected >= 0) expanded.add(lastCorrected)
  readingStore.expandedNotes = expanded
}

function applyWorkPayload(data, { initExpanded = false } = {}) {
  const article = data && data.article ? data.article : {}
  const sentences = Array.isArray(data && data.sentences)
    ? data.sentences.map((sentence) => {
        const work = normalizeWork(sentence.work)
        // 刷新恢复时若有孤儿 submitting（无本地在途请求），视为可重试的 pending，避免界面卡在「批改中」
        if (work.status === 'submitting' && readingStore.submittingIdx === null) work.status = 'pending'
        return {
          idx: Number(sentence.idx),
          text: typeof sentence.text === 'string' ? sentence.text : '',
          work
        }
      })
    : []
  const counts = countSentenceProgress(sentences)
  readingStore.article = {
    id: article.id,
    title: article.title || '',
    status: article.status || 'reading',
    sentenceCount: Number.isFinite(article.sentenceCount) ? article.sentenceCount : sentences.length,
    processed: Number.isFinite(article.processed) ? article.processed : counts.processed,
    skipped: Number.isFinite(article.skipped) ? article.skipped : counts.skipped
  }
  readingStore.sentences = sentences
  readingStore.chats = normalizeChats(data && data.chats)
  applyProgress(data && data.progress)
  const current = Number(article.currentIdx)
  readingStore.currentIdx = Number.isInteger(current) ? current : firstPendingIndex(sentences)
  if (initExpanded) initExpandedNotes()
  else if (!readingStore.expandedNotes.size) initExpandedNotes()
  bumpNoteRevision()
}

function resetState(articleId) {
  cancelSubmit()
  stopReadingTimer(readingStore)
  readingStore.articleId = articleId
  readingStore.article = null
  readingStore.sentences = []
  readingStore.chats = {}
  readingStore.currentIdx = 0
  readingStore.loading = true
  readingStore.error = null
  readingStore.notFound = false
  readingStore.conflict = ''
  readingStore.sessionId = null
  readingStore.resumed = false
  readingStore.wordCard = null
  readingStore.drafts = loadDraftsFor(articleId)
  readingStore.submitError = null
  readingStore.submittingIdx = null
  readingStore.consecutiveFailures = 0
  readingStore.serviceWarning = false
  readingStore.expandedNotes = new Set()
}

/** 开始/继续精读；复盘/已复盘状态返回 STATE_CONFLICT（只读提示，不阻塞打开）。 */
async function ensureStarted() {
  try {
    const data = await post(`/api/articles/${readingStore.articleId}/start`, undefined, {
      timeoutMs: 15000
    })
    if (data && typeof data.sessionId === 'number') readingStore.sessionId = data.sessionId
    readingStore.resumed = Boolean(data && data.resumed)
    return true
  } catch (err) {
    if (err instanceof ApiError && err.code === 'STATE_CONFLICT') {
      readingStore.conflict = 'readonly'
      return false
    }
    throw err
  }
}

/**
 * 打开一篇文章的精读工作台。
 * @param {number|string} articleId
 */
export async function loadReading(articleId) {
  resetState(Number(articleId))
  try {
    await ensureStarted()
    const data = await get(`/api/articles/${readingStore.articleId}/work`, { timeoutMs: 30000 })
    applyWorkPayload(data, { initExpanded: true })
    readingStore.error = null
    startReadingTimer(readingStore)
  } catch (err) {
    if (err instanceof ApiError && err.code === 'NOT_FOUND') {
      readingStore.notFound = true
    } else {
      readingStore.error = err
    }
  } finally {
    readingStore.loading = false
  }
}

/**
 * 重新拉取 work（409/取消后同步、或手动重试页面加载）。
 * @param {{ silent?: boolean }} [options]
 */
/**
 * 回顾模式：已复盘文章的只读 work（不创建计时会话、不调 AI）。
 * @param {number|string} articleId
 */
export async function loadReview(articleId) {
  resetState(Number(articleId))
  try {
    const data = await get(`/api/articles/${readingStore.articleId}/work`, { timeoutMs: 30000 })
    applyWorkPayload(data)
    readingStore.currentIdx = -1
    readingStore.expandedNotes = new Set()
    readingStore.error = null
  } catch (err) {
    if (err instanceof ApiError && err.code === 'NOT_FOUND') readingStore.notFound = true
    else readingStore.error = err
  } finally {
    readingStore.loading = false
  }
}

export async function reloadWork({ silent = true } = {}) {
  if (!readingStore.articleId) return false
  try {
    const data = await get(`/api/articles/${readingStore.articleId}/work`, { timeoutMs: 30000 })
    applyWorkPayload(data)
    if (!silent) readingStore.error = null
    return true
  } catch (err) {
    if (!silent) readingStore.error = err
    return false
  }
}

function classifyError(err) {
  const code = err instanceof ApiError ? err.code : 'NETWORK'
  let kind = 'fatal'
  if (code === 'AI_NOT_CONFIGURED') kind = 'config'
  else if (code === 'ALREADY_CORRECTED' || code === 'STATE_CONFLICT') kind = 'conflict'
  else if (code === 'VALIDATION') kind = 'validation'
  else if (err && err.retryable) kind = 'retryable'
  return { code, kind }
}

/**
 * 提交当前句译文（阻塞，最长 90s；可 cancelSubmit 取消）。
 * @param {number} idx
 * @param {string} translation
 */
export async function submitTranslation(idx, translation) {
  const sentence = findSentence(idx)
  if (!sentence) return { ok: false }
  const text = String(translation ?? '').trim()
  if (!text) {
    readingStore.submitError = {
      idx,
      code: 'VALIDATION',
      kind: 'validation',
      retryable: false,
      message: '请先写下这句的中文译文'
    }
    return { ok: false }
  }
  if (text.length > 2000) {
    readingStore.submitError = {
      idx,
      code: 'VALIDATION',
      kind: 'validation',
      retryable: false,
      message: '译文最多 2000 字'
    }
    return { ok: false }
  }
  if (readingStore.submittingIdx !== null) return { ok: false }

  submitController = new AbortController()
  submitGeneration += 1
  readingStore.submittingIdx = idx
  readingStore.submitError = null
  sentence.work = { ...sentence.work, status: 'submitting' }
  bumpNoteRevision()
  try {
    const data = await post(
      `/api/articles/${readingStore.articleId}/sentences/${idx}/submit`,
      { translation: text },
      { timeoutMs: 90000, signal: submitController.signal }
    )
    sentence.work = normalizeWork((data && data.work) || { status: 'corrected', myTranslation: text })
    applyProgress(data && data.progress)
    setDraft(idx, '')
    readingStore.consecutiveFailures = 0
    readingStore.serviceWarning = false
    // 只展开最新一条批注（与刷新后「最近一条展开」一致），避免长文里多条批注同时撑高页面
    readingStore.expandedNotes = new Set([idx])
    bumpNoteRevision()
    announce(`第 ${idx + 1} 句批改完成`)
    return { ok: true }
  } catch (err) {
    if (err instanceof ApiError && err.code === 'ABORTED') {
      // 客户端取消：本地先回可输入；服务端可能已落 corrected（race），静默同步以服务端为准
      sentence.work = { ...sentence.work, status: 'pending' }
      bumpNoteRevision()
      announce('已取消批改')
      syncAfterCancel()
      return { ok: false, cancelled: true }
    }
    const { code, kind } = classifyError(err)
    // AI_NOT_CONFIGURED / VALIDATION 服务端不会改状态（仍为 pending），其余 AI 失败落 error
    sentence.work = {
      ...sentence.work,
      status: kind === 'config' || kind === 'validation' ? 'pending' : 'error'
    }
    readingStore.submitError = {
      idx,
      code,
      kind,
      retryable: Boolean(err && err.retryable),
      message: describeError(err)
    }
    readingStore.consecutiveFailures += 1
    if (readingStore.consecutiveFailures >= 3) readingStore.serviceWarning = true
    bumpNoteRevision()
    announce(`第 ${idx + 1} 句批改失败`)
    if (kind === 'conflict') await reloadWork({ silent: true })
    return { ok: false, error: readingStore.submitError }
  } finally {
    submitController = null
    readingStore.submittingIdx = null
  }
}

/** 取消后的静默同步：等待服务端 abort 落库；若仍显示 submitting 再补一次。 */
function syncAfterCancel(attempt = 0) {
  const generationAtCancel = submitGeneration
  setTimeout(async () => {
    // 期间用户已重新提交/切句，则不再用旧快照覆盖状态
    if (submitGeneration !== generationAtCancel || readingStore.submittingIdx !== null) return
    const ok = await reloadWork({ silent: true })
    if (!ok) return
    if (submitGeneration !== generationAtCancel) return
    const stillSubmitting = readingStore.sentences.some(
      (sentence) => sentence.work && sentence.work.status === 'submitting'
    )
    if (stillSubmitting && attempt < 2) syncAfterCancel(attempt + 1)
  }, 400)
}

/** 取消正在进行的批改（Esc/取消按钮）；请求 abort 后服务端回到 pending。 */
export function cancelSubmit() {
  if (submitController) submitController.abort()
}

/**
 * 跳过某句：确认后调用；成功后由调用方决定是否前进。
 * @param {number} idx
 */
export async function skipSentence(idx) {
  const sentence = findSentence(idx)
  if (!sentence) return { ok: false }
  try {
    const data = await post(`/api/articles/${readingStore.articleId}/sentences/${idx}/skip`, {})
    sentence.work = { ...sentence.work, status: 'skipped' }
    applyProgress(data && data.progress)
    readingStore.submitError = null
    bumpNoteRevision()
    announce(`第 ${idx + 1} 句已跳过`)
    return { ok: true }
  } catch (err) {
    readingStore.submitError = {
      idx,
      code: err instanceof ApiError ? err.code : 'NETWORK',
      kind: classifyError(err).kind,
      retryable: Boolean(err && err.retryable),
      message: describeError(err)
    }
    if (err instanceof ApiError && (err.code === 'STATE_CONFLICT' || err.code === 'ALREADY_CORRECTED')) {
      await reloadWork({ silent: true })
    }
    announce(`第 ${idx + 1} 句跳过失败`)
    return { ok: false }
  }
}

/**
 * 进入下一句（下一句 pending/error；没有则返回 null）。
 * 进入下一句时立即收起上一句的页边批注（不用等下一句提交）；
 * 若下一句本身已批改过（回看场景），则直接展开它自己的批注。
 * @param {number} idx
 */
export function advanceToNext(idx) {
  const next = nextPendingIndex(readingStore.sentences, idx)
  if (next === null) return null
  readingStore.currentIdx = next
  const nextSentence = readingStore.sentences.find((sentence) => sentence.idx === next)
  const nextHasNote = Boolean(
    nextSentence &&
    nextSentence.work &&
    nextSentence.work.status === 'corrected' &&
    nextSentence.work.correction
  )
  readingStore.expandedNotes = nextHasNote ? new Set([next]) : new Set()
  bumpNoteRevision()
  return next
}

export function setCurrentIdx(idx) {
  const target = Number(idx)
  if (!Number.isInteger(target)) return
  readingStore.currentIdx = target
}

/** 关闭阅读页：中止提交、结束计时并清空划词卡。 */
export function leaveReading() {
  cancelSubmit()
  closeWordCard()
  stopReadingTimer(readingStore)
}
