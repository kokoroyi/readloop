/**
 * 自由提问消息区高度：默认 260，min 140，max min(520, 60vh)，localStorage 记忆。
 */
export const CHAT_HEIGHT_KEY = 'rl.recapChatHeight'
export const CHAT_HEIGHT_DEFAULT = 260
export const CHAT_HEIGHT_MIN = 140
export const CHAT_HEIGHT_MAX = 520

export function maxChatHeight() {
  if (typeof window === 'undefined') return CHAT_HEIGHT_MAX
  return Math.max(CHAT_HEIGHT_MIN, Math.min(CHAT_HEIGHT_MAX, Math.round(window.innerHeight * 0.6)))
}

export function clampChatHeight(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return CHAT_HEIGHT_DEFAULT
  return Math.min(maxChatHeight(), Math.max(CHAT_HEIGHT_MIN, Math.round(number)))
}

export function loadChatHeight() {
  try {
    const raw = localStorage.getItem(CHAT_HEIGHT_KEY)
    if (raw === null) return CHAT_HEIGHT_DEFAULT
    return clampChatHeight(raw)
  } catch {
    return CHAT_HEIGHT_DEFAULT
  }
}

export function saveChatHeight(value) {
  try {
    localStorage.setItem(CHAT_HEIGHT_KEY, String(clampChatHeight(value)))
  } catch {
    /* 隐私模式等场景忽略 */
  }
}
