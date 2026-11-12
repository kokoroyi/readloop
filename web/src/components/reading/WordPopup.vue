<script setup>
/**
 * 划词小卡：绝对定位 + 视口钳制，展示音标/释义/词性/词频与收藏按钮；
 * 未收录时给 suggest 候选；词典不可用给提示；Esc / 点击外部 / 滚动关闭。
 */
import { onBeforeUnmount, reactive, ref, watch } from 'vue'
import Button from '../ui/Button.vue'
import Icon from '../ui/Icon.vue'
import { ApiError, describeError, get, post } from '../../lib/api.js'
import { closeWordCard, readingStore } from '../../stores/reading.js'
import { isFavorite, markFavorite } from '../../stores/words.js'
import { toast } from '../../stores/toast.js'

const cardEl = ref(null)
const coords = ref({ top: '0px', left: '0px' })
const word = ref('')

const state = reactive({
  loading: false,
  entry: null,
  notFound: false,
  dictUnavailable: false,
  errorMessage: '',
  suggestions: []
})
const favorite = ref(false)
const favoriting = ref(false)

function close() {
  closeWordCard()
}

function reset() {
  state.loading = false
  state.entry = null
  state.notFound = false
  state.dictUnavailable = false
  state.errorMessage = ''
  state.suggestions = []
  favorite.value = false
  favoriting.value = false
}

function position() {
  const card = cardEl.value
  const anchor = readingStore.wordCard && readingStore.wordCard.rect
  if (!card || !anchor) return
  const margin = 10
  const width = card.offsetWidth
  const height = card.offsetHeight
  const vw = window.innerWidth
  const vh = window.innerHeight
  let left = anchor.left + anchor.width / 2 - width / 2
  left = Math.max(margin, Math.min(left, vw - width - margin))
  let top = anchor.bottom + 10
  if (top + height > vh - margin) top = Math.max(margin, anchor.top - height - 10)
  coords.value = { top: `${Math.round(top)}px`, left: `${Math.round(left)}px` }
}

async function suggestFor(query) {
  try {
    const data = await get(`/api/dict/suggest?q=${encodeURIComponent(query)}`, { timeoutMs: 10000 })
    return Array.isArray(data.items) ? data.items.slice(0, 8) : []
  } catch {
    return []
  }
}

async function lookup(query) {
  word.value = query
  state.loading = true
  state.entry = null
  state.notFound = false
  state.dictUnavailable = false
  state.errorMessage = ''
  state.suggestions = []
  favorite.value = false
  await Promise.resolve()
  position()
  try {
    const data = await get(`/api/dict/lookup?word=${encodeURIComponent(query)}`, { timeoutMs: 15000 })
    if (data && data.entry) {
      state.entry = data.entry
      favorite.value = isFavorite(data.entry.lemma || data.entry.word)
    } else {
      state.notFound = true
    }
  } catch (err) {
    if (err instanceof ApiError && err.code === 'NOT_FOUND') {
      state.notFound = true
      const detail = err.detail && Array.isArray(err.detail.suggestions) ? err.detail.suggestions : null
      state.suggestions = detail ? detail.map(String).slice(0, 8) : await suggestFor(query)
    } else if (err instanceof ApiError && err.code === 'DICT_UNAVAILABLE') {
      state.dictUnavailable = true
    } else {
      state.errorMessage = describeError(err)
    }
  } finally {
    state.loading = false
    window.requestAnimationFrame(() => position())
  }
}

async function onFavorite() {
  if (!state.entry || favoriting.value || favorite.value) return
  favoriting.value = true
  try {
    const payload = { word: state.entry.lemma || state.entry.word }
    const articleId = readingStore.wordCard && readingStore.wordCard.articleId
    if (articleId) payload.articleId = articleId
    const data = await post('/api/words', payload)
    markFavorite(state.entry.lemma || state.entry.word)
    favorite.value = true
    toast.success(data && data.duplicated ? '该词已在词库' : '已收藏到词库')
  } catch (err) {
    toast.error(`收藏失败：${describeError(err)}`)
  } finally {
    favoriting.value = false
  }
}

function pickSuggestion(candidate) {
  lookup(candidate)
}

function onKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    close()
  }
}

function onWheel(event) {
  if (cardEl.value && event.target instanceof Node && cardEl.value.contains(event.target)) return
  close()
}

function teardown() {
  document.removeEventListener('keydown', onKeydown, true)
  document.removeEventListener('wheel', onWheel, true)
  window.removeEventListener('resize', close)
}

watch(
  () => readingStore.wordCard,
  async (payload) => {
    teardown()
    if (!payload) {
      reset()
      return
    }
    document.addEventListener('keydown', onKeydown, true)
    document.addEventListener('wheel', onWheel, true)
    window.addEventListener('resize', close)
    await lookup(payload.word)
  }
)

onBeforeUnmount(teardown)
</script>

