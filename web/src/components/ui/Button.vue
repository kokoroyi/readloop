<script setup>
/**
 * 按钮：primary / secondary / ghost / danger，支持 loading 与 disabled。
 * 通过 defineExpose 暴露 focus()，父组件可用 ref 把焦点交给按钮（提交后聚焦「下一句」）。
 */
import { computed, ref } from 'vue'

const props = defineProps({
  variant: { type: String, default: 'secondary' },
  size: { type: String, default: 'md' },
  type: { type: String, default: 'button' },
  loading: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  block: { type: Boolean, default: false },
  iconOnly: { type: Boolean, default: false },
  ariaLabel: { type: String, default: '' }
})

const emit = defineEmits(['click'])

const rootEl = ref(null)

const classes = computed(() => [
  'btn',
  `btn-${props.variant}`,
  props.size === 'sm' ? 'btn-sm' : '',
  props.size === 'lg' ? 'btn-lg' : '',
  props.block ? 'btn-block' : '',
  props.iconOnly ? 'btn-icon-only' : ''
])

const isDisabled = computed(() => props.disabled || props.loading)

function onClick(event) {
  if (isDisabled.value) return
  emit('click', event)
}

function focus(options) {
  if (rootEl.value) rootEl.value.focus(options)
}

function blur() {
  if (rootEl.value) rootEl.value.blur()
}

defineExpose({ focus, blur })
</script>

<template>
  <button
    ref="rootEl"
    :type="type"
    :class="classes"
    :disabled="isDisabled"
    :aria-busy="loading || undefined"
    :aria-label="ariaLabel || undefined"
    @click="onClick"
  >
    <span v-if="loading" class="spinner" aria-hidden="true" />
    <slot />
  </button>
</template>
