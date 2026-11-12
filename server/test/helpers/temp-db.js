import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'

/**
 * 测试脚手架：临时数据目录 + 临时 SQLite + 真实 HTTP 服务（app.listen(0) + fetch）。
 * 所有测试数据都在 os.tmpdir() 下，通过 READLOOP_DATA_DIR 隔离，不触碰真实数据（05-TEST-IMPL-PLAN §1.2）。
 * 注意：必须在创建临时目录之后再 import 服务端模块（config 在首次 import 时读取环境变量），
 * 因此这里统一用动态 import。
 */

/**
 * 创建一份最小 ECDICT fixture（stardict 表 + 少量词条），供词典/词库集成测试使用。
 * 词典服务只读打开 config.dictPath，因此测试数据目录里放这个文件即可完全离线。
 * @param {string} dictPath
 * @returns {void}
 */
export function createDictFixture(dictPath) {
  fs.mkdirSync(path.dirname(dictPath), { recursive: true })
  const db = new Database(dictPath)
  try {
    db.exec(`
      CREATE TABLE stardict (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        word TEXT NOT NULL UNIQUE,
        sw TEXT,
        phonetic TEXT,
        definition TEXT,
        translation TEXT,
        pos TEXT,
        collins INTEGER,
        oxford INTEGER,
        tag TEXT,
        bnc INTEGER,
        frq INTEGER,
        exchange TEXT,
        detail TEXT,
        audio TEXT
      )
    `)
    const insert = db.prepare(`
      INSERT INTO stardict (word, sw, phonetic, definition, translation, pos, collins, oxford, tag, bnc, frq, exchange, detail, audio)
      VALUES (@word, @word, @phonetic, NULL, @translation, @pos, @collins, NULL, @tag, @bnc, @frq, @exchange, NULL, NULL)
    `)
    const rows = [
      {
        word: 'go',
        phonetic: 'ɡəʊ',
        translation: 'vi. 去, 走, 达到, 运转\nvt. 以...打赌',
        pos: 'v:100',
        collins: 5,
        tag: 'zk gk',
        bnc: 44,
        frq: 35,
        exchange: 'i:going/p:went/d:gone/3:goes/s:goes'
      },
      {
        word: 'went',
        phonetic: '',
        translation: 'go的过去式',
        pos: '',
        collins: null,
        tag: '',
        bnc: 0,
        frq: 0,
        exchange: '0:go/1:p'
      },
      {
        word: 'do',
        phonetic: 'duː',
        translation: 'vt. 做, 干',
        pos: 'v:100',
        collins: 5,
        tag: 'zk gk',
        bnc: 10,
        frq: 12,
        exchange: 'i:doing/p:did/d:done/3:does/s:dos'
      },
      {
        word: 'did',
        phonetic: '',
        translation: 'do的过去式',
        pos: '',
        collins: null,
        tag: '',
        bnc: 0,
        frq: 0,
        exchange: '1:p/0:do/s:dids'
      },
      {
        word: 'study',
        phonetic: 'ˈstʌdi',
        translation: 'n. 学习；研究\nvt. 学习；考虑',
        pos: 'n:50/v:50',
        collins: 5,
        tag: 'zk gk',
        bnc: 500,
        frq: 480,
        exchange: 'i:studying/p:studied/d:studied/3:studies/s:studies'
      },
      {
        word: 'studies',
        phonetic: '',
        translation: 'study 的复数/第三人称单数',
        pos: '',
        collins: null,
        tag: 'ielts',
        bnc: 0,
        frq: 0,
        exchange: '0:study/1:s3'
      },
      {
        word: 'library',
        phonetic: 'ˈɪntrəstɪŋ',
        translation: 'a. 有趣的',
        pos: 'j:100',
        collins: 3,
        tag: 'zk gk',
        bnc: 1032,
        frq: 1072,
        exchange: '0:interest/1:i'
      },
      {
        word: 'quiet-looking',
        phonetic: '',
        translation: 'a. 看上去有趣的',
        pos: 'j:100',
        collins: null,
        tag: '',
        bnc: 0,
        frq: 0,
        exchange: ''
      },
      {
        word: 'interest',
        phonetic: 'ˈɪntrəst',
        translation: 'n. 兴趣；利息\nvt. 使感兴趣',
        pos: 'n:70/v:30',
        collins: 5,
        tag: 'zk gk',
        bnc: 600,
        frq: 500,
        exchange: 'i:quiet/p:quietly/d:quietly/3:interests/s:interests'
      },
      {
        word: 'walk',
        phonetic: 'wɔːk',
        translation: 'vi. 走, 步行\nn. 散步',
        pos: 'v:80/n:20',
        collins: 5,
        tag: 'zk gk',
        bnc: 700,
        frq: 690,
        exchange: 'i:walking/p:walked/d:walked/3:walks/s:walks'
      },
      {
        word: 'the',
        phonetic: 'ðə',
        translation: 'art. 那',
        pos: 'a:100',
        collins: 5,
        tag: 'zk gk',
        bnc: 1,
        frq: 1,
        exchange: ''
      },
      {
        word: 'better',
        phonetic: 'ˈbetə',
        translation: 'a. 较好的\nadv. 比较好',
        pos: 'r:47/j:51',
        collins: 5,
        tag: 'gk',
        bnc: 704,
        frq: 452,
        exchange: '0:good/1:r'
      },
      {
        word: 'good',
        phonetic: 'ɡʊd',
        translation: 'a. 好的, 优良的\nn. 好处',
        pos: 'j:100',
        collins: 5,
        tag: 'zk gk',
        bnc: 30,
        frq: 40,
        exchange: 'r:better/t:best'
      }
    ]
    for (const row of rows) insert.run(row)
  } finally {
    db.close()
  }
}

