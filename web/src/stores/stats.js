/**
 * 阅读台统计 store：阅读概览（指标）+ 活跃日历（按月，懒加载）。
 */

import { computed, reactive } from 'vue'
import { describeError, get } from '../lib/api.js'
import { isFutureMonth, shiftMonth } from '../lib/calendar.js'

const now = new Date()

export const statsStore = reactive({
  overview: null,
  overviewLoading: true,
  overviewError: null,
  calendar: null,
  calendarYear: now.getFullYear(),
  calendarMonth: now.getMonth(),
  calendarLoading: true,
  calendarError: null
})

export const calendarTitle = computed(
  () => `${statsStore.calendarYear} 年 ${statsStore.calendarMonth + 1} 月`
)

export const canGoNextMonth = computed(
  () => !isFutureMonth(statsStore.calendarYear, statsStore.calendarMonth + 1)
)

function normalizeOverview(raw) {
  const data = raw && typeof raw === 'object' ? raw : {}
  return {
    reviewedArticles: Number(data.reviewedArticles) || 0,
    totalSeconds: Number(data.totalSeconds) || 0,
    totalSentences: Number(data.totalSentences) || 0,
    streakDays: Number(data.streakDays) || 0,
    queueCount: Number(data.queueCount) || 0
  }
}

function normalizeCalendar(raw) {
  const data = raw && typeof raw === 'object' ? raw : {}
  const days = Array.isArray(data.days)
    ? data.days
        .filter((day) => day && typeof day.date === 'string')
        .map((day) => ({
          date: day.date,
          score: Number(day.score) || 0,
          level: Math.max(0, Math.min(4, Number(day.level) || 0)),
          minutes: Number(day.minutes) || 0,
          sentences: Number(day.sentences) || 0
        }))
    : []
  return { year: Number(data.year) || statsStore.calendarYear, month: Number(data.month) || statsStore.calendarMonth + 1, days }
}

export async function loadOverview({ silent = false } = {}) {
  if (!silent) statsStore.overviewLoading = true
  statsStore.overviewError = null
  try {
    const data = await get('/api/stats/overview', { timeoutMs: 20000 })
    statsStore.overview = normalizeOverview(data)
  } catch (err) {
    statsStore.overviewError = err
    if (!silent) statsStore.overview = null
  } finally {
    statsStore.overviewLoading = false
  }
}

export async function loadCalendar(year = statsStore.calendarYear, month = statsStore.calendarMonth, { silent = false } = {}) {
  statsStore.calendarYear = year
  statsStore.calendarMonth = month
  if (!silent) statsStore.calendarLoading = true
  statsStore.calendarError = null
  try {
    const data = await get(
      `/api/stats/calendar?year=${year}&month=${month + 1}`,
      { timeoutMs: 20000 }
    )
    const calendar = normalizeCalendar(data)
    // 服务端可能把 year/month 回成另一时区口径，前端以请求参数为准展示
    statsStore.calendar = { ...calendar, year, month: month + 1 }
  } catch (err) {
    statsStore.calendarError = err
    statsStore.calendar = { year, month: month + 1, days: [] }
  } finally {
    statsStore.calendarLoading = false
  }
}

export async function changeCalendarMonth(delta) {
  if (delta > 0 && !canGoNextMonth.value) return
  const next = shiftMonth(statsStore.calendarYear, statsStore.calendarMonth, delta)
  await loadCalendar(next.year, next.month)
}

export function calendarDayMap() {
  const map = {}
  if (statsStore.calendar && Array.isArray(statsStore.calendar.days)) {
    for (const day of statsStore.calendar.days) map[day.date] = day
  }
  return map
}

export async function loadReadingDesk() {
  await Promise.all([loadOverview(), loadCalendar()])
}

export function describeStatsError(err) {
  return describeError(err)
}
