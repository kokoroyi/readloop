<script setup>
/**
 * AI 配置：接口地址 / API Key / 模型 / 超时 / 重试。
 * 就地校验，非法时保存禁用；保存 PUT /api/settings（ai 分区），测试与模型列表使用已保存配置。
 */
import { computed, reactive, ref, watch } from 'vue'
import Button from '../ui/Button.vue'
import Field from '../ui/Field.vue'
import Icon from '../ui/Icon.vue'
import AiTestNote from './AiTestNote.vue'
import { describeError, get, post } from '../../lib/api.js'
import {
  aiDraftFromSettings,
  emptyAiDraft,
  isAiDraftDirty,
  toAiPayload,
  toAiTestResult,
  validateAiDraft
} from '../../lib/aiConfig.js'
import { loadHealth, saveSettings, settingsStore } from '../../stores/settings.js'
import { toast } from '../../stores/toast.js'

const saved = computed(() => settingsStore.settings.ai)

const draft = reactive(emptyAiDraft())
const touched = reactive({ baseUrl: false, apiKey: false, model: false, timeout: false, retry: false })

const attempted = ref(false)
const revealKey = ref(false)
const saving = ref(false)
const testing = ref(false)
const loadingModels = ref(false)
const models = ref([])
const testResult = ref(null)

function syncFromStore() {
  Object.assign(draft, aiDraftFromSettings(saved.value))
  for (const key of Object.keys(touched)) touched[key] = false
}

watch(saved, syncFromStore, { immediate: true, deep: true })

const errors = computed(() => validateAiDraft(draft))
const valid = computed(() => Object.keys(errors.value).length === 0)
const dirty = computed(() => isAiDraftDirty(draft, saved.value, touched.apiKey))

const apiKeyPlaceholder = computed(() =>
  saved.value.apiKeySet
    ? `已保存 ${saved.value.apiKey}（留空则保持不变）`
    : '未设置（本地模型可留空）'
)

const apiKeyHint = computed(() =>
  saved.value.apiKeySet
    ? '已保存的 Key 只显示末 4 位；输入新值才会覆盖，密码框可切换显示。'
    : '密钥只保存在本机数据库，日志与错误信息不会输出完整 Key。'
)

const actionsHint = computed(() =>
  dirty.value ? '有未保存的修改；测试与获取模型会先保存' : '测试与获取模型使用已保存的配置'
)

function showError(fieldName) {
  if (!attempted.value && !touched[fieldName]) return ''
  return errors.value[fieldName] || ''
}

function markAllTouched() {
  attempted.value = true
}

async function persist() {
  await saveSettings({ ai: toAiPayload(draft, touched.apiKey) })
  await loadHealth()
}

async function onSave() {
  if (!valid.value) {
    markAllTouched()
    toast.error('请先修正标红的字段')
    return
  }
  saving.value = true
  try {
    await persist()
    toast.success('AI 配置已保存')
  } catch (err) {
    toast.error(`保存失败：${describeError(err)}。可以检查接口地址与本地服务状态。`)
  } finally {
    saving.value = false
  }
}

async function testConnection() {
  if (!valid.value) {
    markAllTouched()
    toast.error('请先修正标红的字段')
    return
  }
  testing.value = true
  testResult.value = null
  try {
    let autoSaved = false
    if (dirty.value) {
      await persist()
      autoSaved = true
    }
    const data = await post('/api/ai/test', undefined, { timeoutMs: 45000 })
    testResult.value = toAiTestResult(data, autoSaved)
    toast.success('连接正常')
  } catch (err) {
    testResult.value = { ok: false, message: describeError(err) }
    toast.error('测试连接失败')
  } finally {
    testing.value = false
  }
}

async function fetchModels() {
  if (!valid.value) {
    markAllTouched()
    toast.error('请先修正标红的字段')
    return
  }
  loadingModels.value = true
  try {
    if (dirty.value) await persist()
    const data = await get('/api/ai/models', { timeoutMs: 30000 })
    const list = Array.isArray(data.models)
      ? data.models.filter((item) => typeof item === 'string' && item.trim())
      : []
    models.value = list
    if (!list.length) {
      toast.error('没有取到模型列表，请确认接口地址与 API Key')
      return
    }
    if (!draft.model.trim()) draft.model = list[0]
    toast.success(`已获取 ${list.length} 个模型，点下方模型名即可选用`)
  } catch (err) {
    toast.error(`获取模型失败：${describeError(err)}`)
  } finally {
    loadingModels.value = false
  }
}

