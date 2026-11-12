<script setup>
/**
 * 复盘自由提问：消息流（复用 recap store）、Markdown 渲染、SSE 流式、发送中禁用/取消、
 * 中断保留已产出内容 + 手动重试（不自动重发）。不计入题号。
 * 消息区高度可拖拽调整并记忆；输入 textarea 1–6 行自适应。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Button from '../ui/Button.vue'
import Icon from '../ui/Icon.vue'
import MarkdownText from '../reading/MarkdownText.vue'
import { describeError } from '../../lib/api.js'
import { streamSse } from '../../lib/sse.js'
import {
  CHAT_HEIGHT_DEFAULT,
  CHAT_HEIGHT_MIN,
  clampChatHeight,
  loadChatHeight,
  maxChatHeight,
  saveChatHeight
} from '../../lib/recapChatHeight.js'
import { autoGrowTextarea } from '../../lib/textareaAutosize.js'
import {
  appendMessage,
  recapStore,
  updateMessage
} from '../../stores/recap.js'

const props = defineProps({
  articleId: { type: [Number, String], default: null },
  disabled: { type: Boolean, default: false }
})

const emit = defineEmits(['announce'])

const draft = ref('')
const sending = ref(false)
const sendError = ref('')
const lastFailedMessage = ref('')
const listEl = ref(null)
const inputEl = ref(null)
const listHeight = ref(loadChatHeight())
const resizing = ref(false)
let abortController = null
let resizeStartY = 0
let resizeStartHeight = 0
let activePointerId = null

const messages = computed(() => (Array.isArray(recapStore.messages) ? recapStore.messages : []))
const canSend = computed(() => !props.disabled && !sending.value && draft.value.trim().length > 0)
const listStyle = computed(() => (messages.value.length ? { height: `${listHeight.value}px` } : null))
const resizeMax = computed(() => maxChatHeight())

function scrollToBottom() {
  const el = listEl.value
  if (!el) return
  el.scrollTop = el.scrollHeight
}

function growInput() {
  nextTick(() => autoGrowTextarea(inputEl.value, { minRows: 1, maxRows: 6 }))
}

async function send() {
  const text = draft.value.trim()
  if (!text || sending.value || props.disabled) return
  appendMessage({ role: 'user', content: text, partial: false, createdAt: new Date().toISOString() })
  const assistantIndex = appendMessage({
    role: 'assistant',
    content: '',
    partial: false,
    createdAt: null
  })
  sending.value = true
  sendError.value = ''
  draft.value = ''
  growInput()
  lastFailedMessage.value = text
  const controller = new AbortController()
  abortController = controller
  let doneReceived = false
  try {
    await streamSse(`/api/articles/${props.articleId}/recap/chat`, {
      body: { message: text },
      signal: controller.signal,
      onEvent: (event, data) => {
        const current = messages.value[assistantIndex]
        if (!current) return
        if (event === 'delta' && data && typeof data.text === 'string') {
          updateMessage(assistantIndex, {
            content: `${current.content || ''}${data.text}`,
            streaming: true
          })
          return
        }
        if (event === 'done') {
          doneReceived = true
          updateMessage(assistantIndex, {
            id: data && data.messageId != null ? data.messageId : null,
            content:
              data && typeof data.content === 'string' && data.content
                ? data.content
                : current.content || '',
            partial: false,
            streaming: false
          })
          return
        }
        if (event === 'error') {
          const failure = new Error((data && data.message) || '提问失败')
          failure.code = data && data.code
          failure.retryable = Boolean(data && data.retryable)
          throw failure
        }
      }
    })
    if (!doneReceived) {
      throw Object.assign(new Error('连接中断，回答可能不完整'), {
        code: 'STREAM_INTERRUPTED',
        retryable: true
      })
    }
    lastFailedMessage.value = ''
    emit('announce', '自由提问回答完成')
  } catch (err) {
    const current = messages.value[assistantIndex]
    if (!current || !current.content) {
      // 没有产出时移除空气泡
      recapStore.messages.splice(assistantIndex, 1)
    } else {
      updateMessage(assistantIndex, { streaming: false, partial: true })
    }
    const aborted = err && (err.name === 'AbortError' || err.code === 'ABORTED')
    sendError.value = aborted
      ? '已中断提问，已保留已产出内容。可以手动重试。'
      : `提问失败：${describeError(err)}。已保留已产出内容，可手动重试。`
    emit('announce', aborted ? '自由提问已中断' : '自由提问失败')
  } finally {
    sending.value = false
    abortController = null
    scrollToBottom()
  }
}

function retry() {
  if (!lastFailedMessage.value || sending.value) return
  draft.value = lastFailedMessage.value
  growInput()
  send()
}

function cancel() {
  if (abortController) abortController.abort()
}

function onChatKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    if (inputEl.value) inputEl.value.blur()
    return
  }
  if (event.key !== 'Enter') return
  if (event.shiftKey) return
  event.preventDefault()
  if (!sending.value) send()
}

function onInput(event) {
  draft.value = event.target.value
  autoGrowTextarea(inputEl.value, { minRows: 1, maxRows: 6 })
}

function onResizeMove(event) {
  if (!resizing.value) return
  listHeight.value = clampChatHeight(resizeStartHeight + (resizeStartY - event.clientY))
}

function onResizeEnd() {
  if (!resizing.value) return
  resizing.value = false
  saveChatHeight(listHeight.value)
  document.removeEventListener('pointermove', onResizeMove)
  document.removeEventListener('pointerup', onResizeEnd)
  document.body.classList.remove('is-chat-resizing')
  activePointerId = null
}

function onResizeStart(event) {
  if (props.disabled) return
  if (event.button !== undefined && event.button !== 0) return
  event.preventDefault()
  resizing.value = true
  resizeStartY = event.clientY
  resizeStartHeight = listHeight.value
  activePointerId = event.pointerId
  document.addEventListener('pointermove', onResizeMove)
  document.addEventListener('pointerup', onResizeEnd)
  document.body.classList.add('is-chat-resizing')
  if (event.currentTarget && typeof event.currentTarget.setPointerCapture === 'function' && activePointerId != null) {
    try {
      event.currentTarget.setPointerCapture(activePointerId)
    } catch {
      /* 某些指针环境不支持捕获，document 监听已足够 */
    }
  }
}

