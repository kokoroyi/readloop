<script setup>
/** 文件导入的拖放区（空闲态）：选择或拖入 .txt / .md。 */
import { ref } from 'vue'
import Icon from '../ui/Icon.vue'
import { MAX_FILE_BYTES } from '../../lib/import.js'

const props = defineProps({
  loading: { type: Boolean, default: false }
})

const emit = defineEmits(['pick', 'file'])

const dragOver = ref(false)

function onDragOver(event) {
  event.preventDefault()
  dragOver.value = true
}

function onDragLeave() {
  dragOver.value = false
}

function onDrop(event) {
  event.preventDefault()
  dragOver.value = false
  const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0]
  if (file) emit('file', file)
}
</script>

<template>
  <div
    class="drop-zone"
    :class="{ over: dragOver, loading: props.loading }"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <div class="drop-icon"><Icon :name="props.loading ? 'spinner' : 'upload'" :size="22" /></div>
    <p class="drop-title">{{ props.loading ? '正在解析大纲…' : '把 .txt / .md 文件拖到这里' }}</p>
    <p class="drop-hint">
      或
      <button type="button" class="link" @click="emit('pick')">选择文件</button>
      ；最大 {{ MAX_FILE_BYTES / 1024 / 1024 }}MB，只支持 UTF-8
    </p>
    <p class="drop-note">.txt 整篇导入 · .md 按大纲拆分多篇</p>
  </div>
</template>

<style scoped>
.drop-zone {
  flex: 1;
  min-height: 320px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-12);
  border: 1.5px dashed var(--paper-line-2);
  border-radius: var(--radius-lg);
  background: var(--paper-surface-2);
  transition:
    border-color var(--dur-fast) var(--ease),
    background var(--dur-fast) var(--ease);
}

.drop-zone.over {
  border-color: var(--paper-accent);
  background: var(--paper-accent-soft);
}

.drop-icon {
  width: 46px;
  height: 46px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-lg);
  background: var(--paper-surface);
  color: var(--paper-accent);
  box-shadow: var(--shadow-sm);
}

.drop-title {
  margin-top: var(--space-6);
  font-family: var(--font-serif);
  font-size: var(--text-5xl);
  font-weight: 700;
  color: var(--paper-ink);
}

.drop-hint {
  margin-top: var(--space-3);
  font-size: var(--text-lg);
  color: var(--paper-ink-3);
}

.drop-note {
  margin-top: var(--space-5);
  font-size: var(--text-sm);
  color: var(--paper-ink-3);
}
</style>
