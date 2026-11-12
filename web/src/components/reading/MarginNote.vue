<script setup>
/**
 * 页边批注（MarginNote）：展开态 = 我的译文（错误片段锈色下划线）+ 问题列表 +
 * 参考译文 + 降级原文 + 句内追问；折叠态 = 一行摘要（通过 / n 处问题）。
 */
import { computed } from 'vue'
import ChatThread from './ChatThread.vue'
import Icon from '../ui/Icon.vue'
import { ISSUE_TYPE_TONE, issueSummary, splitTranslationFragments } from '../../lib/work.js'
import { isNoteExpanded, readingStore, toggleNote } from '../../stores/reading.js'

const props = defineProps({
  sentence: { type: Object, required: true },
  articleId: { type: [Number, String], default: null },
  configured: { type: Boolean, default: true },
  active: { type: Boolean, default: false },
  readonly: { type: Boolean, default: false }
})

const work = computed(() => props.sentence.work || {})
const status = computed(() => work.value.status || 'pending')
const correction = computed(() => work.value.correction || null)
const summary = computed(() => issueSummary(correction.value))
const expanded = computed(() => isNoteExpanded(props.sentence.idx))
const myTranslation = computed(() => work.value.myTranslation || '')
const segments = computed(() =>
  splitTranslationFragments(
    myTranslation.value,
    ((correction.value && correction.value.issues) || []).map((issue) => issue.fragment)
  )
)
const chatCount = computed(() => {
  const list = readingStore.chats[props.sentence.idx]
  return Array.isArray(list) ? list.length : 0
})
const headLabel = computed(() => {
  if (correction.value && correction.value.degraded) return 'AI 输出格式异常'
  if (!summary.value.count) return '通过，无问题'
  return summary.value.label
})
const headSummary = computed(() => {
  if (expanded.value) return summary.value.label
  const hasReference = Boolean(correction.value && correction.value.referenceTranslation)
  return hasReference ? `${summary.value.label} · 参考译文` : summary.value.label
})

function onToggle() {
  toggleNote(props.sentence.idx)
}
</script>

<template>
  <div class="margin-note" :class="[`status-${status}`, { 'is-active': props.active }]">
    <template v-if="status === 'corrected'">
      <div
        class="margin-note-head"
        :class="{ 'is-pass': summary.count === 0 && !(correction && correction.degraded) }"
        role="button"
        tabindex="0"
        :aria-expanded="expanded"
        :aria-label="`第 ${props.sentence.idx + 1} 句批注：${headLabel}，点击${expanded ? '收起' : '展开'}`"
        @click="onToggle"
        @keydown.enter.prevent="onToggle"
        @keydown.space.prevent="onToggle"
      >
        <span v-if="correction && correction.degraded" class="tag tag-amber">格式异常</span>
        <span v-else-if="summary.count === 0" class="margin-pass">
          <Icon name="check" :size="12" />通过 · 无问题
        </span>
        <span v-else class="margin-summary">{{ headSummary }}</span>
        <span v-if="chatCount && !props.readonly" class="margin-chat-count">追问 {{ chatCount }}</span>
        <Icon class="margin-toggle" :class="{ open: expanded }" name="chevron-down" :size="13" />
      </div>

      <div class="margin-note-body" :class="{ open: expanded }">
        <div class="margin-note-inner">
          <template v-if="correction && correction.degraded">
            <div class="note note-warn degraded-note">
              <Icon name="alert" :size="13" />
              <span>AI 输出格式异常，以下是原始内容；可继续追问或跳过这句。</span>
            </div>
            <pre class="degraded-raw">{{ correction.rawText || '（无原始内容）' }}</pre>
          </template>

          <template v-else-if="correction">
            <section class="note-section">
              <h4 class="note-label">我的译文</h4>
              <p class="my-translation">
                <template v-for="(segment, index) in segments" :key="index">
                  <span v-if="segment.wrong" class="wrong-frag">{{ segment.text }}</span>
                  <template v-else>{{ segment.text }}</template>
                </template>
              </p>
            </section>

            <section v-if="summary.count" class="note-section">
              <h4 class="note-label">问题（{{ summary.count }}）</h4>
              <ul class="issue-list">
                <li
                  v-for="(issue, index) in correction.issues"
                  :key="index"
                  class="issue-item"
                >
                  <span class="tag issue-type" :class="ISSUE_TYPE_TONE[issue.type] || 'tag-amber'">
                    {{ issue.type }}
                  </span>
                  <div class="issue-main">
                    <p v-if="issue.fragment" class="issue-fragment">“{{ issue.fragment }}”</p>
                    <p class="issue-explain">{{ issue.explain }}</p>
                  </div>
                </li>
              </ul>
            </section>

            <section v-if="correction.referenceTranslation" class="note-section">
              <h4 class="note-label">参考译文</h4>
              <p class="ref-translation">{{ correction.referenceTranslation }}</p>
            </section>
          </template>

          <p v-if="work.model" class="margin-model">{{ work.model }}</p>

          <ChatThread
            v-if="expanded && !props.readonly"
            :article-id="props.articleId"
            :idx="props.sentence.idx"
            :configured="props.configured"
          />
        </div>
      </div>
    </template>

    <div v-else-if="status === 'submitting'" class="margin-state margin-submitting">
      <span class="spinner" aria-hidden="true" />
      <span>批改中…</span>
    </div>

    <div v-else-if="status === 'skipped'" class="margin-state margin-skipped">
      <span class="margin-skip-label">已跳过</span>
      <p class="margin-hint">跳过的句子不补做</p>
    </div>

    <div v-else-if="status === 'error'" class="margin-state margin-error">
      <Icon name="alert" :size="13" />
      <span>批改失败</span>
      <p v-if="!props.active" class="margin-hint">回到这句可重试或跳过</p>
    </div>

    <div v-else-if="props.active" class="margin-state margin-current">
      <span class="margin-current-label"><Icon name="chevron-right" :size="12" />当前句</span>
      <p class="margin-hint">提交后在这里出现批改</p>
    </div>
  </div>
