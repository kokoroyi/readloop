/**
 * 精读阅读计时：进入阅读页 start 会话 → 15s tick（页面可见且 5 分钟内活跃）→
 * 离开/隐藏时结束或补零头。计时失败不打扰用户。
 */

import { post } from './api.js'

const TICK_INTERVAL_MS = 15000
const ACTIVITY_WINDOW_MS = 5 * 60 * 1000

let tickTimer = null
let lastTickAt = 0
let lastActivityAt = 0

function markActivity() {
  lastActivityAt = Date.now()
}

async function flushTick(store) {
  if (!store.sessionId) return
  if (document.visibilityState !== 'visible') {
    lastTickAt = Date.now()
    return
  }
  if (lastActivityAt && Date.now() - lastActivityAt > ACTIVITY_WINDOW_MS) {
    lastTickAt = Date.now()
    return
  }
  const seconds = Math.min(60, Math.max(1, Math.round((Date.now() - lastTickAt) / 1000)))
  lastTickAt = Date.now()
  try {
    await post(
      '/api/reading/tick',
      { sessionId: store.sessionId, articleId: store.articleId, seconds },
      { timeoutMs: 10000 }
    )
  } catch {
    // 计时失败不打断阅读
  }
}

function onVisibilityChange(store) {
  if (document.visibilityState === 'visible') lastTickAt = Date.now()
  else flushTick(store)
}

/** 页面刷新/关闭时用 sendBeacon 结束会话，避免悬挂计时。 */
function onPageHide(store) {
  const sessionId = store.sessionId
  if (!sessionId) return
  const payload = JSON.stringify({ sessionId, articleId: store.articleId })
  try {
    navigator.sendBeacon('/api/reading/end', new Blob([payload], { type: 'application/json' }))
  } catch {
    /* 浏览器不支持 sendBeacon 时忽略 */
  }
  store.sessionId = null
}

function bindVisibility(store) {
  return () => onVisibilityChange(store)
}

function bindPageHide(store) {
  return () => onPageHide(store)
}

/** 开始计时（需 store.sessionId 已就绪；重复调用无副作用）。 */
export function startReadingTimer(store) {
  if (tickTimer || !store.sessionId) return
  lastTickAt = Date.now()
  lastActivityAt = Date.now()
  tickTimer = setInterval(() => flushTick(store), TICK_INTERVAL_MS)
  store.__timerVisibility = bindVisibility(store)
  store.__timerPageHide = bindPageHide(store)
  document.addEventListener('visibilitychange', store.__timerVisibility)
  window.addEventListener('pagehide', store.__timerPageHide)
  window.addEventListener('pointerdown', markActivity, true)
  window.addEventListener('keydown', markActivity, true)
}

/** 结束计时：SPA 内离开时补一次零头 tick 再 end；页面刷新/关闭走 pagehide。 */
export function stopReadingTimer(store, { endSession = true } = {}) {
  if (tickTimer) {
    clearInterval(tickTimer)
    tickTimer = null
  }
  if (store.__timerVisibility) document.removeEventListener('visibilitychange', store.__timerVisibility)
  if (store.__timerPageHide) window.removeEventListener('pagehide', store.__timerPageHide)
  store.__timerVisibility = null
  store.__timerPageHide = null
  window.removeEventListener('pointerdown', markActivity, true)
  window.removeEventListener('keydown', markActivity, true)

  const sessionId = store.sessionId
  const articleId = store.articleId
  store.sessionId = null
  if (!endSession || !sessionId) return
  const seconds = lastTickAt ? Math.min(60, Math.max(1, Math.round((Date.now() - lastTickAt) / 1000))) : 0
  const finish = () => post('/api/reading/end', { sessionId, articleId }, { timeoutMs: 5000 }).catch(() => {})
  if (seconds > 0) {
    post('/api/reading/tick', { sessionId, articleId, seconds }, { timeoutMs: 5000 })
      .catch(() => {})
      .then(finish)
  } else {
    finish()
  }
}
