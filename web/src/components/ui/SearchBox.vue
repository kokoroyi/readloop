<script setup>
/** 搜索框：受控输入，带清空按钮。 */
import Icon from './Icon.vue'

const props = defineProps({
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: '搜索' },
  ariaLabel: { type: String, default: '搜索' },
  autofocus: { type: Boolean, default: false }
})

const emit = defineEmits(['update:modelValue'])

function onInput(event) {
  emit('update:modelValue', event.target.value)
}

function clear() {
  emit('update:modelValue', '')
}
</script>

<template>
  <label class="search">
    <Icon name="search" :size="15" />
    <input
      type="search"
      :value="props.modelValue"
      :placeholder="props.placeholder"
      :aria-label="props.ariaLabel"
      :autofocus="props.autofocus || undefined"
      spellcheck="false"
      @input="onInput"
    />
    <button
      v-if="props.modelValue"
      class="search-clear"
      type="button"
      aria-label="清空搜索"
      @click="clear"
    >
      <Icon name="close" :size="11" />
    </button>
  </label>
</template>
