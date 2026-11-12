<script setup>
/**
 * Markdown 行内渲染：粗体 / 斜体 / 行内代码 / 文本。
 * 只渲染文本节点，不生成 HTML。
 */
defineProps({
  inlines: { type: Array, default: () => [] }
})
</script>

<template>
  <template v-for="(inline, index) in inlines" :key="index">
    <strong v-if="inline.type === 'bold'">{{ inline.text }}</strong>
    <em v-else-if="inline.type === 'italic'">{{ inline.text }}</em>
    <code v-else-if="inline.type === 'code'" class="md-code">{{ inline.text }}</code>
    <template v-else>{{ inline.text }}</template>
  </template>
</template>

<style scoped>
.md-code {
  padding: 0 var(--space-2);
  border-radius: 4px;
  background: var(--paper-line);
  font-family: var(--font-mono);
  font-size: 0.92em;
  color: var(--paper-ink);
}

em {
  font-style: italic;
}

strong {
  font-weight: 700;
}
</style>
