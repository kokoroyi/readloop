<script setup>
/**
 * 当前句行内操作区：译文输入 / 提交 / 批改中取消 / 下一句 / 失败重试与跳过。
 * Enter 提交；提交中 Esc 取消；批改成功后自动聚焦「下一句」。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import Button from '../ui/Button.vue'
import Icon from '../ui/Icon.vue'
import Tip from '../ui/Tip.vue'
import { allProcessed, draftFor, setDraft } from '../../stores/reading.js'

const props = defineProps({
  sentence: { type: Object, required: true },
  active: { type: Boolean, default: false },
  editable: { type: Boolean, default: true },
  configured: { type: Boolean, default: true },
  submitting: { type: Boolean, default: false },
  submitError: { type: Object, default: null }
})

const emit = defineEmits(['submit', 'cancel', 'skip', 'next', 'retry', 'go-settings'])

const inputEl = ref(null)
const nextBtn = ref(null)
const draft = computed(() => draftFor(props.sentence.idx))
const workStatus = computed(() => (props.sentence.work && props.sentence.work.status) || 'pending')
const errorForThis = computed(() =>
  props.submitError && props.submitError.idx === props.sentence.idx ? props.submitError : null
)
const canSubmit = computed(() => props.configured && draft.value.trim().length > 0 && !props.submitting)

function onInput(event) {
  setDraft(props.sentence.idx, event.target.value)
}

function submit() {
  if (!canSubmit.value) return
  emit('submit', draft.value.trim())
}

function onEnter() {
  if (props.submitting) return
  submit()
}

function onEscape() {
  if (props.submitting) {
    emit('cancel')
    return
  }
  if (document.activeElement === inputEl.value) inputEl.value.blur()
}

function onGlobalKey(event) {
  if (event.key !== 'Escape') return
  if (!props.active || !props.submitting) return
  event.preventDefault()
  event.stopPropagation()
  emit('cancel')
}

watch(
  () => props.submitting,
  (value) => {
    if (value) document.addEventListener('keydown', onGlobalKey, true)
    else document.removeEventListener('keydown', onGlobalKey, true)
  }
)

watch(
  () => props.active,
  async (active) => {
    if (!active) return
    await nextTick()
    if (
      props.editable &&
      !props.submitting &&
      (workStatus.value === 'pending' || workStatus.value === 'error') &&
      inputEl.value
    ) {
      inputEl.value.focus({ preventScroll: true })
    }
  },
  { immediate: true }
)

watch(workStatus, async (value) => {
  if (!props.active || value !== 'corrected') return
  await nextTick()
  if (nextBtn.value && typeof nextBtn.value.focus === 'function') {
    nextBtn.value.focus({ preventScroll: true })
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onGlobalKey, true)
})
</script>

<template>
  <div v-if="props.editable" class="answer-line">
    <template v-if="workStatus === 'submitting' || props.submitting">
      <span class="answer-loading" role="status">
        <span class="spinner" aria-hidden="true" />
        <span>批改中…</span>
      </span>
      <Button size="sm" variant="ghost" aria-label="取消批改" @click="emit('cancel')">
        取消 <span class="kbd">Esc</span>
      </Button>
      <span class="answer-hint">通常 2–5 秒；可取消</span>
    </template>

    <template v-else-if="workStatus === 'corrected'">
      <template v-if="allProcessed">
        <span class="answer-hint">全部句子已处理完，可在下方进入复盘（M4 接入）。</span>
      </template>
      <template v-else>
        <Button
          ref="nextBtn"
          variant="primary"
          size="sm"
          class="btn-next"
          aria-label="下一句"
          @click="emit('next')"
        >
          下一句 <span class="kbd">Enter</span>
        </Button>
        <span class="answer-hint">看完右侧批注再继续；Enter 进入下一句</span>
      </template>
    </template>

    <template v-else-if="workStatus === 'skipped'">
      <span class="answer-hint">这句已跳过（v1 不支持补做）。</span>
    </template>

    <template v-else>
      <input
        ref="inputEl"
        class="answer-input"
        :value="draft"
        :disabled="!props.configured"
        :placeholder="props.configured ? '写下这句的中文译文…' : 'AI 未配置，暂时无法批改'"
        aria-label="译文输入"
        autocomplete="off"
        spellcheck="false"
        @input="onInput"
        @keydown.enter.prevent="onEnter"
        @keydown.esc="onEscape"
      />
      <Tip v-if="props.configured" content="Enter 提交译文">
        <span class="action-wrap">
          <Button
            size="sm"
            variant="primary"
            :disabled="!canSubmit"
            aria-label="提交译文"
            @click="submit"
          >
            提交译文
          </Button>
        </span>
      </Tip>
      <Button v-else size="sm" variant="primary" @click="emit('go-settings')">去设置 AI</Button>
      <Tip v-if="props.configured" content="跳过后这句记为未完成，v1 不支持补做">
        <span class="action-wrap">
          <button type="button" class="skip-link" aria-label="跳过这句" @click="emit('skip')">
            跳过
          </button>
        </span>
      </Tip>
    </template>

    <div v-if="errorForThis" class="submit-error note note-error" role="alert">
      <Icon name="alert" :size="14" />
      <div class="submit-error-main">
        <span>批改失败：{{ errorForThis.message }}</span>
        <span v-if="errorForThis.kind === 'retryable'" class="submit-error-hint">
          可以重试；也可以跳过这句继续往下读。
        </span>
      </div>
      <div class="submit-error-actions">
        <Button
          v-if="errorForThis.kind === 'config'"
          size="sm"
          variant="primary"
          @click="emit('go-settings')"
        >
          去设置
        </Button>
        <template v-else-if="errorForThis.kind !== 'validation'">
          <Button
            v-if="errorForThis.retryable"
            size="sm"
            variant="primary"
            aria-label="重试批改"
            @click="emit('retry')"
          >
            重试
          </Button>
          <Button size="sm" variant="ghost" aria-label="跳过这句" @click="emit('skip')">
            跳过这句
          </Button>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.answer-line {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  margin-top: var(--space-5);
  flex-wrap: wrap;
}

.answer-input {
  flex: 1;
  min-width: 180px;
  height: 36px;
  padding: 0 var(--space-2);
  border: none;
  border-bottom: 1.5px solid var(--paper-accent-2);
  background: transparent;
  font-family: var(--font-ui);
  font-size: var(--text-3xl);
  color: var(--paper-ink);
  outline: none;
}

.answer-input::placeholder {
  color: var(--paper-ink-3);
}

.answer-input:disabled {
  border-bottom-color: var(--paper-line-2);
  color: var(--paper-ink-3);
  cursor: not-allowed;
}

.answer-input:focus-visible {
  outline: none;
  border-bottom-color: var(--paper-accent);
}

.answer-loading {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--paper-accent);
}

.answer-hint {
  font-size: var(--text-2xs);
  color: var(--paper-ink-3);
}

.skip-link {
  padding: 0 var(--space-2);
  border: none;
  background: transparent;
  color: var(--paper-ink-3);
  font-size: var(--text-sm);
}

.skip-link:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.action-wrap {
  display: inline-flex;
}

.submit-error {
  flex: 1 1 100%;
  align-items: flex-start;
}

.submit-error-main {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

.submit-error-hint {
  font-size: var(--text-2xs);
  opacity: 0.85;
}

.submit-error-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex: 0 0 auto;
}
</style>
