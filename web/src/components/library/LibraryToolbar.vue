<script setup>
/**
 * 文章库工具栏：状态筛选（带计数）、排序方式、队列排序开关。
 */
import Button from '../ui/Button.vue'
import Icon from '../ui/Icon.vue'
import Tip from '../ui/Tip.vue'
import { SORT_OPTIONS, STATUS_OPTIONS } from '../../stores/library.js'

const props = defineProps({
  status: { type: String, default: 'all' },
  counts: { type: Object, default: () => ({ all: 0, queued: 0, reading: 0, recap: 0, done: 0 }) },
  sort: { type: String, default: 'queue' },
  reorderMode: { type: Boolean, default: false }
})

const emit = defineEmits(['status', 'sort', 'toggle-reorder'])
</script>

<template>
  <div class="toolbar">
    <div class="seg" role="group" aria-label="按状态筛选">
      <button
        v-for="option in STATUS_OPTIONS"
        :key="option.value"
        type="button"
        class="seg-btn"
        :class="{ active: props.status === option.value }"
        :aria-pressed="props.status === option.value"
        @click="emit('status', option.value)"
      >
        {{ option.label }}<span class="seg-count">({{ props.counts[option.value] }})</span>
      </button>
    </div>
    <div class="toolbar-tail">
      <div class="seg" role="group" aria-label="排序">
        <button
          v-for="option in SORT_OPTIONS"
          :key="option.value"
          type="button"
          class="seg-btn"
          :class="{ active: props.sort === option.value }"
          :aria-pressed="props.sort === option.value"
          @click="emit('sort', option.value)"
        >
          {{ option.label }}
        </button>
      </div>
      <Tip content="用 ↑ ↓ 与置顶按钮调整待读队列顺序">
        <span class="reorder-wrap">
          <Button
            size="sm"
            :variant="props.reorderMode ? 'primary' : 'secondary'"
            @click="emit('toggle-reorder')"
          >
            <Icon name="arrow-down-up" :size="14" />
            {{ props.reorderMode ? '完成排序' : '队列排序' }}
          </Button>
        </span>
      </Tip>
    </div>
  </div>
</template>

<style scoped>
.seg-count {
  margin-left: var(--space-1);
  font-family: var(--font-mono);
  font-size: var(--text-2xs);
  color: var(--paper-ink-3);
}

.seg-btn.active .seg-count {
  color: var(--paper-accent);
}

.reorder-wrap {
  display: inline-flex;
}
</style>
