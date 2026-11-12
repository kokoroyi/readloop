<script setup>
/**
 * 悬浮提示：150ms 出现、视口钳制、移出/滚动即消失；不使用原生 title。
 */
import { nextTick, onBeforeUnmount, ref } from 'vue'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  content: { type: String, default: '' },
  delay: { type: Number, default: 150 }
})

const visible = ref(false)
const anchorEl = ref(null)
const tipEl = ref(null)
const positionStyle = ref({})
let timer = null
let listening = false

function clearTimer() {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}

function hide() {
  clearTimer()
  visible.value = false
  if (listening) {
    listening = false
    window.removeEventListener('scroll', hide, true)
    window.removeEventListener('resize', hide)
  }
}

function schedule() {
  clearTimer()
  if (!props.content) return
  timer = setTimeout(show, props.delay)
}

async function show() {
  timer = null
  if (!props.content) return
  visible.value = true
  await nextTick()
  position()
  if (!listening) {
    listening = true
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
  }
}

function position() {
  const anchor = anchorEl.value
  const tip = tipEl.value
  if (!anchor || !tip) return
  const margin = 8
  const rect = anchor.getBoundingClientRect()
  const tipRect = tip.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight
  let left = rect.left + rect.width / 2 - tipRect.width / 2
  left = Math.max(margin, Math.min(left, vw - tipRect.width - margin))
  let top = rect.top - tipRect.height - margin
  if (top < margin) top = Math.min(rect.bottom + margin, vh - tipRect.height - margin)
  positionStyle.value = { top: `${Math.round(top)}px`, left: `${Math.round(left)}px` }
}

onBeforeUnmount(hide)
</script>

<template>
  <span
    ref="anchorEl"
    class="tip-anchor"
    @mouseenter="schedule"
    @mouseleave="hide"
    @focusin="schedule"
    @focusout="hide"
  >
    <slot />
  </span>
  <Teleport to="body">
    <div v-if="visible" ref="tipEl" class="tip" role="tooltip" :style="positionStyle">
      {{ content }}
    </div>
  </Teleport>
</template>

<style scoped>
.tip-anchor {
  display: inline-flex;
  align-items: center;
}
</style>
