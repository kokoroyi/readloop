import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  SCORE_WEIGHTS,
  buildCalendarDays,
  computeCalendarLevel,
  computeStreak,
  resolveCalendarRange
} from '../../services/statsService.js'

describe('statsService 纯函数（STAT-05/06 口径）', () => {
  it('色阶 0–4：0/(0,5)/[5,15)/[15,35)/[35,70)/≥70', () => {
    assert.equal(computeCalendarLevel(0), 0)
    assert.equal(computeCalendarLevel(0.1), 1)
    assert.equal(computeCalendarLevel(4.9), 1)
    assert.equal(computeCalendarLevel(5), 2)
    assert.equal(computeCalendarLevel(14.9), 2)
    assert.equal(computeCalendarLevel(15), 3)
    assert.equal(computeCalendarLevel(34.9), 3)
    assert.equal(computeCalendarLevel(35), 4)
    assert.equal(computeCalendarLevel(69.9), 4)
    assert.equal(computeCalendarLevel(70), 4)
    assert.equal(computeCalendarLevel(999), 4)
    assert.equal(computeCalendarLevel(-1), 0)
    assert.equal(computeCalendarLevel(Number.NaN), 0)
  })

  it('连续天数：今天有记录 / 今天无则从昨天 / 中断 / 空 / 跨月跨年', () => {
    // 今天及前两天都有 → 3
    assert.equal(computeStreak(['2026-03-01', '2026-02-28', '2026-02-27'], '2026-03-01'), 3)
    // 今天无记录，从昨天起算 → 3
    assert.equal(computeStreak(['2026-03-01', '2026-02-28', '2026-02-27'], '2026-03-02'), 3)
    // 断一天 → 1
    assert.equal(computeStreak(['2026-03-02', '2026-02-28'], '2026-03-02'), 1)
    // 无数据
    assert.equal(computeStreak([], '2026-03-02'), 0)
    // 跨年
    assert.equal(computeStreak(['2026-01-01', '2025-12-31'], '2026-01-01'), 2)
  })

  it('日历区间：month 省略整年；2 月闰年最后一天正确', () => {
    const yearOnly = resolveCalendarRange({ year: 2025 })
    assert.equal(yearOnly.month, null)
    assert.equal(yearOnly.startDate, '2025-01-01')
    assert.equal(yearOnly.endDate, '2025-12-31')
    assert.deepEqual(resolveCalendarRange({ year: 2024, month: 2 }), {
      year: 2024,
      month: 2,
      startDate: '2024-02-01',
      endDate: '2024-02-29'
    })
    assert.equal(resolveCalendarRange({ year: 2025, month: 2 }).endDate, '2025-02-28')
    const current = resolveCalendarRange()
    assert.equal(current.year, new Date().getFullYear())
    assert.equal(current.month, null)
  })

  it('buildCalendarDays：合并会话/句数/完成文章，score 与 level 正确且只含有活动的天', () => {
    const days = buildCalendarDays({
      sessions: [
        { date: '2026-01-02', seconds: 600 },
        { date: '2026-01-01', seconds: 240 }
      ],
      sentences: [{ date: '2026-01-02', sentences: 2 }],
      completed: [{ date: '2026-01-03', articles: 1 }]
    })
    assert.equal(days.length, 3)
    assert.deepEqual(days[0], {
      date: '2026-01-01',
      score: 4,
      level: 1,
      minutes: 4,
      sentences: 0
    })
    assert.deepEqual(days[1], {
      date: '2026-01-02',
      score: 11,
      level: 2,
      minutes: 10,
      sentences: 2
    })
    assert.deepEqual(days[2], {
      date: '2026-01-03',
      score: 5,
      level: 2,
      minutes: 0,
      sentences: 0
    })
    assert.deepEqual(buildCalendarDays({ sessions: [], sentences: [], completed: [] }), [])
  })

  it('权重集中：明确导出 SCORE_WEIGHTS（分钟 1 / 句 0.5 / 完成文章 5）', () => {
    assert.deepEqual(SCORE_WEIGHTS, { minute: 1, sentence: 0.5, article: 5 })
  })
})
