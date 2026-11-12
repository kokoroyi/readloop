<script setup>
/**
 * 精读视图（B 句行稿纸）：精简顶栏 + 页头 + 句行列表 + 页边批注 + 提交/跳过/追问交互。
 * 只读状态（复盘/已复盘）与 AI 未配置在此给出顶部提示。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import ReadingTopBar from './ReadingTopBar.vue'
import Workbook from './Workbook.vue'
import WordPopup from './WordPopup.vue'
import Button from '../ui/Button.vue'
import ConfirmDialog from '../ui/ConfirmDialog.vue'
import Icon from '../ui/Icon.vue'
import Skeleton from '../ui/Skeleton.vue'
import { ApiError, describeError } from '../../lib/api.js'
import { ADHD_OPTIONS, loadHealth, saveSettings, settingsStore } from '../../stores/settings.js'
import {
  advanceToNext,
  currentIdx,
  isEditable,
  leaveReading,
  loadReading,
  processedCount,
  setScrollTarget,
  readingStore,
  skipSentence,
  skippedCount,
  totalCount
} from '../../stores/reading.js'
import { startRecap } from '../../stores/recap.js'
import { toast } from '../../stores/toast.js'
import { loadFavorites, wordsStore } from '../../stores/words.js'

const router = useRouter()

const props = defineProps({ articleId: { type: [Number, String], required: true }, focusLast: { type: Boolean, default: false } })
const emit = defineEmits(['recap-started'])
const article = computed(() => readingStore.article)
const status = computed(() => (article.value && article.value.status) || 'reading')
const adhdMode = computed(() => settingsStore.settings.appearance.adhd.mode || 'off')
const editable = computed(() => isEditable.value)

/** AI 是否已配置：health 优先，其次看本地设置（Key/模型）。 */
const aiConfigured = computed(() => {
  const healthAi = settingsStore.health && settingsStore.health.ai
  if (healthAi && typeof healthAi.configured === 'boolean') return healthAi.configured
  const ai = settingsStore.settings.ai
  return Boolean(ai.apiKeySet && ai.model)
})

const conflictNotice = computed(() => (readingStore.conflict ? '当前状态不支持在精读视图修改。' : ''))

const skipState = reactive({ open: false, idx: null, loading: false })
const recapStarting = ref(false)
const recapError = ref(null)
let recapAbort = null

/** 完成精读后进入复盘：POST recap/start（阻塞出题），成功后通知外层容器切到复盘视图。 */
async function startRecapFlow() {
  if (recapStarting.value) return
  recapStarting.value = true
  recapError.value = null
  recapAbort = new AbortController()
  try {
    await startRecap(Number(props.articleId), { signal: recapAbort.signal })
    recapStarting.value = false
    emit('recap-started')
  } catch (err) {
    recapStarting.value = false
    if (err instanceof ApiError && err.code === 'ABORTED') return
    recapError.value = {
      message: describeError(err),
      code: err instanceof ApiError ? err.code : 'NETWORK',
      settings: err instanceof ApiError && err.code === 'AI_NOT_CONFIGURED'
    }
  } finally {
    recapAbort = null
  }
}

function cancelRecapStart() {
  if (recapAbort) recapAbort.abort()
  recapStarting.value = false
}

onMounted(async () => {
  loadFavorites()
  loadHealth()
  await loadReading(Number(props.articleId))
  if (!props.focusLast) return
  const corrected = readingStore.sentences.filter((sentence) => sentence.work.status === 'corrected')
  if (!corrected.length) return
  await nextTick()
  setScrollTarget(corrected[corrected.length - 1].idx)
})

onBeforeUnmount(() => {
  leaveReading()
})

// 批改失败为「AI 未配置」时刷新 health，让顶部提示与设置状态同步
watch(
  () => readingStore.submitError,
  (error) => {
    if (error && error.kind === 'config') loadHealth()
  }
)

function back() {
  router.push('/library')
}

async function cycleAdhd() {
  const index = ADHD_OPTIONS.findIndex((option) => option.value === adhdMode.value)
  const next = ADHD_OPTIONS[(index + 1) % ADHD_OPTIONS.length].value
  settingsStore.settings.appearance.adhd.mode = next
  try {
    await saveSettings({ appearance: { adhd: { mode: next } } })
  } catch (err) {
    toast.error(`保存 ADHD 模式失败：${describeError(err)}`)
  }
}

function openAppearance() {
  router.push('/settings?section=appearance')
}

function goSettings() {
  router.push('/settings?section=ai')
}

function onMore(action) {
  if (action === 'library') router.push('/library')
  else if (action === 'settings') openAppearance()
  else if (action === 'home') router.push('/')
}

function retry() {
  loadReading(Number(props.articleId))
}

function requestSkip(idx) {
  skipState.idx = idx
  skipState.open = true
}

async function confirmSkip() {
  const idx = skipState.idx
  if (idx == null) return
  skipState.loading = true
  try {
    const result = await skipSentence(idx)
    if (result.ok) {
      advanceToNext(idx)
      skipState.open = false
    } else {
      toast.error('跳过失败，请重试或刷新页面')
    }
  } finally {
    skipState.loading = false
  }
}
</script>

