/**
 * 精读状态层（M3）：reactive 单例、派生进度、草稿持久化、批注折叠、追问消息与 aria-live。
 * 交互动作（加载/提交/跳过/计时）在 stores/reading.js。
 */

import { computed, reactive } from 'vue'
import { countSentenceProgress, isProcessedWork } from '../lib/work.js'

const DRAFT_KEY_PREFIX = 'readloop.reading.draft.'

function draftKey(articleId) {
  return `${DRAFT_KEY_PREFIX}${articleId}`
}

function readDrafts(articleId) {
  try {
    const raw = localStorage.getItem(draftKey(articleId))
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeDrafts(articleId, drafts) {
  if (!articleId) return
  try {
    localStorage.setItem(draftKey(articleId), JSON.stringify(drafts))
  } catch {
    /* localStorage 满/被禁用时忽略，草稿仍留在内存 */
  }
}

export const readingStore = reactive({
  articleId: null,
  article: null,
  sentences: [],
  chats: {},
  currentIdx: 0,
  loading: true,
  error: null,
  notFound: false,
  conflict: '',
  sessionId: null,
  resumed: false,
  drafts: {},
  draftSavedAt: 0,
  wordCard: null,
  submittingIdx: null,
  submitError: null,
  consecutiveFailures: 0,
  serviceWarning: false,
  expandedNotes: new Set(),
  noteRevision: 0,
  scrollTargetIdx: null,
  liveMessage: ''
})

let announceTimer = null

export const processedCount = computed(() => {
  if (readingStore.article && typeof readingStore.article.processed === 'number') {
    return readingStore.article.processed
  }
  return countSentenceProgress(readingStore.sentences).processed
})

export const skippedCount = computed(() => {
  if (readingStore.article && typeof readingStore.article.skipped === 'number') {
    return readingStore.article.skipped
  }
  return countSentenceProgress(readingStore.sentences).skipped
})

export const totalCount = computed(() => {
  if (readingStore.article && typeof readingStore.article.sentenceCount === 'number') {
    return readingStore.article.sentenceCount
  }
  return readingStore.sentences.length
})

export const progressPercent = computed(() => {
  const total = totalCount.value
  if (!total) return 0
  return Math.min(100, Math.round((processedCount.value / total) * 100))
})

export const currentSentence = computed(
  () => readingStore.sentences.find((sentence) => sentence.idx === readingStore.currentIdx) || null
)

export const currentIdx = computed(() => readingStore.currentIdx)

/** 可输入状态：复盘/已复盘等只读场景除外。 */
export const isEditable = computed(() => {
  if (readingStore.conflict || !readingStore.article) return false
  return ['queued', 'reading'].includes(readingStore.article.status)
})

export const allProcessed = computed(
  () =>
    readingStore.sentences.length > 0 &&
    readingStore.sentences.every((sentence) => isProcessedWork(sentence.work))
)

/** aria-live 播报（清空再写入，确保重复文案也会被读屏播报）。 */
export function announce(message) {
  readingStore.liveMessage = ''
  if (announceTimer) clearTimeout(announceTimer)
  announceTimer = setTimeout(() => {
    readingStore.liveMessage = message
  }, 30)
}

export function bumpNoteRevision() {
  readingStore.noteRevision += 1
}

/** 保存某句译文草稿（本地 store + localStorage）。 */
export function setDraft(idx, text) {
  const value = String(text ?? '')
  if (value) readingStore.drafts[idx] = value
  else delete readingStore.drafts[idx]
  readingStore.draftSavedAt = Date.now()
  writeDrafts(readingStore.articleId, readingStore.drafts)
}

export function draftFor(idx) {
  return readingStore.drafts[idx] || ''
}

export function loadDraftsFor(articleId) {
  return readDrafts(articleId)
}

export function isNoteExpanded(idx) {
  return readingStore.expandedNotes.has(idx)
}

export function toggleNote(idx) {
  const expanded = new Set(readingStore.expandedNotes)
  if (expanded.has(idx)) expanded.delete(idx)
  else expanded.add(idx)
  readingStore.expandedNotes = expanded
}

export function ensureChats(idx) {
  if (!Array.isArray(readingStore.chats[idx])) readingStore.chats[idx] = []
  return readingStore.chats[idx]
}

/** 追加一条追问消息，返回其在数组中的下标。 */
export function appendChatMessage(idx, message) {
  const list = ensureChats(idx)
  list.push(message)
  return list.length - 1
}

/** 更新某条追问消息（流式增量/完成/中断时用替换对象触发响应式）。 */
export function updateChatMessage(idx, messageIndex, patch) {
  const list = ensureChats(idx)
  if (!list[messageIndex]) return
  list[messageIndex] = { ...list[messageIndex], ...patch }
}

export function clearSubmitError() {
  readingStore.submitError = null
}

export function openWordCard(payload) {
  readingStore.wordCard = payload
}

export function closeWordCard() {
  readingStore.wordCard = null
}

/** 阅读台「查看已批改」：请求 Workbook 滚动到最近一条批改。 */
export function setScrollTarget(idx) {
  readingStore.scrollTargetIdx = Number.isInteger(idx) ? idx : null
}
