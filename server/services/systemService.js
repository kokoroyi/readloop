import fs from 'node:fs'
import path from 'node:path'
import { isFileReadable } from '../lib/fileCheck.js'
import { localDateKey } from '../lib/time.js'

/**
 * 系统服务（M5）：系统信息 / 数据库备份 / 清空学习数据（保留 settings）。
 * 备份前先 wal_checkpoint(TRUNCATE)，再复制主库文件；保留最近 5 份。
 */

const BACKUP_FILE_PATTERN = /^readloop-\d{8}-\d{6}\.db$/
const MAX_BACKUPS = 5

/**
 * 本地时间戳（YYYYMMDD-HHmmss），用于备份文件名。
 * @param {Date} [date]
 * @returns {string}
 */
export function backupTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  )
}

/**
 * @param {{
 *   db: import('better-sqlite3').Database,
 *   config: import('../config.js').config,
 *   system: ReturnType<typeof import('../db/repositories/system.js').createSystemRepository>,
 *   logger?: { info: (module: string, message: string, detail?: unknown) => void }
 * }} deps
 */
export function createSystemService({ db, config, system, logger }) {
  return {
    /**
     * GET /api/system/info
     * @param {number} [port]
     * @returns {object}
     */
    info(port) {
      let dbSizeBytes = 0
      try {
        dbSizeBytes = Number(fs.statSync(config.dbPath).size)
      } catch {
        dbSizeBytes = 0
      }
      const monthPrefix = localDateKey(new Date()).slice(0, 7)
      return {
        version: config.version,
        port: Number(port) || config.port,
        dataDir: config.dataDir,
        dbPath: config.dbPath,
        dictPath: config.dictPath,
        dictOk: isFileReadable(config.dictPath),
        dbSizeBytes,
        counts: system.counts(),
        aiUsageThisMonth: system.aiUsageThisMonth(monthPrefix)
      }
    },

    /**
     * POST /api/system/backup：checkpoint 后复制数据库，保留最近 5 份。
     * @returns {{ path: string, sizeBytes: number, deletedOld: number }}
     */
    backup() {
      db.pragma('wal_checkpoint(TRUNCATE)')
      const backupsDir = path.join(config.dataDir, 'backups')
      fs.mkdirSync(backupsDir, { recursive: true })
      const filename = `readloop-${backupTimestamp()}.db`
      const targetPath = path.resolve(backupsDir, filename)
      fs.copyFileSync(config.dbPath, targetPath)
      const sizeBytes = Number(fs.statSync(targetPath).size)

      const backups = fs
        .readdirSync(backupsDir)
        .filter((name) => BACKUP_FILE_PATTERN.test(name))
        .sort()
        .reverse()
      let deletedOld = 0
      for (const stale of backups.slice(MAX_BACKUPS)) {
        try {
          fs.unlinkSync(path.join(backupsDir, stale))
          deletedOld += 1
        } catch {
          // 删除旧备份失败不影响本次备份结果
        }
      }
      logger?.info('system', '数据库备份完成', { path: targetPath, sizeBytes, deletedOld })
      return { path: targetPath, sizeBytes, deletedOld }
    },

    /**
     * POST /api/system/clear-data：单事务清空学习数据，保留 settings。
     * @param {{ keepWords: boolean }} options
     * @returns {{ keptWords: boolean, removed: object }}
     */
    clearData({ keepWords }) {
      const keptWords = keepWords !== false
      const removed = system.clearLearningData({ keepWords: keptWords })
      logger?.info('system', '清空学习数据', { keptWords, removed })
      return { keptWords, removed }
    }
  }
}

export default createSystemService
