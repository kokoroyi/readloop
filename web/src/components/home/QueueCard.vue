<script setup>
/**
 * 阅读台·待读队列卡：按 queue_order 展示前 5 篇；支持手柄鼠标拖拽排序
 * （ghost + 插入指示线），键盘 ↑/↓ 移动一位；保留置顶/移除/开始入口。
 */
import { computed, nextTick, reactive, ref } from 'vue'
import Icon from '../ui/Icon.vue'
import { moveWithin } from './QueueDrag.js'

const props = defineProps({
  items: { type: Array, default: () => [] },
  total: { type: Number, default: 0 },
  saving: { type: Boolean, default: false }
})

const emit = defineEmits(['open', 'start', 'pin', 'remove', 'manage', 'reorder'])

const listEl = ref(null)

const visibleItems = computed(() => props.items.slice(0, 5))

const drag = reactive({
  active: false,
  fromIndex: -1,
  targetIndex: -1,
  title: '',
  ghostX: 0,
  ghostY: 0,
  lineTop: 0
})

const dragStyle = computed(() => ({
  left: `${drag.ghostX}px`,
  top: `${drag.ghostY}px`
}))

const lineStyle = computed(() => ({ top: `${drag.lineTop}px` }))

function rowElements() {
  if (!listEl.value) return []
  return Array.from(listEl.value.querySelectorAll('.queue-item'))
}

function updateTarget(clientY) {
  const rows = rowElements()
  if (!rows.length) return
  const target = rows.filter((row) => {
    const rect = row.getBoundingClientRect()
    return clientY > rect.top + rect.height / 2
  }).length
  drag.targetIndex = Math.max(0, Math.min(rows.length - 1, target))
  const row = rows[drag.targetIndex]
  drag.lineTop = drag.targetIndex === 0 ? 0 : row.offsetTop
}

function cleanupDrag() {
  drag.active = false
  drag.fromIndex = -1
  drag.targetIndex = -1
  document.removeEventListener('mousemove', onMouseMove)
  document.removeEventListener('mouseup', onMouseUp)
  document.body.classList.remove('is-queue-dragging')
}

function onMouseMove(event) {
  if (!drag.active) return
  drag.ghostX = event.clientX + 12
  drag.ghostY = event.clientY - 16
  updateTarget(event.clientY)
}

function onMouseUp() {
  if (!drag.active) {
    cleanupDrag()
    return
  }
  const fromIndex = drag.fromIndex
  const targetIndex = drag.targetIndex
  const item = visibleItems.value[fromIndex]
  cleanupDrag()
  if (!item || targetIndex < 0 || targetIndex === fromIndex) return
  const reordered = moveWithin(visibleItems.value, fromIndex, targetIndex)
  emit('reorder', reordered.map((entry) => entry.id))
}

function onHandleMouseDown(event, index) {
  if (event.button !== 0 || props.saving || drag.active) return
  event.preventDefault()
  const item = visibleItems.value[index]
  if (!item) return
  drag.active = true
  drag.fromIndex = index
  drag.targetIndex = index
  drag.title = item.title
  drag.ghostX = event.clientX + 12
  drag.ghostY = event.clientY - 16
  updateTarget(event.clientY)
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
  document.body.classList.add('is-queue-dragging')
}

function focusHandle(id) {
  nextTick(() => {
    if (!listEl.value) return
    const handle = listEl.value.querySelector(`[data-queue-handle="${id}"]`)
    if (handle) handle.focus()
  })
}

function onHandleKeydown(event, index) {
  if (props.saving) return
  const delta = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0
  if (!delta) return
  event.preventDefault()
  const item = visibleItems.value[index]
  if (!item) return
  const target = index + delta
  if (target < 0 || target >= visibleItems.value.length) return
  const reordered = moveWithin(visibleItems.value, index, target)
  emit('reorder', reordered.map((entry) => entry.id))
  focusHandle(item.id)
}

function onTitleClick(item) {
  if (props.saving || drag.active) return
  emit('open', item)
}
</script>

<template>
  <section class="card home-card home-queue" :class="{ 'is-saving': props.saving }" aria-label="待读队列">
    <header class="home-card-head">
      <h2 class="home-card-title">待读队列</h2>
      <span class="home-card-count">{{ props.total }} 篇</span>
      <span v-if="props.saving" class="queue-saving">保存中…</span>
      <button type="button" class="link-btn" aria-label="管理待读队列" @click="emit('manage')">
        管理
      </button>
    </header>

    <div v-if="visibleItems.length" ref="listEl" class="queue-list" :class="{ 'is-dragging': drag.active }">
      <div
        v-for="(item, index) in visibleItems"
        :key="item.id"
        class="queue-item"
        :class="{ 'is-dragging': drag.active && drag.fromIndex === index }"
        :data-queue-id="item.id"
      >
        <button
          type="button"
          class="queue-handle"
          :class="{ 'is-disabled': props.saving }"
          :aria-label="`拖拽排序：${item.title}`"
          :aria-disabled="props.saving"
          :data-queue-handle="item.id"
          title="拖动排序（聚焦后可用 ↑/↓ 移动）"
          @mousedown="onHandleMouseDown($event, index)"
          @keydown="onHandleKeydown($event, index)"
        >
          <i /><i /><i />
        </button>
        <div class="queue-info">
          <button type="button" class="queue-title" :title="item.title" :disabled="props.saving" @click="onTitleClick(item)">
            {{ item.title }}
          </button>
          <span class="queue-meta">
            {{ item.sourceName || item.sourceFormat || '导入' }} · {{ item.sentenceCount }} 句
          </span>
        </div>
        <span class="tag">待读</span>
        <span class="queue-actions">
          <button
            type="button"
            class="queue-action"
            aria-label="置顶"
            :title="`把《${item.title}》置顶`"
            :disabled="props.saving"
            @click="emit('pin', item)"
          >
            <Icon name="arrow-up" :size="13" />
          </button>
          <button
            type="button"
            class="queue-action"
            aria-label="移除"
            :title="`从待读队列移除《${item.title}》`"
            :disabled="props.saving"
            @click="emit('remove', item)"
          >
            <Icon name="trash" :size="13" />
          </button>
          <button
            type="button"
            class="queue-start"
            aria-label="开始阅读"
            :disabled="props.saving"
            @click="emit('start', item)"
          >
            开始 →
          </button>
        </span>
      </div>

      <div v-if="drag.active" class="queue-drop-line" :style="lineStyle" aria-hidden="true" />
    </div>
    <p v-else class="queue-empty">队列为空，去文章库导入。</p>

    <p v-if="props.total > 5" class="queue-empty">
      还有 {{ props.total - 5 }} 篇，可到文章库管理队列。
    </p>

    <Teleport to="body">
      <div v-if="drag.active" class="queue-drag-ghost" :style="dragStyle" aria-hidden="true">
        <span class="queue-drag-grip">≡</span>
        <span class="queue-drag-title">{{ drag.title }}</span>
      </div>
    </Teleport>
  </section>
</template>
