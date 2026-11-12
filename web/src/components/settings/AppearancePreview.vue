<script setup>
/**
 * 阅读外观实时预览：字号/行距/栏宽 + ADHD v3（Bionic/语义加粗/语义高亮）效果。
 * 使用阅读视图同一个 AdhdText，保证预览与正文一致。
 */
import { computed } from 'vue'
import AdhdText from '../reading/AdhdText.vue'
import { normalizeAdhdParams } from '../../lib/adhd.js'

const props = defineProps({
  fontSize: { type: Number, default: 19 },
  lineHeight: { type: Number, default: 1.9 },
  maxWidth: { type: Number, default: 720 },
  adhd: { type: Object, default: null }
})

const SAMPLE_LINES = [
  'The quiet library was almost empty when I arrived. I found a seat near the window and opened my notebook.',
  'The old librarian was very kind, but I did not look up.',
  'A woman in a red coat was reading poems by the door and smiling.'
]

const params = computed(() => normalizeAdhdParams(props.adhd || {}))

const modeLabel = computed(
  () =>
    ({
      off: '普通',
      bionic: 'Bionic',
      semantic: '语义加粗',
      highlight: '语义高亮'
    })[params.value.mode] || '普通'
)

const bodyStyle = computed(() => {
  const active = params.value.mode !== 'off'
  return {
    fontSize: `${props.fontSize * (active ? params.value.baseScale : 1)}px`,
    lineHeight: String(props.lineHeight),
    maxWidth: `${props.maxWidth}px`,
    letterSpacing: active ? `${params.value.letterSpacing}em` : '0em',
    wordSpacing: active ? `${params.value.wordSpacing}em` : '0em'
  }
})

const dimensionText = computed(
  () => `${params.value.baseScale.toFixed(2)}× · ${Number(props.lineHeight).toFixed(2)} · ${props.maxWidth}px · ${modeLabel.value}`
)
</script>

<template>
  <div class="preview" data-adhd-preview :data-adhd-mode="params.mode">
    <div class="preview-head">
      <span class="preview-label">实时预览</span>
      <span class="preview-dim mono">{{ dimensionText }}</span>
    </div>

    <div class="preview-body" :style="bodyStyle">
      <p class="preview-kicker">示例文章 · 阅读外观预览</p>
      <p v-for="(line, index) in SAMPLE_LINES" :key="index" class="preview-line">
        <AdhdText :text="line" :mode="params.mode" :params="params" />
      </p>
    </div>

    <p class="preview-foot">
      预览按当前草稿渲染；保存后应用到精读与回顾正文，不影响批注、输入行与表格。
    </p>
  </div>
</template>

<style scoped>
.preview {
  border: 1px solid var(--paper-line);
  border-radius: var(--radius-lg);
  background: var(--paper-surface-2);
  padding: var(--space-7) var(--space-8) var(--space-6);
}

.preview-head {
  display: flex;
  align-items: baseline;
  gap: var(--space-5);
  margin-bottom: var(--space-5);
}

.preview-label {
  font-size: var(--text-sm);
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--paper-ink-3);
}

.preview-dim {
  margin-left: auto;
  font-size: var(--text-xs);
  color: var(--paper-ink-3);
}

.preview-body {
  margin: 0 auto;
  width: 100%;
  font-family: var(--reading-font);
  color: var(--paper-ink);
}

.preview-kicker {
  margin-bottom: var(--space-4);
  font-family: var(--font-ui);
  font-size: var(--text-xs);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--paper-ink-3);
}

.preview-line {
  margin: 0 0 var(--space-4);
  overflow-wrap: anywhere;
}

.preview-line:last-child {
  margin-bottom: 0;
}

.preview-foot {
  margin-top: var(--space-6);
  font-size: var(--text-sm);
  color: var(--paper-ink-3);
  line-height: var(--leading-relaxed);
}
</style>

