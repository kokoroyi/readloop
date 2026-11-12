<script setup>
/**
 * 阅读台·继续精读卡：有进行中文章 → 进度与继续入口；无进行中但有队列 → 开始下一篇。
 */
import Button from '../ui/Button.vue'

const props = defineProps({
  article: { type: Object, default: null },
  queueFirst: { type: Object, default: null }
})

const emit = defineEmits(['continue', 'corrections', 'start-first'])

function percentOf(article) {
  if (!article) return 0
  const total = Number(article.sentenceCount) || 0
  const processed = Number(article.processedCount) || 0
  return total ? Math.min(100, Math.round((processed / total) * 100)) : 0
}

function remainingOf(article) {
  if (!article) return 0
  return Math.max(0, (Number(article.sentenceCount) || 0) - (Number(article.processedCount) || 0))
}
</script>

<template>
  <section v-if="props.article" class="card home-card home-continue" aria-label="继续精读">
    <div class="continue-main">
      <span class="chip chip-accent"><span class="chip-dot" />精读中</span>
      <h2 class="continue-title" :title="props.article.title">{{ props.article.title }}</h2>
      <p class="continue-meta">
        来源 {{ props.article.sourceName || props.article.sourceFormat || '导入' }} ·
        {{ props.article.sentenceCount }} 句 · 已处理 {{ props.article.processedCount }} 句
        <template v-if="props.article.skippedCount"> · 跳过 {{ props.article.skippedCount }} </template>
      </p>
      <div class="continue-progress">
        <div class="progress"><i :style="{ width: `${percentOf(props.article)}%` }" /></div>
        <span class="continue-count mono">
          {{ props.article.processedCount }} / {{ props.article.sentenceCount }}
        </span>
      </div>
      <div class="continue-actions">
        <Button variant="primary" aria-label="继续精读" @click="emit('continue', props.article)">
          继续精读
        </Button>
        <Button variant="ghost" aria-label="查看已批改" @click="emit('corrections', props.article)">
          查看已批改
        </Button>
      </div>
    </div>
    <div class="continue-side">
      <div class="side-stat">
        <b>{{ remainingOf(props.article) }}</b>
        <span>剩余句数</span>
      </div>
      <div class="side-stat">
        <b>{{ props.article.skippedCount || 0 }}</b>
        <span>跳过句数</span>
      </div>
    </div>
  </section>

  <section v-else-if="props.queueFirst" class="card home-card home-start-next" aria-label="开始下一篇">
    <span class="chip"><span class="chip-dot" />待读队列</span>
    <h2 class="home-start-next-title" :title="props.queueFirst.title">{{ props.queueFirst.title }}</h2>
    <p class="continue-meta">{{ props.queueFirst.sentenceCount }} 句 · 队列第一篇</p>
    <div class="continue-actions">
      <Button variant="primary" aria-label="开始精读" @click="emit('start-first', props.queueFirst)">
        开始精读
      </Button>
    </div>
  </section>
</template>
