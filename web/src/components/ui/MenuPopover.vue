<script setup>
/**
 * 下拉菜单：Teleport + fixed 定位（表格行内也不会被裁剪）、视口钳制、Esc/外部点击关闭、
 * 关闭后焦点回到触发按钮。触发元素通过默认插槽提供（收到 toggle/open）。
 */
import { nextTick, onBeforeUnmount, ref } from 'vue'
import Icon from './Icon.vue'

const props = defineProps({
  items: { type: Array, default: () => [] },
  align: { type: String, default: 'right' },
  minWidth: { type: String, default: '168px' },
  ariaLabel: { type: String, default: '更多操作' }
})

const emit = defineEmits(['select'])

const trigger = ref(null)
const menuEl = ref(null)
const open = ref(false)
const menuStyle = ref({})
let lastActive = null

function position() {
  const anchor = trigger.value ? trigger.value.getBoundingClientRect() : null
  const panel = menuEl.value ? menuEl.value.getBoundingClientRect() : null
  if (!anchor || !panel) return
  const margin = 8
  const vw = window.innerWidth
  const vh = window.innerHeight
  let left = props.align === 'right' ? anchor.right - panel.width : anchor.left
  left = Math.max(margin, Math.min(left, vw - panel.width - margin))
  let top = anchor.bottom + 6
  if (top + panel.height > vh - margin) top = Math.max(margin, anchor.top - panel.height - 6)
  menuStyle.value = {
    top: `${Math.round(top)}px`,
    left: `${Math.round(left)}px`,
    minWidth: props.minWidth
  }
}

function onScroll(event) {
  if (menuEl.value && event.target instanceof Node && menuEl.value.contains(event.target)) return
  close()
}

function onResize() {
  close()
}

async function show() {
  lastActive = document.activeElement
  open.value = true
  await nextTick()
  position()
  document.addEventListener('scroll', onScroll, true)
  window.addEventListener('resize', onResize)
  const first = menuEl.value ? menuEl.value.querySelector('button:not([disabled])') : null
  if (first) first.focus({ preventScroll: true })
}

function close() {
  if (!open.value) return
  open.value = false
  document.removeEventListener('scroll', onScroll, true)
  window.removeEventListener('resize', onResize)
  if (lastActive && document.contains(lastActive) && typeof lastActive.focus === 'function') {
    lastActive.focus({ preventScroll: true })
  }
  lastActive = null
}

function toggle() {
  if (open.value) close()
  else show()
}

function onOutside(event) {
  if (trigger.value && event.target instanceof Node && trigger.value.contains(event.target)) return
  close()
}

function onKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    close()
    return
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  const buttons = menuEl.value
    ? Array.from(menuEl.value.querySelectorAll('button:not([disabled])'))
    : []
  if (!buttons.length) return
  event.preventDefault()
  const index = buttons.indexOf(document.activeElement)
  const next = event.key === 'ArrowDown' ? (index + 1) % buttons.length : (index - 1 + buttons.length) % buttons.length
  buttons[next].focus({ preventScroll: true })
}

function onSelect(item) {
  if (item.disabled) return
  close()
  emit('select', item.id)
}

onBeforeUnmount(() => {
  document.removeEventListener('scroll', onScroll, true)
  window.removeEventListener('resize', onResize)
})
</script>

<template>
  <span ref="trigger" class="menu-trigger">
    <slot :open="open" :toggle="toggle" />
  </span>
  <Teleport to="body">
    <div
      v-if="open"
      ref="menuEl"
      v-click-outside="onOutside"
      class="menu"
      role="menu"
      :aria-label="props.ariaLabel"
      :style="menuStyle"
      @keydown="onKeydown"
    >
      <template v-for="item in props.items" :key="item.id || item.label">
        <div v-if="item.separator" class="menu-sep" />
        <button
          v-else
          type="button"
          class="menu-item"
          :class="{ danger: item.danger }"
          role="menuitem"
          :disabled="item.disabled"
          @click="onSelect(item)"
        >
          <Icon v-if="item.icon" :name="item.icon" :size="14" />
          <span>{{ item.label }}</span>
        </button>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.menu-trigger {
  display: inline-flex;
}
</style>
