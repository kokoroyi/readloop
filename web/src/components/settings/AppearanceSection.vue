<script setup>
/**
 * 阅读外观：主题（浅/深/跟随系统）、字号 16–22、行距 1.6–2.2、栏宽 640–860、
 * ADHD 增强 v3（4 模式 + 预设 + 6 参数），预览实时生效，保存完整外观对象。
 */
import { computed, reactive, ref, watch } from 'vue'
import Button from '../ui/Button.vue'
import AdhdSettings from './AdhdSettings.vue'
import AppearancePreview from './AppearancePreview.vue'
import RangeRow from './RangeRow.vue'
import { describeError } from '../../lib/api.js'
import { ADHD_DEFAULT_PARAMS, normalizeAdhdParams } from '../../lib/adhd.js'
import {
  THEME_OPTIONS,
  applyAppearance,
  previewTheme,
  saveSettings,
  settingsStore
} from '../../stores/settings.js'
import { toast } from '../../stores/toast.js'

const saved = computed(() => settingsStore.settings.appearance)

const draft = reactive({
  theme: 'light',
  fontSize: 19,
  lineHeight: 1.9,
  maxWidth: 720,
  adhd: { ...ADHD_DEFAULT_PARAMS, mode: 'off' }
})

const saving = ref(false)

function syncFromStore() {
  const appearance = saved.value
  draft.theme = appearance.theme
  draft.fontSize = appearance.fontSize
  draft.lineHeight = appearance.lineHeight
  draft.maxWidth = appearance.maxWidth
  draft.adhd = normalizeAdhdParams(appearance.adhd)
}

watch(saved, syncFromStore, { immediate: true, deep: true })

const dirty = computed(() => {
  const appearance = saved.value
  return (
    draft.theme !== appearance.theme ||
    draft.fontSize !== appearance.fontSize ||
    draft.lineHeight !== appearance.lineHeight ||
    draft.maxWidth !== appearance.maxWidth ||
    JSON.stringify(normalizeAdhdParams(draft.adhd)) !==
      JSON.stringify(normalizeAdhdParams(appearance.adhd))
  )
})

const lineHeightText = computed(() => draft.lineHeight.toFixed(2).replace(/0$/, ''))

const themeTail = computed(() => {
  const option = THEME_OPTIONS.find((item) => item.value === draft.theme)
  return `当前使用${option ? option.label : '纸感浅色'}`
})

function onThemeChange(mode) {
  draft.theme = mode
  previewTheme(mode)
}

function onAdhdUpdate(value) {
  draft.adhd = normalizeAdhdParams(value)
}

function onReset() {
  syncFromStore()
  applyAppearance()
  toast.info('已撤销未保存的修改')
}

async function onSave() {
  saving.value = true
  try {
    await saveSettings({
      appearance: {
        theme: draft.theme,
        fontSize: draft.fontSize,
        lineHeight: draft.lineHeight,
        maxWidth: draft.maxWidth,
        adhd: normalizeAdhdParams(draft.adhd)
      }
    })
    applyAppearance()
    toast.success('阅读外观已保存')
  } catch (err) {
    toast.error(`保存失败：${describeError(err)}`)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section>
    <header class="section-head">
      <h2 class="section-title">阅读外观</h2>
      <span class="section-desc">影响阅读台、精读视图与回顾正文的排版密度</span>
    </header>

    <div class="line">
      <span class="line-label">主题</span>
      <div class="seg" role="group" aria-label="主题">
        <button
          v-for="option in THEME_OPTIONS"
          :key="option.value"
          type="button"
          class="seg-btn"
          :class="{ active: draft.theme === option.value }"
          :aria-pressed="draft.theme === option.value"
          @click="onThemeChange(option.value)"
        >
          {{ option.label }}
        </button>
      </div>
      <span class="line-tail">{{ themeTail }}</span>
    </div>

    <div class="line">
      <span class="line-label">字体</span>
      <span class="tag">固定衬线</span>
      <span class="line-tail">v1 固定使用衬线字体（Georgia 系），后续版本再提供无衬线选项</span>
    </div>

    <div class="sliders">
      <RangeRow
        label="字号"
        :min="16"
        :max="22"
        :step="1"
        :model-value="draft.fontSize"
        :display="`${draft.fontSize}px`"
        @update:model-value="draft.fontSize = $event"
      />
      <RangeRow
        label="行距"
        :min="1.6"
        :max="2.2"
        :step="0.05"
        :model-value="draft.lineHeight"
        :display="lineHeightText"
        @update:model-value="draft.lineHeight = $event"
      />
      <RangeRow
        label="栏宽"
        :min="640"
        :max="860"
        :step="20"
        :model-value="draft.maxWidth"
        :display="`${draft.maxWidth}px`"
        @update:model-value="draft.maxWidth = $event"
      />
    </div>

    <div class="adhd-block">
      <div class="adhd-block-head">
        <span class="line-label">ADHD 阅读增强</span>
        <span class="line-tail">只作用于句子正文与回顾正文，可实时预览</span>
      </div>
      <AdhdSettings :adhd="draft.adhd" @update="onAdhdUpdate" />
    </div>

    <AppearancePreview
      class="preview"
      :font-size="draft.fontSize"
      :line-height="draft.lineHeight"
      :max-width="draft.maxWidth"
      :adhd="draft.adhd"
    />

    <div class="actions">
      <Button variant="primary" :loading="saving" @click="onSave">保存外观</Button>
      <Button v-if="dirty" variant="ghost" @click="onReset">撤销修改</Button>
      <span class="actions-hint">{{ dirty ? '有未保存的修改' : '已与保存值一致' }}</span>
    </div>
  </section>
</template>

<style scoped>
.section-head {
  display: flex;
  align-items: baseline;
  gap: var(--space-5);
  flex-wrap: wrap;
  margin-bottom: var(--space-7);
}

.section-title {
  font-family: var(--font-serif);
  font-size: var(--text-4xl);
  font-weight: 700;
  color: var(--paper-ink);
}

.section-desc {
  font-size: var(--text-sm);
  color: var(--paper-ink-3);
}

.line {
  display: flex;
  align-items: center;
  gap: var(--space-7);
  margin-bottom: var(--space-6);
}

.line-label {
  flex: 0 0 96px;
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--paper-ink-2);
}

.line-tail {
  font-size: var(--text-sm);
  color: var(--paper-ink-3);
  min-width: 0;
}

.sliders {
  margin: var(--space-7) 0 var(--space-8);
}

.adhd-block {
  margin-top: var(--space-8);
}

.adhd-block-head {
  display: flex;
  align-items: baseline;
  gap: var(--space-5);
  flex-wrap: wrap;
}

.preview {
  margin-top: var(--space-8);
}

.actions {
  display: flex;
  align-items: center;
  gap: var(--space-7);
  margin-top: var(--space-8);
  padding-top: var(--space-7);
  border-top: 1px solid var(--paper-line);
}

.actions-hint {
  margin-left: auto;
  font-size: var(--text-sm);
  color: var(--paper-ink-3);
}
</style>
