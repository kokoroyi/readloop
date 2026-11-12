<script setup>
/**
 * 文章库：状态筛选、搜索（防抖 200ms）、排序、批量删除、待读队列排序、
 * 行内操作菜单与导入入口。
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import ArticleTable from '../components/library/ArticleTable.vue'
import ImportDialog from '../components/library/ImportDialog.vue'
import LibraryEmptyState from '../components/library/LibraryEmptyState.vue'
import LibraryToolbar from '../components/library/LibraryToolbar.vue'
import Button from '../components/ui/Button.vue'
import ConfirmDialog from '../components/ui/ConfirmDialog.vue'
import Icon from '../components/ui/Icon.vue'
import SearchBox from '../components/ui/SearchBox.vue'
import Skeleton from '../components/ui/Skeleton.vue'
import { describeError, post } from '../lib/api.js'
import {
  SORT_OPTIONS,
  clearSelection,
  libraryPageCount,
  libraryStore,
  moveInQueue,
  refreshLibrary,
  removeArticles,
  selectionCount,
  setPage,
  setQuery,
  setSort,
  setStatus,
  startArticle,
  toggleSelect,
  toggleSelectPage,
  visibleArticles
} from '../stores/library.js'
import { toast } from '../stores/toast.js'

const router = useRouter()

const importOpen = ref(false)
const searchText = ref('')
const openingId = ref(null)
const deleting = ref(false)
let searchTimer = null

const confirmState = reactive({
  open: false,
  ids: [],
  title: '删除文章？',
  description: ''
})

const reReadState = reactive({ open: false, item: null, loading: false })

const loading = computed(() => libraryStore.loading)
const error = computed(() => libraryStore.error)
const noItems = computed(() => !loading.value && !error.value && libraryStore.items.length === 0)
const counts = computed(() => libraryStore.counts)
const pageCount = computed(() => libraryPageCount.value)
const isReorder = computed(() => libraryStore.reorderMode)

const summaryText = computed(() => {
  const c = counts.value
  return `共 ${c.all} 篇 · 待读 ${c.queued} · 精读中 ${c.reading} · 复盘中 ${c.recap} · 已复盘 ${c.done}`
})

const footText = computed(() => {
  const label = SORT_OPTIONS.find((option) => option.value === libraryStore.sort)?.label || ''
  return `共 ${libraryStore.total} 篇 · ${label}`
})

onMounted(() => {
  refreshLibrary()
})

onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
})

watch(searchText, (value) => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => setQuery(value), 200)
})

async function toggleReorderMode() {
  if (libraryStore.reorderMode) {
    libraryStore.reorderMode = false
    return
  }
  if (libraryStore.sort !== 'queue') await setSort('queue')
  if (libraryStore.status !== 'queued') await setStatus('queued')
  libraryStore.reorderMode = true
}

function retryLoad() {
  refreshLibrary()
}

async function openArticle(item) {
  if (openingId.value) return
  openingId.value = item.id
  try {
    if (item.status === 'queued') {
      await startArticle(item.id)
      router.push(`/read/${item.id}`)
      return
    }
    if (item.status === 'recap') {
      router.push(`/read/${item.id}`)
      return
    }
    if (item.status === 'done') {
      router.push(`/read/${item.id}?review=1`)
      return
    }
    router.push(`/read/${item.id}`)
  } catch (err) {
    toast.error(`打开文章失败：${describeError(err)}`)
  } finally {
    openingId.value = null
  }
}

function onMenuAction({ action, item }) {
  if (action === 'open') openArticle(item)
  else if (action === 'review') router.push(`/read/${item.id}?review=1`)
  else if (action === 'record') router.push(`/read/${item.id}`)
  else if (action === 'reread') {
    reReadState.item = item
    reReadState.open = true
  } else if (action === 'delete') askDelete([item.id])
}

async function confirmReRead() {
  const item = reReadState.item
  if (!item) return
  reReadState.loading = true
  try {
    await post(`/api/articles/${item.id}/re-read`)
    reReadState.open = false
    toast.success('已重新开始精读')
    router.push(`/read/${item.id}`)
  } catch (err) {
    toast.error(`重新精读失败：${describeError(err)}`)
  } finally {
    reReadState.loading = false
  }
}

function askDelete(ids) {
  const list = Array.from(new Set(ids))
  if (!list.length) return
  const single = list.length === 1 ? libraryStore.items.find((item) => item.id === list[0]) : null
  confirmState.ids = list
  confirmState.title = single ? `删除《${single.title}》？` : `删除选中的 ${list.length} 篇文章？`
  confirmState.description = '删除后正文、句子与批改记录都不可恢复；已收藏的词会保留在词库。'
  confirmState.open = true
}

async function confirmDelete() {
  deleting.value = true
  try {
    const result = await removeArticles(confirmState.ids)
    if (result.ok.length) {
      toast.success(
        confirmState.ids.length === 1 ? '已删除文章' : `已删除 ${result.ok.length} 篇文章`
      )
    }
    if (result.failed.length) {
      toast.error(`有 ${result.failed.length} 篇删除失败：${result.failed[0].message}`)
    }
    confirmState.open = false
    libraryStore.reorderMode = false
  } finally {
    deleting.value = false
  }
}

async function onMove({ id, direction }) {
  try {
    await moveInQueue(id, direction)
  } catch (err) {
    toast.error(`调整顺序失败：${describeError(err)}`)
  }
}

function onImported(result) {
  refreshLibrary()
  if (!result) return
  if (result.duplicate) {
    toast.info('这篇文章已在文章库中')
    return
  }
  const count = typeof result.count === 'number' ? result.count : 0
  if (count > 0) toast.success(`已导入 ${count} 篇，进入待读队列`)
  if (result.skippedCount) toast.info(`有 ${result.skippedCount} 篇因重复内容被跳过`)
}

function clearSearch() {
  searchText.value = ''
  setQuery('')
}

function showAll() {
  setStatus('all')
}

function prevPage() {
  setPage(libraryStore.page - 1)
}

function nextPage() {
  setPage(libraryStore.page + 1)
}
</script>

<template>
  <div class="container library-page">
    <header class="page-head">
      <div>
        <h1 class="page-title">文章库</h1>
        <p class="page-sub">{{ summaryText }}</p>
      </div>
      <div class="page-head-actions">
        <SearchBox v-model="searchText" placeholder="搜索标题或正文…" aria-label="搜索文章" />
        <Button variant="primary" @click="importOpen = true">
          <Icon name="upload" :size="15" />
          导入文章
        </Button>
      </div>
    </header>

    <LibraryToolbar
      :status="libraryStore.status"
      :counts="counts"
      :sort="libraryStore.sort"
      :reorder-mode="isReorder"
      @status="setStatus"
      @sort="setSort"
      @toggle-reorder="toggleReorderMode"
    />

    <div v-if="selectionCount > 0" class="batch-bar">
      <span>已选 {{ selectionCount }} 篇</span>
      <Button size="sm" variant="danger" @click="askDelete(libraryStore.selected)">
        <Icon name="trash" :size="14" />
        删除选中
      </Button>
      <Button size="sm" variant="ghost" @click="clearSelection">取消选择</Button>
    </div>

    <section class="card lib-card">
      <div v-if="loading" class="lib-skeleton" aria-busy="true">
        <div v-for="index in 6" :key="index" class="skeleton-row">
          <Skeleton width="18px" height="18px" />
          <div class="skeleton-main">
            <Skeleton width="46%" height="15px" />
            <Skeleton width="24%" height="11px" />
          </div>
          <Skeleton width="72px" height="22px" radius="999px" />
          <Skeleton width="120px" height="8px" />
        </div>
      </div>

      <div v-else-if="error" class="lib-error">
        <div class="note note-error" role="alert">
          <Icon name="alert" :size="14" />
          <span>读取文章列表失败：{{ describeError(error) }}</span>
        </div>
        <Button variant="primary" @click="retryLoad">重试</Button>
      </div>

      <LibraryEmptyState
        v-else-if="noItems"
        :query="libraryStore.query"
        :status="libraryStore.status"
        @clear-search="clearSearch"
        @show-all="showAll"
        @import="importOpen = true"
      />

      <ArticleTable
        v-else
        :items="visibleArticles"
        :selected="libraryStore.selected"
        :reorder-mode="isReorder"
        :busy-id="openingId"
        @open="openArticle"
        @menu-action="onMenuAction"
        @move="onMove"
        @toggle-select="toggleSelect"
        @toggle-page="toggleSelectPage"
      />

      <div v-if="!loading && !error && libraryStore.items.length" class="card-foot lib-foot">
        <span>{{ footText }}</span>
        <div class="pager">
          <button class="pager-btn" type="button" :disabled="libraryStore.page <= 1" aria-label="上一页" @click="prevPage">
            <Icon name="chevron-left" :size="13" />
          </button>
          <span class="pager-info mono">第 {{ libraryStore.page }} / {{ pageCount }} 页</span>
          <button class="pager-btn" type="button" :disabled="libraryStore.page >= pageCount" aria-label="下一页" @click="nextPage">
            <Icon name="chevron-right" :size="13" />
          </button>
        </div>
      </div>
    </section>

    <ImportDialog v-model="importOpen" @imported="onImported" />

    <ConfirmDialog
      v-model="confirmState.open"
      :title="confirmState.title"
      :description="confirmState.description"
      confirm-text="删除"
      danger
      :loading="deleting"
      @confirm="confirmDelete"
    />

    <ConfirmDialog
      v-model="reReadState.open"
      title="重新精读这篇文章？"
      description="会清空逐句批改、追问、复盘与学习小结，重新从第一句开始；收藏词与阅读统计保留。"
      confirm-text="重新精读"
      danger
      :loading="reReadState.loading"
      @confirm="confirmReRead"
    />
  </div>
</template>

<style scoped>
.library-page {
  padding-bottom: var(--space-16);
}

.lib-card {
  overflow: hidden;
}

.lib-skeleton {
  padding: var(--space-8) var(--space-11);
  display: flex;
  flex-direction: column;
  gap: var(--space-7);
}

.skeleton-row {
  display: flex;
  align-items: center;
  gap: var(--space-8);
}

.skeleton-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.lib-error {
  padding: var(--space-9) var(--space-11);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-6);
}

.lib-foot {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  font-size: var(--text-base);
  color: var(--paper-ink-3);
}

.pager-info {
  font-size: var(--text-sm);
  color: var(--paper-ink-2);
}
</style>

