<script setup>
/**
 * /read/:id 容器：按文章状态分流三态——
 * queued/reading → 精读视图；recap → 复盘视图；done → 复盘记录（只读）+ 小结入口。
 * 精读完成后进入复盘时刷新详情，自动切到复盘视图。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ReviewView from '../components/reading/ReviewView.vue'
import ReadingView from '../components/reading/ReadingView.vue'
import RecapView from '../components/recap/RecapView.vue'
import Button from '../components/ui/Button.vue'
import Icon from '../components/ui/Icon.vue'
import Skeleton from '../components/ui/Skeleton.vue'
import { ApiError, describeError, get } from '../lib/api.js'
import { leaveRecap } from '../stores/recap.js'
import { leaveReading } from '../stores/reading.js'

const route = useRoute()
const router = useRouter()

const articleId = computed(() => Number(route.params.id))
const article = ref(null)
const loading = ref(true)
const notFound = ref(false)
const error = ref(null)

const mode = computed(() => {
  const status = article.value ? article.value.status : ''
  if (status === 'recap') return 'recap'
  if (status === 'done') return 'done'
  return 'reading'
})

/** done + ?review=1 → 只读回顾模式；不带参数 → 复盘记录。 */
const reviewMode = computed(() => mode.value === 'done' && route.query.review === '1')

async function loadDetail() {
  loading.value = true
  error.value = null
  notFound.value = false
  try {
    const data = await get(`/api/articles/${articleId.value}`, { timeoutMs: 30000 })
    article.value = data.article || null
    if (!article.value) notFound.value = true
  } catch (err) {
    if (err instanceof ApiError && err.code === 'NOT_FOUND') notFound.value = true
    else error.value = err
  } finally {
    loading.value = false
  }
}

onMounted(loadDetail)

watch(articleId, (id) => {
  if (!id) return
  leaveReading()
  leaveRecap()
  loadDetail()
})

// 回顾模式切换（重新精读后 /read/:id?review=1 → /read/:id）需要重新拉详情
watch(
  () => route.query.review,
  () => loadDetail()
)

function back() {
  router.push('/library')
}

function openSummary() {
  router.push(`/read/${articleId.value}/summary`)
}
</script>

<template>
  <div class="read-shell">
    <header v-if="loading" class="read-topbar read-topbar-skeleton">
      <Skeleton width="34px" height="34px" />
      <Skeleton width="240px" height="16px" />
      <div class="skeleton-tail"><Skeleton width="150px" height="10px" /></div>
    </header>

    <div v-if="loading" class="recap-wrap read-detail-loading" aria-busy="true">
      <Skeleton width="180px" height="12px" />
      <Skeleton width="46%" height="30px" />
      <Skeleton width="280px" height="12px" />
      <div v-for="index in 3" :key="index" class="read-detail-skeleton-row">
        <Skeleton width="72px" height="12px" />
        <Skeleton width="100%" height="14px" />
      </div>
    </div>

    <div v-else-if="notFound" class="read-state">
      <div class="card read-state-card">
        <div class="state-icon"><Icon name="file-text" :size="22" /></div>
        <h2 class="state-title">文章不存在或已被删除</h2>
        <p class="state-text">可能是链接里的文章编号有误，或这篇文章已被删除。</p>
        <Button variant="primary" @click="back">返回文章库</Button>
      </div>
    </div>

    <div v-else-if="error" class="read-state">
      <div class="card read-state-card">
        <div class="state-icon"><Icon name="alert" :size="22" /></div>
        <h2 class="state-title">打开文章失败</h2>
        <p class="state-text">{{ describeError(error) }}</p>
        <div class="state-actions">
          <Button variant="primary" @click="loadDetail">重试</Button>
          <Button @click="back">返回文章库</Button>
        </div>
      </div>
    </div>

    <ReadingView
      v-else-if="mode === 'reading'"
      :key="`reading-${articleId}`"
      :article-id="articleId"
      :focus-last="route.query.focus === 'last'"
      @recap-started="loadDetail"
    />

    <ReviewView
      v-else-if="reviewMode"
      :key="`review-${articleId}`"
      :article-id="articleId"
    />

    <RecapView
      v-else
      :key="`recap-${articleId}`"
      :article-id="articleId"
      :article="article"
      :readonly="mode === 'done'"
      @summary="openSummary"
    />
  </div>
</template>

<style scoped>
.read-shell {
  min-height: 100%;
}

.read-topbar-skeleton {
  position: sticky;
  top: 0;
  z-index: var(--z-topbar);
  height: var(--topbar-h);
  display: flex;
  align-items: center;
  gap: var(--space-7);
  padding: 0 var(--space-13);
  background: var(--topbar-bg);
  border-bottom: 1px solid var(--paper-line);
}

.skeleton-tail {
  margin-left: auto;
}

.read-detail-loading {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  padding-top: var(--space-10);
}

.read-detail-skeleton-row {
  display: flex;
  align-items: center;
  gap: var(--space-5);
  padding: var(--space-4) 0;
  border-top: 1px solid var(--paper-line);
}

.read-state {
  display: grid;
  place-items: center;
  padding: var(--space-16) var(--space-12);
}

.read-state-card {
  width: 520px;
  max-width: 100%;
  padding: var(--space-12) var(--space-12) var(--space-10);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.state-icon {
  width: 46px;
  height: 46px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-lg);
  background: var(--paper-accent-soft);
  color: var(--paper-accent);
}

.state-title {
  margin-top: var(--space-6);
  font-family: var(--font-serif);
  font-size: var(--text-5xl);
  font-weight: 700;
}

.state-text {
  margin: var(--space-4) 0 var(--space-8);
  font-size: var(--text-lg);
  color: var(--paper-ink-3);
  line-height: var(--leading-relaxed);
}

.state-actions {
  display: flex;
  gap: var(--space-5);
}
</style>
