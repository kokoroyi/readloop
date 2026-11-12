<script setup>
/**
 * ADHD 增强 v3 设置：4 模式 + 轻/中/重预设 + 6 个参数滑杆 + 恢复默认。
 * 所有改动实时 emit（用于设置页预览即时生效），保存由外层统一 PUT。
 */
import { computed } from 'vue'
import Button from '../ui/Button.vue'
import RangeRow from './RangeRow.vue'
import {
  ADHD_DEFAULT_PARAMS,
  ADHD_PARAM_RANGES,
  ADHD_PRESETS,
  normalizeAdhdParams
} from '../../lib/adhd.js'
import { ADHD_OPTIONS } from '../../stores/settings.js'

const props = defineProps({
  adhd: { type: Object, required: true }
})

const emit = defineEmits(['update'])

const value = computed(() => normalizeAdhdParams(props.adhd))
const isOff = computed(() => value.value.mode === 'off')
const isBionic = computed(() => value.value.mode === 'bionic')

function patch(partial) {
  emit('update', normalizeAdhdParams({ ...value.value, ...partial }))
}

function onMode(mode) {
  patch({ mode })
}

function presetActive(preset) {
  return Object.keys(preset.params).every(
    (key) => Math.abs(Number(preset.params[key]) - Number(value.value[key])) < 1e-6
  )
}

function applyPreset(preset) {
  patch(preset.params)
}

function resetParams() {
  patch({ ...ADHD_DEFAULT_PARAMS, mode: value.value.mode })
}

const baseScaleDisplay = computed(() => `${Math.round(value.value.baseScale * 100)}%`)
const letterSpacingDisplay = computed(() => `${value.value.letterSpacing.toFixed(3)}em`)
const wordSpacingDisplay = computed(() => `${value.value.wordSpacing.toFixed(2)}em`)
const densityDisplay = computed(() => `${Math.round(value.value.semanticDensity * 100)}%`)
const splitDisplay = computed(() => `${Math.round(value.value.splitRatio * 100)}%`)
const leadScaleDisplay = computed(() => `${Math.round(value.value.leadScale * 100)}%`)
</script>

