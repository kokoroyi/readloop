<script setup>
/**
 * 弹窗：遮罩居中、焦点陷阱、Esc 关闭、关闭后焦点回到触发元素。
 * 可通过内容里的 [data-autofocus] 指定初始焦点（危险确认指向"取消"）。
 */
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import Icon from './Icon.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' },
  closable: { type: Boolean, default: true },
  closeOnBackdrop: { type: Boolean, default: true },
  width: { type: String, default: '' },
  height: { type: String, default: '' }
})

const panelStyle = computed(() => {
  const style = {}
  if (props.width) style.width = props.width
  if (props.height) style.height = props.height
  return Object.keys(style).length ? style : null
})

const emit = defineEmits(['update:modelValue', 'close'])

const uid = useId()
const titleId = `rl-modal-title-${uid}`
const panel = ref(null)
let lastActive = null

function focusables() {
  if (!panel.value) return []
  const selector =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  return Array.from(panel.value.querySelectorAll(selector)).filter((el) => el.getClientRects().length > 0)
}

function onKeydown(event) {
  if (event.key === 'Escape') {
    if (!props.closable) return
    event.preventDefault()
    event.stopPropagation()
    close()
    return
  }
  if (event.key !== 'Tab') return
  const items = focusables()
  if (!items.length) {
    event.preventDefault()
    panel.value?.focus()
    return
  }
  const first = items[0]
  const last = items[items.length - 1]
  const active = document.activeElement
  const inside = panel.value?.contains(active)
  if (event.shiftKey && (!inside || active === first)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (!inside || active === last)) {
    event.preventDefault()
    first.focus()
  }
}

function close() {
  emit('update:modelValue', false)
  emit('close')
}

function onBackdrop() {
  if (props.closeOnBackdrop && props.closable) close()
}

function teardown() {
  document.removeEventListener('keydown', onKeydown, true)
  if (lastActive && typeof lastActive.focus === 'function' && document.contains(lastActive)) {
    lastActive.focus()
  }
  lastActive = null
}

async function open() {
  lastActive = document.activeElement
  document.addEventListener('keydown', onKeydown, true)
  await nextTick()
  const auto = panel.value?.querySelector('[data-autofocus]')
  const target = auto || focusables()[0] || panel.value
  if (target && typeof target.focus === 'function') target.focus()
}

watch(
  () => props.modelValue,
  (open_) => {
    if (open_) open()
    else teardown()
  },
  { immediate: true }
)

onBeforeUnmount(teardown)
</script>

<template>
  <Teleport to="body">
    <div v-if="modelValue" class="overlay" @mousedown.self="onBackdrop">
      <div
        ref="panel"
        class="modal"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="title ? titleId : undefined"
        :style="panelStyle"
        tabindex="-1"
        @mousedown.stop
      >
        <div class="modal-head">
          <div>
            <h2 v-if="title" :id="titleId" class="modal-title">{{ title }}</h2>
            <p v-if="subtitle" class="modal-sub">{{ subtitle }}</p>
          </div>
          <button
            v-if="closable"
            class="icon-btn modal-close"
            type="button"
            aria-label="关闭"
            @click="close"
          >
            <Icon name="close" :size="15" />
          </button>
        </div>
        <div class="modal-body">
          <slot />
        </div>
        <div v-if="$slots.foot" class="modal-foot">
          <slot name="foot" />
        </div>
      </div>
    </div>
  </Teleport>
</template>
