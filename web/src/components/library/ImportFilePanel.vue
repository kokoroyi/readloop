<script setup>
/**
 * 文件导入：.txt 整文件一篇；.md 调 /api/articles/import/preview 展示大纲，
 * 勾选节点、改标题后按 commit 上限分批导入，并展示重复跳过原因。
 */
import { computed, reactive, ref } from 'vue'
import Button from '../ui/Button.vue'
import Icon from '../ui/Icon.vue'
import ImportFileCard from './ImportFileCard.vue'
import ImportFileDropZone from './ImportFileDropZone.vue'
import ImportMdLayout from './ImportMdLayout.vue'
import ImportResultCard from './ImportResultCard.vue'
import { describeError, post } from '../../lib/api.js'
import {
  MAX_CONTENT_CHARS,
  MAX_TITLE_CHARS,
  chunkImportItems,
  fileExtension,
  formatFileSize,
  looksLikeUtf8,
  titleFromFilename,
  validateImportFile
} from '../../lib/import.js'

const emit = defineEmits(['imported', 'close'])

const fileInput = ref(null)
const stage = ref('idle')
const loadingPreview = ref(false)
const committing = ref(false)
const errorMessage = ref('')
const warningMessage = ref('')

const fileMeta = reactive({ name: '', ext: '', size: 0 })
const txt = reactive({ content: '', title: '' })
const md = reactive({ warnings: [], nodes: [] })
const selectedIds = ref([])
const currentId = ref('')
const titleOverrides = reactive({})
const result = reactive({ articles: [], skipped: [] })

const selectedNodes = computed(() => md.nodes.filter((node) => selectedIds.value.includes(node.id)))
const selectedChars = computed(() =>
  selectedNodes.value.reduce((sum, node) => sum + String(node.content || '').length, 0)
)
const batchCount = computed(() => {
  if (!selectedNodes.value.length) return 0
  return chunkImportItems(selectedNodes.value.map((node) => ({ content: node.content }))).length
})
const currentIndex = computed(() => md.nodes.findIndex((node) => node.id === currentId.value))
const currentNode = computed(() => (currentIndex.value >= 0 ? md.nodes[currentIndex.value] : null))
const currentTitle = computed(() => {
  const node = currentNode.value
  if (!node) return ''
  return titleOverrides[node.id] !== undefined ? titleOverrides[node.id] : node.title || ''
})
const currentTitleError = computed(() =>
  currentTitle.value.length > MAX_TITLE_CHARS ? `标题最多 ${MAX_TITLE_CHARS} 字` : ''
)
const titlesValid = computed(() =>
  selectedNodes.value.every((node) => titleOf(node).trim().length <= MAX_TITLE_CHARS)
)
const canCommitMd = computed(
  () => selectedNodes.value.length > 0 && titlesValid.value && !committing.value
)
const canCommitTxt = computed(
  () => txt.content.trim().length > 0 && txt.title.length <= MAX_TITLE_CHARS && !committing.value
)

function titleOf(node) {
  const override = titleOverrides[node.id]
  return override !== undefined ? override : node.title || ''
}

function setCurrentTitle(value) {
  if (currentNode.value) titleOverrides[currentNode.value.id] = value
}

function resetState() {
  stage.value = 'idle'
  errorMessage.value = ''
  warningMessage.value = ''
  md.warnings = []
  md.nodes = []
  selectedIds.value = []
  currentId.value = ''
  result.articles = []
  result.skipped = []
  fileMeta.name = ''
  fileMeta.ext = ''
  fileMeta.size = 0
  txt.content = ''
  txt.title = ''
}

function openPicker() {
  if (fileInput.value) fileInput.value.click()
}

function onFileChange(event) {
  const file = event.target.files && event.target.files[0]
  event.target.value = ''
  if (file) handleFile(file)
}

async function handleFile(file) {
  resetState()
  const invalid = validateImportFile(file)
  if (invalid) {
    errorMessage.value = invalid
    return
  }
  let text = ''
  try {
    text = await file.text()
  } catch {
    errorMessage.value = '读取文件失败，请重新选择'
    return
  }
  fileMeta.name = file.name
  fileMeta.ext = fileExtension(file.name)
  fileMeta.size = file.size
  if (!looksLikeUtf8(text)) {
    warningMessage.value = '文件疑似不是 UTF-8 编码，可能出现乱码；请另存为 UTF-8 后重试。'
  }
  if (fileMeta.ext === 'txt') {
    if (text.trim().length > MAX_CONTENT_CHARS) {
      errorMessage.value = `正文 ${text.trim().length} 字符，超过单篇上限 ${MAX_CONTENT_CHARS}，请拆分为 .md 后导入`
      return
    }
    txt.content = text
    txt.title = titleFromFilename(file.name)
    stage.value = 'txt'
    return
  }
  await loadPreview(file.name, text)
}

async function loadPreview(filename, content) {
  loadingPreview.value = true
  errorMessage.value = ''
  try {
    const data = await post('/api/articles/import/preview', { filename, content }, { timeoutMs: 60000 })
    md.warnings = Array.isArray(data.warnings) ? data.warnings : []
    md.nodes = (Array.isArray(data.nodes) ? data.nodes : []).map((node) => ({
      id: String(node.id),
      level: Number(node.level) || 1,
      title: typeof node.title === 'string' ? node.title : '',
      chars: Number(node.chars) || String(node.content || '').length,
      preview: typeof node.preview === 'string' ? node.preview : '',
      content: typeof node.content === 'string' ? node.content : ''
    }))
    selectedIds.value = md.nodes
      .filter((node) => node.content.length <= MAX_CONTENT_CHARS)
      .map((node) => node.id)
    currentId.value = md.nodes.length ? md.nodes[0].id : ''
    stage.value = 'md'
  } catch (err) {
    errorMessage.value = describeError(err)
  } finally {
    loadingPreview.value = false
  }
}

