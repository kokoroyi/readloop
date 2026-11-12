import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { logger as defaultLogger } from '../lib/logger.js'

const SCHEMA_PATH = fileURLToPath(new URL('./schema.sql', import.meta.url))

/** 当前 schema 版本（PRAGMA user_version 从 1 开始，02-DATA-API §7） */
export const SCHEMA_VERSION = 1

let cachedSchemaSql = null

/**
 * 读取 schema.sql（首次读入后缓存）。
 * @returns {string}
 */
function readSchemaSql() {
  if (cachedSchemaSql === null) cachedSchemaSql = fs.readFileSync(SCHEMA_PATH, 'utf8')
  return cachedSchemaSql
}

/**
 * 迁移列表：每项 { version, name, sql }，version 必须从 1 递增且不可修改已发布项。
 * @returns {{ version: number, name: string, sql: string }[]}
 */
export function getMigrations() {
  return [{ version: 1, name: 'initial-schema-v1', sql: readSchemaSql() }]
}

/**
 * 拆分 SQL 文本为独立语句；去掉 `--` 行注释与空语句。
 * schema.sql 里没有字符串内含分号/注释符号的情况，简单拆分即可。
 * @param {string} sql
 * @returns {string[]}
 */
export function splitSqlStatements(sql) {
  const withoutComments = sql
    .split(/\r?\n/)
    .map((line) => {
      const commentAt = line.indexOf('--')
      return commentAt >= 0 ? line.slice(0, commentAt) : line
    })
    .join('\n')
  return withoutComments
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
}

/**
 * @param {string} statement
 * @returns {boolean}
 */
function isPragma(statement) {
  return /^PRAGMA\b/i.test(statement)
}

/**
 * 执行数据库迁移：
 * - PRAGMA 语句在事务外执行（journal_mode 不能在事务中切换）；
 * - CREATE 语句与 user_version 更新在同一事务内，失败自动回滚；
 * - 重复调用幂等（user_version 已是最新时直接返回）。
 * @param {import('better-sqlite3').Database} db
 * @param {{ migrations?: { version: number, name: string, sql: string }[], logger?: typeof defaultLogger }} [options]
 * @returns {{ from: number, to: number, applied: string[] }}
 */
export function migrate(db, options = {}) {
  const log = options.logger ?? defaultLogger
  const migrations = [...(options.migrations ?? getMigrations())].sort(
    (a, b) => a.version - b.version
  )
  const target = migrations.length > 0 ? migrations[migrations.length - 1].version : 0
  const from = Number(db.pragma('user_version', { simple: true }) ?? 0)

  if (from > target) {
    throw new Error(`数据库版本(${from})高于当前程序支持的版本(${target})，请升级程序后再启动`)
  }
  const pending = migrations.filter((migration) => migration.version > from)
  if (pending.length === 0) {
    log.debug('db', '数据库已是最新版本，跳过迁移', { version: from })
    return { from, to: from, applied: [] }
  }

  try {
    for (const migration of pending) {
      for (const statement of splitSqlStatements(migration.sql).filter(isPragma)) {
        db.exec(statement)
      }
    }
    db.transaction(() => {
      for (const migration of pending) {
        for (const statement of splitSqlStatements(migration.sql).filter(
          (item) => !isPragma(item)
        )) {
          db.exec(statement)
        }
        db.pragma(`user_version = ${migration.version}`)
      }
    })()

    const applied = pending.map((migration) => migration.name)
    log.info('db', '数据库迁移完成', { from, to: target, applied })
    return { from, to: target, applied }
  } catch (error) {
    log.error('db', '数据库迁移失败，事务已回滚', {
      from,
      target,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    })
    throw error
  }
}
