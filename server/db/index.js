import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { config } from '../config.js'

/** 连接级 PRAGMA（journal_mode 与 foreign_keys 同时写在 schema.sql，迁移前由这里先打开） */
const CONNECTION_PRAGMAS = [
  ['journal_mode', 'WAL'],
  ['foreign_keys', 'ON'],
  ['busy_timeout', 5000],
  ['synchronous', 'NORMAL']
]

/**
 * 打开 SQLite 数据库（默认 <dataDir>\readloop.db），自动建目录并应用 WAL/外键/busy_timeout。
 * @param {{ dbPath?: string }} [options]
 * @returns {import('better-sqlite3').Database}
 */
export function openDatabase(options = {}) {
  const dbPath = options.dbPath ?? config.dbPath
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const db = new Database(dbPath)
  for (const [name, value] of CONNECTION_PRAGMAS) {
    db.pragma(`${name} = ${value}`)
  }
  return db
}

/**
 * 关闭数据库连接（已关闭或空值安全返回）。
 * @param {import('better-sqlite3').Database | null | undefined} db
 * @returns {boolean} 是否真正关闭了一个连接
 */
export function closeDatabase(db) {
  if (!db || db.open === false) return false
  try {
    db.close()
    return true
  } catch {
    // 关闭失败（例如连接已被误用关闭）不影响进程退出
    return false
  }
}

/**
 * 执行 WAL checkpoint(TRUNCATE)，备份/退出前调用，保证 db 文件自包含。
 * @param {import('better-sqlite3').Database} db
 * @returns {unknown} better-sqlite3 返回的 pragma 结果
 */
export function checkpointWal(db) {
  return db.pragma('wal_checkpoint(TRUNCATE)')
}

/**
 * 健康检查用的轻量探测：只执行 SELECT 1，不遍历表。
 * @param {import('better-sqlite3').Database} db
 * @returns {boolean}
 */
export function isDatabaseHealthy(db) {
  try {
    db.prepare('SELECT 1 AS ok').get()
    return true
  } catch {
    // 数据库不可用时由 /api/health 返回 db:false
    return false
  }
}