/**
 * 从「可选模型」里点选一个填进输入框。
 * 原生 datalist 的下拉箭头在部分浏览器/空列表时没有反馈，所以额外提供显式列表。
 * @param {string} model
 */
function pickModel(model) {
  draft.model = model
  touched.model = true
}
</script>

<template>
  <section>
    <header class="section-head">
      <h2 class="section-title">AI 配置</h2>
      <span class="section-desc">任意 OpenAI 兼容接口，默认 DeepSeek</span>
    </header>

    <Field
      v-slot="{ id, invalid, describedby }"
      label="接口地址"
      required
      :error="showError('baseUrl')"
      hint="原样填写即可，例如 https://api.deepseek.com 或 http://127.0.0.1:5179/v1"
    >
      <input
        :id="id"
        v-model.trim="draft.baseUrl"
        class="input"
        type="url"
        spellcheck="false"
        autocomplete="off"
        placeholder="https://api.deepseek.com"
        :aria-invalid="invalid || undefined"
        :aria-describedby="describedby"
        @blur="touched.baseUrl = true"
      />
    </Field>

    <Field v-slot="{ id, describedby }" label="API Key" :hint="apiKeyHint">
      <div class="input-wrap">
        <input
          :id="id"
          v-model="draft.apiKey"
          class="input key-input"
          :type="revealKey ? 'text' : 'password'"
          spellcheck="false"
          autocomplete="off"
          :placeholder="apiKeyPlaceholder"
          :aria-describedby="describedby"
          @input="touched.apiKey = true"
        />
        <button
          class="input-action"
          type="button"
          :aria-label="revealKey ? '隐藏 API Key' : '显示 API Key'"
          @click="revealKey = !revealKey"
        >
          {{ revealKey ? '隐藏' : '显示' }}
        </button>
      </div>
    </Field>

    <Field
      v-slot="{ id, invalid, describedby }"
      label="模型"
      required
      :error="showError('model')"
    >
      <div class="inline-row">
        <input
          :id="id"
          v-model.trim="draft.model"
          class="input mono"
          list="rl-model-options"
          spellcheck="false"
          autocomplete="off"
          placeholder="deepseek-chat"
          :aria-invalid="invalid || undefined"
          :aria-describedby="describedby"
          @blur="touched.model = true"
        />
        <Button class="fetch-btn" :loading="loadingModels" @click="fetchModels">
          <Icon name="rotate-cw" :size="14" />
          获取模型
        </Button>
      </div>
      <div v-if="models.length" class="model-picks" role="group" aria-label="可用模型">
        <span class="model-picks-label">可选模型</span>
        <button
          v-for="model in models"
          :key="model"
          type="button"
          class="model-pick"
          :class="{ active: draft.model === model }"
          :aria-pressed="draft.model === model"
          @click="pickModel(model)"
        >
          {{ model }}
        </button>
      </div>
      <p v-else class="model-hint">
        点「获取模型」拉取可用列表，也可以直接输入模型名（如 deepseek-chat / deepseek-reasoner）。
      </p>
      <datalist id="rl-model-options">
        <option v-for="model in models" :key="model" :value="model" />
      </datalist>
    </Field>

    <div class="grid-2">
      <Field v-slot="{ id, invalid, describedby }" label="超时" :error="showError('timeout')">
        <div class="input-wrap">
          <input
            :id="id"
            v-model.number="draft.timeoutSeconds"
            class="input unit-input"
            type="number"
            min="1"
            max="600"
            step="1"
            :aria-invalid="invalid || undefined"
            :aria-describedby="describedby"
            @blur="touched.timeout = true"
          />
          <span class="input-suffix">秒</span>
        </div>
      </Field>

      <Field v-slot="{ id, invalid, describedby }" label="重试" :error="showError('retry')">
        <div class="input-wrap">
          <input
            :id="id"
            v-model.number="draft.retry"
            class="input unit-input"
            type="number"
            min="0"
            max="5"
            step="1"
            :aria-invalid="invalid || undefined"
            :aria-describedby="describedby"
            @blur="touched.retry = true"
          />
          <span class="input-suffix">次</span>
        </div>
      </Field>
    </div>

    <div class="actions">
      <Button :loading="testing" @click="testConnection">
        <Icon name="zap" :size="15" />
        测试连接
      </Button>
      <Button variant="primary" :loading="saving" :disabled="!valid" @click="onSave">
        保存
      </Button>
      <span class="actions-hint">{{ actionsHint }}</span>
    </div>

    <AiTestNote :result="testResult" />
  </section>
</template>


