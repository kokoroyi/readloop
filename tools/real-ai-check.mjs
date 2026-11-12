#!/usr/bin/env node
/**
 * M3-08 真实 AI 验收脚本（可复跑；默认只预检不调用，需显式 --run 才会请求上游）。
 *
 * 用法：
 *   node tools/real-ai-check.mjs            # 预检：读取已保存 settings.ai，打印将要执行的调用量与成本估算
 *   node tools/real-ai-check.mjs --run      # 真正调用（会产生费用；20 句 ≈ 20 次批改请求）
 *   node tools/real-ai-check.mjs --run --limit=5
 *
 * 行为：
 * - 只使用 %APPDATA%\readloop（或 READLOOP_DATA_DIR）里已保存的 AI 配置，不读 Key 明文到控制台；
 * - 创建一篇 20 句样本文章，逐句走 readingService.submit（与前端相同链路）；
 * - 打印每句耗时/状态/降级、汇总 tokens 与成本估算（单价可用环境变量覆盖）；
 * - 结束后删除样本文章（ai_calls 保留作为观测记录）；不会调用真实 API 除非加 --run。
 */

import { config } from '../server/config.js'
import { closeDatabase, openDatabase } from '../server/db/index.js'
import { migrate } from '../server/db/migrate.js'
import { createAiCallsRepository } from '../server/db/repositories/aiCalls.js'
import { createArticlesRepository } from '../server/db/repositories/articles.js'
import { createReadingSessionsRepository } from '../server/db/repositories/reading.js'
import { createSentenceChatsRepository } from '../server/db/repositories/sentenceChats.js'
import { createSentencesRepository } from '../server/db/repositories/sentences.js'
import { createSettingsRepository } from '../server/db/repositories/settings.js'
import { createSentenceWorkRepository } from '../server/db/repositories/work.js'
import { createAiClient } from '../server/lib/aiClient.js'
import { createAiQueue } from '../server/lib/aiQueue.js'
import { contentHash } from '../server/lib/hash.js'
import { splitSentences } from '../server/lib/sentenceSplitter.js'
import { nowIso } from '../server/lib/time.js'
import { createReadingService } from '../server/services/readingService.js'
import { createSettingsService, isAiConfigured } from '../server/services/settingsService.js'

/** 20 句英文样本（自写素材，每句配一个中性中文译文） */
const SAMPLE = [
  ['The morning train was unusually quiet.', '早晨的火车异常安静。'],
  ['A woman sat by the window with a small notebook.', '一位年轻女子拿着小本子坐在窗边。'],
  ['She wrote down every station name she passed.', '她记下经过的每一个站名。'],
  ['Outside, the fields were still covered with light frost.', '窗外，田野上还覆着一层薄霜。'],
  ['The conductor walked slowly down the aisle.', '列车员沿着过道慢慢走过。'],
  ['He checked each ticket with great care.', '他非常仔细地检查每一张车票。'],
  ['No one seemed to be in a hurry that morning.', '那天早晨似乎没有人着急。'],
  ['The coffee machine made a soft humming sound.', '咖啡机发出轻柔的嗡鸣声。'],
  ['I opened my book and read the first page twice.', '我打开书，把第一页读了两遍。'],
  ['The story was about a village near the sea.', '这个故事讲的是海边的一个村庄。'],
  ['Its main character had never left home before.', '主人公此前从未离开过家。'],
  ['He decided to travel north after the harvest.', '他决定在收获之后向北旅行。'],
  ['His mother packed him a warm coat and some bread.', '母亲为他装了一件厚外套和一些面包。'],
  ['The road to the station was long and muddy.', '去车站的路又长又泥泞。'],
  [
    'Still, he walked with a light and hopeful heart.',
    '尽管如此，他仍带着轻松而满怀希望的心情走着。'
  ],
  ['When the train finally appeared, the sky had cleared.', '当火车终于出现时，天已经放晴。'],
  ['He found a seat near an old man who spoke softly.', '他在一位轻声说话的老人旁边找到座位。'],
  ['They talked about the weather and the coming winter.', '他们聊了天气和即将到来的冬天。'],
  ['By noon, the village had disappeared behind the hills.', '到中午时，村庄已消失在群山之后。'],
  ['It was the beginning of a long and quiet journey.', '这是一段漫长而安静旅程的开始。']
]