<template>
  <div
    v-if="readingStore.wordCard"
    ref="cardEl"
    v-click-outside="close"
    class="word-card"
    :style="coords"
    role="dialog"
    aria-label="查词卡片"
  >
    <div class="wc-head">
      <span class="wc-word">{{ (state.entry && (state.entry.display || state.entry.word)) || word }}</span>
      <span v-if="state.entry && state.entry.lemma && state.entry.lemma.toLowerCase() !== word.toLowerCase()" class="wc-lemma">
        原型 {{ state.entry.lemma }}
      </span>
      <button type="button" class="icon-btn wc-close" aria-label="关闭查词" @click="close">
        <Icon name="close" :size="13" />
      </button>
    </div>

    <div v-if="state.loading" class="wc-skeleton">
      <span class="skeleton" style="width: 70%; height: 12px" />
      <span class="skeleton" style="width: 90%; height: 12px" />
      <span class="skeleton" style="width: 55%; height: 12px" />
    </div>

    <template v-else-if="state.entry">
      <div class="wc-line">
        <span v-if="state.entry.phonetic" class="wc-ipa mono">{{ state.entry.phonetic }}</span>
        <span class="wc-tags">
          <span v-if="state.entry.pos" class="tag">{{ state.entry.pos }}</span>
          <span v-if="state.entry.collins" class="tag">COLLINS {{ state.entry.collins }}</span>
          <span v-if="state.entry.bnc" class="tag">BNC {{ state.entry.bnc }}</span>
          <span v-if="state.entry.frq" class="tag">FRQ {{ state.entry.frq }}</span>
        </span>
      </div>
      <div class="wc-trans">
        <p v-for="(line, index) in String(state.entry.translation || '暂无释义').split('\n').slice(0, 4)" :key="index">
          {{ line }}
        </p>
      </div>
      <Button
        size="sm"
        :variant="favorite ? 'secondary' : 'primary'"
        :loading="favoriting"
        :disabled="favorite"
        @click="onFavorite"
      >
        <Icon :name="favorite ? 'check' : 'bookmarks'" :size="14" />
        {{ favorite ? '已收藏' : '收藏到词库' }}
      </Button>
    </template>

    <template v-else-if="state.dictUnavailable">
      <p class="wc-note wc-error">
        词典未加载，暂时无法查词。请确认词典文件已放到数据目录（设置页的词典路径管理在 M5 提供）。
      </p>
    </template>

    <template v-else-if="state.notFound">
      <p class="wc-note">词典未收录「{{ word }}」。</p>
      <div v-if="state.suggestions.length" class="wc-suggest">
        <span class="wc-suggest-label">是不是想找：</span>
        <button
          v-for="item in state.suggestions"
          :key="item"
          type="button"
          class="suggest-chip"
          @click="pickSuggestion(item)"
        >
          {{ item }}
        </button>
      </div>
    </template>

    <p v-else class="wc-note wc-error">查词失败：{{ state.errorMessage || '未知错误' }}</p>
  </div>
</template>

<style scoped>
.word-card {
  position: fixed;
  z-index: var(--z-float);
  width: 320px;
  padding: var(--space-5) var(--space-6) var(--space-6);
  border: 1px solid var(--paper-line);
  border-radius: var(--radius-lg);
  background: var(--paper-surface);
  box-shadow: var(--shadow-pop);
}

.wc-head {
  display: flex;
  align-items: baseline;
  gap: var(--space-4);
  min-height: 22px;
}

.wc-word {
  font-family: var(--font-serif);
  font-size: var(--text-5xl);
  font-weight: 700;
  color: var(--paper-ink);
  overflow-wrap: anywhere;
}

.wc-lemma {
  font-size: var(--text-xs);
  color: var(--paper-ink-3);
}

.wc-close {
  margin-left: auto;
  width: 24px;
  height: 24px;
  border-color: transparent;
  background: transparent;
  align-self: center;
}

.wc-skeleton {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4) 0;
}

.wc-line {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  margin-top: var(--space-1);
  flex-wrap: wrap;
}

.wc-ipa {
  font-size: var(--text-lg);
  color: var(--paper-ink-2);
}

.wc-tags {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.wc-trans {
  margin: var(--space-4) 0 var(--space-5);
  font-size: var(--text-lg);
  line-height: var(--leading-relaxed);
  color: var(--paper-ink);
  max-height: 96px;
  overflow-y: auto;
}

.wc-trans p {
  margin: 0 0 var(--space-1);
}

.wc-note {
  margin: var(--space-4) 0;
  font-size: var(--text-base);
  line-height: var(--leading-relaxed);
  color: var(--paper-ink-2);
}

.wc-error {
  color: var(--paper-rust);
}

.wc-suggest {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.wc-suggest-label {
  font-size: var(--text-sm);
  color: var(--paper-ink-3);
}

.suggest-chip {
  height: 24px;
  padding: 0 var(--space-4);
  border: 1px solid var(--paper-line);
  border-radius: var(--radius-pill);
  background: var(--paper-surface-2);
  color: var(--paper-ink-2);
  font-size: var(--text-sm);
  font-weight: 600;
}

.suggest-chip:hover {
  background: var(--paper-accent-soft);
  border-color: transparent;
  color: var(--paper-accent);
}
</style>
