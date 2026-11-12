<script setup>
/**
 * Markdown 大纲布局：左侧大纲树（全选/全不选）+ 右侧节点标题与正文预览。
 */
import ImportNodePreview from './ImportNodePreview.vue'
import ImportOutline from './ImportOutline.vue'

const props = defineProps({
  nodes: { type: Array, default: () => [] },
  selectedIds: { type: Array, default: () => [] },
  currentId: { type: String, default: '' },
  currentTitle: { type: String, default: '' },
  currentTitleError: { type: String, default: '' },
  selectedCount: { type: Number, default: 0 },
  maxChars: { type: Number, default: 100000 }
})

const emit = defineEmits(['toggle', 'select', 'select-all', 'select-none', 'update:title'])
</script>

<template>
  <div class="md-layout">
    <aside class="md-tree">
      <div class="tree-head">
        <span>大纲</span>
        <span class="tree-count">{{ props.selectedCount }} / {{ props.nodes.length }} 篇</span>
      </div>
      <div class="tree-tools">
        <button type="button" class="link" @click="emit('select-all')">全选</button>
        <span class="tree-sep">·</span>
        <button type="button" class="link" @click="emit('select-none')">全不选</button>
      </div>
      <ImportOutline
        :nodes="props.nodes"
        :selected-ids="props.selectedIds"
        :current-id="props.currentId"
        :max-chars="props.maxChars"
        @toggle="(id) => emit('toggle', id)"
        @select="(id) => emit('select', id)"
      />
    </aside>
    <section class="md-detail">
      <ImportNodePreview
        :node="props.nodes.find((node) => node.id === props.currentId) || null"
        :title="props.currentTitle"
        @update:title="(value) => emit('update:title', value)"
      />
      <p v-if="props.currentTitleError" class="error-text" role="alert">
        {{ props.currentTitleError }}
      </p>
    </section>
  </div>
</template>

<style scoped>
.md-layout {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: var(--space-8);
}

.md-tree {
  flex: 0 0 340px;
  width: 340px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: var(--space-5);
  border: 1px solid var(--paper-line);
  border-radius: var(--radius-md);
  background: var(--paper-surface-2);
}

.tree-head {
  display: flex;
  align-items: baseline;
  gap: var(--space-4);
  padding: 0 var(--space-2) var(--space-2);
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--paper-ink-3);
}

.tree-count {
  margin-left: auto;
  font-weight: 500;
  letter-spacing: 0;
  font-family: var(--font-mono);
}

.tree-tools {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--space-2) var(--space-3);
  font-size: var(--text-sm);
}

.tree-sep {
  color: var(--paper-line-2);
}

.md-detail {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
</style>
