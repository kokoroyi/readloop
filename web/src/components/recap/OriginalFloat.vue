<script setup>
/**
 * 原文浮窗：拖拽（标题栏）/ 八向缩放 / 折叠 / 关闭与恢复 /
 * 当前题相关句高亮并滚动到可见；键盘方向键移动、Esc 关闭；布局记忆 localStorage。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import Icon from '../ui/Icon.vue'
import {
  FLOAT_HEADER_HEIGHT,
  clampFloatWindow,
  loadFloatWindow,
  saveFloatWindow
} from '../../lib/floatWindow.js'

const props = defineProps({
  title: { type: String, default: '' },
  sentences: { type: Array, default: () => [] },
  refs: { type: Array, default: () => [] },
  open: { type: Boolean, default: true }
})

const emit = defineEmits(['update:open'])

const layout = reactive(loadFloatWindow())
const dragging = ref(false)
const resizing = ref('')
const winEl = ref(null)
const bodyEl = ref(null)
const titlebarEl = ref(null)
const dimmed = ref(false)

const DIRS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

const windowStyle = computed(() => ({
  left: `${layout.x}px`,
  top: `${layout.y}px`,
  width: `${layout.w}px`,
  height: layout.collapsed ? `${FLOAT_HEADER_HEIGHT}px` : `${layout.h}px`
}))

const refSet = computed(() => new Set(props.refs))

let dragState = null

function persist() {
  saveFloatWindow({ ...layout, open: props.open })
}

function clampNow() {
  Object.assign(layout, clampFloatWindow(layout))
}

function scrollToRelated() {
  nextTick(() => {
    if (!bodyEl.value) return
    const target = bodyEl.value.querySelector('.float-sentence.rel')
    if (!target) return
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    target.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' })
  })
}

function onPointerMove(event) {
  if (!dragState) return
  const dx = event.clientX - dragState.startX
  const dy = event.clientY - dragState.startY
  if (dragState.mode === 'move') {
    layout.x = dragState.x + dx
    layout.y = dragState.y + dy
  } else {
    const dir = dragState.dir
    let x = dragState.x
    let y = dragState.y
    let w = dragState.w
    let h = dragState.h
    if (dir.includes('e')) w = dragState.w + dx
    if (dir.includes('s')) h = dragState.h + dy
    if (dir.includes('w')) {
      w = dragState.w - dx
      x = dragState.x + dx
    }
    if (dir.includes('n')) {
      h = dragState.h - dy
      y = dragState.y + dy
    }
    Object.assign(layout, clampFloatWindow({ ...layout, x, y, w, h, collapsed: false }))
    return
  }
  clampNow()
}

function endDrag() {
  if (!dragState) return
  dragState = null
  dragging.value = false
  resizing.value = ''
  persist()
}

function onPointerUp() {
  endDrag()
}

function startMove(event) {
  if (event.button !== 0) return
  if (event.target.closest('.float-actions')) return
  dragState = {
    mode: 'move',
    startX: event.clientX,
    startY: event.clientY,
    x: layout.x,
    y: layout.y,
    w: layout.w,
    h: layout.h
  }
  dragging.value = true
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp, { once: true })
  event.preventDefault()
}

function startResize(event, dir) {
  if (event.button !== 0) return
  dragState = {
    mode: 'resize',
    dir,
    startX: event.clientX,
    startY: event.clientY,
    x: layout.x,
    y: layout.y,
    w: layout.w,
    h: layout.h
  }
  resizing.value = dir
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp, { once: true })
  event.preventDefault()
  event.stopPropagation()
}

function toggleCollapse() {
  layout.collapsed = !layout.collapsed
  if (!layout.collapsed) clampNow()
  persist()
  if (!layout.collapsed) scrollToRelated()
}

function close() {
  emit('update:open', false)
  persist()
}

function restore() {
  clampNow()
  emit('update:open', true)
  persist()
  scrollToRelated()
}

function onTitleKeydown(event) {
  const step = event.shiftKey ? 48 : 16
  const moves = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step]
  }
  const move = moves[event.key]
  if (!move) return
  event.preventDefault()
  layout.x += move[0]
  layout.y += move[1]
  clampNow()
  persist()
}

function onWindowResize() {
  replaceLayout()
}

function replaceLayout() {
  Object.assign(layout, clampFloatWindow(loadFloatWindow()))
  persist()
}

watch(
  () => props.refs,
  () => scrollToRelated(),
  { deep: true }
)

watch(
  () => props.open,
  (open) => {
    if (open) {
      clampNow()
      scrollToRelated()
    }
  }
)

function onFocusIn(event) {
  const target = event.target
  if (!props.open || !target || !target.matches || !target.matches('textarea, input')) return
  const el = winEl.value
  if (!el) return
  const floatRect = el.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  const overlap =
    targetRect.right > floatRect.left &&
    targetRect.left < floatRect.right &&
    targetRect.bottom > floatRect.top &&
    targetRect.top < floatRect.bottom
  dimmed.value = overlap
}

function onFocusOut() {
  dimmed.value = false
}

onMounted(() => {
  window.addEventListener('resize', onWindowResize)
  document.addEventListener('focusin', onFocusIn)
  document.addEventListener('focusout', onFocusOut)
  if (props.open) scrollToRelated()
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize)
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  document.removeEventListener('focusin', onFocusIn)
  document.removeEventListener('focusout', onFocusOut)
})
</script>

<template>
  <template v-if="props.open">
    <section ref="winEl" class="float-window" :class="{ 'is-dimmed': dimmed }" :style="windowStyle" aria-label="原文浮窗" @keydown.esc.stop.prevent="close">
      <header
        ref="titlebarEl"
        class="float-titlebar"
        :class="{ 'is-dragging': dragging }"
        tabindex="0"
        role="group"
        aria-label="原文浮窗标题栏：拖动移动，方向键微调，Esc 关闭"
        @pointerdown="startMove"
        @keydown="onTitleKeydown"
      >
        <span class="float-dot" aria-hidden="true" />
        <span class="float-title" :title="`原文 · ${props.title}`">原文 · {{ props.title }}</span>
        <div class="float-actions">
          <button
            type="button"
            class="float-btn"
            aria-label="折叠原文浮窗"
            @click="toggleCollapse"
          >
            {{ layout.collapsed ? '+' : '−' }}
          </button>
          <button type="button" class="float-btn" aria-label="关闭原文浮窗" @click="close">✕</button>
        </div>
      </header>

      <div v-if="!layout.collapsed" ref="bodyEl" class="float-body">
        <p class="float-text">
          <template v-for="(sentence, index) in props.sentences" :key="sentence.idx">
            <span class="float-sentence" :class="{ rel: refSet.has(sentence.idx) }">{{ sentence.text }}</span>
            <template v-if="index < props.sentences.length - 1">{{ ' ' }}</template>
          </template>
        </p>
        <p class="float-hint">拖动标题栏移动 · 右下角缩放 · 相关句已高亮</p>
      </div>

      <span
        v-for="dir in DIRS"
        :key="dir"
        class="float-resize"
        :class="`is-${dir}`"
        aria-hidden="true"
        @pointerdown="startResize($event, dir)"
      />
    </section>
  </template>

  <button
    v-else
    type="button"
    class="float-restore"
    aria-label="显示原文"
    @click="restore"
  >
    <Icon name="book-open" :size="14" />
    显示原文
  </button>
</template>
