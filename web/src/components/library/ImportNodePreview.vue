<script setup>
/**
 * Markdown 节点预览：可编辑导入标题 + 完整正文预览（可滚动，超长截断提示）。
 * 优先使用后端清洗后的完整 content；旧接口缺失 content 时回退 preview。
 */
import { computed } from 'vue'
import { MAX_TITLE_CHARS } from '../../lib/import.js'

const props = defineProps({
  node: { type: Object, default: null },
  title: { type: String, default: '' }
})

const emit = defineEmits(['update:title'])

/** 单次最多渲染 6000 字，避免 10 万字节点卡顿；其余提示导入后查看。 */
const PREVIEW_MAX_CHARS = 6000

const titleError = computed(() =>
  props.title.length > MAX_TITLE_CHARS ? `标题最多 ${MAX_TITLE_CHARS} 字` : ''
)

const fullText = computed(() => {
  if (!props.node) return ''
  return String(props.node.content || props.node.preview || '')
})

const truncated = computed(() => fullText.value.length > PREVIEW_MAX_CHARS)

const previewText = computed(() => fullText.value.slice(0, PREVIEW_MAX_CHARS))

const previewNote = computed(() => (truncated.value ? '超长正文' : '完整正文 · 可滚动查看'))

const metaText = computed(() => {
  if (!props.node) return ''
  return `${props.node.chars} 字 · 第 ${props.node.level} 级标题`
})
</script>

<template>
  <div v-if="props.node" class="node-preview" data-import-node-preview>
    <label class="node-label" :for="`import-node-title-${props.node.id}`">导入标题</label>
    <input
      :id="`import-node-title-${props.node.id}`"
      class="input node-title"
      type="text"
      :value="props.title"
      @input="emit('update:title', $event.target.value)"
    />
    <p v-if="titleError" class="error-text" role="alert">{{ titleError }}</p>
    <p class="node-meta">{{ metaText }}</p>

    <div class="node-preview-head">
      <span>正文预览（可滚动）</span>
      <span class="node-preview-note">{{ previewNote }}</span>
    </div>
    <div
      class="node-preview-text"
      :class="{ 'is-truncated': truncated }"
      data-import-preview-scroll
      tabindex="0"
      role="region"
      aria-label="正文预览（可滚动）"
      v-text="previewText"
    ></div>
    <p v-if="truncated" class="node-preview-truncated" data-import-preview-truncated>
      预览前 {{ PREVIEW_MAX_CHARS }} 字，导入后可完整查看
    </p>
  </div>
  <div v-else class="node-preview-empty">从左侧大纲选择一个节点查看正文</div>
</template>

<style scoped>
.node-preview {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}

.node-label {
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--paper-ink-2);
  margin-bottom: var(--space-3);
}

.node-title {
  height: 40px;
  font-family: var(--font-serif);
  font-size: var(--text-4xl);
  font-weight: 600;
}

.node-meta {
  margin-top: var(--space-3);
  font-size: var(--text-sm);
  color: var(--paper-ink-3);
}

.node-preview-head {
  display: flex;
  align-items: baseline;
  gap: var(--space-4);
  margin: var(--space-6) 0 var(--space-4);
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--paper-ink-2);
}

.node-preview-note {
  margin-left: auto;
  font-size: var(--text-sm);
  font-weight: 400;
  color: var(--paper-ink-3);
}

/* 高度随内容自适应：短内容不拉伸，超长内容滚动，最高 340px */
.node-preview-text {
  flex: 0 1 auto;
  min-height: 72px;
  max-height: 340px;
  overflow: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--paper-line-2) transparent;
  padding: var(--space-5) var(--space-6);
  border: 1px solid var(--paper-line);
  border-radius: var(--radius-md);
  background: var(--paper-surface-2);
  font-family: var(--font-serif);
  font-size: var(--text-4xl);
  line-height: var(--leading-reading);
  color: var(--paper-ink-2);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.node-preview-text:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

.node-preview-text::-webkit-scrollbar {
  width: 6px;
}

.node-preview-text::-webkit-scrollbar-track {
  background: transparent;
}

.node-preview-text::-webkit-scrollbar-thumb {
  border-radius: var(--radius-pill);
  background: var(--paper-line-2);
}

.node-preview-truncated {
  margin-top: var(--space-3);
  font-size: var(--text-sm);
  color: var(--paper-ink-3);
}

.node-preview-empty {
  display: grid;
  place-items: center;
  height: 100%;
  min-height: 160px;
  font-size: var(--text-md);
  color: var(--paper-ink-3);
}
</style>
