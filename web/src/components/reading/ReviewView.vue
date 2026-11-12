<script setup>
/**
 * 回顾模式（已复盘文章只读）：原文 + 我的译文 + 参考译文 + 页边批注（默认折叠）
 * + 可划词查词收藏；无输入线、无 AI 调用；顶部可进学习小结/重新精读。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import Button from '../ui/Button.vue'
import ConfirmDialog from '../ui/ConfirmDialog.vue'
import Icon from '../ui/Icon.vue'
import Skeleton from '../ui/Skeleton.vue'
import Workbook from './Workbook.vue'
import ReviewTopBar from './ReviewTopBar.vue'
import WordPopup from './WordPopup.vue'
import { describeError, post } from '../../lib/api.js'
import {
  closeWordCard,
  leaveReading,
  loadReview,
  readingStore
} from '../../stores/reading.js'
import { loadHealth, settingsStore } from '../../stores/settings.js'
import { toast } from '../../stores/toast.js'
import { loadFavorites, wordsStore } from '../../stores/words.js'

const props = defineProps({
  articleId: { type: [Number, String], required: true }
})

const router = useRouter()
const reReadOpen = ref(false)
const reReading = ref(false)

const article = computed(() => readingStore.article)
const title = computed(() => (article.value && article.value.title) || '回顾')
const adhdMode = computed(() => settingsStore.settings.appearance.adhd.mode || 'off')

onMounted(() => {
  loadFavorites()
  loadHealth()
  loadReview(Number(props.articleId))
})

watch(
  () => props.articleId,
  (id) => {
    if (id) loadReview(Number(id))
  }
)

onBeforeUnmount(() => {
  closeWordCard()
  leaveReading()
})

function back() {
  router.push('/library')
}

function openSummary() {
  router.push(`/read/${props.articleId}/summary`)
}

function requestReRead() {
  reReadOpen.value = true
}

async function confirmReRead() {
  reReading.value = true
  try {
    await post(`/api/articles/${props.articleId}/re-read`, undefined, { timeoutMs: 30000 })
    reReadOpen.value = false
    router.push(`/read/${props.articleId}`)
  } catch (err) {
    toast.error(`重新精读失败：${describeError(err)}`)
  } finally {
    reReading.value = false
  }
}

function retryLoad() {
  loadReview(Number(props.articleId))
}
</script>

<template>
  <div class="review-shell">
    <ReviewTopBar
      :title="title"
      @back="back"
      @summary="openSummary"
      @reread="requestReRead"
    />

    <div v-if="readingStore.loading" class="container review-loading" aria-busy="true">
      <div class="review-loading-head">
        <Skeleton width="180px" height="12px" />
        <Skeleton width="46%" height="26px" />
        <Skeleton width="220px" height="12px" />
      </div>
      <div v-for="index in 4" :key="index" class="review-loading-row">
        <Skeleton width="22px" height="10px" />
        <div class="review-loading-text">
          <Skeleton width="88%" height="16px" />
          <Skeleton width="62%" height="16px" />
        </div>
        <Skeleton width="160px" height="38px" />
      </div>
    </div>

    <div v-else-if="readingStore.notFound" class="review-state">
      <div class="card recap-state-card">
        <div class="state-icon"><Icon name="file-text" :size="22" /></div>
        <h2 class="state-title">文章不存在或已被删除</h2>
        <p class="state-text">可能链接里的文章编号有误，或这篇文章已被删除。</p>
        <Button variant="primary" @click="back">返回文章库</Button>
      </div>
    </div>

    <div v-else-if="readingStore.error" class="review-state">
      <div class="card recap-state-card">
        <div class="state-icon"><Icon name="alert" :size="22" /></div>
        <h2 class="state-title">打开回顾失败</h2>
        <p class="state-text">{{ describeError(readingStore.error) }}。可以确认本地服务是否在运行。</p>
        <div class="state-actions">
          <Button variant="primary" @click="retryLoad">重试</Button>
          <Button @click="back">返回文章库</Button>
        </div>
      </div>
    </div>

    <Workbook
      v-else-if="article"
      class="review-workbook"
      :sentences="readingStore.sentences"
      :current-idx="-1"
      :article-id="readingStore.articleId"
      :adhd-mode="adhdMode"
      :favorite-set="wordsStore.favoriteLemmas"
      :editable="false"
      :configured="false"
      :title="article.title"
      status="done"
      review
      @skip-request="() => {}"
      @go-settings="() => {}"
    />

    <WordPopup />

    <ConfirmDialog
      v-model="reReadOpen"
      title="重新精读这篇文章？"
      description="会清空逐句批改、追问、复盘与学习小结，重新从第一句开始；收藏词与阅读统计保留。"
      confirm-text="重新精读"
      danger
      :loading="reReading"
      @confirm="confirmReRead"
    />
  </div>
</template>

<style scoped>
.review-shell {
  min-height: 100%;
}

.review-loading {
  padding-top: var(--space-9);
}

.review-loading-head {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding-bottom: var(--space-9);
}

.review-loading-row {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) 160px;
  gap: var(--space-8);
  align-items: start;
  padding: var(--space-6) 0;
  border-top: 1px solid var(--paper-line);
}

.review-loading-text {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.review-state {
  display: grid;
  place-items: center;
  padding: var(--space-16) var(--space-12);
}

.review-workbook {
  padding-bottom: var(--space-12);
}
</style>
