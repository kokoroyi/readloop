<script setup>
/**
 * 句行稿纸容器：页头（kicker/标题/元信息/进度）、句子行列表、当前句滚动定位、
 * 全部处理完的收尾入口、aria-live 播报。
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import Button from '../ui/Button.vue'
import Icon from '../ui/Icon.vue'
import SentenceRow from './SentenceRow.vue'
import Tip from '../ui/Tip.vue'
import {
  allProcessed,
  processedCount,
  readingStore,
  skippedCount,
  totalCount
} from '../../stores/reading.js'

const props = defineProps({
  sentences: { type: Array, default: () => [] },
  currentIdx: { type: Number, default: 0 },
  articleId: { type: [Number, String], default: null },
  adhdMode: { type: String, default: 'off' },
  favoriteSet: { type: Object, default: null },
  editable: { type: Boolean, default: true },
  configured: { type: Boolean, default: true },
  recapStarting: { type: Boolean, default: false },
  title: { type: String, default: '' },
  status: { type: String, default: 'reading' },
  conflictNotice: { type: String, default: '' },
  review: { type: Boolean, default: false }
})

const emit = defineEmits(['skip-request', 'go-settings', 'recap-start', 'recap-cancel'])

const listEl = ref(null)

const progressPercent = computed(() =>
  totalCount.value ? Math.min(100, Math.round((processedCount.value / totalCount.value) * 100)) : 0
)
const kicker = computed(() => {
  if (props.review) return `回顾 · 共 ${totalCount.value} 句`
  if (!totalCount.value) return '精读'
  return `精读 · 第 ${Math.min(props.currentIdx + 1, totalCount.value)} 句 / 共 ${totalCount.value} 句`
})
const metaText = computed(
  () => `总句数 ${totalCount.value} · 已处理 ${processedCount.value} · 跳过 ${skippedCount.value}`
)

function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function scrollBehavior(behavior) {
  return prefersReducedMotion() ? 'auto' : behavior
}

async function scrollToCurrent(behavior = 'auto', { force = false } = {}) {
  await nextTick()
  if (!listEl.value) return
  const rows = listEl.value.querySelectorAll('.sentence-row')
  const target = rows[props.currentIdx]
  if (!target) return
  const rect = target.getBoundingClientRect()
  const topbar = 62
  const visible = rect.top >= topbar + 8 && rect.bottom <= window.innerHeight - 8
  if (visible && !force) return
  target.scrollIntoView({ block: 'center', behavior: scrollBehavior(behavior) })
}

/** 批改/跳过/展开批注后，确保当前行（含页边批注）仍在视口内。 */
async function ensureCurrentVisible() {
  await nextTick()
  if (!listEl.value) return
  const rows = listEl.value.querySelectorAll('.sentence-row')
  const target = rows[props.currentIdx]
  if (!target) return
  const rect = target.getBoundingClientRect()
  const topbar = 62
  const fullyVisible = rect.top >= topbar + 8 && rect.bottom <= window.innerHeight - 24
  if (!fullyVisible) target.scrollIntoView({ block: 'center', behavior: scrollBehavior('smooth') })
}

onMounted(() => scrollToCurrent('auto'))

watch(
  () => props.currentIdx,
  () => scrollToCurrent('smooth')
)

watch(
  () => readingStore.noteRevision,
  () => ensureCurrentVisible()
)

// 阅读台「查看已批改」：滚动到最近一条已批改句（不改变当前输入句）
watch(
  () => readingStore.scrollTargetIdx,
  async (idx) => {
    if (idx === null) return
    await nextTick()
    const rows = listEl.value ? listEl.value.querySelectorAll('.sentence-row') : []
    const target = rows[idx]
    if (target) {
      target.scrollIntoView({ block: 'center', behavior: scrollBehavior('smooth') })
      readingStore.scrollTargetIdx = null
    }
  }
)

watch(
  () => props.sentences.length,
  (length, previous) => {
    if (length && length !== previous) scrollToCurrent('auto')
  }
)
</script>

