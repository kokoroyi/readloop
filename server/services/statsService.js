import { localDateKey } from '../lib/time.js'

/**
 * 统计服务（M5）：口径与权重集中在单点（02-DATA-API §5）。
 * 仓库层只做本地时区聚合 SQL；score/level/streak 在这里计算，便于测试与单点修改。
 */

/** 有效阅读会话阈值（秒）：<30s 不计入累计时长/日历/连续天数（02 §5） */
export const MIN_VALID_SESSION_SECONDS = 30
/** 日历 score 权重（单点修改） */
export const SCORE_WEIGHTS = { minute: 1, sentence: 0.5, article: 5 }
/** 色阶边界（5 档 0–4）：score=0→0；(0,5)→1；[5,15)→2；[15,35)→3；≥35→4（≥70 仍封顶 4） */
export const LEVEL_THRESHOLDS = [5, 15, 35, 70]
/** level 上限（0–4 共 5 档） */
export const MAX_LEVEL = 4

/**
 * @param {number} value
 * @returns {number}
 */
function round1(value) {
  return Math.round(value * 10) / 10
}

/**
 * 日期键（YYYY-MM-DD）加减天数，使用本地中午避免夏令时/零点边界问题。
 * @param {string} dateKey
 * @param {number} days
 * @returns {string}
 */
function shiftDateKey(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(year, month - 1, day, 12, 0, 0, 0)
  date.setDate(date.getDate() + days)
  return localDateKey(date)
}

/**
 * 天 → 色阶（0–4）。score 为 0 → 0；否则按 5/15/35/70 递增，封顶 4。
 * @param {number} score
 * @returns {number}
 */
export function computeCalendarLevel(score) {
  const value = Number(score)
  if (!Number.isFinite(value) || value <= 0) return 0
  let level = 1
  for (const threshold of LEVEL_THRESHOLDS) {
    if (value >= threshold) level += 1
  }
  return Math.min(MAX_LEVEL, level)
}

/**
 * 连续阅读天数（02 §5 决定：今天无记录则从昨天起算；某天无记录即中断）。
 * @param {string[]} activeDates 有有效阅读会话的本地日期键
 * @param {string} todayKey 今天本地日期键
 * @returns {number}
 */
export function computeStreak(activeDates, todayKey) {
  const active = new Set(Array.isArray(activeDates) ? activeDates : [])
  let cursor = todayKey
  if (!active.has(cursor)) cursor = shiftDateKey(cursor, -1)
  let streak = 0
  while (active.has(cursor)) {
    streak += 1
    cursor = shiftDateKey(cursor, -1)
  }
  return streak
}

/**
 * 构造日历 days（只返回有活动的日期，按日期升序）。
 * @param {{
 *   sessions: { date: string, seconds: number }[],
 *   sentences: { date: string, sentences: number }[],
 *   completed: { date: string, articles: number }[]
 * }} input
 * @returns {{ date: string, score: number, level: number, minutes: number, sentences: number }[]}
 */
export function buildCalendarDays({ sessions, sentences, completed }) {
  /** @type {Map<string, { seconds: number, sentences: number, articles: number }>} */
  const dayMap = new Map()
  /**
   * @param {string} date
   */
  const ensure = (date) => {
    let day = dayMap.get(date)
    if (!day) {
      day = { seconds: 0, sentences: 0, articles: 0 }
      dayMap.set(date, day)
    }
    return day
  }
  for (const row of sessions ?? []) ensure(row.date).seconds += Number(row.seconds) || 0
  for (const row of sentences ?? []) ensure(row.date).sentences += Number(row.sentences) || 0
  for (const row of completed ?? []) ensure(row.date).articles += Number(row.articles) || 0
  return [...dayMap.entries()]
    .filter(([, day]) => day.seconds > 0 || day.sentences > 0 || day.articles > 0)
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([date, day]) => {
      const score = round1(
        (day.seconds / 60) * SCORE_WEIGHTS.minute +
          day.sentences * SCORE_WEIGHTS.sentence +
          day.articles * SCORE_WEIGHTS.article
      )
      return {
        date,
        score,
        level: computeCalendarLevel(score),
        minutes: Math.round(day.seconds / 60),
        sentences: day.sentences
      }
    })
}

/**
 * 解析年份/月份参数为本地日期区间（month 省略 → 全年）。
 * @param {{ year?: number, month?: number }} [input]
 * @returns {{ year: number, month: number | null, startDate: string, endDate: string }}
 */
export function resolveCalendarRange(input = {}) {
  const now = new Date()
  const year = Number.isInteger(input.year) ? input.year : now.getFullYear()
  if (!Number.isInteger(input.month)) {
    return { year, month: null, startDate: `${year}-01-01`, endDate: `${year}-12-31` }
  }
  const month = input.month
  const lastDay = new Date(year, month, 0).getDate()
  const mm = String(month).padStart(2, '0')
  return {
    year,
    month,
    startDate: `${year}-${mm}-01`,
    endDate: `${year}-${mm}-${String(lastDay).padStart(2, '0')}`
  }
}

/**
 * @param {{
 *   stats: ReturnType<typeof import('../db/repositories/stats.js').createStatsRepository>,
 *   logger?: { info: (module: string, message: string, detail?: unknown) => void }
 * }} deps
 */
export function createStatsService({ stats, logger }) {
  return {
    /**
     * GET /api/stats/overview
     * @returns {{ reviewedArticles: number, totalSeconds: number, totalSentences: number, streakDays: number, queueCount: number }}
     */
    overview() {
      const base = stats.overview()
      const streakDays = computeStreak(stats.activityDates(), localDateKey(new Date()))
      return {
        reviewedArticles: base.reviewedArticles,
        totalSeconds: base.totalSeconds,
        totalSentences: base.totalSentences,
        streakDays,
        queueCount: base.queueCount
      }
    },

    /**
     * GET /api/stats/calendar
     * @param {{ year?: number, month?: number }} [query]
     * @returns {{ year: number, month: number | null, days: object[] }}
     */
    calendar(query = {}) {
      const range = resolveCalendarRange(query)
      const days = buildCalendarDays({
        sessions: stats.dailySeconds(range.startDate, range.endDate),
        sentences: stats.dailySentences(range.startDate, range.endDate),
        completed: stats.dailyCompletedArticles(range.startDate, range.endDate)
      })
      logger?.info('stats', '日历聚合完成', {
        year: range.year,
        month: range.month,
        days: days.length
      })
      return { year: range.year, month: range.month, days }
    }
  }
}

export default createStatsService
