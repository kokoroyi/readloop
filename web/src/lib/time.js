/**
 * 前端时间展示：库/词库列表用相对时间，详情/小结用日期时间。
 * 入参为服务端 UTC ISO 字符串；展示统一按本地时区。
 */

const MINUTE = 60 * 1000

function parseTime(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function pad(value) {
  return String(value).padStart(2, '0')
}

/** 相对时间：刚刚 / N 分钟前 / 今天 HH:mm / 昨天 HH:mm / M 月 D 日 / YYYY 年 M 月 D 日 */
export function formatRelative(value) {
  const date = parseTime(value)
  if (!date) return '—'
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  if (diff < MINUTE) return '刚刚'
  if (diff < 60 * MINUTE) return `${Math.floor(diff / MINUTE)} 分钟前`
  const sameDay = date.toDateString() === now.toDateString()
  if (sameDay) return `今天 ${pad(date.getHours())}:${pad(date.getMinutes())}`
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) {
    return `昨天 ${pad(date.getHours())}:${pad(date.getMinutes())}`
  }
  if (date.getFullYear() === now.getFullYear()) return `${date.getMonth() + 1} 月 ${date.getDate()} 日`
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`
}

/** 日期：M 月 D 日 / YYYY 年 M 月 D 日 */
export function formatDate(value) {
  const date = parseTime(value)
  if (!date) return '—'
  const now = new Date()
  if (date.getFullYear() === now.getFullYear()) return `${date.getMonth() + 1} 月 ${date.getDate()} 日`
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`
}

/** 日期时间：YYYY-MM-DD HH:mm */
export function formatDateTime(value) {
  const date = parseTime(value)
  if (!date) return '—'
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 秒数 → "12 分钟" / "1 小时 5 分钟" */
export function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0))
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`
}