function toggleNode(id) {
  const index = selectedIds.value.indexOf(id)
  if (index >= 0) selectedIds.value.splice(index, 1)
  else selectedIds.value.push(id)
}

function selectAllNodes() {
  selectedIds.value = md.nodes
    .filter((node) => node.content.length <= MAX_CONTENT_CHARS)
    .map((node) => node.id)
}

function selectNoNodes() {
  selectedIds.value = []
}

async function commitItems(items) {
  committing.value = true
  errorMessage.value = ''
  try {
    const batches = chunkImportItems(items)
    const articles = []
    const skipped = []
    for (const batch of batches) {
      const data = await post('/api/articles/import/commit', { items: batch }, { timeoutMs: 180000 })
      if (Array.isArray(data.articles)) articles.push(...data.articles)
      if (Array.isArray(data.skipped)) skipped.push(...data.skipped)
    }
    result.articles = articles
    result.skipped = skipped
    stage.value = 'done'
  } catch (err) {
    errorMessage.value = describeError(err)
  } finally {
    committing.value = false
  }
}

/** 完成：把导入结果交回页面（刷新列表 + toast），并关闭弹窗。 */
function finish() {
  emit('imported', {
    count: result.articles.length,
    articles: result.articles,
    skippedCount: result.skipped.length
  })
  emit('close')
}

function commitTxt() {
  const title = txt.title.trim()
  commitItems([
    { ...(title ? { title } : {}), content: txt.content, sourceFormat: 'txt' }
  ])
}

function commitMd() {
  const items = selectedNodes.value.map((node) => {
    const title = titleOf(node).trim()
    return { ...(title ? { title } : {}), content: node.content, sourceFormat: 'md' }
  })
  commitItems(items)
}
</script>

<template>
  <div class="file-panel">
    <input
      ref="fileInput"
      class="hidden-input"
      type="file"
      accept=".txt,.md,text/plain,text/markdown"
      @change="onFileChange"
    />

    <div v-if="errorMessage" class="note note-error" role="alert">
      <Icon name="alert" :size="14" />
      <span>{{ errorMessage }}</span>
    </div>
    <div v-if="warningMessage" class="note note-warn">
      <Icon name="alert" :size="14" />
      <span>{{ warningMessage }}</span>
    </div>

    <!-- 未选文件 -->
    <ImportFileDropZone
      v-if="stage === 'idle'"
      :loading="loadingPreview"
      @pick="openPicker"
      @file="handleFile"
    />

    <!-- txt -->
    <template v-else-if="stage === 'txt'">
      <ImportFileCard
        :name="fileMeta.name"
        :meta="`${formatFileSize(fileMeta.size)} · TXT · ${txt.content.trim().length} 字符`"
        @repick="openPicker"
      />

      <div class="txt-form">
        <label class="label" for="import-txt-title">导入标题</label>
        <input id="import-txt-title" v-model="txt.title" class="input" type="text" />
        <p class="txt-note">标题可改；留空则自动取正文首句前 40 字。</p>
      </div>

      <div class="panel-actions">
        <Button variant="ghost" @click="emit('close')">取消</Button>
        <Button variant="primary" :loading="committing" :disabled="!canCommitTxt" @click="commitTxt">
          导入文章
        </Button>
      </div>
    </template>

    <!-- md 大纲 -->
    <template v-else-if="stage === 'md'">
      <ImportFileCard
        :name="fileMeta.name"
        :meta="`${formatFileSize(fileMeta.size)} · Markdown · 检测到 ${md.nodes.length} 篇候选`"
        @repick="openPicker"
      />

      <div v-if="md.warnings.length" class="note note-warn warnings">
        <Icon name="alert" :size="14" />
        <span>{{ md.warnings.join('；') }}</span>
      </div>

      <ImportMdLayout
        :nodes="md.nodes"
        :selected-ids="selectedIds"
        :current-id="currentId"
        :current-title="currentTitle"
        :current-title-error="currentTitleError"
        :selected-count="selectedNodes.length"
        :max-chars="MAX_CONTENT_CHARS"
        @toggle="toggleNode"
        @select="currentId = $event"
        @select-all="selectAllNodes"
        @select-none="selectNoNodes"
        @update:title="setCurrentTitle"
      />

      <div class="panel-actions">
        <span class="panel-info">
          已选 {{ selectedNodes.length }} 篇 · {{ selectedChars }} 字符
          <template v-if="batchCount > 1">（将分 {{ batchCount }} 批导入）</template>
        </span>
        <Button variant="ghost" @click="emit('close')">取消</Button>
        <Button variant="primary" :loading="committing" :disabled="!canCommitMd" @click="commitMd">
          导入 {{ selectedNodes.length }} 篇
        </Button>
      </div>
    </template>

    <!-- 完成 -->
    <template v-else-if="stage === 'done'">
      <ImportResultCard :articles="result.articles" :skipped="result.skipped" />
      <div class="panel-actions">
        <Button variant="primary" @click="finish">完成</Button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.file-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  gap: var(--space-5);
}

.hidden-input {
  display: none;
}

.txt-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.txt-note {
  font-size: var(--text-sm);
  color: var(--paper-ink-3);
}

.warnings {
  flex: 0 0 auto;
}

.panel-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-5);
  padding-top: var(--space-6);
  border-top: 1px solid var(--paper-line);
}

.panel-info {
  margin-right: auto;
  font-size: var(--text-sm);
  color: var(--paper-ink-3);
}

</style>
