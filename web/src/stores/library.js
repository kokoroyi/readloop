/**
 * 文章库 store：列表/筛选/搜索/排序（服务端过滤 + 客户端 50/页分页）、
 * 计数、批量选择删除、待读队列排序。
 */

import { computed, reactive } from 'vue'
import { del, get, post } from '../lib/api.js'

export const STATUS_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'queued', label: '待读' },
  { value: 'reading', label: '精读中' },
  { value: 'recap', label: '复盘中' },
  { value: 'done', label: '已复盘' }
]

export const SORT_OPTIONS = [
  { value: 'queue', label: '队列顺序' },
  { value: 'updated', label: '更新时间' }
]

const PAGE_SIZE = 50

export const libraryStore = reactive({
  items: [],
  total: 0,
  counts: { all: 0, queued: 0, reading: 0, recap: 0, done: 0 },
  status: 'all',
  query: '',
  sort: 'queue',
  loading: true,
  error: null,
  selected: [],
  page: 1,
  pageSize: PAGE_SIZE,
  reorderMode: false
})

export const visibleArticles = computed(() => {
  const start = (libraryStore.page - 1) * libraryStore.pageSize
  return libraryStore.items.slice(start, start + libraryStore.pageSize)
})

export const libraryPageCount = computed(() =>
  Math.max(1, Math.ceil(libraryStore.items.length / libraryStore.pageSize))
)

export const selectionCount = computed(() => libraryStore.selected.length)

export const selectedOnPage = computed(() => {
  const ids = new Set(visibleArticles.value.map((item) => item.id))
  return libraryStore.selected.filter((id) => ids.has(id))
})

function buildListQuery(extra = {}) {
  const params = new URLSearchParams()
  const status = extra.status ?? libraryStore.status
  const query = extra.query ?? libraryStore.query
  const sort = extra.sort ?? libraryStore.sort
  if (status && status !== 'all') params.set('status', status)
  if (query && query.trim()) params.set('q', query.trim())
  if (sort) params.set('sort', sort)
  const text = params.toString()
  return text ? `?${text}` : ''
}

export async function loadArticles({ silent = false } = {}) {
  if (!silent) libraryStore.loading = libraryStore.items.length === 0
  try {
    const data = await get(`/api/articles${buildListQuery()}`)
    const items = Array.isArray(data.items) ? data.items : []
    libraryStore.items = items
    libraryStore.total = typeof data.total === 'number' ? data.total : items.length
    if (libraryStore.page > libraryPageCount.value) libraryStore.page = libraryPageCount.value
    libraryStore.error = null
    const visibleIds = new Set(items.map((item) => item.id))
    libraryStore.selected = libraryStore.selected.filter((id) => visibleIds.has(id))
  } catch (err) {
    libraryStore.error = err
  } finally {
    libraryStore.loading = false
  }
}

export async function loadCounts() {
  const statuses = ['queued', 'reading', 'recap', 'done']
  try {
    const responses = await Promise.all(statuses.map((status) => get(`/api/articles?status=${status}`)))
    const counts = { all: 0 }
    statuses.forEach((status, index) => {
      const data = responses[index]
      const items = Array.isArray(data.items) ? data.items : []
      counts[status] = typeof data.total === 'number' ? data.total : items.length
      counts.all += counts[status]
    })
    libraryStore.counts = counts
  } catch {
    // 计数失败不影响主列表；保留旧值
  }
}

export async function refreshLibrary() {
  await Promise.all([loadArticles(), loadCounts()])
}

export async function setStatus(status) {
  if (!STATUS_OPTIONS.some((option) => option.value === status)) return
  libraryStore.status = status
  libraryStore.page = 1
  libraryStore.reorderMode = false
  return loadArticles()
}

export async function setQuery(query) {
  libraryStore.query = query
  libraryStore.page = 1
  return loadArticles({ silent: true })
}

export async function setSort(sort) {
  if (!SORT_OPTIONS.some((option) => option.value === sort)) return
  libraryStore.sort = sort
  libraryStore.page = 1
  return loadArticles({ silent: true })
}

export function setPage(page) {
  const next = Math.max(1, Math.min(libraryPageCount.value, Number(page) || 1))
  libraryStore.page = next
}

export function toggleSelect(id) {
  const index = libraryStore.selected.indexOf(id)
  if (index >= 0) libraryStore.selected.splice(index, 1)
  else libraryStore.selected.push(id)
}

export function toggleSelectPage() {
  const ids = visibleArticles.value.map((item) => item.id)
  const allSelected = selectedOnPage.value.length === ids.length && ids.length > 0
  if (allSelected) {
    libraryStore.selected = libraryStore.selected.filter((id) => !ids.includes(id))
    return
  }
  const merged = new Set([...libraryStore.selected, ...ids])
  libraryStore.selected = Array.from(merged)
}

export function clearSelection() {
  libraryStore.selected = []
}

/**
 * 删除文章（单删/批删共用；批删用 Promise.allSettled 逐条调用）。
 * @param {number[]} ids
 * @returns {Promise<{ ok: number[], failed: Array<{ id: number, message: string }> }>}
 */
export async function removeArticles(ids) {
  const list = Array.from(new Set(ids))
  const results = await Promise.allSettled(list.map((id) => del(`/api/articles/${id}`)))
  const ok = []
  const failed = []
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') ok.push(list[index])
    else failed.push({ id: list[index], message: result.reason && result.reason.message ? result.reason.message : '删除失败' })
  })
  clearSelection()
  await refreshLibrary()
  return { ok, failed }
}

/** 开始/继续精读：POST start（幂等），返回后端文章状态。 */
export async function startArticle(id) {
  const data = await post(`/api/articles/${id}/start`)
  return data && data.article ? data.article : { id, status: 'reading' }
}

/**
 * 提交待读队列新顺序。
 * @param {number[]} ids
 */
export async function reorderQueue(ids) {
  await post('/api/articles/reorder', { ids })
}

/** 在当前队列中移动一篇文章（direction: top | up | down）。 */
export async function moveInQueue(id, direction, { persist = true } = {}) {
  const queued = libraryStore.items
  const index = queued.findIndex((item) => item.id === id)
  if (index < 0) return false
  let target = index
  if (direction === 'top') target = 0
  else if (direction === 'up') target = Math.max(0, index - 1)
  else if (direction === 'down') target = Math.min(queued.length - 1, index + 1)
  if (target === index) return false
  const [moved] = queued.splice(index, 1)
  queued.splice(target, 0, moved)
  if (!persist) return true
  try {
    await reorderQueue(queued.map((item) => item.id))
    return true
  } catch (err) {
    await loadArticles({ silent: true })
    throw err
  }
}
