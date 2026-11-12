<script setup>
/**
 * 粘贴导入：标题（可空）+ 正文，实时字数/词数/句数预估，
 * 重复内容 409 时就地二次确认（force:true = 删除旧文章并重建）。
 */
import { computed, ref } from 'vue'
import Button from '../ui/Button.vue'
import Field from '../ui/Field.vue'
import Icon from '../ui/Icon.vue'
import { ApiError, describeError, post } from '../../lib/api.js'
import {
  MAX_CONTENT_CHARS,
  MAX_TITLE_CHARS,
  MIN_CONTENT_CHARS,
  countWords,
  estimateSentences
} from '../../lib/import.js'

const emit = defineEmits(['imported', 'close'])

const title = ref('')
const content = ref('')
const submitting = ref(false)
const errorMessage = ref('')
const duplicate = ref(null)

const charCount = computed(() => content.value.trim().length)
const contentError = computed(() => {
  if (charCount.value === 0) return ''
  if (charCount.value < MIN_CONTENT_CHARS) {
    return `正文至少 ${MIN_CONTENT_CHARS} 个字符（当前 ${charCount.value}）`
  }
  if (charCount.value > MAX_CONTENT_CHARS) {
    return `正文最多 ${MAX_CONTENT_CHARS} 字符（当前 ${charCount.value}），可拆成多篇导入`
  }
  return ''
})
const titleError = computed(() =>
  title.value.length > MAX_TITLE_CHARS ? `标题最多 ${MAX_TITLE_CHARS} 字` : ''
)
const stats = computed(() => ({
  words: countWords(content.value),
  sentences: estimateSentences(content.value)
}))
const canSubmit = computed(
  () =>
    charCount.value >= MIN_CONTENT_CHARS &&
    charCount.value <= MAX_CONTENT_CHARS &&
    !titleError.value &&
    !submitting.value
)

async function submit({ force = false } = {}) {
  if (!canSubmit.value) return
  submitting.value = true
  errorMessage.value = ''
  duplicate.value = null
  try {
    const payload = { content: content.value.trim(), sourceFormat: 'paste' }
    if (title.value.trim()) payload.title = title.value.trim()
    if (force) payload.force = true
    const data = await post('/api/articles', payload, { timeoutMs: 30000 })
    if (data && data.duplicate) {
      const existingId = data.existingId || (data.article && data.article.id) || null
      emit('imported', { count: 0, duplicate: true, existingId })
      emit('close')
      return
    }
    const article = (data && data.article) || {}
    emit('imported', {
      count: 1,
      articles: [article],
      replacedExistingId: data && data.replacedExistingId ? data.replacedExistingId : null
    })
    emit('close')
  } catch (err) {
    if (err instanceof ApiError && err.code === 'DUPLICATE_ARTICLE') {
      duplicate.value = {
        existingId: (err.detail && err.detail.existingId) || null
      }
      return
    }
    errorMessage.value = describeError(err)
  } finally {
    submitting.value = false
  }
}

function confirmForce() {
  submit({ force: true })
}

function cancelDuplicate() {
  duplicate.value = null
}
</script>

<template>
  <div class="paste-panel">
    <Field
      v-slot="{ id, invalid, describedby }"
      label="标题"
      :hint="`留空时取正文首句前 40 字；最多 ${MAX_TITLE_CHARS} 字`"
      :error="titleError"
    >
      <input
        :id="id"
        v-model="title"
        class="input"
        type="text"
        placeholder="例如：The quiet library"
        :aria-invalid="invalid || undefined"
        :aria-describedby="describedby"
      />
    </Field>

    <Field label="正文" :error="contentError">
      <textarea
        v-model="content"
        class="textarea paste-textarea"
        placeholder="粘贴英文原文…"
        spellcheck="false"
      />
    </Field>

    <div class="paste-stats">
      <span>{{ charCount }} 字符</span>
      <span>{{ stats.words }} 词</span>
      <span>预估 {{ stats.sentences }} 句</span>
      <span class="paste-hint">正文 ≥ {{ MIN_CONTENT_CHARS }} 字符、≤ {{ MAX_CONTENT_CHARS }} 字符</span>
    </div>

    <div v-if="errorMessage" class="note note-error" role="alert">
      <Icon name="alert" :size="14" />
      <span>导入失败：{{ errorMessage }}</span>
    </div>

    <div v-if="duplicate" class="note note-warn" role="alert">
      <Icon name="alert" :size="14" />
      <span>
        内容与已导入的文章重复。再次导入只会识别为「已存在」并跳过新建，不会改动已有文章。
      </span>
    </div>

    <div class="paste-actions">
      <template v-if="duplicate">
        <Button variant="ghost" @click="cancelDuplicate">取消</Button>
        <Button variant="primary" :loading="submitting" @click="confirmForce">仍然导入</Button>
      </template>
      <template v-else>
        <Button variant="ghost" @click="emit('close')">取消</Button>
        <Button variant="primary" :loading="submitting" :disabled="!canSubmit" @click="submit()">
          导入文章
        </Button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.paste-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.paste-textarea {
  min-height: 240px;
  resize: vertical;
}

.paste-stats {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  margin-top: var(--space-2);
  font-size: var(--text-sm);
  color: var(--paper-ink-3);
}

.paste-hint {
  margin-left: auto;
}

.paste-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-5);
  margin-top: auto;
  padding-top: var(--space-7);
  border-top: 1px solid var(--paper-line);
}
</style>
