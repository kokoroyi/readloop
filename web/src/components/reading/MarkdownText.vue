<script setup>
/**
 * 轻量 Markdown 渲染（结构化解析 → 模板渲染，不生成 HTML）：
 * 标题 / 段落 / 无序与有序列表 / 引用 / 分隔线 / GFM 表格 / 代码块 / 粗体 / 斜体 / 行内代码。
 * 用于 AI 追问、复盘自由提问与知识扩展，表格在窄屏可横向滚动。
 */
import { computed } from 'vue'
import MarkdownInline from './MarkdownInline.vue'
import { parseMarkdown } from '../../lib/markdown.js'

const props = defineProps({
  text: { type: String, default: '' }
})

const blocks = computed(() => parseMarkdown(props.text))

function cellStyle(align) {
  return align && align !== 'left' ? { textAlign: align } : null
}
</script>

<template>
  <div class="md-text">
    <template v-for="(block, blockIndex) in blocks" :key="blockIndex">
      <pre v-if="block.type === 'pre'" class="md-pre">{{ block.text }}</pre>

      <component
        :is="`h${block.level}`"
        v-else-if="block.type === 'heading'"
        class="md-heading"
      >
        <MarkdownInline :inlines="block.inlines" />
      </component>

      <ul v-else-if="block.type === 'ul'" class="md-list">
        <li v-for="(item, itemIndex) in block.items" :key="itemIndex">
          <MarkdownInline :inlines="item" />
        </li>
      </ul>

      <ol v-else-if="block.type === 'ol'" class="md-list md-list-ordered" :start="block.start">
        <li v-for="(item, itemIndex) in block.items" :key="itemIndex">
          <MarkdownInline :inlines="item" />
        </li>
      </ol>

      <blockquote v-else-if="block.type === 'quote'" class="md-quote">
        <p v-for="(line, lineIndex) in block.lines" :key="lineIndex" class="md-quote-line">
          <MarkdownInline :inlines="line" />
        </p>
      </blockquote>

      <hr v-else-if="block.type === 'hr'" class="md-hr" />

      <div
        v-else-if="block.type === 'table'"
        class="md-table-wrap"
        role="region"
        aria-label="Markdown 表格"
        tabindex="0"
        data-md-table-wrap
      >
        <table class="md-table" data-md-table>
          <thead>
            <tr>
              <th
                v-for="(header, headerIndex) in block.headers"
                :key="headerIndex"
                :style="cellStyle(block.aligns[headerIndex])"
              >
                <MarkdownInline :inlines="header" />
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, rowIndex) in block.rows" :key="rowIndex">
              <td
                v-for="(cell, cellIndex) in row"
                :key="cellIndex"
                :style="cellStyle(block.aligns[cellIndex])"
              >
                <MarkdownInline :inlines="cell" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p v-else class="md-p">
        <MarkdownInline :inlines="block.inlines" />
      </p>
    </template>
  </div>
</template>

<style scoped>
.md-text {
  font-size: var(--text-base);
  line-height: var(--leading-relaxed);
  overflow-wrap: anywhere;
}

.md-text > *:last-child {
  margin-bottom: 0;
}

.md-p {
  margin: 0 0 var(--space-3);
  white-space: pre-wrap;
}

.md-heading {
  margin: var(--space-4) 0 var(--space-3);
  font-family: var(--font-serif);
  font-weight: 700;
  line-height: var(--leading-tight);
  color: var(--paper-ink);
}

.md-heading:first-child {
  margin-top: 0;
}

h1.md-heading {
  font-size: var(--text-4xl);
}

h2.md-heading {
  font-size: var(--text-3xl);
}

h3.md-heading {
  font-size: var(--text-2xl);
}

h4.md-heading,
h5.md-heading,
h6.md-heading {
  font-size: var(--text-xl);
}

.md-list {
  margin: 0 0 var(--space-3);
  padding-left: var(--space-7);
  list-style: disc;
}

.md-list-ordered {
  list-style: decimal;
}

.md-list li {
  margin-bottom: var(--space-1);
}

.md-list li:last-child {
  margin-bottom: 0;
}

.md-quote {
  margin: 0 0 var(--space-3);
  padding: var(--space-3) var(--space-5);
  border-left: 3px solid var(--paper-accent-2);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  background: var(--paper-accent-soft);
  color: var(--paper-ink-2);
}

.md-quote-line {
  margin: 0;
  white-space: pre-wrap;
}

.md-quote-line + .md-quote-line {
  margin-top: var(--space-2);
}

.md-hr {
  margin: var(--space-5) 0;
  border: none;
  border-top: 1px solid var(--paper-line-2);
}

.md-table-wrap {
  max-width: 100%;
  margin: 0 0 var(--space-4);
  overflow-x: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--paper-line-2) transparent;
  border: 1px solid var(--paper-line);
  border-radius: var(--radius-sm);
  background: var(--paper-surface);
}

.md-table-wrap:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

.md-table-wrap::-webkit-scrollbar {
  height: 6px;
}

.md-table-wrap::-webkit-scrollbar-thumb {
  border-radius: var(--radius-pill);
  background: var(--paper-line-2);
}

.md-table {
  width: max-content;
  min-width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}

.md-table th,
.md-table td {
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--paper-line);
  text-align: left;
  vertical-align: top;
}

.md-table th {
  background: var(--paper-surface-2);
  font-weight: 600;
  color: var(--paper-ink);
  white-space: nowrap;
}

.md-table td {
  min-width: 96px;
  color: var(--paper-ink-2);
}

.md-table tbody tr:last-child td {
  border-bottom: none;
}

.md-pre {
  margin: 0 0 var(--space-3);
  padding: var(--space-3) var(--space-4);
  overflow-x: auto;
  border-radius: var(--radius-sm);
  background: var(--paper-line);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: var(--leading-relaxed);
  white-space: pre;
}
</style>
