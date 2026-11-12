<script setup>
/**
 * 句行稿纸的一行：序号 / 句子正文（衬线、可划词）/ 行内操作区 / 页边批注。
 * 状态样式：pending、submitting、corrected、skipped、error。
 */
import { computed, ref } from 'vue'
import AdhdText from './AdhdText.vue'
import AnswerLine from './AnswerLine.vue'
import MarginNote from './MarginNote.vue'
import {
  advanceToNext,
  cancelSubmit,
  draftFor,
  openWordCard,
  readingStore,
  submitTranslation
} from '../../stores/reading.js'
import { settingsStore } from '../../stores/settings.js'

const props = defineProps({
  sentence: { type: Object, required: true },
  active: { type: Boolean, default: false },
  editable: { type: Boolean, default: false },
  configured: { type: Boolean, default: true },
  articleId: { type: [Number, String], default: null },
  adhdMode: { type: String, default: 'off' },
  favoriteSet: { type: Object, default: null },
  review: { type: Boolean, default: false }
})

const emit = defineEmits(['skip-request', 'go-settings'])

const textEl = ref(null)

const adhdParams = computed(() => settingsStore.settings.appearance.adhd)
const displayIndex = computed(() => String(Number(props.sentence.idx) + 1).padStart(2, '0'))
const workStatus = computed(() => (props.sentence.work && props.sentence.work.status) || 'pending')
const submitting = computed(() => readingStore.submittingIdx === props.sentence.idx)
const submitError = computed(() => readingStore.submitError)

function onSubmit(text) {
  submitTranslation(props.sentence.idx, text)
}

function onRetry() {
  submitTranslation(props.sentence.idx, draftFor(props.sentence.idx))
}

function onCancel() {
  cancelSubmit()
}

function onNext() {
  advanceToNext(props.sentence.idx)
}

function onSkip() {
  emit('skip-request', props.sentence.idx)
}

function onGoSettings() {
  emit('go-settings')
}

/** 划词：只在选区完全落在本句正文内、且 1–4 个英文词时弹卡（AI 未配置时也可查词收藏）。 */
function onMouseUp() {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed) return
  const range = selection.getRangeAt(0)
  if (!textEl.value || !textEl.value.contains(range.commonAncestorContainer)) return
  const raw = selection.toString().trim().replace(/\s+/g, ' ')
  if (!raw) return
  const words = raw.split(' ')
  if (words.length > 4) return
  if (!words.every((word) => /^[A-Za-z][A-Za-z'’-]*[.,!?;:]?$/.test(word))) return
  const rect = range.getBoundingClientRect()
  if (!rect || (!rect.width && !rect.height)) return
  openWordCard({
    word: raw.replace(/[.,!?;:]+$/, ''),
    articleId: props.articleId,
    sentenceIdx: props.sentence.idx,
    rect: {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height
    }
  })
}
</script>

<template>
  <div class="sentence-row" :class="[`status-${workStatus}`, { current: props.active }]">
    <span class="sentence-no mono">{{ displayIndex }}</span>

    <div class="sentence-main">
      <p ref="textEl" class="sentence-text" @mouseup="onMouseUp">
        <AdhdText
          :text="props.sentence.text"
          :mode="props.adhdMode"
          :params="adhdParams"
          :favorites="props.favoriteSet"
        />
      </p>

      <AnswerLine
        v-if="props.active && props.editable && !props.review"
        :sentence="props.sentence"
        :active="props.active"
        :editable="props.editable"
        :configured="props.configured"
        :submitting="submitting"
        :submit-error="submitError"
        @submit="onSubmit"
        @retry="onRetry"
        @cancel="onCancel"
        @next="onNext"
        @skip="onSkip"
        @go-settings="onGoSettings"
      />
      <p v-else-if="props.active && !props.review" class="readonly-note">
        当前为只读状态：批改与输入将在 M3/M4 接入。
      </p>
    </div>

    <div class="sentence-margin">
      <MarginNote
        :sentence="props.sentence"
        :article-id="props.articleId"
        :configured="props.configured"
        :active="props.active"
        :readonly="props.review"
      />
    </div>
  </div>
</template>

<style scoped>
.sentence-row {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) minmax(240px, 300px);
  gap: var(--space-13);
  padding: var(--space-6) 0;
  border-bottom: 1px solid var(--paper-line);
  align-items: start;
  scroll-margin-top: calc(var(--topbar-h) + var(--space-8));
}

.sentence-row.current {
  background: var(--reading-highlight);
  margin: 0 calc(var(--space-7) * -1);
  padding: var(--space-6) var(--space-7);
  border-radius: 9px;
  border-bottom-color: transparent;
  box-shadow: 0 0 0 1px var(--paper-accent-soft);
}

.sentence-no {
  font-size: var(--text-2xs);
  color: var(--paper-ink-3);
  padding-top: var(--space-3);
}

.sentence-text {
  margin: 0;
  font-family: var(--reading-font);
  font-size: calc(var(--reading-font-size) * var(--adhd-base-scale, 1));
  line-height: var(--reading-line-height);
  letter-spacing: var(--adhd-letter-spacing, 0);
  word-spacing: var(--adhd-word-spacing, 0);
  color: var(--paper-ink);
  overflow-wrap: anywhere;
}

.sentence-row.status-corrected .sentence-text,
.sentence-row.status-submitting .sentence-text {
  color: var(--paper-ink-2);
}

.sentence-row.status-skipped .sentence-text {
  color: var(--paper-ink-3);
}

.sentence-row.status-error .sentence-text {
  color: var(--paper-ink);
}


.readonly-note {
  margin-top: var(--space-4);
  font-size: var(--text-sm);
  color: var(--paper-ink-3);
}

.sentence-margin {
  border-left: 1px solid var(--paper-line-2);
  padding-left: var(--space-7);
  min-height: 20px;
}
</style>
