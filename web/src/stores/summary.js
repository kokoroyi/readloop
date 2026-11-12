/**
 * 学习小结 store：读取 summary + work（逐句对照），我的笔记自动保存、导出 Markdown、重新精读。
 */

import { computed, reactive } from 'vue'
import { ApiError, describeError, get, patch, post } from '../lib/api.js'
import { downloadFile } from '../lib/download.js'
import { normalizeCorrection } from '../lib/work.js'

function normalizeSummaryData(raw) {
  const data = raw && typeof raw === 'object' ? raw : {}
  const issueSummary = {}
  if (data.issueSummary && typeof data.issueSummary === 'object') {
    for (const key of ['漏译', '误译', '理解偏差']) {
      const value = Number(data.issueSummary[key])
      if (Number.isFinite(value) && value > 0) issueSummary[key] = value
    }
  }
  return {
    overview: typeof data.overview === 'string' ? data.overview : '',
    issueSummary,
    knowledgePoints: Array.isArray(data.knowledgePoints)
      ? data.knowledgePoints.map((point) => ({
          title: (point && point.title) || '',
          explain: (point && point.explain) || '',
          example: (point && point.example) || ''
        }))
      : [],
    weakSentences: Array.isArray(data.weakSentences)
      ? data.weakSentences.map((item) => ({ idx: Number(item && item.idx) || 0, reason: (item && item.reason) || '' }))
      : [],
    suggestions: Array.isArray(data.suggestions) ? data.suggestions.map((item) => String(item)) : [],
    degraded: Boolean(data.degraded)
  }
}

function buildSentenceRows(workData) {
  const sentences = Array.isArray(workData && workData.sentences) ? workData.sentences : []
  return sentences.map((sentence) => {
    const work = sentence.work || {}
    const correction = normalizeCorrection(work.correction)
    return {
      idx: Number(sentence.idx),
      text: typeof sentence.text === 'string' ? sentence.text : '',
      myTranslation: typeof work.myTranslation === 'string' ? work.myTranslation : '',
      referenceTranslation: correction ? correction.referenceTranslation : '',
      issues: correction ? correction.issues : [],
      status: work.status || 'pending'
    }
  })
}

export const summaryStore = reactive({
  articleId: null,
  article: null,
  data: null,
  sentences: [],
  notes: '',
  savedNotes: '',
  createdAt: null,
  updatedAt: null,
  degraded: false,
  loading: true,
  error: null,
  notFound: false,
  saving: false,
  saveError: '',
  exporting: false,
  rereading: false,
  liveMessage: ''
})

let liveTimer = null
function announce(message) {
  summaryStore.liveMessage = ''
  if (liveTimer) clearTimeout(liveTimer)
  liveTimer = setTimeout(() => {
    summaryStore.liveMessage = message
  }, 30)
}

export const notesDirty = computed(() => summaryStore.notes !== summaryStore.savedNotes)

export const issueStats = computed(() => {
  const summary = summaryStore.data
  if (!summary) return []
  const tones = { 漏译: 'tag-amber', 误译: 'tag-rust', 理解偏差: 'tag-blue' }
  return Object.keys(summary.issueSummary).map((type) => ({
    type,
    count: summary.issueSummary[type],
    tone: tones[type] || 'tag'
  }))
})

export const problemSentenceCount = computed(
  () => summaryStore.sentences.filter((row) => row.issues.length > 0).length
)

export async function loadSummary(articleId) {
  summaryStore.articleId = Number(articleId)
  summaryStore.loading = true
  summaryStore.error = null
  summaryStore.notFound = false
  summaryStore.data = null
  summaryStore.sentences = []
  try {
    const [summaryData, workData] = await Promise.all([
      get(`/api/articles/${summaryStore.articleId}/summary`, { timeoutMs: 30000 }),
      get(`/api/articles/${summaryStore.articleId}/work`, { timeoutMs: 30000 }).catch(() => null)
    ])
    summaryStore.article = summaryData.article || null
    summaryStore.data = normalizeSummaryData(summaryData.summary && summaryData.summary.data)
    summaryStore.notes = (summaryData.summary && summaryData.summary.userNotes) || ''
    summaryStore.savedNotes = summaryStore.notes
    summaryStore.createdAt = (summaryData.summary && summaryData.summary.createdAt) || null
    summaryStore.updatedAt = (summaryData.summary && summaryData.summary.updatedAt) || null
    summaryStore.degraded = Boolean(
      (summaryData.summary && summaryData.summary.degraded) ||
        (summaryStore.data && summaryStore.data.degraded)
    )
    summaryStore.sentences = buildSentenceRows(workData)
  } catch (err) {
    if (err instanceof ApiError && err.code === 'NOT_FOUND') summaryStore.notFound = true
    else summaryStore.error = err
  } finally {
    summaryStore.loading = false
  }
}

export function setNotes(value) {
  summaryStore.notes = String(value ?? '').slice(0, 20000)
}

/** 保存「我的笔记」（PATCH）；失败保留本地内容并返回错误。 */
export async function saveNotes() {
  if (!summaryStore.articleId || summaryStore.saving) return { ok: false }
  if (!notesDirty.value) return { ok: true }
  summaryStore.saving = true
  summaryStore.saveError = ''
  try {
    const data = await patch(`/api/articles/${summaryStore.articleId}/summary`, {
      userNotes: summaryStore.notes
    })
    summaryStore.savedNotes = summaryStore.notes
    summaryStore.updatedAt = data.updatedAt || new Date().toISOString()
    summaryStore.saveError = ''
    announce('我的笔记已保存')
    return { ok: true }
  } catch (err) {
    summaryStore.saveError = describeError(err)
    return { ok: false, error: summaryStore.saveError }
  } finally {
    summaryStore.saving = false
  }
}

export async function exportSummary() {
  if (summaryStore.exporting) return { ok: false }
  summaryStore.exporting = true
  try {
    const filename = await downloadFile(
      `/api/articles/${summaryStore.articleId}/summary/export`,
      { fallbackName: `readloop-summary-${summaryStore.articleId}.md` }
    )
    announce(`已导出 ${filename}`)
    return { ok: true, filename }
  } catch (err) {
    return { ok: false, error: describeError(err) }
  } finally {
    summaryStore.exporting = false
  }
}

/** 重新精读（危险操作，调用方二次确认后执行）；返回 {ok}。 */
export async function reRead() {
  if (summaryStore.rereading) return { ok: false }
  summaryStore.rereading = true
  try {
    await post(`/api/articles/${summaryStore.articleId}/re-read`, undefined, { timeoutMs: 30000 })
    announce('已重新开始精读')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: describeError(err) }
  } finally {
    summaryStore.rereading = false
  }
}
