<script setup>
/**
 * 加载占位骨架：仅首屏与 AI 结果块使用，避免闪烁。
 * 用法：<Skeleton width="120px" height="14px" /> 或 <Skeleton :lines="3" />
 */
import { computed } from 'vue'

const props = defineProps({
  width: { type: String, default: '100%' },
  height: { type: String, default: '14px' },
  radius: { type: String, default: 'var(--radius-sm)' },
  lines: { type: Number, default: 0 },
  gap: { type: String, default: 'var(--space-4)' }
})

const lineWidths = computed(() => {
  if (!props.lines) return []
  return Array.from({ length: props.lines }, (_, index) =>
    index === props.lines - 1 ? '62%' : '100%'
  )
})
</script>

<template>
  <div v-if="lines" class="skeleton-stack" :style="{ gap }" aria-hidden="true">
    <span
      v-for="(lineWidth, index) in lineWidths"
      :key="index"
      class="skeleton"
      :style="{ width: lineWidth, height, borderRadius: radius }"
    />
  </div>
  <span
    v-else
    class="skeleton"
    :style="{ width, height, borderRadius: radius }"
    aria-hidden="true"
  />
</template>
