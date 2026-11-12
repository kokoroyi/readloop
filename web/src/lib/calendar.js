/**
 * 阅读台日历与指标展示辅助：月网格（周日起始）、色阶 class、统计时长格式。
 */

export const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

function pad(value) {
  return String(value).padStart(2, '0')
}

export function dateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 当前本地日期 YYYY-MM-DD。 */
export function todayKey() {
  return dateKey(new Date())
}

export function levelClass(level) {
  const value = Math.max(0, Math.min(4, Number(level) || 0))
  return value === 0 ? 'cal-level-0' : `cal-level-${value}`
}

/**
 * 生成月网格（周日起始，补齐前后月日期）。
 * @param {number} year
 * @param {number} month 0-11
 * @returns {Array<{date:string,day:number,inMonth:boolean,isToday:boolean}>}
 */
export function buildMonthGrid(year, month) {
  const first = new Date(year, month, 1)
  const startOffset = first.getDay()
  const cells = []
  const start = new Date(year, month, 1 - startOffset)
  const today = todayKey()
  for (let index = 0; index < 42; index += 1) {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    const key = dateKey(date)
    cells.push({
      date: key,
      day: date.getDate(),
      inMonth: date.getMonth() === month && date.getFullYear() === year,
      isToday: key === today
    })
    if (index >= 34 && date.getMonth() !== month && date.getDate() >= 7) break
  }
  return cells
}

/** 切换月份；返回 {year, month}。 */
export function shiftMonth(year, month, delta) {
  const date = new Date(year, month + delta, 1)
  return { year: date.getFullYear(), month: date.getMonth() }
}

export function isFutureMonth(year, month) {
  const now = new Date()
  return year > now.getFullYear() || (year === now.getFullYear() && month > now.getMonth())
}

/**
 * 累计阅读时长格式：<1 分钟为 0m，<60 分钟 Xm，否则 XhYm。
 * 阅读统计卡按 mockup 用紧凑英文单位。
 */
export function formatStudyDuration(totalSeconds) {
  const seconds = Math.max(0, Number(totalSeconds) || 0)
  if (seconds < 60) return '0m'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours}h${rest}m` : `${hours}h`
}

/** 日历悬浮/点击明细文案。 */
export function dayDetail(day) {
  if (!day) return '没有记录'
  const minutes = Number(day.minutes) || 0
  const sentences = Number(day.sentences) || 0
  return `${day.date} · 阅读 ${minutes} 分钟 · 处理 ${sentences} 句`
}
