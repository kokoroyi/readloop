/**
 * 原文浮窗布局记忆：localStorage `rl.floatWindow`（跨文章保留），
 * 负责默认位置/尺寸、读取校验与视口钳制。
 */

export const FLOAT_KEY = 'rl.floatWindow'
export const FLOAT_MIN_WIDTH = 300
export const FLOAT_MIN_HEIGHT = 220
export const FLOAT_EDGE = 20
export const FLOAT_DEFAULT_WIDTH = 424
export const FLOAT_DEFAULT_HEIGHT = 348
export const FLOAT_HEADER_HEIGHT = 38

function viewport() {
  return { width: window.innerWidth || 1440, height: window.innerHeight || 900 }
}

/** 默认右下角悬浮（32 / 30 px 边距）。 */
export function defaultFloatWindow() {
  const { width, height } = viewport()
  return clampFloatWindow({
    x: width - FLOAT_DEFAULT_WIDTH - 32,
    y: height - FLOAT_DEFAULT_HEIGHT - 30,
    w: FLOAT_DEFAULT_WIDTH,
    h: FLOAT_DEFAULT_HEIGHT,
    collapsed: false,
    open: true
  })
}

/** 把位置/尺寸收进视口；尺寸上限为视口 - 40px。 */
export function clampFloatWindow(input) {
  const { width, height } = viewport()
  const maxW = Math.max(FLOAT_MIN_WIDTH, width - FLOAT_EDGE * 2)
  const maxH = Math.max(FLOAT_MIN_HEIGHT, height - FLOAT_EDGE * 2)
  const w = Math.min(maxW, Math.max(FLOAT_MIN_WIDTH, Math.round(Number(input.w) || FLOAT_DEFAULT_WIDTH)))
  const h = Math.min(maxH, Math.max(FLOAT_MIN_HEIGHT, Math.round(Number(input.h) || FLOAT_DEFAULT_HEIGHT)))
  const visibleW = Math.min(w, 120)
  const visibleH = Math.min(input.collapsed ? FLOAT_HEADER_HEIGHT : h, 80)
  const x = Math.min(
    width - visibleW - 4,
    Math.max(4 - (w - visibleW), Math.round(Number(input.x) || 0))
  )
  const y = Math.min(
    height - visibleH - 4,
    Math.max(4, Math.round(Number(input.y) || 0))
  )
  return { x, y, w, h, collapsed: Boolean(input.collapsed), open: Boolean(input.open) }
}

export function loadFloatWindow() {
  try {
    const raw = localStorage.getItem(FLOAT_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') {
        return clampFloatWindow({
          x: parsed.x,
          y: parsed.y,
          w: parsed.w,
          h: parsed.h,
          collapsed: parsed.collapsed,
          open: parsed.open !== false
        })
      }
    }
  } catch {
    /* 损坏/被禁用时回默认值 */
  }
  return defaultFloatWindow()
}

export function saveFloatWindow(state) {
  try {
    localStorage.setItem(FLOAT_KEY, JSON.stringify(clampFloatWindow(state)))
  } catch {
    /* localStorage 不可用则只保留内存状态 */
  }
}

export function resetFloatWindow() {
  try {
    localStorage.removeItem(FLOAT_KEY)
  } catch {
    /* ignore */
  }
}
