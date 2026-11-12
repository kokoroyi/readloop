/**
 * 系统信息 / 日志 / 备份 / 清空学习数据 store（M5 设置页「数据管理」「关于与日志」）。
 */

import { reactive } from 'vue'
import { describeError, get, post } from '../lib/api.js'

export const systemStore = reactive({
  info: null,
  infoLoading: true,
  infoError: null,
  logs: [],
  logsLoading: false,
  logsError: null,
  logsLoadedAt: null,
  backupLoading: false,
  backupError: '',
  backupResult: null,
  clearing: false,
  clearError: '',
  clearResult: null
})

function normalizeInfo(raw) {
  const data = raw && typeof raw === 'object' ? raw : {}
  const counts = data.counts && typeof data.counts === 'object' ? data.counts : {}
  const usage = data.aiUsageThisMonth && typeof data.aiUsageThisMonth === 'object' ? data.aiUsageThisMonth : {}
  return {
    version: typeof data.version === 'string' ? data.version : '',
    port: Number(data.port) || 0,
    dataDir: typeof data.dataDir === 'string' ? data.dataDir : '',
    dbPath: typeof data.dbPath === 'string' ? data.dbPath : '',
    dictPath: typeof data.dictPath === 'string' ? data.dictPath : '',
    dictOk: Boolean(data.dictOk),
    dbSizeBytes: Number(data.dbSizeBytes) || 0,
    counts: {
      articles: Number(counts.articles) || 0,
      doneArticles: Number(counts.doneArticles) || 0,
      words: Number(counts.words) || 0,
      aiCalls: Number(counts.aiCalls) || 0
    },
    aiUsageThisMonth: {
      calls: Number(usage.calls) || 0,
      inputTokens: Number(usage.inputTokens) || 0,
      outputTokens: Number(usage.outputTokens) || 0
    }
  }
}

function normalizeLog(raw) {
  const item = raw && typeof raw === 'object' ? raw : {}
  const level = ['info', 'warn', 'error', 'debug'].includes(item.level) ? item.level : 'info'
  return {
    id: item.id ?? null,
    level,
    module: typeof item.module === 'string' ? item.module : '',
    message: typeof item.message === 'string' ? item.message : '',
    createdAt: item.createdAt || null
  }
}

export async function loadSystemInfo({ silent = false } = {}) {
  if (!silent) systemStore.infoLoading = true
  systemStore.infoError = null
  try {
    const data = await get('/api/system/info', { timeoutMs: 20000 })
    systemStore.info = normalizeInfo(data)
  } catch (err) {
    systemStore.infoError = err
    if (!silent) systemStore.info = null
  } finally {
    systemStore.infoLoading = false
  }
}

export async function loadLogs(limit = 200) {
  systemStore.logsLoading = true
  systemStore.logsError = null
  try {
    const data = await get(`/api/logs?limit=${limit}`, { timeoutMs: 20000 })
    const items = Array.isArray(data.items) ? data.items : []
    systemStore.logs = items.map(normalizeLog)
    systemStore.logsLoadedAt = new Date().toISOString()
  } catch (err) {
    systemStore.logsError = err
  } finally {
    systemStore.logsLoading = false
  }
}

export async function runBackup() {
  if (systemStore.backupLoading) return { ok: false }
  systemStore.backupLoading = true
  systemStore.backupError = ''
  try {
    const data = await post('/api/system/backup', undefined, { timeoutMs: 120000 })
    systemStore.backupResult = {
      path: typeof data.path === 'string' ? data.path : '',
      sizeBytes: Number(data.sizeBytes) || 0,
      deletedOld: Number(data.deletedOld) || 0
    }
    return { ok: true, result: systemStore.backupResult }
  } catch (err) {
    systemStore.backupError = describeError(err)
    return { ok: false, error: systemStore.backupError }
  } finally {
    systemStore.backupLoading = false
  }
}

function normalizeRemoved(raw) {
  const data = raw && typeof raw === 'object' ? raw : {}
  const labels = {
    articles: '文章',
    sentences: '句子',
    sentenceWork: '逐句批改',
    sentenceChats: '句内追问',
    recapSessions: '复盘会话',
    summaries: '学习小结',
    readingSessions: '阅读计时',
    aiCalls: 'AI 调用记录',
    logs: '日志',
    words: '收藏词'
  }
  return Object.keys(labels).map((key) => ({
    key,
    label: labels[key],
    count: Number(data[key]) || 0
  }))
}

export async function clearLearningData({ keepWords = true } = {}) {
  if (systemStore.clearing) return { ok: false }
  systemStore.clearing = true
  systemStore.clearError = ''
  try {
    const data = await post(
      '/api/system/clear-data',
      { confirm: true, keepWords },
      { timeoutMs: 120000 }
    )
    systemStore.clearResult = {
      keptWords: Boolean(data.keptWords),
      removed: normalizeRemoved(data.removed)
    }
    await loadSystemInfo({ silent: true })
    return { ok: true, result: systemStore.clearResult }
  } catch (err) {
    systemStore.clearError = describeError(err)
    return { ok: false, error: systemStore.clearError }
  } finally {
    systemStore.clearing = false
  }
}

/** 字节数展示。 */
export function formatBytes(bytes) {
  const size = Math.max(0, Number(bytes) || 0)
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`
}
