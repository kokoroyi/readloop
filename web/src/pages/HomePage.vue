<script setup>
/**
 * 阅读台（M5）：继续精读卡 / 待读队列 / 活跃日历 / 阅读统计 / 随机回顾 / 导入入口。
 * 数据全部来自真实接口，不复用文章库筛选状态。
 */
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import CalendarCard from '../components/home/CalendarCard.vue'
import ContinueCard from '../components/home/ContinueCard.vue'
import QueueCard from '../components/home/QueueCard.vue'
import { applyQueueOrder, buildFullQueueIds } from '../components/home/QueueDrag.js'
import RandomCard from '../components/home/RandomCard.vue'
import StatsGrid from '../components/home/StatsGrid.vue'
import ImportDialog from '../components/library/ImportDialog.vue'
import Button from '../components/ui/Button.vue'
import ConfirmDialog from '../components/ui/ConfirmDialog.vue'
import Icon from '../components/ui/Icon.vue'
import Skeleton from '../components/ui/Skeleton.vue'
import { ApiError, del, describeError, get, post } from '../lib/api.js'
import {
  canGoNextMonth,
  changeCalendarMonth,
  loadReadingDesk,
  statsStore
} from '../stores/stats.js'
import { toast } from '../stores/toast.js'

const router = useRouter()

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const now = new Date()
const dateText = `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日 · ${WEEK[now.getDay()]}`

const articles = ref([])
const total = ref(0)
const loading = ref(true)
const error = ref(null)
const importOpen = ref(false)
const randomLoading = ref(false)
const queueSaving = ref(false)
const queueMessage = ref('')
const removeState = reactive({ open: false, item: null, loading: false })

const overview = computed(() => statsStore.overview)
const readingArticle = computed(() => articles.value.find((item) => item.status === 'reading') || null)
const queueItems = computed(() => articles.value.filter((item) => item.status === 'queued'))
const queueTotal = computed(() =>
  overview.value && overview.value.queueCount ? overview.value.queueCount : queueItems.value.length
)
const reviewedArticles = computed(() => (overview.value ? overview.value.reviewedArticles : 0))
const streakDays = computed(() => (overview.value ? overview.value.streakDays : 0))
const hasAnyArticle = computed(() => total.value > 0)

async function loadArticles() {
  const data = await get('/api/articles?sort=queue', { timeoutMs: 30000 })
  articles.value = Array.isArray(data.items) ? data.items : []
  total.value = Number.isFinite(data.total) ? data.total : articles.value.length
}

async function loadHome() {
  loading.value = true
  error.value = null
  try {
    await Promise.all([loadArticles(), loadReadingDesk()])
  } catch (err) {
    error.value = err
  } finally {
    loading.value = false
  }
}

onMounted(loadHome)

function retry() {
  loadHome()
}

async function startItem(item) {
  try {
    await post(`/api/articles/${item.id}/start`)
    router.push(`/read/${item.id}`)
  } catch (err) {
    toast.error(`开始精读失败：${describeError(err)}`)
  }
}

function continueArticle(item) {
  router.push(`/read/${item.id}`)
}

function viewCorrections(item) {
  router.push({ path: `/read/${item.id}`, query: { focus: 'last' } })
}

function openLibrary() {
  router.push('/library')
}

/** aria-live 播报（先清空再写入，重复文案也会播报）。 */
function speakQueue(text) {
  queueMessage.value = ''
  nextTick(() => {
    queueMessage.value = text
  })
}

/**
 * 队列前 5 条拖拽/键盘重排：乐观更新 + 完整队列 id 顺序保存 + 失败回滚。
 * @param {number[]} visibleIds 新的可见前 5 条 id 顺序
 */
async function onQueueReorder(visibleIds) {
  if (queueSaving.value) return
  const previousArticles = articles.value.slice()
  const fullIds = buildFullQueueIds(visibleIds, queueItems.value)
  articles.value = applyQueueOrder(articles.value, fullIds)
  queueSaving.value = true
  speakQueue('正在保存队列顺序…')
  try {
    await post('/api/articles/reorder', { ids: fullIds })
    speakQueue('队列顺序已保存')
  } catch {
    articles.value = previousArticles
    speakQueue('排序保存失败，已恢复原顺序')
    toast.error('排序保存失败，已恢复原顺序')
  } finally {
    queueSaving.value = false
  }
}

async function pinItem(item) {
  try {
    const ids = queueItems.value.map((entry) => entry.id).filter((id) => id !== item.id)
    ids.unshift(item.id)
    await post('/api/articles/reorder', { ids })
    toast.success('已置顶到队列最前')
    await loadHome()
  } catch (err) {
    toast.error(`置顶失败：${describeError(err)}`)
  }
}

function askRemove(item) {
  removeState.item = item
  removeState.open = true
}

async function confirmRemove() {
  const item = removeState.item
  if (!item) return
  removeState.loading = true
  try {
    await del(`/api/articles/${item.id}`)
    removeState.open = false
    toast.success('已从待读队列移除')
    await loadHome()
  } catch (err) {
    toast.error(`移除失败：${describeError(err)}`)
  } finally {
    removeState.loading = false
  }
}

