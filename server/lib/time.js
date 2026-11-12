/**
 * 时间工具：数据库只写 UTC ISO（02-DATA-API §5），本地日期口径统一走这里。
 */

/**
 * 当前时间的 UTC ISO 字符串。
 * @returns {string} 例如 2026-11-09T04:25:16.000Z
 */
export function nowIso() {
  return new Date().toISOString()
}

/**
 * 把 Date / ISO 字符串统一成 Date；无效输入返回当前时间。
 * @param {Date | string | number | undefined} value
 * @returns {Date}
 */
function toDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) return date
  }
  return new Date()
}

/**
 * 本地日期键（YYYY-MM-DD），用于按用户本地时区聚合统计。
 * @param {Date | string | number} [value]
 * @returns {string}
 */
export function localDateKey(value = new Date()) {
  const date = toDate(value)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * 加减天数，返回新 Date（不修改入参）。
 * @param {Date | string | number} value
 * @param {number} days 正数向后、负数向前
 * @returns {Date}
 */
export function addDays(value, days) {
  const date = new Date(toDate(value).getTime())
  date.setDate(date.getDate() + days)
  return date
}

/**
 * 把 Date / ISO 字符串转成 UTC ISO；用于写入数据库前归一化。
 * @param {Date | string | number} [value]
 * @returns {string}
 */
export function toIso(value = new Date()) {
  return toDate(value).toISOString()
}