<template>
  <section class="workbook">
    <p class="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {{ readingStore.liveMessage }}
    </p>

    <header class="wb-head">
      <div class="wb-head-main">
        <p class="wb-kicker">{{ kicker }}</p>
        <h2 class="wb-title" :title="props.title">{{ props.title || '精读' }}</h2>
        <p class="wb-meta">{{ metaText }}</p>
      </div>
      <div class="wb-progress">
        <div class="progress"><i :style="{ width: `${progressPercent}%` }" /></div>
        <p class="wb-pct mono">{{ processedCount }} / {{ totalCount }}</p>
      </div>
    </header>

    <div v-if="props.conflictNotice" class="note note-warn wb-notice" role="note">
      <Icon name="info" :size="14" />
      <span>{{ props.conflictNotice }}</span>
    </div>

    <div v-if="props.sentences.length" ref="listEl" class="lines">
      <SentenceRow
        v-for="sentence in props.sentences"
        :key="sentence.idx"
        :sentence="sentence"
        :active="sentence.idx === props.currentIdx"
        :editable="props.editable"
        :configured="props.configured"
        :article-id="props.articleId"
        :adhd-mode="props.adhdMode"
        :favorite-set="props.favoriteSet"
        :review="props.review"
        @skip-request="(idx) => emit('skip-request', idx)"
        @go-settings="emit('go-settings')"
      />
    </div>
    <div v-else class="lines-empty">这篇文章没有可精读的句子</div>

    <p v-if="props.sentences.length && !allProcessed && !props.review" class="lines-end">
      <template v-if="props.currentIdx >= props.sentences.length - 1">已到最后一句</template>
      <template v-else>… 后面还有 {{ props.sentences.length - props.currentIdx - 1 }} 句</template>
    </p>

    <div v-if="allProcessed && !props.review" class="complete-banner" role="status">
      <div class="complete-main">
        <span class="complete-icon"><Icon name="check" :size="18" /></span>
        <div>
          <p class="complete-title">全部句子已处理完</p>
          <p class="complete-meta">共 {{ totalCount }} 句 · 跳过 {{ skippedCount }} 句</p>
        </div>
      </div>
      <div v-if="props.recapStarting" class="recap-starting" role="status">
        <span class="spinner" aria-hidden="true" />
        <span>正在出题…</span>
        <Button size="sm" variant="ghost" aria-label="取消出题" @click="emit('recap-cancel')">
          取消
        </Button>
      </div>
      <Tip v-else content="AI 会根据这篇文章与批改生成开放题，然后进入复盘">
        <span class="action-wrap">
          <Button variant="primary" aria-label="进入复盘" @click="emit('recap-start')">进入复盘</Button>
        </span>
      </Tip>
    </div>
  </section>
</template>

<style scoped>
.workbook {
  width: calc(var(--reading-width, 720px) + 320px);
  max-width: calc(100vw - 72px);
  margin: 0 auto;
  padding: var(--space-9) 0 var(--space-12);
}

.wb-head {
  display: flex;
  align-items: flex-end;
  gap: var(--space-7);
  padding-bottom: var(--space-6);
}

.wb-head-main {
  min-width: 0;
}

.wb-kicker {
  font-size: var(--text-2xs);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--paper-ink-3);
}

.wb-title {
  margin-top: var(--space-1);
  font-family: var(--font-serif);
  font-size: var(--text-6xl);
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--paper-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wb-meta {
  margin-top: var(--space-1);
  font-size: var(--text-sm);
  color: var(--paper-ink-3);
}

.wb-progress {
  margin-left: auto;
  width: 176px;
  flex: 0 0 auto;
}

.wb-progress .progress {
  height: 4px;
}

.wb-pct {
  margin-top: var(--space-1);
  text-align: right;
  font-size: var(--text-2xs);
  color: var(--paper-ink-3);
}

.wb-notice {
  margin-bottom: var(--space-6);
}

.lines {
  border-top: 1px solid var(--paper-line);
}

.lines-empty {
  padding: var(--space-12);
  text-align: center;
  font-size: var(--text-md);
  color: var(--paper-ink-3);
  border-top: 1px solid var(--paper-line);
}

.lines-end {
  padding: var(--space-5) 0 0 56px;
  font-size: var(--text-2xs);
  color: var(--paper-ink-3);
}

.complete-banner {
  display: flex;
  align-items: center;
  gap: var(--space-7);
  margin-top: var(--space-8);
  padding: var(--space-7) var(--space-8);
  border: 1px solid var(--paper-line);
  border-radius: var(--radius-lg);
  background: var(--paper-surface);
  box-shadow: var(--shadow-sm);
}

.complete-main {
  display: flex;
  align-items: center;
  gap: var(--space-5);
  min-width: 0;
}

.complete-icon {
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--paper-green-soft);
  color: var(--paper-green);
}

.complete-title {
  font-family: var(--font-serif);
  font-size: var(--text-5xl);
  font-weight: 700;
  color: var(--paper-ink);
}

.complete-meta {
  margin-top: var(--space-1);
  font-size: var(--text-sm);
  color: var(--paper-ink-3);
}

.complete-banner .action-wrap {
  margin-left: auto;
}

.recap-starting {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: var(--space-4);
  font-size: var(--text-base);
  color: var(--paper-accent);
  font-weight: 600;
}
</style>
