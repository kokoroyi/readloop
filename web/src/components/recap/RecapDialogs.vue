<script setup>
/**
 * 复盘的两个确认弹窗：跳过本题（轻确认）与结束复盘生成小结（危险确认）。
 */
import ConfirmDialog from '../ui/ConfirmDialog.vue'

const props = defineProps({
  skipOpen: { type: Boolean, default: false },
  skipLoading: { type: Boolean, default: false },
  endOpen: { type: Boolean, default: false },
  endLoading: { type: Boolean, default: false },
  endDescription: { type: String, default: '' }
})

const emit = defineEmits(['update:skipOpen', 'update:endOpen', 'confirm-skip', 'confirm-end'])
</script>

<template>
  <ConfirmDialog
    :model-value="props.skipOpen"
    title="跳过本题？"
    description="跳过后本题记为未完成（v1 不支持补做），可以继续下一题。"
    confirm-text="跳过"
    :loading="props.skipLoading"
    @update:model-value="emit('update:skipOpen', $event)"
    @confirm="emit('confirm-skip')"
  />
  <ConfirmDialog
    :model-value="props.endOpen"
    title="结束复盘并生成学习小结？"
    :description="props.endDescription"
    confirm-text="结束并生成小结"
    danger
    :loading="props.endLoading"
    @update:model-value="emit('update:endOpen', $event)"
    @confirm="emit('confirm-end')"
  />
</template>
