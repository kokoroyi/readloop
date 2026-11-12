<script setup>
/**
 * 学习小结页：整体评价 / 问题统计 / AI 建议 / 逐句对照 / 知识点 / 薄弱句 / 我的笔记；
 * 导出 Markdown 原生下载；重新精读危险确认后回精读。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Button from '../components/ui/Button.vue'
import ConfirmDialog from '../components/ui/ConfirmDialog.vue'
import Icon from '../components/ui/Icon.vue'
import Skeleton from '../components/ui/Skeleton.vue'
import SummaryNotes from '../components/summary/SummaryNotes.vue'
import SummarySentenceTable from '../components/summary/SummarySentenceTable.vue'
import { describeError } from '../lib/api.js'
import { formatDate } from '../lib/time.js'
import {
  exportSummary,
  issueStats,
  loadSummary,
  reRead,
  summaryStore
} from '../stores/summary.js'
import { toggleTheme } from '../stores/settings.js'
import { toast } from '../stores/toast.js'

const route = useRoute()
const router = useRouter()

const articleId = computed(() => Number(route.params.id))
const reReadOpen = ref(false)
const reReading = ref(false)

const summary = computed(() => summaryStore.data)
const article = computed(() => summaryStore.article)
const title = computed(() => (article.value && article.value.title) || '学习小结')
const metaText = computed(() => {
  const parts = ['学习小结']
  parts.push(formatDate(summaryStore.createdAt))
  const sentenceCount = article.value && article.value.sentenceCount
  if (sentenceCount) parts.push(`${sentenceCount} 句`)
  parts.push('已复盘')
  return parts.join(' · ')
})

onMounted(() => loadSummary(articleId.value))

watch(articleId, (id) => {
  if (id) loadSummary(id)
})

function back() {
  router.push(`/read/${articleId.value}`)
}

async function onExport() {
  const result = await exportSummary()
  if (result.ok) toast.success(`已导出 ${result.filename}`)
  else toast.error(`导出失败：${result.error}`)
}

function requestReRead() {
  reReadOpen.value = true
}

async function confirmReRead() {
  reReading.value = true
  const result = await reRead()
  reReading.value = false
  if (result.ok) {
    reReadOpen.value = false
    router.push(`/read/${articleId.value}`)
  } else {
    toast.error(`重新精读失败：${result.error}`)
  }
}

async function onToggleTheme() {
  try {
    await toggleTheme()
  } catch (err) {
    toast.error(`切换主题失败：${describeError(err)}`)
  }
}

function weakLabel(idx) {
  return `第 ${String(Number(idx) + 1).padStart(2, '0')} 句`
}
</script>

<template>
  <div class="summary-shell">
    <header class="read-topbar">
      <button type="button" class="icon-btn" aria-label="返回复盘记录" @click="back">
        <Icon name="chevron-left" :size="16" />
      </button>
      <span class="read-title">学习小结</span>
      <span class="chip chip-done"><span class="chip-dot" />已复盘</span>
      <div class="read-topbar-right">
        <Button
          size="sm"
          aria-label="导出 Markdown"
          :loading="summaryStore.exporting"
          @click="onExport"
        >
          <Icon name="download" :size="14" />
          导出 Markdown
        </Button>
        <Button size="sm" variant="ghost" aria-label="重新精读" @click="requestReRead">重新精读</Button>
        <button type="button" class="icon-btn" aria-label="切换主题" @click="onToggleTheme">
          <Icon name="moon" :size="15" />
        </button>
      </div>
    </header>

    <p class="sr-only" role="status" aria-live="polite">{{ summaryStore.liveMessage }}</p>

    <div v-if="summaryStore.loading" class="summary-wrap" aria-busy="true">
      <Skeleton width="42%" height="34px" />
      <Skeleton width="300px" height="12px" />
      <div class="summary-skeleton-grid">
        <div class="card summary-card">
          <Skeleton width="120px" height="16px" />
          <Skeleton width="100%" height="14px" />
          <Skeleton width="96%" height="14px" />
          <Skeleton width="88%" height="14px" />
        </div>
        <div class="card summary-card">
          <Skeleton width="90px" height="16px" />
          <Skeleton width="100%" height="14px" />
          <Skeleton width="82%" height="14px" />
        </div>
      </div>
    </div>

    <div v-else-if="summaryStore.notFound" class="read-state">
      <div class="card read-state-card">
        <div class="state-icon"><Icon name="file-text" :size="22" /></div>
        <h2 class="state-title">学习小结还没生成</h2>
        <p class="state-text">先完成复盘并结束，才会生成学习小结。</p>
        <div class="state-actions">
          <Button variant="primary" @click="back">回到复盘</Button>
          <Button @click="router.push('/library')">返回文章库</Button>
        </div>
      </div>
    </div>

    <div v-else-if="summaryStore.error" class="read-state">
      <div class="card read-state-card">
        <div class="state-icon"><Icon name="alert" :size="22" /></div>
        <h2 class="state-title">读取学习小结失败</h2>
        <p class="state-text">{{ describeError(summaryStore.error) }}</p>
        <div class="state-actions">
          <Button variant="primary" @click="loadSummary(articleId)">重试</Button>
          <Button @click="back">返回复盘记录</Button>
        </div>
      </div>
    </div>

    <div v-else-if="summary" class="summary-wrap">
      <header class="summary-head">
        <h1 class="summary-title">{{ title }}</h1>
        <p class="summary-meta">{{ metaText }}</p>
      </header>

      <div v-if="summaryStore.degraded" class="note note-warn summary-banner" role="note">
        <Icon name="alert" :size="14" />
        <span>AI 小结输出异常，已生成简版；可以重新精读后再复盘。</span>
      </div>

      <div class="summary-grid">
        <div class="summary-col">
          <section class="card summary-card">
            <h2 class="card-title">整体评价</h2>
            <p class="summary-overview">{{ summary.overview || '暂无整体评价。' }}</p>
            <div v-if="issueStats.length" class="issue-chips">
              <span v-for="stat in issueStats" :key="stat.type" class="tag" :class="stat.tone">
                {{ stat.type }} {{ stat.count }}
              </span>
            </div>
            <div v-if="summary.suggestions.length" class="summary-advice">
              <p class="advice-label">AI 建议</p>
              <ul>
                <li v-for="(tip, index) in summary.suggestions" :key="index">{{ tip }}</li>
              </ul>
            </div>
          </section>

          <SummarySentenceTable :rows="summaryStore.sentences" />
        </div>

        <div class="summary-col">
          <section class="card summary-card">
            <h2 class="card-title">知识点</h2>
            <div v-if="summary.knowledgePoints.length" class="kp-list">
              <div v-for="(point, index) in summary.knowledgePoints" :key="index" class="kp-item">
                <h3 class="kp-title">{{ point.title }}</h3>
                <p class="kp-explain">{{ point.explain }}</p>
                <p v-if="point.example" class="kp-example">{{ point.example }}</p>
              </div>
            </div>
            <p v-else class="summary-empty">这篇没有额外知识点。</p>
          </section>

          <section class="card summary-card">
            <h2 class="card-title">薄弱句</h2>
            <div v-if="summary.weakSentences.length" class="weak-list">
              <div v-for="(weak, index) in summary.weakSentences" :key="index" class="weak-row">
                <span class="weak-idx">{{ weakLabel(weak.idx) }}</span>
                <p class="weak-text">{{ weak.reason }}</p>
              </div>
            </div>
            <p v-else class="summary-empty">没有明显的薄弱句。</p>
          </section>

          <SummaryNotes />
        </div>
      </div>
    </div>

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

