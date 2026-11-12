/**
 * 轻提示 store：底部居中、2.5s 自动消失、aria-live="polite"。
 * 由 App.vue 中的 ToastHost 渲染。
 */

import { reactive } from 'vue'

let nextId = 1

export const toastStore = reactive({
  items: []
})

export function dismissToast(id) {
  const index = toastStore.items.findIndex((item) => item.id === id)
  if (index >= 0) toastStore.items.splice(index, 1)
}

/**
 * 显示一条轻提示。
 * @param {string} message 展示文案
 * @param {{ type?: 'info'|'success'|'error', duration?: number }} [options]
 */
export function showToast(message, { type = 'info', duration = 2500 } = {}) {
  const id = nextId++
  toastStore.items.push({ id, type, message })
  if (duration > 0) setTimeout(() => dismissToast(id), duration)
  return id
}

export const toast = {
  show: showToast,
  success: (message, options) => showToast(message, { ...options, type: 'success' }),
  error: (message, options) => showToast(message, { ...options, type: 'error', duration: 3500 }),
  info: (message, options) => showToast(message, { ...options, type: 'info' })
}
