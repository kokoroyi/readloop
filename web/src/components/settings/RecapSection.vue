<script setup>
/**
 * 复盘设置：题数（自动/3/4/5/6/8）、原文浮窗默认打开、题卡显示参考译文、重置浮窗位置。
 */
import { computed, reactive, ref, watch } from 'vue'
import Button from '../ui/Button.vue'
import { describeError } from '../../lib/api.js'
import { resetFloatWindow } from '../../lib/floatWindow.js'
import { RECAP_QUESTION_COUNTS } from '../../lib/recap.js'
import { saveSettings, settingsStore } from '../../stores/settings.js'
import { toast } from '../../stores/toast.js'

const saved = computed(() => settingsStore.settings.recap)
const saving = ref(false)

const draft = reactive({
  questions: 'auto',
  showReference: true,
  floatWindowDefaultOpen: true
})

function syncFromStore() {
  draft.questions = String(saved.value.questions ?? 'auto')
  draft.showReference = Boolean(saved.value.showReference)
  draft.floatWindowDefaultOpen = Boolean(saved.value.floatWindowDefaultOpen)
}

watch(saved, syncFromStore, { immediate: true, deep: true })

const dirty = computed(
  () =>
    draft.questions !== String(saved.value.questions ?? 'auto') ||
    draft.showReference !== Boolean(saved.value.showReference) ||
    draft.floatWindowDefaultOpen !== Boolean(saved.value.floatWindowDefaultOpen)
)

const autoRuleHint = computed(() => {
  if (draft.questions !== 'auto') return `固定 ${draft.questions} 道开放题（模型也可能少出）`
  return '自动按文章长度：少于 15 句 4 题，15–29 句 5 题，30 句及以上 6 题'
})

function onResetFloat() {
  resetFloatWindow()
  toast.info('浮窗位置与尺寸已重置，下次打开使用默认位置')
}

function onReset() {
  syncFromStore()
  toast.info('已撤销未保存的修改')
}

async function onSave() {
  saving.value = true
  try {
    await saveSettings({
      recap: {
        questions: draft.questions,
        showReference: draft.showReference,
        floatWindowDefaultOpen: draft.floatWindowDefaultOpen
      }
    })
    toast.success('复盘设置已保存')
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
      <h2 class="section-title">复盘</h2>
      <span class="section-desc">控制复盘题量、原文浮窗与题卡参考译文</span>
    </header>

    <div class="field">
      <span class="field-label">题数</span>
      <div class="field-control">
        <div class="seg" role="group" aria-label="复盘题数">
          <button
            v-for="option in RECAP_QUESTION_COUNTS"
            :key="option.value"
            type="button"
            class="seg-btn"
            :class="{ active: draft.questions === option.value }"
            :aria-pressed="draft.questions === option.value"
            @click="draft.questions = option.value"
          >
            {{ option.label }}
          </button>
        </div>
        <p class="field-hint">{{ autoRuleHint }}</p>
      </div>
    </div>

    <div class="field">
      <div class="field-main">
        <span class="field-label">原文浮窗默认打开</span>
        <p class="field-hint">打开文章复盘时在右下角显示原文浮窗；位置与尺寸会跨文章记忆。</p>
      </div>
      <button
        type="button"
        class="switch"
        :class="{ on: draft.floatWindowDefaultOpen }"
        role="switch"
        aria-label="原文浮窗默认打开"
        :aria-checked="draft.floatWindowDefaultOpen"
        @click="draft.floatWindowDefaultOpen = !draft.floatWindowDefaultOpen"
      />
    </div>

    <div class="field">
      <div class="field-main">
        <span class="field-label">题卡显示参考译文</span>
        <p class="field-hint">在复盘题目里展示相关句的参考译文，便于对照。</p>
      </div>
      <button
        type="button"
        class="switch"
        :class="{ on: draft.showReference }"
        role="switch"
        aria-label="题卡显示参考译文"
        :aria-checked="draft.showReference"
        @click="draft.showReference = !draft.showReference"
      />
    </div>

    <div class="field">
      <div class="field-main">
        <span class="field-label">原文浮窗位置</span>
        <p class="field-hint">恢复到默认的右下角位置与 424 × 348 尺寸。</p>
      </div>
      <Button size="sm" @click="onResetFloat">重置浮窗位置</Button>
    </div>

    <div class="actions">
      <Button variant="primary" :loading="saving" @click="onSave">保存复盘设置</Button>
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

.field {
  display: flex;
  align-items: flex-start;
  gap: var(--space-7);
  padding: var(--space-6) 0;
  border-bottom: 1px solid var(--paper-line);
}

.field-label {
  flex: 0 0 176px;
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--paper-ink-2);
}

.field-main {
  flex: 1;
  min-width: 0;
}

.field-main .field-label {
  display: block;
  flex: none;
}

.field-hint {
  margin-top: var(--space-2);
  font-size: var(--text-sm);
  color: var(--paper-ink-3);
  line-height: var(--leading-relaxed);
}

/* 题数行：分段控件与说明文字上下排，避免挤在一行相互覆盖 */
.field-control {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
}

.field-control .seg {
  flex: 0 0 auto;
  max-width: 100%;
  flex-wrap: wrap;
}

.field-control .field-hint {
  margin-top: 0;
}

.field > .switch {
  margin-left: auto;
  margin-top: 2px;
}

.actions {
  display: flex;
  align-items: center;
  gap: var(--space-7);
  margin-top: var(--space-8);
}

.actions-hint {
  margin-left: auto;
  font-size: var(--text-sm);
  color: var(--paper-ink-3);
}

@media (max-width: 760px) {
  .field {
    flex-wrap: wrap;
  }

  .field-label {
    flex: 1 1 100%;
  }
}
</style>
