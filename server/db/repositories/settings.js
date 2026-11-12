/**
 * settings 表仓库：key → JSON 文本。只做 SQL 与 JSON 编解码，不参与默认值/业务规则。
 */

/**
 * @param {import('better-sqlite3').Database} db
 */
export function createSettingsRepository(db) {
  const selectAll = db.prepare('SELECT key, value FROM settings ORDER BY key')
  const selectOne = db.prepare('SELECT value FROM settings WHERE key = ?')
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )
  const removeStmt = db.prepare('DELETE FROM settings WHERE key = ?')

  /**
   * 批量写入多个分区（单事务）。
   * @param {Record<string, unknown>} values key → 可 JSON 序列化的值
   * @returns {string[]} 写入的 key 列表
   */
  const setMany = db.transaction((values) => {
    const keys = Object.keys(values)
    for (const key of keys) upsert.run(key, JSON.stringify(values[key]))
    return keys
  })

  return {
    /**
     * 读取全部设置分区；损坏的 JSON 行跳过并记录 key。
     * @returns {{ values: Record<string, unknown>, corruptKeys: string[] }}
     */
    getAll() {
      const values = {}
      const corruptKeys = []
      for (const row of selectAll.all()) {
        try {
          values[row.key] = JSON.parse(row.value)
        } catch {
          corruptKeys.push(row.key)
        }
      }
      return { values, corruptKeys }
    },

    /**
     * 读取单个分区；不存在返回 undefined，JSON 损坏抛 SyntaxError。
     * @param {string} key
     * @returns {unknown}
     */
    get(key) {
      const row = selectOne.get(key)
      if (!row) return undefined
      return JSON.parse(row.value)
    },

    /**
     * 批量写分区（事务内）。
     * @param {Record<string, unknown>} values
     * @returns {string[]}
     */
    setMany(values) {
      return setMany(values)
    },

    /**
     * 删除一个分区。
     * @param {string} key
     * @returns {number} 删除行数
     */
    remove(key) {
      return removeStmt.run(key).changes
    }
  }
}
