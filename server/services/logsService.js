/**
 * 日志读取服务（M5）：设置页「日志」最近 N 条。
 * @param {{ logs: ReturnType<typeof import('../db/repositories/logs.js').createLogsRepository> }} deps
 */
export function createLogsService({ logs }) {
  return {
    /**
     * @param {number} limit
     * @returns {{ id: number, level: string, module: string | null, message: string, createdAt: string }[]}
     */
    recent(limit) {
      return logs.recent(limit)
    }
  }
}

export default createLogsService
