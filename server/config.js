import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** 服务所在目录（D:\ReadLoop\server） */
const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url))
/** 项目根目录（D:\ReadLoop） */
const ROOT_DIR = path.dirname(SERVER_DIR)

export const DEFAULT_PORT = 5178
export const DEFAULT_HOST = '127.0.0.1'
export const FALLBACK_VERSION = '0.1.0'

/**
 * 读取项目版本号：优先根目录 package.json，读取失败回退常量 0.1.0。
 * @returns {string}
 */
function readVersion() {
  try {
    const raw = fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8')
    const pkg = JSON.parse(raw)
    return typeof pkg.version === 'string' && pkg.version.length > 0
      ? pkg.version
      : FALLBACK_VERSION
  } catch {
    // package.json 缺失或损坏时不能让服务起不来，回退硬编码版本
    return FALLBACK_VERSION
  }
}

/**
 * 解析数据目录：READLOOP_DATA_DIR 优先，其次 %APPDATA%\readloop。
 * @param {NodeJS.ProcessEnv} env
 * @returns {string} 绝对路径
 */
function resolveDataDir(env) {
  const override = env.READLOOP_DATA_DIR
  if (typeof override === 'string' && override.trim().length > 0)
    return path.resolve(override.trim())
  if (env.APPDATA) return path.join(env.APPDATA, 'readloop')
  if (env.LOCALAPPDATA) return path.join(env.LOCALAPPDATA, 'readloop')
  // 非 Windows 兜底（项目目标平台是 Windows，这里只保证可运行）
  return path.join(os.homedir(), '.readloop')
}

/**
 * 从命令行参数里取出 --port 的值，支持 `--port 5191` 与 `--port=5191`。
 * @param {string[]} argv
 * @returns {string | undefined}
 */
function readPortArg(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--port') return argv[i + 1]
    if (arg.startsWith('--port=')) return arg.slice('--port='.length)
  }
  return undefined
}

/**
 * 把端口值转成合法端口号；非法返回 null。
 * @param {unknown} value
 * @returns {number | null}
 */
function toPort(value) {
  if (value === undefined || value === null) return null
  const text = String(value).trim()
  if (!/^\d+$/.test(text)) return null
  const port = Number(text)
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null
}

/**
 * 解析监听端口，优先级：--port 参数 > READLOOP_PORT > 默认 5178。
 * 非法值回退默认端口，并把原始值放进 invalid 供调用方记录告警。
 * @param {string[]} [argv]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ port: number, source: 'cli' | 'env' | 'default', invalid: string | null }}
 */
export function resolvePort(argv = process.argv.slice(2), env = process.env) {
  const fromArgv = readPortArg(argv)
  if (fromArgv !== undefined) {
    const port = toPort(fromArgv)
    if (port !== null) return { port, source: 'cli', invalid: null }
    return { port: DEFAULT_PORT, source: 'default', invalid: String(fromArgv) }
  }
  const fromEnv = env.READLOOP_PORT
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    const port = toPort(fromEnv)
    if (port !== null) return { port, source: 'env', invalid: null }
    return { port: DEFAULT_PORT, source: 'default', invalid: fromEnv }
  }
  return { port: DEFAULT_PORT, source: 'default', invalid: null }
}

const portInfo = resolvePort(process.argv.slice(2), process.env)
const dataDir = resolveDataDir(process.env)
const logsDir = path.join(dataDir, 'logs')
const publicDir = path.join(SERVER_DIR, 'public')

/**
 * 运行期配置（进程启动时冻结；测试通过 READLOOP_DATA_DIR 覆盖数据目录）。
 */
export const config = Object.freeze({
  version: readVersion(),
  host: DEFAULT_HOST,
  port: portInfo.port,
  portSource: portInfo.source,
  invalidPort: portInfo.invalid,
  /** JSON 请求体上限（02-DATA-API §6.1） */
  jsonLimit: '3mb',
  /** 优雅关闭硬超时（04-ENGINEERING §5.1） */
  shutdownTimeoutMs: 3000,
  rootDir: ROOT_DIR,
  serverDir: SERVER_DIR,
  dataDir,
  dbPath: path.join(dataDir, 'readloop.db'),
  logsDir,
  logFile: path.join(logsDir, 'server.log'),
  logLevel: (process.env.READLOOP_LOG_LEVEL || 'info').toLowerCase(),
  /** 日志文件 5MB 轮转、保留 3 份（04-ENGINEERING §5.5） */
  logRotateBytes: 5 * 1024 * 1024,
  logRotateKeep: 3,
  publicDir,
  indexHtmlPath: path.join(publicDir, 'index.html'),
  /** 词典目标路径（setup.bat 复制到数据目录，04-ENGINEERING §7.1） */
  dictPath: path.join(dataDir, 'stardict.db'),
  dictSource: process.env.READLOOP_DICT_SOURCE || null
})

export default config