<template>
  <div class="reading-page">
    <ReadingTopBar
      v-if="article"
      :title="article.title"
      :status="status"
      :current-idx="currentIdx"
      :processed="processedCount"
      :skipped="skippedCount"
      :total="totalCount"
      @back="back"
      @cycle-adhd="cycleAdhd"
      @open-appearance="openAppearance"
      @more="onMore"
    />
    <div v-else class="read-topbar-skeleton">
      <Skeleton width="34px" height="34px" />
      <Skeleton width="260px" height="16px" />
      <div class="skeleton-tail"><Skeleton width="150px" height="10px" /></div>
    </div>

    <div v-if="readingStore.loading" class="container read-loading" aria-busy="true">
      <div class="read-loading-head">
        <Skeleton width="180px" height="12px" />
        <Skeleton width="46%" height="26px" />
        <Skeleton width="220px" height="12px" />
      </div>
      <div v-for="index in 5" :key="index" class="read-loading-row">
        <Skeleton width="22px" height="10px" />
        <div class="read-loading-text">
          <Skeleton width="88%" height="16px" />
          <Skeleton width="64%" height="16px" />
        </div>
        <Skeleton width="180px" height="40px" />
      </div>
    </div>

    <div v-else-if="readingStore.notFound" class="read-state">
      <div class="card read-state-card">
        <div class="state-icon"><Icon name="file-text" :size="22" /></div>
        <h2 class="state-title">文章不存在或已被删除</h2>
        <p class="state-text">可能是链接里的文章编号有误，或这篇文章已被删除。</p>
        <Button variant="primary" @click="back">返回文章库</Button>
      </div>
    </div>

    <div v-else-if="readingStore.error" class="read-state">
      <div class="card read-state-card">
        <div class="state-icon"><Icon name="alert" :size="22" /></div>
        <h2 class="state-title">打开文章失败</h2>
        <p class="state-text">{{ describeError(readingStore.error) }}</p>
        <div class="state-actions">
          <Button variant="primary" @click="retry">重试</Button>
          <Button @click="back">返回文章库</Button>
        </div>
      </div>
    </div>

    <template v-else-if="article">
      <div class="banners">
        <div v-if="!aiConfigured" class="note note-warn ai-banner" role="alert">
          <Icon name="alert" :size="14" />
          <span class="banner-text">
            AI 未配置，无法批改。仍可以阅读、划词与收藏；配置完成后回来即可继续。
          </span>
          <Button size="sm" variant="primary" @click="goSettings">去设置</Button>
        </div>
        <div v-if="readingStore.serviceWarning" class="note note-error ai-banner" role="alert">
          <Icon name="alert" :size="14" />
          <span class="banner-text">
            AI 服务连续多次失败，建议检查接口地址、API Key 与网络后重试。
          </span>
          <Button size="sm" variant="secondary" @click="goSettings">检查配置</Button>
        </div>
      </div>

      <div v-if="recapError" class="note note-error ai-banner" role="alert">
        <Icon name="alert" :size="14" />
        <span class="banner-text">进入复盘失败：{{ recapError.message }}</span>
        <Button v-if="recapError.settings" size="sm" variant="primary" @click="goSettings">去设置</Button>
        <Button v-else size="sm" variant="secondary" @click="startRecapFlow">重试</Button>
      </div>

      <Workbook
        :sentences="readingStore.sentences"
        :current-idx="currentIdx"
        :article-id="readingStore.articleId"
        :adhd-mode="adhdMode"
        :favorite-set="wordsStore.favoriteLemmas"
        :editable="editable"
        :configured="aiConfigured"
        :title="article.title"
        :status="status"
        :conflict-notice="conflictNotice"
        :recap-starting="recapStarting"
        @skip-request="requestSkip"
        @go-settings="goSettings"
        @recap-start="startRecapFlow"
        @recap-cancel="cancelRecapStart"
      />
    </template>

    <WordPopup />

    <ConfirmDialog
      v-model="skipState.open"
      title="跳过这一句？"
      description="跳过后这句会记为未完成（v1 不支持补做），可以继续下一句。"
      confirm-text="跳过"
      :loading="skipState.loading"
      @confirm="confirmSkip"
    />
  </div>
</template>

<style scoped>
.reading-page {
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

.read-loading {
  padding-top: var(--space-9);
}

.read-loading-head {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding-bottom: var(--space-9);
}

.read-loading-row {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) 180px;
  gap: var(--space-8);
  align-items: start;
  padding: var(--space-6) 0;
  border-top: 1px solid var(--paper-line);
}

.read-loading-text {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
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

.banners {
  width: 1040px;
  max-width: calc(100vw - 72px);
  margin: 0 auto;
  padding-top: var(--space-6);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.ai-banner {
  align-items: center;
}

.banner-text {
  flex: 1;
  min-width: 0;
}
</style>

