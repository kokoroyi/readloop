<script setup>
/**
 * 学习小结·我的笔记：1s 防抖自动保存 + 失焦保存 + 手动保存；失败保留内容并提示。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import Button from '../ui/Button.vue'
import { notesDirty, saveNotes, setNotes, summaryStore } from '../../stores/summary.js'

const saving = ref(false)
const savedAt = ref('')
let timer = null

const statusText = computed(() => {
  if (saving.value || summaryStore.saving) return '保存中…'
  if (summaryStore.saveError) return `保存失败：${summaryStore.saveError}`
  if (notesDirty.value) return '有未保存的修改'
  return savedAt.value ? `已保存 ${savedAt.value}` : '自动保存到本地'
})

function onInput(event) {
  setNotes(event.target.value)
  scheduleSave()
}

function scheduleSave() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    void flush()
  }, 1000)
}

async function flush() {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (!notesDirty.value || summaryStore.saving) return
  saving.value = true
  const result = await saveNotes()
  saving.value = false
  if (result.ok) {
    const now = new Date()
    savedAt.value = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  }
}

function onSaveClick() {
  void flush()
}

function onBlur() {
  void flush()
}

watch(
  () => summaryStore.notes,
  () => scheduleSave()
)

onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
  if (notesDirty.value) {
    // 离开页面时尽力保存一次（不阻塞跳转）
    void saveNotes()
  }
})
</script>

<template>
  <section class="card summary-card summary-notes-card">
    <div class="summary-card-head">
      <h2 class="card-title">我的笔记</h2>
    </div>
    <textarea
      class="summary-notes"
      :value="summaryStore.notes"
      rows="5"
      maxlength="20000"
      placeholder="写下你自己的总结，或今天最大的收获…"
      aria-label="我的笔记"
      @input="onInput"
      @blur="onBlur"
    />
    <div class="summary-notes-foot">
      <Button size="sm" variant="primary" aria-label="保存笔记" :loading="saving" @click="onSaveClick">
        保存笔记
      </Button>
      <span class="summary-notes-status">{{ statusText }}</span>
    </div>
  </section>
</template>