</template>

<style scoped>
.margin-note {
  font-family: var(--font-ui);
  font-size: var(--text-sm);
  color: var(--paper-ink-2);
  min-height: 20px;
}

.margin-note-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-1) var(--space-2);
  margin-left: calc(var(--space-2) * -1);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.margin-note-head:hover {
  background: var(--paper-surface-2);
}

.margin-note-head:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

.margin-pass {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  color: var(--paper-green);
  font-size: var(--text-xs);
  font-weight: 600;
}

.margin-summary {
  color: var(--paper-rust);
  font-size: var(--text-xs);
  font-weight: 600;
}

.margin-chat-count {
  font-size: var(--text-2xs);
  color: var(--paper-ink-3);
}

.margin-toggle {
  margin-left: auto;
  flex: 0 0 auto;
  color: var(--paper-ink-3);
  transition: transform var(--dur-fast) var(--ease);
}

.margin-toggle.open {
  transform: rotate(180deg);
}

.margin-note-body {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows var(--dur-mid) var(--ease);
}

.margin-note-body.open {
  grid-template-rows: 1fr;
}

.margin-note-inner {
  overflow: hidden;
  min-height: 0;
  padding-left: var(--space-1);
}

.note-section {
  margin-top: var(--space-4);
}

.note-label {
  margin-bottom: var(--space-2);
  font-size: var(--text-2xs);
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--paper-ink-3);
}

.my-translation {
  margin: 0;
  line-height: var(--leading-relaxed);
  color: var(--paper-ink-2);
  overflow-wrap: anywhere;
}

.wrong-frag {
  text-decoration: underline;
  text-decoration-color: var(--paper-rust);
  text-decoration-thickness: 2px;
  text-underline-offset: 3px;
}

.issue-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.issue-item {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding-left: var(--space-3);
  border-left: 2px solid var(--paper-amber);
}

.issue-type {
  flex: 0 0 auto;
}

.issue-main {
  min-width: 0;
}

.issue-fragment {
  margin: 0;
  color: var(--paper-ink);
  font-weight: 600;
  overflow-wrap: anywhere;
}

.issue-explain {
  margin: var(--space-1) 0 0;
  line-height: var(--leading-relaxed);
  color: var(--paper-ink-2);
}

.ref-translation {
  margin: 0;
  color: var(--paper-green);
  font-weight: 600;
  line-height: var(--leading-relaxed);
}

.degraded-note {
  margin-top: var(--space-3);
  font-size: var(--text-sm);
}

.degraded-raw {
  margin: var(--space-3) 0 0;
  padding: var(--space-3) var(--space-4);
  max-height: 220px;
  overflow: auto;
  border: 1px solid var(--paper-line);
  border-radius: var(--radius-sm);
  background: var(--paper-surface-2);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: var(--leading-relaxed);
  color: var(--paper-ink-2);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.margin-model {
  margin-top: var(--space-4);
  font-size: var(--text-2xs);
  color: var(--paper-ink-3);
}

.margin-state {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 22px;
  font-size: var(--text-xs);
}

.margin-submitting {
  color: var(--paper-accent);
  font-weight: 600;
}

.margin-skipped {
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-1);
}

.margin-skip-label {
  color: var(--paper-ink-3);
  font-weight: 600;
}

.margin-error {
  color: var(--paper-rust);
  font-weight: 600;
}

.margin-hint {
  margin: 0;
  font-size: var(--text-2xs);
  font-weight: 400;
  color: var(--paper-ink-3);
  line-height: var(--leading-relaxed);
}

.margin-current {
  flex-wrap: wrap;
}

.margin-current-label {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--paper-accent);
}
</style>
