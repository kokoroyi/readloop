<script setup>
/**
 * Markdown 大纲树：层级缩进、勾选、当前项高亮、字数；过长节点（>100k 字符）禁止选择。
 */
import Icon from '../ui/Icon.vue'

const props = defineProps({
  nodes: { type: Array, default: () => [] },
  selectedIds: { type: Array, default: () => [] },
  currentId: { type: String, default: '' },
  maxChars: { type: Number, default: 100000 }
})

const emit = defineEmits(['toggle', 'select'])

function isSelected(id) {
  return props.selectedIds.includes(id)
}

function isTooLong(node) {
  return Number(node.chars) > props.maxChars
}

function indent(level) {
  const depth = Math.max(0, Math.min(4, Number(level) - 1 || 0))
  return `${depth * 14 + 4}px`
}
</script>

<template>
  <div class="outline">
    <ul class="outline-list">
      <li
        v-for="node in props.nodes"
        :key="node.id"
        class="outline-item"
        :class="{ current: props.currentId === node.id, off: !isSelected(node.id) }"
        :style="{ paddingLeft: indent(node.level) }"
        @click="emit('select', node.id)"
      >
        <input
          class="checkbox"
          type="checkbox"
          :checked="isSelected(node.id)"
          :disabled="isTooLong(node)"
          :aria-label="`选择 ${node.title || '未命名'} `"
          @click.stop
          @change="emit('toggle', node.id)"
        />
        <div class="outline-main">
          <div class="outline-title">{{ node.title || '未命名节点' }}</div>
          <div class="outline-meta">
            {{ node.chars }} 字
            <span v-if="isTooLong(node)" class="outline-warn">· 过长，需拆分</span>
          </div>
        </div>
        <Icon v-if="props.currentId === node.id" name="chevron-right" :size="13" class="outline-caret" />
      </li>
    </ul>
    <p v-if="!props.nodes.length" class="outline-empty">没有解析到可导入的节点</p>
  </div>
</template>

<style scoped>
.outline {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding-right: var(--space-2);
}

.outline-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.outline-item {
  display: flex;
  align-items: flex-start;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-4);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  cursor: pointer;
}

.outline-item:hover {
  background: var(--paper-surface-2);
}

.outline-item.current {
  background: var(--paper-surface);
  border-color: var(--paper-line);
  box-shadow: inset 3px 0 0 var(--paper-accent), var(--shadow-sm);
}

.outline-item.off .outline-title {
  color: var(--paper-ink-2);
}

.outline-main {
  flex: 1;
  min-width: 0;
}

.outline-title {
  font-family: var(--font-serif);
  font-size: var(--text-lg);
  line-height: var(--leading-relaxed);
  color: var(--paper-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.outline-meta {
  margin-top: var(--space-1);
  font-size: var(--text-2xs);
  color: var(--paper-ink-3);
}

.outline-warn {
  color: var(--paper-rust);
}

.outline-caret {
  color: var(--paper-accent);
  margin-top: var(--space-2);
  flex: 0 0 auto;
}

.outline-empty {
  padding: var(--space-9);
  text-align: center;
  font-size: var(--text-md);
  color: var(--paper-ink-3);
}
</style>
