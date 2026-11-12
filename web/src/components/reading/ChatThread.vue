<script setup>
/**
 * 句内追问线程：用户/AI 气泡、SSE 流式增量、发送中禁用、失败保留已产出内容并手动重试、自动滚到底。
 * 中断不自动重发（避免重复计费），刷新后从 work.chats 恢复。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Button from '../ui/Button.vue'
import Icon from '../ui/Icon.vue'
import MarkdownText from './MarkdownText.vue'
import { describeError } from '../../lib/api.js'
import { streamSse } from '../../lib/sse.js'
import {
  announce,
  appendChatMessage,
  ensureChats,
  readingStore,
  updateChatMessage
} from '../../stores/reading.js'

const props = defineProps({
  articleId: { type: [Number, String], default: null },
  idx: { type: Number, required: true },
  configured: { type: Boolean, default: true }
})

const draft = ref('')
const sending = ref(false)
const sendError = ref('')
const lastFailedMessage = ref('')
const listEl = ref(null)
let abortController = null

const messages = computed(() => (Array.isArray(readingStore.chats[props.idx]) ? readingStore.chats[props.idx] : []))
const canSend = computed(() => props.configured && !sending.value && draft.value.trim().length > 0)

function scrollToBottom() {
  const el = listEl.value
  if (!el) return
  el.scrollTop = el.scrollHeight
}

function onInput(event) {
  draft.value = event.target.value
}

async function send() {
  const text = draft.value.trim()
  if (!text || sending.value || !props.configured) return
  const list = ensureChats(props.idx)
  appendChatMessage(props.idx, {
    id: null,
    role: 'user',
    content: text,
    partial: false,
    createdAt: new Date().toISOString()
  })
  const assistantIndex = appendChatMessage(props.idx, {
    id: null,
    role: 'assistant',
    content: '',
    streaming: true,
    partial: false,
    createdAt: null
  })
  sending.value = true
  sendError.value = ''
  draft.value = ''
  lastFailedMessage.value = text
  const controller = new AbortController()
  abortController = controller
  let doneReceived = false
  try {
    await streamSse(`/api/articles/${props.articleId}/sentences/${props.idx}/chat`, {
      body: { message: text },
      signal: controller.signal,
      onEvent: (event, data) => {
        const current = list[assistantIndex]
        if (!current) return
        if (event === 'delta' && data && typeof data.text === 'string') {
          updateChatMessage(props.idx, assistantIndex, {
            content: `${current.content || ''}${data.text}`
          })
          return
        }
        if (event === 'done') {
          doneReceived = true
          const content =
            data && typeof data.content === 'string' && data.content
              ? data.content
              : current.content || ''
          updateChatMessage(props.idx, assistantIndex, {
            id: data && data.messageId != null ? data.messageId : null,
            content,
            streaming: false,
            partial: false
          })
          return
        }
        if (event === 'error') {
          const failure = new Error((data && data.message) || '追问失败')
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
    announce(`第 ${props.idx + 1} 句追问回答完成`)
  } catch (err) {
    const current = list[assistantIndex]
    const isEmpty = !current || !current.content
    if (isEmpty) {
      // 没有任何产出时移除空气泡，避免残留
      list.splice(assistantIndex, 1)
    } else {
      updateChatMessage(props.idx, assistantIndex, { streaming: false, partial: true })
    }
    const aborted = err && (err.name === 'AbortError' || err.code === 'ABORTED')
    sendError.value = aborted
      ? '已中断追问，已保留已产出内容。可以手动重试。'
      : `追问失败：${describeError(err)}。已保留已产出内容，可手动重试。`
    announce(`第 ${props.idx + 1} 句追问${aborted ? '已中断' : '失败'}`)
  } finally {
    sending.value = false
    abortController = null
    scrollToBottom()
  }
}

function retry() {
  if (!lastFailedMessage.value || sending.value) return
  draft.value = lastFailedMessage.value
  send()
}

function cancel() {
  if (abortController) abortController.abort()
}

function onEnter() {
  if (sending.value) return
  send()
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

onMounted(() => {
  nextTick(scrollToBottom)
})

onBeforeUnmount(() => {
  if (abortController) abortController.abort()
})
</script>

<template>
  <section class="chat-thread" aria-label="句内追问">
    <div v-if="messages.length" ref="listEl" class="chat-list">
      <div
        v-for="(message, index) in messages"
        :key="message.id || `local-${index}`"
        class="chat-bubble"
        :class="message.role"
      >
        <div class="chat-role">{{ message.role === 'user' ? '我' : 'AI' }}</div>
        <p v-if="message.role === 'user'" class="chat-content">{{ message.content }}</p>
        <div v-else class="chat-content">
          <MarkdownText v-if="message.content" :text="message.content" />
          <span v-if="message.streaming" class="chat-caret" aria-hidden="true" />
        </div>
        <span v-if="message.partial" class="chat-partial">（已中断）</span>
      </div>
    </div>
    <p v-else class="chat-empty">有疑问就继续问这句，比如为什么这么译。</p>

    <div v-if="sendError" class="chat-error note note-error" role="alert">
      <Icon name="alert" :size="13" />
      <span>{{ sendError }}</span>
      <Button v-if="lastFailedMessage" size="sm" variant="secondary" @click="retry">重试</Button>
    </div>

    <div class="chat-input-row">
      <input
        class="chat-input"
        :value="draft"
        :disabled="!props.configured || sending"
        :placeholder="props.configured ? '继续追问这句…' : 'AI 未配置'"
        aria-label="追问这句"
        autocomplete="off"
        @input="onInput"
        @keydown.enter.prevent="onEnter"
      />
      <Button
        v-if="sending"
        size="sm"
        variant="ghost"
        aria-label="取消追问"
        @click="cancel"
      >
        取消
      </Button>
      <Button
        v-else
        size="sm"
        variant="secondary"
        :disabled="!canSend"
        aria-label="发送追问"
        @click="send"
      >
        <Icon name="send" :size="13" />
      </Button>
    </div>
  </section>
</template>

<style scoped>
.chat-thread {
  margin-top: var(--space-5);
  padding-top: var(--space-4);
  border-top: 1px dashed var(--paper-line-2);
}

.chat-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-height: 260px;
  overflow-y: auto;
  padding-right: var(--space-1);
}

.chat-bubble {
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  font-size: var(--text-base);
  line-height: var(--leading-relaxed);
}

.chat-bubble.user {
  align-self: flex-end;
  max-width: 92%;
  background: var(--paper-accent-soft);
  color: var(--paper-accent);
}

.chat-bubble.assistant {
  background: var(--paper-surface-2);
  border: 1px solid var(--paper-line);
  color: var(--paper-ink-2);
}

.chat-role {
  font-size: var(--text-2xs);
  font-weight: 700;
  letter-spacing: 0.04em;
  opacity: 0.7;
  margin-bottom: var(--space-1);
}

.chat-content {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.chat-caret {
  display: inline-block;
  width: 6px;
  height: 12px;
  margin-left: 2px;
  border-radius: 1px;
  background: var(--paper-accent);
  animation: chat-blink 1s step-end infinite;
  vertical-align: -1px;
}

@keyframes chat-blink {
  50% {
    opacity: 0;
  }
}

.chat-partial {
  font-size: var(--text-2xs);
  color: var(--paper-rust);
}

.chat-empty {
  font-size: var(--text-sm);
  color: var(--paper-ink-3);
  line-height: var(--leading-relaxed);
}

.chat-error {
  margin-top: var(--space-3);
  align-items: center;
  flex-wrap: wrap;
  font-size: var(--text-sm);
}

.chat-error span {
  flex: 1 1 140px;
  min-width: 0;
}

.chat-input-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-top: var(--space-4);
}

.chat-input {
  flex: 1;
  min-width: 0;
  height: 30px;
  padding: 0 var(--space-4);
  border: 1px solid var(--paper-line);
  border-radius: var(--radius-sm);
  background: var(--paper-surface);
  font-family: var(--font-ui);
  font-size: var(--text-base);
  color: var(--paper-ink);
}

.chat-input:focus {
  outline: none;
  border-color: var(--paper-accent-2);
  box-shadow: var(--input-focus-shadow);
}

.chat-input::placeholder {
  color: var(--paper-ink-3);
}
</style>