function onResizeKey(event) {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
  event.preventDefault()
  const delta = event.key === 'ArrowUp' ? 12 : -12
  listHeight.value = clampChatHeight(listHeight.value + delta)
  saveChatHeight(listHeight.value)
}

function resetHeight() {
  listHeight.value = CHAT_HEIGHT_DEFAULT
  saveChatHeight(listHeight.value)
}

watch(
  () => {
    const list = messages.value
    const last = list[list.length - 1]
    if (!last) return 0
    return last.content.length + (last.streaming ? 1 : 0)
  },
  () => scrollToBottom()
)

watch(
  () => props.disabled,
  (disabled) => {
    if (disabled && abortController) abortController.abort()
  }
)

onMounted(() => {
  growInput()
  nextTick(scrollToBottom)
})

onBeforeUnmount(() => {
  if (abortController) abortController.abort()
  document.removeEventListener('pointermove', onResizeMove)
  document.removeEventListener('pointerup', onResizeEnd)
  document.body.classList.remove('is-chat-resizing')
})
</script>

<template>
  <section class="recap-chat" aria-label="自由提问">
    <header class="recap-chat-head">
      <p class="recap-chat-title">自由提问</p>
      <span class="recap-chat-tip">不计入题号；可以问词汇、语法或文章理解</span>
    </header>

    <div v-if="messages.length" ref="listEl" class="recap-chat-list" :style="listStyle">
      <div
        v-for="(message, index) in messages"
        :key="message.id || `msg-${index}`"
        class="recap-bubble"
        :class="message.role"
      >
        <div class="recap-bubble-role">{{ message.role === 'user' ? '我' : 'AI' }}</div>
        <p v-if="message.role === 'user'" class="recap-bubble-text">{{ message.content }}</p>
        <div v-else class="recap-bubble-text">
          <MarkdownText v-if="message.content" :text="message.content" />
          <span v-if="message.streaming" class="recap-caret" aria-hidden="true" />
        </div>
        <span v-if="message.partial" class="recap-partial">（已中断）</span>
      </div>
    </div>
    <p v-else class="recap-chat-empty">对这篇文章还有疑问？在下面问 AI。</p>

    <div
      v-if="!props.disabled && messages.length"
      class="recap-chat-resizer"
      data-chat-resizer
      role="separator"
      aria-orientation="horizontal"
      aria-label="调整自由提问消息区高度"
      :aria-valuenow="listHeight"
      :aria-valuemin="CHAT_HEIGHT_MIN"
      :aria-valuemax="resizeMax"
      tabindex="0"
      title="拖动调整高度，双击恢复默认"
      @pointerdown="onResizeStart"
      @dblclick="resetHeight"
      @keydown="onResizeKey"
    >
      <span class="recap-chat-resizer-grip" aria-hidden="true" />
    </div>

    <div v-if="sendError" class="note note-error recap-chat-error" role="alert">
      <Icon name="alert" :size="13" />
      <span>{{ sendError }}</span>
      <Button v-if="lastFailedMessage" size="sm" variant="secondary" @click="retry">重试</Button>
    </div>

    <div v-if="!props.disabled" class="recap-chat-input-row">
      <textarea
        ref="inputEl"
        v-model="draft"
        class="recap-chat-input"
        rows="1"
        :disabled="sending"
        placeholder="自由提问…（Enter 发送，Shift+Enter 换行）"
        aria-label="自由提问"
        @input="onInput"
        @keydown="onChatKeydown"
      />
      <Button v-if="sending" size="sm" variant="ghost" aria-label="取消提问" @click="cancel">
        取消
      </Button>
      <Button v-else size="sm" variant="primary" :disabled="!canSend" aria-label="发送提问" @click="send">
        发送
      </Button>
    </div>
    <p v-else class="recap-chat-readonly">复盘已结束，自由提问记录只读。</p>
  </section>
</template>
