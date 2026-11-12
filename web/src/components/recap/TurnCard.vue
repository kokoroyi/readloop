<script setup>
/**
 * 复盘回合卡片：当前待答（输入/发送/跳过）、评估中、评估完成（判定/点评/知识扩展/下一题）、
 * 评估失败（重试/下一题）、已答回看（折叠/展开只读）、跳题态。
 */
import { computed, nextTick, ref, watch } from 'vue'
import Button from '../ui/Button.vue'
import Icon from '../ui/Icon.vue'
import MarkdownText from '../reading/MarkdownText.vue'
import { VERDICT_TONE, questionStemSummary, questionTypeLabel } from '../../lib/recap.js'

const props = defineProps({
  question: { type: Object, required: true },
  index: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  answer: { type: Object, default: null },
  isCurrent: { type: Boolean, default: false },
  readonly: { type: Boolean, default: false },
  expanded: { type: Boolean, default: true },
  submitting: { type: Boolean, default: false },
  showReference: { type: Boolean, default: true },
  sentenceMap: { type: Object, default: null },
  answerError: { type: Object, default: null },
  showNext: { type: Boolean, default: false },
  autoFocus: { type: Boolean, default: false }
})

const emit = defineEmits(['submit', 'next', 'toggle', 'retry'])

const draft = ref('')
const pendingText = ref('')
const inputEl = ref(null)
const nextBtn = ref(null)

const label = computed(() => questionTypeLabel(props.question))
const refs = computed(() =>
  (props.question.sentenceRefs || [])
    .map((idx) => props.sentenceMap && props.sentenceMap[idx])
    .filter(Boolean)
)
const hasAnswer = computed(() => Boolean(props.answer))
const evaluation = computed(() => (props.answer ? props.answer.evaluation : null))
const skipped = computed(() => Boolean(props.answer && props.answer.skipped))
const failedEvaluation = computed(
  () => Boolean(props.answer) && !skipped.value && !evaluation.value && props.answer.degraded
)
const verdictTone = computed(() =>
  evaluation.value ? VERDICT_TONE[evaluation.value.verdict] || 'tag' : 'tag'
)
const errorForThis = computed(() =>
  props.answerError && props.answerError.questionId === props.question.id && !hasAnswer.value
    ? props.answerError
    : null
)
const canSend = computed(() => !props.submitting && draft.value.trim().length > 0)
const showCollapsed = computed(() => hasAnswer.value && !props.expanded)
const canShowNext = computed(
  () => !props.readonly && hasAnswer.value && (props.isCurrent || props.showNext)
)

function submit() {
  if (!canSend.value) return
  pendingText.value = draft.value.trim()
  emit('submit', draft.value.trim())
}

function onKeydown(event) {
  if (event.key !== 'Enter') return
  if (event.shiftKey || event.ctrlKey || event.metaKey) {
    // Shift+Enter 换行；Ctrl/Cmd+Enter 也发送
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault()
      submit()
    }
    return
  }
  event.preventDefault()
  submit()
}

watch(
  () => props.autoFocus,
  async (focus) => {
    if (!focus || props.readonly || hasAnswer.value) return
    await nextTick()
    if (inputEl.value) inputEl.value.focus({ preventScroll: true })
  },
  { immediate: true }
)

watch(
  () => hasAnswer.value && !props.isCurrent,
  async (collapsed) => {
    if (!collapsed || props.readonly) return
    await nextTick()
    if (nextBtn.value) nextBtn.value.focus({ preventScroll: true })
  }
)

watch(
  () => evaluation.value,
  async (value) => {
    if (!value || props.readonly || (!props.isCurrent && !props.showNext)) return
    await nextTick()
    if (nextBtn.value) nextBtn.value.focus({ preventScroll: true })
  }
)


</script>

