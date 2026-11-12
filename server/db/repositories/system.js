/**
 * system 仓库：系统信息计数、本月 AI 用量、清空学习数据（事务）。
 */

/**
 * @param {import('better-sqlite3').Database} db
 */
export function createSystemRepository(db) {
  const countsStmt = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM articles) AS articles,
      (SELECT COUNT(*) FROM articles WHERE status = 'done') AS doneArticles,
      (SELECT COUNT(*) FROM words) AS words,
      (SELECT COUNT(*) FROM ai_calls) AS aiCalls
  `)
  const aiUsageStmt = db.prepare(`
    SELECT COUNT(*) AS calls,
      COALESCE(SUM(input_tokens), 0) AS inputTokens,
      COALESCE(SUM(output_tokens), 0) AS outputTokens
    FROM ai_calls
    WHERE strftime('%Y-%m', created_at, 'localtime') = ?
  `)

  const clearLearningData = db.transaction((options) => {
    const removed = {
      articles: db.prepare('SELECT COUNT(*) AS c FROM articles').get().c,
      sentences: db.prepare('SELECT COUNT(*) AS c FROM sentences').get().c,
      sentenceWork: db.prepare('SELECT COUNT(*) AS c FROM sentence_work').get().c,
      sentenceChats: db.prepare('SELECT COUNT(*) AS c FROM sentence_chats').get().c,
      recapSessions: db.prepare('SELECT COUNT(*) AS c FROM recap_sessions').get().c,
      summaries: db.prepare('SELECT COUNT(*) AS c FROM summaries').get().c,
      readingSessions: db.prepare('SELECT COUNT(*) AS c FROM reading_sessions').get().c,
      aiCalls: db.prepare('SELECT COUNT(*) AS c FROM ai_calls').get().c,
      logs: db.prepare('SELECT COUNT(*) AS c FROM logs').get().c,
      words: 0
    }
    // articles 级联删除 sentences/sentence_work/sentence_chats/recap_sessions/summaries；
    // words.source_article_id 由 FK ON DELETE SET NULL 保留词条。
    db.prepare('DELETE FROM articles').run()
    db.prepare('DELETE FROM reading_sessions').run()
    db.prepare('DELETE FROM ai_calls').run()
    db.prepare('DELETE FROM logs').run()
    if (options.keepWords !== true) {
      removed.words = db.prepare('SELECT COUNT(*) AS c FROM words').get().c
      db.prepare('DELETE FROM words').run()
    }
    return removed
  })

  return {
    /**
     * @returns {{ articles: number, doneArticles: number, words: number, aiCalls: number }}
     */
    counts() {
      const row = countsStmt.get()
      return {
        articles: Number(row.articles),
        doneArticles: Number(row.doneArticles),
        words: Number(row.words),
        aiCalls: Number(row.aiCalls)
      }
    },

    /**
     * 本月（本地时区 YYYY-MM）AI 用量。
     * @param {string} localMonthPrefix
     * @returns {{ calls: number, inputTokens: number, outputTokens: number }}
     */
    aiUsageThisMonth(localMonthPrefix) {
      const row = aiUsageStmt.get(localMonthPrefix)
      return {
        calls: Number(row.calls),
        inputTokens: Number(row.inputTokens),
        outputTokens: Number(row.outputTokens)
      }
    },

    /**
     * 清空学习数据（单事务，保留 settings）。
     * @param {{ keepWords: boolean }} options
     * @returns {{ articles: number, readingSessions: number, aiCalls: number, logs: number, words: number }}
     */
    clearLearningData(options) {
      return clearLearningData(options)
    }
  }
}