async function drawRandom() {
  if (randomLoading.value || reviewedArticles.value <= 0) return
  randomLoading.value = true
  try {
    const data = await get('/api/articles/random', { timeoutMs: 20000 })
    const article = data && data.article
    if (!article || !article.id) throw new Error('没有可回顾的文章')
    router.push(`/read/${article.id}?review=1`)
  } catch (err) {
    if (err instanceof ApiError && err.code === 'NOT_FOUND') {
      toast.info('还没有已复盘的文章，先完成一篇复盘吧')
    } else {
      toast.error(`随机回顾失败：${describeError(err)}`)
    }
  } finally {
    randomLoading.value = false
  }
}

async function changeMonth(delta) {
  await changeCalendarMonth(delta)
}

function onImported(result) {
  if (!result) return
  if (result.duplicate) {
    toast.info('这篇文章已在文章库中')
    return
  }
  const count = typeof result.count === 'number' ? result.count : 0
  if (count > 0) {
    toast.success(`已导入 ${count} 篇，进入待读队列`)
    loadHome()
  }
  if (result.skippedCount) toast.info(`有 ${result.skippedCount} 篇因重复内容被跳过`)
}
</script>

<template>
  <div class="home-wrap">
    <header class="home-head">
      <div class="home-head-main">
        <h1 class="home-title">阅读台</h1>
        <p class="home-sub">
          {{ dateText }}<template v-if="streakDays"> · 已连续阅读 {{ streakDays }} 天</template>
        </p>
      </div>
      <div class="home-head-actions">
        <Button
          variant="secondary"
          aria-label="随机回顾"
          :disabled="reviewedArticles <= 0"
          :loading="randomLoading"
          @click="drawRandom"
        >
          <Icon name="refresh" :size="14" />
          随机回顾
        </Button>
        <Button variant="primary" aria-label="导入文章" @click="importOpen = true">
          <Icon name="plus" :size="15" />
          导入文章
        </Button>
      </div>
    </header>

    <div v-if="loading" class="home-loading" aria-busy="true">
      <div class="home-loading-card">
        <Skeleton width="120px" height="14px" />
        <Skeleton width="62%" height="26px" />
        <Skeleton width="80%" height="12px" />
        <Skeleton width="100%" height="8px" />
        <Skeleton width="180px" height="36px" />
      </div>
      <div class="home-loading-card">
        <Skeleton width="100%" height="14px" />
        <Skeleton width="100%" height="160px" />
        <Skeleton width="100%" height="14px" />
      </div>
    </div>

    <template v-else>
      <div v-if="error" class="note note-error home-error" role="alert">
        <Icon name="alert" :size="14" />
        <span>阅读台数据加载失败：{{ describeError(error) }}。可以确认本地服务是否在运行，然后重试。</span>
        <Button size="sm" variant="secondary" @click="retry">重试</Button>
      </div>

      <section v-if="!hasAnyArticle" class="card home-empty" aria-label="阅读台空态">
        <div class="home-empty-icon"><Icon name="book-open" :size="26" /></div>
        <h2 class="home-empty-title">导入第一篇文章，开始一次精读</h2>
        <p class="home-empty-text">
          粘贴英文或选择 .txt / .md 文件；导入后文章进入待读队列，逐句翻译、AI 批改与复盘都会保存在本机。
        </p>
        <Button variant="primary" aria-label="导入第一篇文章" @click="importOpen = true">
          <Icon name="plus" :size="15" />
          导入第一篇文章
        </Button>
      </section>

      <div v-else class="home-grid">
        <div class="home-col">
          <ContinueCard
            :article="readingArticle"
            :queue-first="queueItems[0] || null"
            @continue="continueArticle"
            @corrections="viewCorrections"
            @start-first="startItem"
          />

          <QueueCard
            :items="queueItems"
            :total="queueTotal"
            :saving="queueSaving"
            @open="startItem"
            @start="startItem"
            @pin="pinItem"
            @remove="askRemove"
            @manage="openLibrary"
            @reorder="onQueueReorder"
          />

          <RandomCard
            :reviewed-articles="reviewedArticles"
            :loading="randomLoading"
            @draw="drawRandom"
          />
        </div>

        <div class="home-col">
          <CalendarCard
            :year="statsStore.calendarYear"
            :month="statsStore.calendarMonth"
            :days="statsStore.calendar ? statsStore.calendar.days : []"
            :can-next="canGoNextMonth"
            :loading="statsStore.calendarLoading"
            @change-month="changeMonth"
          />
          <StatsGrid :overview="overview" :loading="statsStore.overviewLoading" />
        </div>
      </div>
    </template>

    <p class="sr-only queue-live" role="status" aria-live="polite" aria-atomic="true">{{ queueMessage }}</p>

    <ImportDialog v-model="importOpen" @imported="onImported" />

    <ConfirmDialog
      v-model="removeState.open"
      title="从待读队列移除？"
      :description="`《${removeState.item ? removeState.item.title : ''}》会从文章库删除，正文与学习记录不可恢复；已收藏的词会保留在词库。`"
      confirm-text="移除"
      danger
      :loading="removeState.loading"
      @confirm="confirmRemove"
    />
  </div>
</template>