<template>
  <article
    class="recap-turn"
    :class="{
      'is-current': props.isCurrent && !hasAnswer,
      'is-answered': hasAnswer && !skipped,
      'is-skipped': skipped,
      'is-collapsed': showCollapsed
    }"
    :aria-label="`第 ${props.index + 1} 题`"
  >
    <!-- 已作答 / 已跳过：头部可折叠（当前题折叠后摘要行仍有下一题） -->
    <template v-if="hasAnswer">
      <div
        class="recap-turn-head"
        :class="{ 'is-collapsed': showCollapsed, 'is-toggleable': true }"
        @click="emit('toggle')"
      >
        <button
          type="button"
          class="turn-head-toggle"
          :aria-expanded="props.expanded"
          :aria-label="`${props.expanded ? '收起' : '展开'}第 ${props.index + 1} 题`"
          @click.stop="emit('toggle')"
        >
          <span class="turn-no">第 {{ props.index + 1 }} 题</span>
          <span class="turn-type">{{ label }}</span>
          <span v-if="skipped" class="tag tag-amber">已跳过</span>
          <span v-else-if="failedEvaluation" class="tag tag-amber">点评失败</span>
          <span v-else-if="evaluation" class="tag" :class="verdictTone">{{ evaluation.verdict }}</span>
          <span class="turn-summary">{{ questionStemSummary(props.question.stem) }}</span>
          <span v-if="!props.expanded" class="turn-expand">展开 ›</span>
        </button>
        <span class="turn-head-actions" @click.stop>
          <Button
            v-if="canShowNext && !props.expanded"
            size="sm"
            variant="primary"
            class="turn-head-next"
            aria-label="下一题"
            @click="emit('next')"
          >
            下一题
          </Button>
          <button
            v-if="props.expanded"
            type="button"
            class="turn-collapse"
            aria-label="收起本题"
            @click="emit('toggle')"
          >
            <Icon name="chevron-down" :size="14" class="open" />
          </button>
        </span>
      </div>

      <div v-if="props.expanded" class="turn-body">
        <p class="turn-stem">{{ props.question.stem }}</p>

        <div v-if="refs.length" class="turn-quote">
          <p v-for="(sentenceRef, refIndex) in refs" :key="refIndex" class="quote-line">
            <span class="quote-text">{{ sentenceRef.text }}</span>
            <span v-if="sentenceRef.myTranslation" class="quote-mine">— 你的译文：{{ sentenceRef.myTranslation }}</span>
            <span v-if="props.showReference && sentenceRef.referenceTranslation" class="quote-ref">
              参考译文：{{ sentenceRef.referenceTranslation }}
            </span>
          </p>
        </div>

        <div v-if="skipped" class="turn-skip-note">本题已跳过，不纳入点评。</div>
        <template v-else>
          <div class="turn-answer">
            <span class="who">我的回答</span>
            <p>{{ props.answer.answer }}</p>
          </div>

          <div v-if="failedEvaluation" class="note note-warn turn-eval-error" role="alert">
            <Icon name="alert" :size="14" />
            <span>点评生成失败，回答已保留。可以重试点评，或直接进入下一题。</span>
            <div class="turn-eval-actions">
              <Button
                size="sm"
                variant="secondary"
                aria-label="重试点评"
                :disabled="props.submitting"
                @click="emit('retry')"
              >
                重试点评
              </Button>
            </div>
          </div>

          <div v-else-if="evaluation" class="turn-eval">
            <div class="eval-head">
              <span class="eval-verdict" :class="VERDICT_TONE[evaluation.verdict] || 'tag'">
                {{ evaluation.verdict }}
              </span>
              <p class="eval-comment">{{ evaluation.comment }}</p>
            </div>
            <div v-if="evaluation.extension" class="eval-extension">
              <span class="ext-label">知识扩展</span>
              <MarkdownText :text="evaluation.extension" />
            </div>
          </div>
        </template>

        <div v-if="(props.isCurrent || props.showNext) && !props.readonly" class="turn-actions">
          <Button
            ref="nextBtn"
            variant="primary"
            aria-label="下一题"
            @click="emit('next')"
          >
            下一题 <span class="kbd">Enter</span>
          </Button>
          <span v-if="props.index + 1 < props.total" class="turn-hint">
            还有 {{ props.total - props.index - 1 }} 题
          </span>
          <span v-else class="turn-hint">已是最后一题，可结束并生成小结</span>
        </div>
      </div>
    </template>

    <!-- 已完成复盘中的未作答题（只读） -->
    <template v-else-if="props.readonly">
      <div class="recap-turn-head">
        <span class="turn-no">第 {{ props.index + 1 }} 题</span>
        <span class="turn-type">{{ label }}</span>
        <span class="tag">未作答</span>
      </div>
      <div class="turn-body">
        <p class="turn-stem">{{ props.question.stem }}</p>
        <div v-if="refs.length" class="turn-quote">
          <p v-for="(sentenceRef, refIndex) in refs" :key="refIndex" class="quote-line">
            <span class="quote-text">{{ sentenceRef.text }}</span>
            <span v-if="props.showReference && sentenceRef.referenceTranslation" class="quote-ref">
              参考译文：{{ sentenceRef.referenceTranslation }}
            </span>
          </p>
        </div>
        <div class="turn-skip-note">本题未作答，不纳入点评。</div>
      </div>
    </template>

    <!-- 当前待答 -->
    <template v-else>
      <div class="recap-turn-head">
        <span class="turn-no">第 {{ props.index + 1 }} 题</span>
        <span class="turn-type">{{ label }}</span>
        <span v-if="props.submitting" class="tag tag-amber">评估中…</span>
        <span v-else class="tag tag-amber">待回答</span>
      </div>

      <div class="turn-body">
        <p class="turn-stem">{{ props.question.stem }}</p>

        <div v-if="refs.length" class="turn-quote">
          <p v-for="(sentenceRef, refIndex) in refs" :key="refIndex" class="quote-line">
            <span class="quote-text">{{ sentenceRef.text }}</span>
            <span v-if="sentenceRef.myTranslation" class="quote-mine">— 你的译文：{{ sentenceRef.myTranslation }}</span>
            <span v-if="props.showReference && sentenceRef.referenceTranslation" class="quote-ref">
              参考译文：{{ sentenceRef.referenceTranslation }}
            </span>
          </p>
        </div>

        <div v-if="props.submitting" class="turn-evaluating" role="status">
          <span class="spinner" aria-hidden="true" />
          <div>
            <p class="evaluating-title">点评生成中…</p>
            <p class="evaluating-answer">{{ pendingText }}</p>
          </div>
        </div>

        <template v-else>
          <textarea
            ref="inputEl"
            class="recap-answer-input"
            :value="draft"
            rows="3"
            placeholder="写下你的回答，或直接向 AI 提问…"
            aria-label="回答输入"
            @input="draft = $event.target.value"
            @keydown="onKeydown"
          />
          <div class="turn-input-row">
            <span class="turn-input-hint">Enter 发送 · Shift+Enter 换行</span>
            <Button
              variant="primary"
              size="sm"
              :disabled="!canSend"
              aria-label="发送回答"
              @click="submit"
            >
              发送
            </Button>
          </div>
        </template>

        <div v-if="errorForThis" class="note note-error turn-submit-error" role="alert">
          <Icon name="alert" :size="14" />
          <span>提交失败：{{ errorForThis.message }}。可以重试发送。</span>
        </div>
      </div>
    </template>
  </article>
</template>


