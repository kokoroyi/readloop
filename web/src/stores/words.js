/**
 * 词库 store：收藏词列表/搜索/排序（客户端 50/页分页）、取消收藏、导出所需数据，
 * 同时维护"已收藏 lemma 集合"，供精读正文画虚线（划词卡也复用）。
 */

import { computed, reactive } from 'vue'
import { del, get } from '../lib/api.js'

export const WORD_SORT_OPTIONS = [
  { value: 'created', label: '收藏时间倒序' },
  { value: 'alpha', label: '按字母排序' }
]

const PAGE_SIZE = 50

export const wordsStore = reactive({
  items: [],
  total: 0,
  query: '',
  sort: 'created',
  loading: true,
  error: null,
  page: 1,
  pageSize: PAGE_SIZE,
  removingIds: [],
  favoriteLemmas: new Set(),
  favoritesLoaded: false
})

export const visibleWords = computed(() => {
  const start = (wordsStore.page - 1) * wordsStore.pageSize
  return wordsStore.items.slice(start, start + wordsStore.pageSize)
})

export const wordsPageCount = computed(() =>
  Math.max(1, Math.ceil(wordsStore.items.length / wordsStore.pageSize))
)

function buildWordsQuery() {
  const params = new URLSearchParams()
  if (wordsStore.query.trim()) params.set('q', wordsStore.query.trim())
  if (wordsStore.sort) params.set('sort', wordsStore.sort)
  const text = params.toString()
  return text ? `?${text}` : ''
}

export async function loadWords({ silent = false } = {}) {
  if (!silent) wordsStore.loading = wordsStore.items.length === 0
  try {
    const data = await get(`/api/words${buildWordsQuery()}`)
    const items = Array.isArray(data.items) ? data.items : []
    wordsStore.items = items
    wordsStore.total = typeof data.total === 'number' ? data.total : items.length
    wordsStore.error = null
    if (wordsStore.page > wordsPageCount.value) wordsStore.page = wordsPageCount.value
  } catch (err) {
    wordsStore.error = err
  } finally {
    wordsStore.loading = false
  }
}

/** 加载全部收藏词并刷新 favoriteLemmas（精读正文划线用）。 */
export async function loadFavorites({ force = false } = {}) {
  if (wordsStore.favoritesLoaded && !force) return wordsStore.favoriteLemmas
  try {
    const data = await get('/api/words')
    const items = Array.isArray(data.items) ? data.items : []
    const next = new Set()
    for (const item of items) {
      const lemma = typeof item.lemma === 'string' ? item.lemma.toLowerCase() : ''
      if (lemma) next.add(lemma)
      const display = typeof item.display === 'string' ? item.display.toLowerCase() : ''
      if (display) next.add(display)
    }
    wordsStore.favoriteLemmas = next
    wordsStore.favoritesLoaded = true
    return next
  } catch {
    return wordsStore.favoriteLemmas
  }
}

export function markFavorite(lemma) {
  if (!lemma) return
  // 换成新 Set，确保依赖 favoriteLemmas 引用的组件（句子正文划线）重新渲染
  const next = new Set(wordsStore.favoriteLemmas)
  next.add(String(lemma).toLowerCase())
  wordsStore.favoriteLemmas = next
  wordsStore.favoritesLoaded = true
}

export function isFavorite(lemma) {
  if (!lemma) return false
  return wordsStore.favoriteLemmas.has(String(lemma).toLowerCase())
}

export async function setWordsQuery(query) {
  wordsStore.query = query
  wordsStore.page = 1
  return loadWords({ silent: true })
}

export async function setWordsSort(sort) {
  if (!WORD_SORT_OPTIONS.some((option) => option.value === sort)) return
  wordsStore.sort = sort
  wordsStore.page = 1
  return loadWords({ silent: true })
}

export function setWordsPage(page) {
  const next = Math.max(1, Math.min(wordsPageCount.value, Number(page) || 1))
  wordsStore.page = next
}

/** 取消收藏：即时生效，失败抛出由页面 toast。 */
export async function removeWord(id) {
  wordsStore.removingIds.push(id)
  try {
    await del(`/api/words/${id}`)
    wordsStore.items = wordsStore.items.filter((item) => item.id !== id)
    wordsStore.total = Math.max(0, wordsStore.total - 1)
    if (wordsStore.page > wordsPageCount.value) wordsStore.page = wordsPageCount.value
  } finally {
    wordsStore.removingIds = wordsStore.removingIds.filter((item) => item !== id)
  }
}
