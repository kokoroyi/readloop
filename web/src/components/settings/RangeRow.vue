<script setup>
/**
 * 带数值显示的滑杆行：字号 / 行距 / 栏宽。
 */
const props = defineProps({
  label: { type: String, required: true },
  min: { type: Number, required: true },
  max: { type: Number, required: true },
  step: { type: Number, default: 1 },
  modelValue: { type: Number, required: true },
  display: { type: String, default: '' }
})

const emit = defineEmits(['update:modelValue'])

function onInput(event) {
  const raw = Number(event.target.value)
  if (!Number.isFinite(raw)) return
  emit('update:modelValue', Math.round(raw * 100) / 100)
}
</script>

<template>
  <div class="range-row">
    <span class="range-label">{{ props.label }}</span>
    <input
      class="range-input"
      type="range"
      :min="props.min"
      :max="props.max"
      :step="props.step"
      :value="props.modelValue"
      :aria-label="props.label"
      @input="onInput"
    />
    <span class="range-value mono">{{ props.display || props.modelValue }}</span>
  </div>
</template>

<style scoped>
.range-row {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  margin-bottom: var(--space-5);
}

.range-row:last-child {
  margin-bottom: 0;
}

.range-label {
  flex: 0 0 56px;
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--paper-ink-2);
}

.range-input {
  flex: 1;
  min-width: 0;
  height: 18px;
  margin: 0;
  accent-color: var(--paper-accent);
  cursor: pointer;
}

.range-value {
  flex: 0 0 54px;
  text-align: right;
  font-size: var(--text-base);
  color: var(--paper-ink-2);
}
</style>
