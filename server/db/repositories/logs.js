/**
 * logs 仓库：最近日志读取（设置页「关于/日志」）。
 */

/**
 * @param {import('better-sqlite3').Database} db
 */
export function createLogsRepository(db) {
  const recentStmt = db.prepare(
    'SELECT id, level, module, message, created_at FROM logs ORDER BY id DESC LIMIT ?'
  )

  return {
    /**
     * @param {number} limit
     * @returns {{ id: number, level: string, module: string | null, message: string, createdAt: string }[]}
     */
    recent(limit) {
      return recentStmt.all(limit).map((row) => ({
        id: row.id,
        level: row.level,
        module: row.module,
        message: row.message,
        createdAt: row.created_at
      }))
    }
  }
}
