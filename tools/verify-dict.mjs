#!/usr/bin/env node
/**
 * 词典校验：确认 ECDICT 拷贝可用。
 *
 * 用法：
 *   node tools/verify-dict.mjs [path]
 *   npm run verify:dict
 *
 * 校验目标（按优先级）：命令行参数 → READLOOP_DICT_SOURCE → %APPDATA%\readloop\stardict.db
 * 通过条件：文件可读、含 stardict 表与必需列、行数 ≥ 1,000,000、抽样查询正常。
 * 退出码 0=通过，1=失败。
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import Database from 'better-sqlite3'

const MIN_ROWS = 1_000_000
const REQUIRED_COLUMNS = ['word', 'phonetic', 'translation', 'pos', 'collins', 'bnc', 'frq']

function targetPath() {
  const fromArg = process.argv[2]
  if (fromArg) return path.resolve(fromArg)
  if (process.env.READLOOP_DICT_SOURCE) return path.resolve(process.env.READLOOP_DICT_SOURCE)
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  return path.join(appData, 'readloop', 'stardict.db')
}

function fail(message) {
  console.error(`✗ ${message}`)
  process.exit(1)
}

const file = targetPath()
console.log(`[verify-dict] 目标：${file}`)

if (!fs.existsSync(file)) {
  fail('文件不存在。请先运行 setup.bat 复制词典，或指定 READLOOP_DICT_SOURCE。')
}

let stat
try {
  stat = fs.statSync(file)
  fs.accessSync(file, fs.constants.R_OK)
} catch (err) {
  fail(`文件不可读：${err.message}`)
}

console.log(`[verify-dict] 大小：${(stat.size / 1024 / 1024).toFixed(1)} MB`)
if (stat.size < 10 * 1024 * 1024) {
  fail('文件过小，疑似未复制完整。')
}

let db
try {
  db = new Database(file, { readonly: true, fileMustExist: true })
} catch (err) {
  fail(`无法以 SQLite 打开：${err.message}`)
}

try {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'stardict'")
    .get()
  if (!table) fail('缺少 stardict 表，不是有效的 ECDICT 数据库。')

  const columns = db.prepare('PRAGMA table_info(stardict)').all().map((c) => c.name)
  const missing = REQUIRED_COLUMNS.filter((c) => !columns.includes(c))
  if (missing.length) fail(`stardict 表缺少列：${missing.join(', ')}`)

  const { c: rows } = db.prepare('SELECT COUNT(*) AS c FROM stardict').get()
  console.log(`[verify-dict] 词条数：${rows.toLocaleString('en-US')}`)
  if (rows < MIN_ROWS) fail(`词条数不足（需要 ≥ ${MIN_ROWS.toLocaleString('en-US')}）。`)

  const sample = db.prepare('SELECT word, translation FROM stardict WHERE word = ?').get('the')
  if (!sample) fail('抽样查询失败：找不到 "the"。')
  console.log(`[verify-dict] 抽样：the → ${String(sample.translation || '').split('\n')[0]}`)
} finally {
  db.close()
}

console.log('✓ 词典校验通过')
