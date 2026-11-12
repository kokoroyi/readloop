/**
 * stats 聚合仓库：只做只读聚合 SQL（权重/色阶/streak 在 statsService 单点计算）。
 * 时间按本地时区聚合（SQLite date(x,'localtime')，02-DATA-API §5）。
 */

/**
 * @param {import('better-sqlite3').Database} db
 */
export function createStatsRepository(db) {
  const reviewedArticlesStmt = db.prepare(
    "SELECT COUNT(*) AS c FROM articles WHERE status = 'done'"
  )
  const queueCountStmt = db.prepare("SELECT COUNT(*) AS c FROM articles WHERE status = 'queued'")
  const totalSecondsStmt = db.prepare(
    'SELECT COALESCE(SUM(active_seconds), 0) AS total FROM reading_sessions WHERE active_seconds >= 30'
  )
  const totalSentencesStmt = db.prepare(
    "SELECT COUNT(*) AS c FROM sentence_work WHERE status IN ('corrected', 'skipped')"
  )
  const activityDatesStmt = db.prepare(`
    SELECT DISTINCT date(started_at, 'localtime') AS date
    FROM reading_sessions
    WHERE active_seconds >= 30
    ORDER BY date DESC
    LIMIT 400
  `)
  const dailySecondsStmt = db.prepare(`
    SELECT date(started_at, 'localtime') AS date, SUM(active_seconds) AS seconds
    FROM reading_sessions
    WHERE active_seconds >= 30
      AND date(started_at, 'localtime') BETWEEN ? AND ?
    GROUP BY date
  `)
  const dailySentencesStmt = db.prepare(`
    SELECT date(COALESCE(corrected_at, updated_at), 'localtime') AS date, COUNT(*) AS sentences
    FROM sentence_work
    WHERE status IN ('corrected', 'skipped')
      AND date(COALESCE(corrected_at, updated_at), 'localtime') BETWEEN ? AND ?
    GROUP BY date
  `)
  const dailyCompletedStmt = db.prepare(`
    SELECT date(completed_at, 'localtime') AS date, COUNT(*) AS articles
    FROM articles
    WHERE status = 'done' AND completed_at IS NOT NULL
      AND date(completed_at, 'localtime') BETWEEN ? AND ?
    GROUP BY date
  `)

  return {
    /**
     * 阅读台四项指标（不含 streak，streak 需日期集合在 service 计算）。
     * @returns {{ reviewedArticles: number, queueCount: number, totalSeconds: number, totalSentences: number }}
     */
    overview() {
      return {
        reviewedArticles: Number(reviewedArticlesStmt.get().c),
        queueCount: Number(queueCountStmt.get().c),
        totalSeconds: Number(totalSecondsStmt.get().total),
        totalSentences: Number(totalSentencesStmt.get().c)
      }
    },

    /**
     * 有有效阅读会话的本地日期（倒序，最多 400 天，够 streak 用）。
     * @returns {string[]}
     */
    activityDates() {
      return activityDatesStmt.all().map((row) => row.date)
    },

    /**
     * 区间内每日有效阅读秒数。
     * @param {string} startDate YYYY-MM-DD（本地）
     * @param {string} endDate YYYY-MM-DD（本地）
     * @returns {{ date: string, seconds: number }[]}
     */
    dailySeconds(startDate, endDate) {
      return dailySecondsStmt.all(startDate, endDate).map((row) => ({
        date: row.date,
        seconds: Number(row.seconds ?? 0)
      }))
    },

    /**
     * 区间内每日已处理句数（corrected + skipped）。
     * @param {string} startDate
     * @param {string} endDate
     * @returns {{ date: string, sentences: number }[]}
     */
    dailySentences(startDate, endDate) {
      return dailySentencesStmt.all(startDate, endDate).map((row) => ({
        date: row.date,
        sentences: Number(row.sentences ?? 0)
      }))
    },

    /**
     * 区间内每日完成文章数（status=done）。
     * @param {string} startDate
     * @param {string} endDate
     * @returns {{ date: string, articles: number }[]}
     */
    dailyCompletedArticles(startDate, endDate) {
      return dailyCompletedStmt.all(startDate, endDate).map((row) => ({
        date: row.date,
        articles: Number(row.articles ?? 0)
      }))
    }
  }
}
