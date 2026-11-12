import fs from 'node:fs'
import { createApp } from './app.js'
import { config } from './config.js'
import { checkpointWal, closeDatabase, openDatabase } from './db/index.js'
import { runStartupCleanup } from './db/maintenance.js'
import { migrate } from './db/migrate.js'
import { initLogger, logger } from './lib/logger.js'

/** @type {import('better-sqlite3').Database | null} */
let db = null
/** @type {import('node:http').Server | null} */
let server = null
/** @type {import('express').Express | null} */
let app = null
let shuttingDown = false
let finished = false
/** @type {NodeJS.Timeout | null} */
let forceTimer = null

/**
 * 完成关闭：记录日志 → 关闭词典连接 → WAL checkpoint → 关闭 DB → 进程退出（04-ENGINEERING §5.1 第 6 步）。
 * @param {string} reason
 * @param {string} how
 * @param {number} exitCode
 */
function finishShutdown(reason, how, exitCode) {
  if (finished) return
  finished = true
  if (forceTimer) clearTimeout(forceTimer)
  forceTimer = null
  logger.info('server', '服务正在退出', { reason, how })
  try {
    app?.locals?.dictionary?.close?.()
  } catch {
    // 词典连接关闭失败不阻塞退出
  }
  if (db) {
    try {
      checkpointWal(db)
    } catch (error) {
      // 退出前 checkpoint 失败不阻塞进程结束
      logger.warn('server', '退出前 WAL checkpoint 失败', {
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }
  logger.info('server', '服务已关闭', { reason })
  closeDatabase(db)
  db = null
  app = null
  process.exitCode = exitCode
  // Windows 上在 server.close 回调里同步 process.exit 偶发 libuv async handle 断言；
  // 正常路径改为让事件循环自然退出（unref 定时器兜底 800ms 强制退出，仍满足 ≤3s）。
  if (how === 'timeout' || how === 'close-error') {
    process.exit(exitCode)
  }
  setTimeout(() => process.exit(exitCode), 800).unref()
}

/**
 * 优雅关闭：停止接收请求（server.close）→ 关闭 DB；超过 3s 硬退出。
 * @param {string} reason
 * @param {number} [exitCode]
 */
function shutdown(reason, exitCode = 0) {
  if (shuttingDown) return
  shuttingDown = true
  logger.info('server', '开始关闭服务', { reason })
  forceTimer = setTimeout(
    () => finishShutdown(reason, 'timeout', exitCode),
    Math.max(500, config.shutdownTimeoutMs - 200)
  )
  if (!server) {
    finishShutdown(reason, 'no-server', exitCode)
    return
  }
  try {
    server.close(() => finishShutdown(reason, 'closed', exitCode))
    if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections()
  } catch (error) {
    logger.warn('server', '关闭 HTTP 服务失败', {
      error: error instanceof Error ? error.message : String(error)
    })
    finishShutdown(reason, 'close-error', exitCode)
  }
}

/**
 * 启动流程：目录 → 打开 DB → 迁移 → 启动清理 → 中间件/路由 → 监听。
 * @returns {void}
 */
function bootstrap() {
  fs.mkdirSync(config.dataDir, { recursive: true })
  fs.mkdirSync(config.logsDir, { recursive: true })
  if (config.invalidPort) {
    logger.warn('server', '端口参数非法，已回退默认端口', {
      invalid: config.invalidPort,
      port: config.port
    })
  }
  logger.info('server', 'ReadLoop 服务启动中', {
    version: config.version,
    port: config.port,
    host: config.host,
    dataDir: config.dataDir,
    dbPath: config.dbPath,
    node: process.version
  })

  db = openDatabase()
  initLogger({ db })
  const migration = migrate(db)
  const cleanup = runStartupCleanup(db)

  app = createApp({
    db,
    config,
    logger,
    onShutdown: (reason) => shutdown(String(reason))
  })

  server = app.listen(config.port, config.host, () => {
    const address = server?.address()
    const actualPort = typeof address === 'object' && address !== null ? address.port : config.port
    app.locals.port = actualPort
    logger.info('server', '服务已就绪', {
      url: `http://${config.host}:${actualPort}`,
      version: config.version,
      migrationApplied: migration.applied,
      cleanup
    })
  })

  server.on('error', (error) => {
    logger.error('server', '服务监听失败', {
      port: config.port,
      code: error.code,
      error: error.message
    })
    shutdown('listen-error', 1)
  })
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('uncaughtException', (error) => {
  logger.error('server', '未捕获异常', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined
  })
  shutdown('uncaughtException', 1)
})
process.on('unhandledRejection', (error) => {
  logger.warn('server', '未处理的 Promise 拒绝', {
    error: error instanceof Error ? error.message : String(error)
  })
})

try {
  bootstrap()
} catch (error) {
  logger.error('server', '服务启动失败', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined
  })
  try {
    app?.locals?.dictionary?.close?.()
  } catch {
    // 启动失败路径下词典连接关闭失败不影响退出
  }
  closeDatabase(db)
  db = null
  app = null
  process.exitCode = 1
  process.exit(1)
}
