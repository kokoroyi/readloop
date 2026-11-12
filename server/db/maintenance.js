import { logger as defaultLogger } from '../lib/logger.js'
import { nowIso } from '../lib/time.js'

/**
 * 启动清理（04-ENGINEERING §5.1 第 3 步 / 02-DATA-API §7）：
 * 1. 崩溃遗留的 sentence_work.submitting 重置为 pending；
 * 2. ended_at 为空的悬挂阅读会话补 ended_at；
 * 3. WAL checkpoint(TRUNCATE)，避免 WAL 文件无限增长。
 * 两个 UPDATE 在同一事务内；checkpoint 必须在事务外执行。
 * @param {import('better-sqlite3').Database} db
 * @param {{ logger?: typeof defaultLogger, now?: string }} [options]
 * @returns {{ submittingReset: number, sessionsClosed: number, checkpoint: unknown }}
 */
export function runStartupCleanup(db, options = {}) {
  const log = options.logger ?? defaultLogger
  const now = options.now ?? nowIso()

  const counts = db.transaction(() => {
    const submittingReset = db
      .prepare(
        "UPDATE sentence_work SET status = 'pending', updated_at = ? WHERE status = 'submitting'"
      )
      .run(now)
    const sessionsClosed = db
      .prepare('UPDATE reading_sessions SET ended_at = ? WHERE ended_at IS NULL')
      .run(now)
    return {
      submittingReset: submittingReset.changes,
      sessionsClosed: sessionsClosed.changes
    }
  })()

  let checkpoint
  try {
    checkpoint = db.pragma('wal_checkpoint(TRUNCATE)')
  } catch (error) {
    // checkpoint 失败不阻塞启动（数据库仍可用，只是 WAL 未合并）
    log.warn('db', '启动 WAL checkpoint 失败', {
      error: error instanceof Error ? error.message : String(error)
    })
    checkpoint = null
  }

  log.info('db', '启动清理完成', { ...counts, checkpoint })
  return { ...counts, checkpoint }
}