/**
 * 创建临时数据目录并设置 READLOOP_DATA_DIR。
 * @returns {{ dataDir: string, cleanup: () => void }}
 */
export function createTempEnv() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'readloop-test-'))
  process.env.READLOOP_DATA_DIR = dataDir
  return {
    dataDir,
    cleanup() {
      try {
        fs.rmSync(dataDir, { recursive: true, force: true })
      } catch {
        // Windows 上偶发文件占用，测试结束清理失败不视为用例失败
      }
    }
  }
}

/**
 * 动态加载服务端模块（此时 config 已能读到临时环境变量）。
 * @returns {Promise<Record<string, unknown>>}
 */
async function loadServerModules() {
  const [configModule, dbModule, migrateModule, maintenanceModule, loggerModule, appModule] =
    await Promise.all([
      import('../../config.js'),
      import('../../db/index.js'),
      import('../../db/migrate.js'),
      import('../../db/maintenance.js'),
      import('../../lib/logger.js'),
      import('../../app.js')
    ])
  return {
    config: configModule.config,
    openDatabase: dbModule.openDatabase,
    closeDatabase: dbModule.closeDatabase,
    isDatabaseHealthy: dbModule.isDatabaseHealthy,
    migrate: migrateModule.migrate,
    runStartupCleanup: maintenanceModule.runStartupCleanup,
    initLogger: loggerModule.initLogger,
    logger: loggerModule.logger,
    createApp: appModule.createApp
  }
}

/**
 * 基于临时目录构造一份隔离的 appConfig（config 模块只初始化一次，路径必须按 env 覆盖）。
 * @param {Record<string, unknown>} baseConfig
 * @param {string} dataDir
 * @returns {Record<string, unknown>}
 */
function buildAppConfig(baseConfig, dataDir) {
  const logsDir = path.join(dataDir, 'logs')
  return {
    ...baseConfig,
    dataDir,
    dbPath: path.join(dataDir, 'readloop.db'),
    logsDir,
    logFile: path.join(logsDir, 'server.log'),
    dictPath: path.join(dataDir, 'stardict.db'),
    // 静态目录也放到临时数据目录，避免测试读到真实 server/public 构建产物
    publicDir: path.join(dataDir, 'public'),
    indexHtmlPath: path.join(dataDir, 'public', 'index.html')
  }
}

