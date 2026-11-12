<script setup>
/**
 * 确认弹窗：危险操作使用红色按钮，默认焦点落在"取消"上，不预聚焦危险按钮。
 */
import Modal from './Modal.vue'
import Button from './Button.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  title: { type: String, default: '确认操作' },
  description: { type: String, default: '' },
  confirmText: { type: String, default: '确认' },
  cancelText: { type: String, default: '取消' },
  danger: { type: Boolean, default: false },
  loading: { type: Boolean, default: false }
})

const emit = defineEmits(['update:modelValue', 'confirm', 'cancel'])

function cancel() {
  if (props.loading) return
  emit('cancel')
  emit('update:modelValue', false)
}

function confirm() {
  if (props.loading) return
  emit('confirm')
}

function onVisibility(value) {
  if (value) return
  cancel()
}
</script>

<template>
  <Modal
    :model-value="modelValue"
    :title="title"
    :subtitle="description"
    :closable="!loading"
    :close-on-backdrop="!loading"
    width="420px"
    @update:model-value="onVisibility"
  >
    <slot />
    <template #foot>
      <span class="foot-info" />
      <Button variant="secondary" :disabled="loading" data-autofocus @click="cancel">
        {{ cancelText }}
      </Button>
      <Button :variant="danger ? 'danger' : 'primary'" :loading="loading" @click="confirm">
        {{ confirmText }}
      </Button>
    </template>
  </Modal>
</template>