<template>
  <section class="adhd-settings" aria-label="ADHD 阅读增强">
    <div class="adhd-modes" role="group" aria-label="ADHD 模式">
      <button
        v-for="option in ADHD_OPTIONS"
        :key="option.value"
        type="button"
        class="adhd-mode-btn"
        :class="{ active: value.mode === option.value }"
        :data-mode="option.value"
        :aria-pressed="value.mode === option.value"
        :title="option.hint"
        @click="onMode(option.value)"
      >
        {{ option.label }}
      </button>
    </div>
    <p class="adhd-mode-hint">
      {{ ADHD_OPTIONS.find((option) => option.value === value.mode)?.hint || '' }}；只作用于句子正文与回顾正文，不影响批注和输入行。
    </p>

    <template v-if="!isOff">
      <div class="adhd-presets" role="group" aria-label="强度预设">
        <span class="adhd-presets-label">强度预设</span>
        <button
          v-for="preset in ADHD_PRESETS"
          :key="preset.id"
          type="button"
          class="adhd-preset"
          :class="{ active: presetActive(preset) }"
          :data-preset="preset.id"
          :aria-pressed="presetActive(preset)"
          :title="preset.hint"
          @click="applyPreset(preset)"
        >
          {{ preset.label }}
        </button>
        <Button size="sm" variant="ghost" class="adhd-reset" aria-label="恢复默认" @click="resetParams">
          恢复默认
        </Button>
      </div>

      <div class="adhd-sliders">
        <div class="adhd-slider" data-adhd-param="baseScale">
          <RangeRow
            label="整体大小"
            :min="ADHD_PARAM_RANGES.baseScale.min"
            :max="ADHD_PARAM_RANGES.baseScale.max"
            :step="ADHD_PARAM_RANGES.baseScale.step"
            :model-value="value.baseScale"
            :display="baseScaleDisplay"
            @update:model-value="patch({ baseScale: $event })"
          />
        </div>
        <div class="adhd-slider" data-adhd-param="letterSpacing">
          <RangeRow
            label="字距"
            :min="ADHD_PARAM_RANGES.letterSpacing.min"
            :max="ADHD_PARAM_RANGES.letterSpacing.max"
            :step="ADHD_PARAM_RANGES.letterSpacing.step"
            :model-value="value.letterSpacing"
            :display="letterSpacingDisplay"
            @update:model-value="patch({ letterSpacing: $event })"
          />
        </div>
        <div class="adhd-slider" data-adhd-param="wordSpacing">
          <RangeRow
            label="词距"
            :min="ADHD_PARAM_RANGES.wordSpacing.min"
            :max="ADHD_PARAM_RANGES.wordSpacing.max"
            :step="ADHD_PARAM_RANGES.wordSpacing.step"
            :model-value="value.wordSpacing"
            :display="wordSpacingDisplay"
            @update:model-value="patch({ wordSpacing: $event })"
          />
        </div>
        <div class="adhd-slider" data-adhd-param="semanticDensity">
          <RangeRow
            label="强调密度"
            :min="ADHD_PARAM_RANGES.semanticDensity.min"
            :max="ADHD_PARAM_RANGES.semanticDensity.max"
            :step="ADHD_PARAM_RANGES.semanticDensity.step"
            :model-value="value.semanticDensity"
            :display="densityDisplay"
            @update:model-value="patch({ semanticDensity: $event })"
          />
        </div>
        <div class="adhd-slider" data-adhd-param="leadScale">
          <RangeRow
            label="强调强度"
            :min="ADHD_PARAM_RANGES.leadScale.min"
            :max="ADHD_PARAM_RANGES.leadScale.max"
            :step="ADHD_PARAM_RANGES.leadScale.step"
            :model-value="value.leadScale"
            :display="leadScaleDisplay"
            @update:model-value="patch({ leadScale: $event })"
          />
        </div>
        <div v-if="isBionic" class="adhd-slider" data-adhd-param="splitRatio">
          <RangeRow
            label="Bionic 比例"
            :min="ADHD_PARAM_RANGES.splitRatio.min"
            :max="ADHD_PARAM_RANGES.splitRatio.max"
            :step="ADHD_PARAM_RANGES.splitRatio.step"
            :model-value="value.splitRatio"
            :display="splitDisplay"
            @update:model-value="patch({ splitRatio: $event })"
          />
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.adhd-settings {
  margin-top: var(--space-4);
  padding: var(--space-5) var(--space-6) var(--space-6);
  border: 1px solid var(--paper-line);
  border-radius: var(--radius-md);
  background: var(--paper-surface-2);
}

.adhd-modes {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.adhd-mode-btn {
  height: 30px;
  padding: 0 var(--space-4);
  border: 1px solid var(--paper-line-2);
  border-radius: var(--radius-pill);
  background: var(--paper-surface);
  font-family: var(--font-ui);
  font-size: var(--text-sm);
  color: var(--paper-ink-2);
  cursor: pointer;
  transition: all var(--dur-fast) var(--ease);
}

.adhd-mode-btn:hover {
  border-color: var(--paper-accent-2);
}

.adhd-mode-btn.active {
  border-color: var(--paper-accent);
  background: var(--paper-accent);
  color: var(--paper-surface);
}

.adhd-mode-btn:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

.adhd-mode-hint {
  margin: var(--space-3) 0 0;
  font-size: var(--text-sm);
  color: var(--paper-ink-3);
}

.adhd-presets {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-top: var(--space-5);
}

.adhd-presets-label {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--paper-ink-2);
}

.adhd-preset {
  height: 26px;
  min-width: 40px;
  padding: 0 var(--space-4);
  border: 1px solid var(--paper-line-2);
  border-radius: var(--radius-sm);
  background: var(--paper-surface);
  font-family: var(--font-ui);
  font-size: var(--text-sm);
  color: var(--paper-ink-2);
  cursor: pointer;
}

.adhd-preset.active {
  border-color: var(--paper-accent);
  background: var(--paper-accent-soft);
  color: var(--paper-accent);
}

.adhd-reset {
  margin-left: auto;
}

.adhd-sliders {
  margin-top: var(--space-5);
}

.adhd-slider :deep(.range-label) {
  flex: 0 0 78px;
}
</style>
