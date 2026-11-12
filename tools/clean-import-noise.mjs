#!/usr/bin/env node
/**
 * 清理已导入文章里残留的 Markdown 任务列表标记（如 `- [x] 已读`）。
 *
 * 背景：旧版导入解析器会把 `- [x] 已读` 当作正文导入。解析器已修复，但已导入的
 * 文章不会自动更新，本工具用于一次性清理本地数据。
 *
 * 行为：
 *   node tools/clean-import-noise.mjs                    只读扫描，列出受影响文章
 *   node tools/clean-import-noise.mjs --apply            安全清理（仅无学习进度的文章）
 *   node tools/clean-import-noise.mjs --apply --data-dir <路径>
 *
 * 安全规则：
 * - 只处理 processed_count=0 且 skipped_count=0 的文章（queued/reading 均可）；
 * - 清理后重新分句、重建 pending work（reading 状态保留，计时不受影响）；
 * - 清理后正文与其它文章重复（content_hash 冲突）→ 跳过并提示；
 * - 已有批改/跳过/复盘/小结数据 → 一律跳过，并提示手动处理（避免误删进度）；
 * - 默认只读；--apply 才写库；写库前先备份 db 到数据目录 backups/ 下。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { stripMarkdownTaskMarkers } from '../server/lib/importParser.js'
import { normalizeContent } from '../server/lib/text.js'
import { splitSentences } from '../server/lib/sentenceSplitter.js'
import { contentHash } from '../server/lib/hash.js'
import { nowIso } from '../server/lib/time.js'

/** 行首（或换行后）出现任务标记：[x] / [ ] */
const TASK_PATTERN = /(^|\n)[ \t]*(?:[-*+][ \t]*)?\[[ xX]\][ \t]/

function parseArgs(argv) {
  const options = { apply: false, dataDir: null }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--apply') options.apply = true
    else if (arg === '--data-dir') options.dataDir = argv[i + 1]
    else if (arg === '--help' || arg === '-h') options.help = true
  }
  return options
}

function resolveDataDir(options) {
  if (options.dataDir) return path.resolve(options.dataDir)
  if (process.env.READLOOP_DATA_DIR) return path.resolve(process.env.READLOOP_DATA_DIR)
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  return path.join(appData, 'readloop')
}

function backup(dbPath) {
  const dir = path.join(path.dirname(dbPath), 'backups')
  fs.mkdirSync(dir, { recursive: true })
  const stamp = new Date()
    .toLocaleString('sv-SE', { hour12: false })
    .replace(/[-: ]/g, (ch) => (ch === ' ' ? '-' : ''))
  const target = path.join(dir, `readloop-before-clean-${stamp}.db`)
  fs.copyFileSync(dbPath, target)
  return target
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(
      '用法：node tools/clean-import-noise.mjs [--apply] [--data-dir <数据目录>]\n' +
        '  默认只读扫描；--apply 才会清理无学习进度的文章（写库前自动备份）。'
    )
    return
  }
  const dataDir = resolveDataDir(options)
  const dbPath = path.join(dataDir, 'readloop.db')
  if (!fs.existsSync(dbPath)) {
    console.error(`找不到数据库：${dbPath}`)
    process.exit(1)
  }

  const db = new Database(dbPath, { readonly: !options.apply })
  db.pragma('foreign_keys = ON')

  const articles = db
    .prepare(
      'SELECT id, title, status, processed_count, skipped_count, sentence_count, content FROM articles ORDER BY id'
    )
    .all()
  const affected = articles.filter((row) => TASK_PATTERN.test(row.content))

  console.log(`数据目录：${dataDir}`)
  console.log(`共 ${articles.length} 篇文章，其中 ${affected.length} 篇正文含任务标记`)
  if (affected.length === 0) {
    console.log('✓ 无需清理')
    db.close()
    return
  }
  console.log('\n受影响文章：')
  for (const row of affected) {
    const progress = `processed=${row.processed_count}, skipped=${row.skipped_count}, sentences=${row.sentence_count}`
    console.log(`  #${row.id} [${row.status}] ${progress}  ${row.title}`)
  }

  const eligible = affected.filter(
    (row) => row.processed_count === 0 && row.skipped_count === 0 && row.status !== 'recap' && row.status !== 'done'
  )
  const blocked = affected.filter((row) => !eligible.includes(row))
  console.log(`\n可安全清理：${eligible.length} 篇` + (blocked.length ? `；有学习进度跳过：${blocked.length} 篇` : ''))
  if (blocked.length > 0) {
    for (const row of blocked) {
      console.log(`  跳过 #${row.id} [${row.status}]（已有进度/复盘数据）：${row.title}`)
    }
  }

  if (!options.apply) {
    console.log('\n当前为只读扫描。确认后执行：node tools/clean-import-noise.mjs --apply')
    db.close()
    return
  }
  if (eligible.length === 0) {
    db.close()
    return
  }

  const backupPath = backup(dbPath)
  console.log(`\n已备份数据库：${backupPath}`)

  const updateArticle = db.prepare(
    'UPDATE articles SET content = ?, content_hash = ?, sentence_count = ?, updated_at = ? WHERE id = ?'
  )
  const deleteSentences = db.prepare('DELETE FROM sentences WHERE article_id = ?')
  const deleteWork = db.prepare('DELETE FROM sentence_work WHERE article_id = ?')
  const deleteChats = db.prepare('DELETE FROM sentence_chats WHERE article_id = ?')
  const insertSentence = db.prepare(
    'INSERT INTO sentences (article_id, idx, text, start_off, end_off) VALUES (?, ?, ?, ?, ?)'
  )
  const insertPending = db.prepare(
    "INSERT OR IGNORE INTO sentence_work (article_id, idx, status, updated_at) VALUES (?, ?, 'pending', ?)"
  )
  const findHash = db.prepare('SELECT id FROM articles WHERE content_hash = ? AND id <> ?')

  const apply = db.transaction((row) => {
    const cleaned = normalizeContent(stripMarkdownTaskMarkers(row.content))
    const sentences = splitSentences(cleaned)
    if (sentences.length === 0) return { skipped: '清洗后正文为空' }
    const hash = contentHash(cleaned)
    const dup = findHash.get(hash, row.id)
    if (dup) return { skipped: `清洗后与文章 #${dup.id} 重复` }

    const now = nowIso()
    updateArticle.run(cleaned, hash, sentences.length, now, row.id)
    deleteWork.run(row.id)
    deleteChats.run(row.id)
    deleteSentences.run(row.id)
    for (const sentence of sentences) {
      insertSentence.run(row.id, sentence.idx, sentence.text, sentence.start, sentence.end)
    }
    if (row.status === 'reading') {
      for (const sentence of sentences) insertPending.run(row.id, sentence.idx, now)
    }
    return { sentences: sentences.length, chars: cleaned.length }
  })

  let changed = 0
  for (const row of eligible) {
    const result = apply(row)
    if (result.skipped) {
      console.log(`  跳过 #${row.id}：${result.skipped}`)
      continue
    }
    changed += 1
    console.log(`  ✓ #${row.id} 已清理（${result.chars} 字符 / ${result.sentences} 句）`)
  }
  console.log(`\n完成：清理 ${changed} 篇，跳过 ${affected.length - changed} 篇。`)
  db.close()
}

main()
