<script setup>
/** 已选文件的摘要条：文件名 / 体积 / 格式 + 重新选择。 */
import Button from '../ui/Button.vue'
import Icon from '../ui/Icon.vue'

const props = defineProps({
  name: { type: String, default: '' },
  meta: { type: String, default: '' }
})

const emit = defineEmits(['repick'])
</script>

<template>
  <div class="file-card">
    <Icon name="file-text" :size="18" />
    <div class="file-main">
      <div class="file-name">{{ props.name }}</div>
      <div class="file-meta">{{ props.meta }}</div>
    </div>
    <Button size="sm" variant="ghost" @click="emit('repick')">重新选择</Button>
  </div>
</template>

<style scoped>
.file-card {
  display: flex;
  align-items: center;
  gap: var(--space-5);
  padding: var(--space-5) var(--space-6);
  border: 1px solid var(--paper-line);
  border-radius: var(--radius-md);
  background: var(--paper-surface-2);
  color: var(--paper-ink-2);
}

.file-main {
  flex: 1;
  min-width: 0;
}

.file-name {
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--paper-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-meta {
  margin-top: var(--space-1);
  font-size: var(--text-sm);
  color: var(--paper-ink-3);
}
</style>
