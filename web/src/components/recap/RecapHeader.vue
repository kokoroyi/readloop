<script setup>
/**
 * 复盘页头：kicker / 文章标题 / 元信息（题数、已答、跳过、用时）/ 进度圆点。
 */
import { computed } from 'vue'

const props = defineProps({
  title: { type: String, default: '' },
  total: { type: Number, default: 0 },
  answered: { type: Number, default: 0 },
  skipped: { type: Number, default: 0 },
  durationText: { type: String, default: '—' },
  dots: { type: Array, default: () => [] }
})

const emit = defineEmits(['dot-click'])

const metaText = computed(() => {
  const parts = [`${props.total} 道开放题`, `已答 ${props.answered} 题`]
  if (props.skipped) parts.push(`跳过 ${props.skipped} 题`)
  parts.push(`用时 ${props.durationText}`)
  return parts.join(' · ')
})

function dotLabel(dot) {
  const stateLabel =
    dot.state === 'answered'
      ? '已答'
      : dot.state === 'skipped'
        ? '已跳过'
        : dot.state === 'current'
          ? '当前题'
          : '未答'
  return `第 ${dot.number} 题：${stateLabel}`
}
</script>

<template>
  <header class="record-head">
    <div class="record-head-main">
      <p class="record-kicker">复盘记录</p>
      <h1 class="record-title">{{ props.title }}</h1>
      <p class="record-meta">{{ metaText }}</p>
    </div>
    <div class="dots" role="group" aria-label="复盘进度">
      <button
        v-for="dot in props.dots"
        :key="dot.id"
        type="button"
        class="dot"
        :class="`is-${dot.state}`"
        :aria-label="dotLabel(dot)"
        :aria-current="dot.state === 'current' ? 'step' : undefined"
        :disabled="dot.state === 'todo'"
        @click="emit('dot-click', dot)"
      >
        {{ dot.number }}
      </button>
    </div>
  </header>
</template>