const args = process.argv.slice(2)
const shouldRun = args.includes('--run')
const limitArg = args.find((arg) => arg.startsWith('--limit='))
const limit = Math.max(
  1,
  Math.min(SAMPLE.length, Number(limitArg?.split('=')[1] ?? SAMPLE.length) || 20)
)

/** 成本估算单价（元 / 百万 tokens，可用环境变量覆盖；默认按 DeepSeek 量级设置） */
const PRICE_INPUT_PER_M = Number(process.env.READLOOP_PRICE_INPUT_PER_M ?? 0.5)
const PRICE_OUTPUT_PER_M = Number(process.env.READLOOP_PRICE_OUTPUT_PER_M ?? 2)

/**
 * @param {number} ms
 * @returns {string}
 */
function formatMs(ms) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`
}

/**
 * @param {string} text
 * @param {number} width
 * @returns {string}
 */
function pad(text, width) {
  const value = String(text)
  const length = [...value].length
  return length >= width ? value : value + ' '.repeat(width - length)
}

async function main() {
  console.log('ReadLoop · 真实 AI 验收脚本（M3-08）')
  console.log(`数据目录：${config.dataDir}`)
  console.log(`数据库：${config.dbPath}`)
  console.log(
    `样本句数：${limit}；单价假设：输入 ¥${PRICE_INPUT_PER_M}/M tokens，输出 ¥${PRICE_OUTPUT_PER_M}/M tokens`
  )
  console.log('')

  const db = openDatabase()
  let exitCode = 0
  try {
    migrate(db)
    const repositories = {
      settings: createSettingsRepository(db),
      articles: createArticlesRepository(db),
      sentences: createSentencesRepository(db),
      work: createSentenceWorkRepository(db),
      reading: createReadingSessionsRepository(db),
      chats: createSentenceChatsRepository(db),
      aiCalls: createAiCallsRepository(db)
    }
    const settingsService = createSettingsService({ repository: repositories.settings })
    const ai = settingsService.getRaw().ai ?? {}
    if (!isAiConfigured(ai)) {
      console.log('AI 未配置：请先在应用「设置 → AI 配置」中填写接口地址、API Key 与模型后再运行。')
      console.log('（本脚本不会读取或打印完整 Key；配置保存在本地 SQLite）')
      return
    }

    console.log(`模型：${ai.model}`)
    console.log(`接口：${ai.baseUrl}`)
    console.log(`超时/重试：${ai.timeoutMs}ms / ${ai.retry} 次`)
    console.log(`预计逻辑调用：${limit} 次批改（重试会合并计为同一次调用）`)
    console.log('')
    if (!shouldRun) {
      console.log('预检模式：未调用上游。确认后会真实产生费用，执行：')
      console.log(
        `  node tools/real-ai-check.mjs --run${limit !== SAMPLE.length ? ` --limit=${limit}` : ''}`
      )
      console.log('单价可用 READLOOP_PRICE_INPUT_PER_M / READLOOP_PRICE_OUTPUT_PER_M 覆盖。')
      return
    }

    const aiQueue = createAiQueue()
    const aiClient = createAiClient({ aiCalls: repositories.aiCalls, queue: aiQueue })
    const readingService = createReadingService({
      db,
      articles: repositories.articles,
      sentences: repositories.sentences,
      work: repositories.work,
      chats: repositories.chats,
      reading: repositories.reading,
      settingsService,
      aiClient
    })

    const startedAt = nowIso()
    const maxCallBefore = Number(
      db.prepare('SELECT COALESCE(MAX(id), 0) AS maxId FROM ai_calls').get().maxId
    )
    const content = SAMPLE.slice(0, limit)
      .map(([sentence]) => sentence)
      .join(' ')
    const sentenceRows = splitSentences(content)
    const articleId = repositories.articles.create({
      title: '[验收] real-ai-check',
      content,
      contentHash: contentHash(content),
      sourceFormat: 'paste',
      sourceName: null,
      status: 'reading',
      queueOrder: repositories.articles.nextQueueOrder(),
      sentenceCount: sentenceRows.length,
      createdAt: nowIso(),
      updatedAt: nowIso()
    })
    repositories.sentences.bulkCreate(articleId, sentenceRows)
    repositories.work.ensurePending(
      articleId,
      sentenceRows.map((row) => row.idx),
      nowIso()
    )
    console.log(
      `样本文章 #${articleId} 已创建（${sentenceRows.length} 句，startedAt=${startedAt}）\n`
    )

    /** @type {{ idx: number, status: string, durationMs: number, degraded: boolean, issues: number, error: string | null }[]} */
    const results = []
    let successCount = 0
    for (let idx = 0; idx < sentenceRows.length; idx += 1) {
      const translation = SAMPLE[idx][1]
      const begin = Date.now()
      try {
        const result = await readingService.submit({ articleId, idx, translation })
        const correction = result.work.correction ?? {}
        const degraded = correction.degraded === true
        const issues = Array.isArray(correction.issues) ? correction.issues.length : 0
        results.push({
          idx,
          status: degraded ? 'degraded' : 'ok',
          durationMs: Date.now() - begin,
          degraded,
          issues,
          error: null
        })
        successCount += 1
        console.log(
          `第 ${pad(idx + 1, 2)} 句  ${formatMs(Date.now() - begin).padStart(6)}  ${
            degraded ? '降级' : '完成'
          }  问题 ${issues} 条`
        )
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? error.code : 'INTERNAL'
        const message = error instanceof Error ? error.message : String(error)
        results.push({
          idx,
          status: 'error',
          durationMs: Date.now() - begin,
          degraded: false,
          issues: 0,
          error: `${code}: ${message}`
        })
        console.log(
          `第 ${pad(idx + 1, 2)} 句  ${formatMs(Date.now() - begin).padStart(6)}  失败 ${code}`
        )
      }
    }

    const callRows = db
      .prepare(
        "SELECT status, input_tokens, output_tokens, duration_ms FROM ai_calls WHERE id > ? AND purpose = 'correct'"
      )
      .all(maxCallBefore)
    const totalInput = callRows.reduce((sum, row) => sum + Number(row.input_tokens ?? 0), 0)
    const totalOutput = callRows.reduce((sum, row) => sum + Number(row.output_tokens ?? 0), 0)
    const degradedCount = results.filter((row) => row.degraded).length
    const failedCount = results.filter((row) => row.status === 'error').length
    const avgLatency =
      results.length > 0
        ? results.reduce((sum, row) => sum + row.durationMs, 0) / results.length
        : 0
    const cost =
      (totalInput / 1_000_000) * PRICE_INPUT_PER_M + (totalOutput / 1_000_000) * PRICE_OUTPUT_PER_M

    console.log('\n================ 验收汇总 ================')
    console.log(
      `样本句数：${results.length}；成功：${successCount}；降级：${degradedCount}；失败：${failedCount}`
    )
    console.log(`降级率：${((degradedCount / Math.max(1, results.length)) * 100).toFixed(1)}%`)
    console.log(`平均耗时：${formatMs(avgLatency)}（含失败句）`)
    console.log(`ai_calls 行数：${callRows.length}（每个逻辑调用一条）`)
    console.log(
      `tokens：输入 ${totalInput} / 输出 ${totalOutput}；成本约 ¥${cost.toFixed(4)}（按上述单价假设）`
    )
    const failedRows = results.filter((row) => row.status === 'error')
    if (failedRows.length > 0) {
      console.log('失败明细：')
      for (const row of failedRows) console.log(`  第 ${row.idx + 1} 句：${row.error}`)
      exitCode = 1
    }
    console.log(
      '\n提示：样本文章已清理；ai_calls 记录保留在数据库，可用 SQL 进一步分析（purpose=correct）。'
    )
  } finally {
    // 清理样本文章（级联删除句子/工作；ai_calls 保留）
    try {
      const row = db
        .prepare(
          "SELECT id FROM articles WHERE title = '[验收] real-ai-check' ORDER BY id DESC LIMIT 1"
        )
        .get()
      if (row) db.prepare('DELETE FROM articles WHERE id = ?').run(row.id)
    } catch {
      // 清理失败不影响验收结论
    }
    closeDatabase(db)
  }
  process.exitCode = exitCode
}

main().catch((error) => {
  console.error('真实 AI 验收脚本异常：', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