/**
 * 关闭 HTTP 服务（先关空闲连接，避免 fetch keep-alive 让 close 挂起）。
 * @param {import('node:http').Server | null} server
 * @returns {Promise<void>}
 */
export function closeServer(server) {
  return new Promise((resolve) => {
    if (!server || !server.listening) {
      resolve()
      return
    }
    server.close(() => resolve())
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections()
  })
}

/**
 * 打开一个迁移好的临时数据库（供 schema/migrate/清理类集成测试使用）。
 * @param {{ migrateNow?: boolean }} [options]
 * @returns {Promise<object>}
 */
export async function openTempDatabase(options = {}) {
  const env = createTempEnv()
  const modules = await loadServerModules()
  const appConfig = buildAppConfig(modules.config, env.dataDir)
  fs.mkdirSync(appConfig.logsDir, { recursive: true })
  const db = modules.openDatabase({ dbPath: appConfig.dbPath })
  modules.initLogger({ db, logDir: appConfig.logsDir })
  if (options.migrateNow === true) modules.migrate(db)
  return {
    env,
    db,
    config: appConfig,
    modules,
    close() {
      modules.initLogger({ db: null })
      modules.closeDatabase(db)
      env.cleanup()
    }
  }
}

/**
 * 启动一个真实监听随机端口的测试服务。
 * @param {{
 *   onShutdown?: (reason: string) => void,
 *   setup?: (context: { env: { dataDir: string }, config: Record<string, unknown> }) => Promise<{ config?: Record<string, unknown> } | void> | { config?: Record<string, unknown> } | void
 * }} [options]
 * @returns {Promise<object>}
 */
export async function startTestApp(options = {}) {
  const env = createTempEnv()
  const modules = await loadServerModules()
  let appConfig = buildAppConfig(modules.config, env.dataDir)
  fs.mkdirSync(appConfig.logsDir, { recursive: true })

  if (typeof options.setup === 'function') {
    const extra = await options.setup({ env, config: appConfig })
    if (extra && extra.config) appConfig = { ...appConfig, ...extra.config }
  }

  const db = modules.openDatabase({ dbPath: appConfig.dbPath })
  modules.initLogger({ db, logDir: appConfig.logsDir })
  const migration = modules.migrate(db)
  const cleanup = modules.runStartupCleanup(db)
  const app = modules.createApp({
    ...(options.appOptions ?? {}),
    db,
    config: appConfig,
    logger: modules.logger,
    onShutdown: options.onShutdown
  })

  const server = await new Promise((resolve, reject) => {
    const httpServer = app.listen(0, '127.0.0.1', () => resolve(httpServer))
    httpServer.on('error', reject)
  })
  const address = server.address()
  app.locals.port = address.port
  const baseUrl = `http://127.0.0.1:${address.port}`

  return {
    env,
    db,
    app,
    server,
    baseUrl,
    config: appConfig,
    migration,
    cleanup,
    modules,
    /**
     * 发一个 JSON 请求并解析响应。
     * @param {string} method
     * @param {string} pathname
     * @param {unknown} [body]
     * @param {Record<string, string>} [headers]
     * @returns {Promise<{ status: number, headers: Headers, text: string, json: any }>}
     */
    async request(method, pathname, body, headers = {}) {
      /** @type {RequestInit} */
      const init = { method, headers: { ...headers } }
      if (body !== undefined) {
        init.headers = { ...init.headers, 'Content-Type': 'application/json' }
        init.body = JSON.stringify(body)
      }
      const response = await fetch(`${baseUrl}${pathname}`, init)
      const text = await response.text()
      let json
      try {
        json = text.length > 0 ? JSON.parse(text) : undefined
      } catch {
        // 非 JSON 响应（静态/纯文本 404）不解析
        json = undefined
      }
      return { status: response.status, headers: response.headers, text, json }
    },
    async close() {
      try {
        app?.locals?.dictionary?.close?.()
      } catch {
        // 词典连接关闭失败不影响测试清理
      }
      await closeServer(server)
      modules.initLogger({ db: null })
      modules.closeDatabase(db)
      env.cleanup()
    }
  }
}
