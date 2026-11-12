/**
 * 精读 work 数据归一化与展示辅助（M3）：
 * correction/chats 形状兜底、进度统计、下一句定位、我的译文错误片段切分。
 */

export const ISSUE_TYPE_TONE = {
  漏译: 'tag-amber',
  误译: 'tag-rust',
  理解偏差: 'tag-blue'
}

const PROCESSED_STATUSES = ['corrected', 'skipped']

/** 批改结果归一化（03-AI-SPEC §3.4）；非法/缺失返回 null。 */
export function normalizeCorrection(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const issues = Array.isArray(raw.issues)
    ? raw.issues
        .filter((issue) => issue && typeof issue === 'object')
        .slice(0, 5)
        .map((issue) => ({
          type: String(issue.type || ''),
          fragment: String(issue.fragment || ''),
          explain: String(issue.explain || '')
        }))
    : []
  return {
    issues,
    referenceTranslation: typeof raw.referenceTranslation === 'string' ? raw.referenceTranslation : '',
    degraded: Boolean(raw.degraded),
    rawText: typeof raw.rawText === 'string' ? raw.rawText : ''
  }
}

/** sentence_work 归一化：M3 起 status 可能为 pending/submitting/corrected/skipped/error。 */
export function normalizeWork(raw) {
  const work = raw && typeof raw === 'object' ? raw : {}
  return {
    status: typeof work.status === 'string' ? work.status : 'pending',
    myTranslation: typeof work.myTranslation === 'string' ? work.myTranslation : null,
    correction: normalizeCorrection(work.correction),
    model: typeof work.model === 'string' ? work.model : '',
    promptVersion: typeof work.promptVersion === 'string' ? work.promptVersion : '',
    submittedAt: work.submittedAt || null,
    correctedAt: work.correctedAt || null
  }
}

function normalizeChatMessage(raw) {
  const message = raw && typeof raw === 'object' ? raw : {}
  return {
    id: message.id ?? null,
    role: message.role === 'user' ? 'user' : 'assistant',
    content: typeof message.content === 'string' ? message.content : '',
    partial: Boolean(message.partial),
    createdAt: message.createdAt || null
  }
}

/** chats 归一化：对象 {idx: 消息[]}（兼容数组包裹），key 统一为 number。 */
export function normalizeChats(raw) {
  const chats = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return chats
  for (const key of Object.keys(raw)) {
    const index = Number(key)
    if (!Number.isInteger(index) || !Array.isArray(raw[key])) continue
    chats[index] = raw[key].map(normalizeChatMessage)
  }
  return chats
}

export function isProcessedWork(work) {
  return Boolean(work) && PROCESSED_STATUSES.includes(work.status)
}

/** 统计某文章已处理 / 跳过句数（以句子状态为准，接口 progress 优先由调用方覆盖）。 */
export function countSentenceProgress(sentences) {
  let processed = 0
  let skipped = 0
  for (const sentence of sentences || []) {
    const status = sentence.work && sentence.work.status
    if (status === 'corrected') processed += 1
    else if (status === 'skipped') {
      processed += 1
      skipped += 1
    }
  }
  return { processed, skipped }
}

/**
 * 找下一句可处理的句子：先向后，再从头找（避免漏掉前面 error/pending）。
 * @returns {number|null}
 */
export function nextPendingIndex(sentences, fromIdx) {
  const list = sentences || []
  for (let index = fromIdx + 1; index < list.length; index += 1) {
    if (!isProcessedWork(list[index].work)) return index
  }
  for (let index = 0; index <= fromIdx && index < list.length; index += 1) {
    if (!isProcessedWork(list[index].work)) return index
  }
  return null
}

/** 第一个可处理句（服务端 currentIdx 缺失时兜底）。 */
export function firstPendingIndex(sentences) {
  const list = sentences || []
  const index = list.findIndex((sentence) => !isProcessedWork(sentence.work))
  return index >= 0 ? index : Math.max(0, list.length - 1)
}

/** 按错误片段把「我的译文」切成 [{ text, wrong }]，用于锈色下划线。 */
export function splitTranslationFragments(translation, fragments) {
  const text = String(translation || '')
  const list = (fragments || []).map((item) => String(item || '')).filter(Boolean)
  if (!text || !list.length) return [{ text, wrong: false }]
  const ranges = []
  for (const fragment of list) {
    const start = text.indexOf(fragment)
    if (start < 0) continue
    const end = start + fragment.length
    if (ranges.some((range) => start < range.end && end > range.start)) continue
    ranges.push({ start, end })
  }
  if (!ranges.length) return [{ text, wrong: false }]
  ranges.sort((a, b) => a.start - b.start)
  const segments = []
  let cursor = 0
  for (const range of ranges) {
    if (range.start > cursor) segments.push({ text: text.slice(cursor, range.start), wrong: false })
    segments.push({ text: text.slice(range.start, range.end), wrong: true })
    cursor = range.end
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), wrong: false })
  return segments
}

/** 折叠态摘要：通过 / n 处问题（附类型计数）。 */
export function issueSummary(correction) {
  const issues = (correction && correction.issues) || []
  if (!issues.length) return { label: '通过 · 无问题', count: 0, types: [] }
  const counts = new Map()
  for (const issue of issues) counts.set(issue.type, (counts.get(issue.type) || 0) + 1)
  const parts = Array.from(counts.entries()).map(([type, count]) => `${count} 处${type}`)
  return { label: parts.join(' · '), count: issues.length, types: Array.from(counts.keys()) }
}
