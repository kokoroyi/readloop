<script setup>
/**
 * 复盘底部操作行：提示 + 跳过本题 + 结束并生成小结 / 查看学习小结。
 */
import Button from '../ui/Button.vue'

const props = defineProps({
  readonly: { type: Boolean, default: false },
  canSkip: { type: Boolean, default: false },
  finishing: { type: Boolean, default: false }
})

const emit = defineEmits(['skip', 'finish', 'summary'])
</script>

<template>
  <footer class="record-foot">
    <span class="record-hint">答题顺序固定；答完可随时结束并生成学习小结</span>
    <div class="record-foot-actions">
      <Button
        v-if="!props.readonly"
        variant="primary"
        size="sm"
        :loading="props.finishing"
        aria-label="结束复盘并生成小结"
        @click="emit('finish')"
      >
        结束并生成小结
      </Button>
    </div>
  </footer>
</template>
