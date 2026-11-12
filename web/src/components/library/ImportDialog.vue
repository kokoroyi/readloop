<script setup>
/**
 * 导入文章弹窗：粘贴文本 / 文件导入（.txt 单篇、.md 大纲拆分多篇）。
 * 文件内容只在前端读成字符串，不落临时文件。
 */
import { ref, watch } from 'vue'
import Modal from '../ui/Modal.vue'
import ImportFilePanel from './ImportFilePanel.vue'
import ImportPastePanel from './ImportPastePanel.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false }
})

const emit = defineEmits(['update:modelValue', 'imported'])

const mode = ref('paste')

watch(
  () => props.modelValue,
  (open) => {
    if (open) mode.value = 'paste'
  }
)

function close() {
  emit('update:modelValue', false)
}

function onImported(payload) {
  emit('imported', payload)
}
</script>

<template>
  <Modal
    :model-value="props.modelValue"
    title="导入文章"
    subtitle="粘贴一段英文，或导入 .txt / .md 文件；导入后进入待读队列"
    width="920px"
    height="640px"
    @update:model-value="(value) => emit('update:modelValue', value)"
  >
    <div class="import-body">
      <div class="import-tabs">
        <div class="seg" role="tablist" aria-label="导入方式">
          <button
            type="button"
            class="seg-btn"
            role="tab"
            :class="{ active: mode === 'paste' }"
            :aria-selected="mode === 'paste'"
            @click="mode = 'paste'"
          >
            粘贴文本
          </button>
          <button
            type="button"
            class="seg-btn"
            role="tab"
            :class="{ active: mode === 'file' }"
            :aria-selected="mode === 'file'"
            @click="mode = 'file'"
          >
            文件导入
          </button>
        </div>
        <span class="import-tip">
          {{
            mode === 'paste'
              ? '正文至少 20 个字符；标题可留空'
              : '支持 .txt 单篇与 .md 大纲拆分，文件最大 2MB'
          }}
        </span>
      </div>

      <ImportPastePanel v-if="mode === 'paste'" @imported="onImported" @close="close" />
      <ImportFilePanel v-else @imported="onImported" @close="close" />
    </div>
  </Modal>
</template>

<style scoped>
.import-body {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.import-tabs {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  padding-bottom: var(--space-5);
  margin-bottom: var(--space-6);
  border-bottom: 1px solid var(--paper-line);
}

.import-tip {
  margin-left: auto;
  font-size: var(--text-sm);
  color: var(--paper-ink-3);
}
</style>
