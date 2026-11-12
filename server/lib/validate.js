import { z } from 'zod'
import { AppError } from './errors.js'

/**
 * 请求校验：zod schema 集中在这里，路由层只做 parseOrThrow。
 * 失败统一抛 VALIDATION 400，detail.fields 带字段路径（如 ai.baseUrl）。
 */

/**
 * http(s) URL 校验（保存前归一化 trim，不强制末尾斜杠）。
 */
const httpUrl = z
  .string({ required_error: '接口地址不能为空', invalid_type_error: '接口地址必须是字符串' })
  .trim()
  .min(1, '接口地址不能为空')
  .max(500, '接口地址过长（最多 500 字符）')
  .refine((value) => {
    try {
      const url = new URL(value)
      return url.protocol === 'http:' || url.protocol === 'https:'
    } catch {
      return false
    }
  }, '接口地址必须是 http(s) URL')

const apiKey = z
  .string({ invalid_type_error: 'API Key 必须是字符串' })
  .trim()
  .max(1000, 'API Key 过长（最多 1000 字符）')

const timeoutMs = z
  .number({ required_error: '超时不能为空', invalid_type_error: '超时必须为数字（毫秒）' })
  .int('超时必须是整数毫秒')
  .min(1000, '超时不能小于 1000ms')
  .max(600000, '超时不能大于 600000ms')

const retry = z
  .number({ required_error: '重试次数不能为空', invalid_type_error: '重试次数必须为数字' })
  .int('重试次数必须是整数')
  .min(0, '重试次数不能小于 0')
  .max(5, '重试次数不能大于 5')

/** settings.ai 分区（PUT 用：字段全部可选，提交 model 时不能为空串） */
export const aiSettingsSchema = z.object({
  baseUrl: httpUrl.optional(),
  apiKey: apiKey.optional(),
  model: z
    .string({ invalid_type_error: '模型必须是字符串' })
    .trim()
    .min(1, '模型不能为空')
    .max(200, '模型名过长（最多 200 字符）')
    .optional(),
  timeoutMs: timeoutMs.optional(),
  retry: retry.optional()
})

const adhdSchema = z.object({
  mode: z
    .enum(['off', 'semantic', 'bionic', 'highlight'], {
      errorMap: () => ({ message: 'ADHD 模式只能是 off/semantic/bionic/highlight' })
    })
    .optional(),
  semanticDensity: z.number().min(0).max(1, '语义密度必须在 0–1 之间').optional(),
  splitRatio: z.number().min(0).max(1, '分栏比例必须在 0–1 之间').optional(),
  leadScale: z.number().min(0.8).max(2, '首句放大必须在 0.8–2 之间').optional(),
  letterSpacing: z.number().min(0).max(0.3, '字距必须在 0–0.3 之间').optional(),
  wordSpacing: z.number().min(0).max(1, '词距必须在 0–1 之间').optional(),
  baseScale: z.number().min(0.8).max(2, '基础缩放必须在 0.8–2 之间').optional()
})

/** settings.appearance 分区（PUT 用） */
export const appearanceSettingsSchema = z.object({
  theme: z
    .enum(['light', 'dark', 'system'], {
      errorMap: () => ({ message: '主题只能是 light/dark/system' })
    })
    .optional(),
  fontSize: z
    .number()
    .int('字号必须是整数')
    .min(16, '字号不能小于 16')
    .max(22, '字号不能大于 22')
    .optional(),
  lineHeight: z.number().min(1.6, '行距不能小于 1.6').max(2.2, '行距不能大于 2.2').optional(),
  maxWidth: z
    .number()
    .int('栏宽必须是整数')
    .min(640, '栏宽不能小于 640')
    .max(860, '栏宽不能大于 860')
    .optional(),
  adhd: adhdSchema.optional()
})

/** settings.recap 分区（PUT 用） */
export const recapSettingsSchema = z.object({
  questions: z
    .union(
      [z.literal('auto'), z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(8)],
      {
        errorMap: () => ({ message: '复盘题数只能是 auto 或 3/4/5/6/8' })
      }
    )
    .optional(),
  showReference: z.boolean({ invalid_type_error: '是否显示参考译文必须是布尔值' }).optional(),
  floatWindowDefaultOpen: z.boolean({ invalid_type_error: '浮窗默认打开必须是布尔值' }).optional()
})

/** PUT /api/settings 请求体：至少提交一个分区 */
export const settingsPatchSchema = z
  .object({
    ai: aiSettingsSchema.optional(),
    appearance: appearanceSettingsSchema.optional(),
    recap: recapSettingsSchema.optional()
  })
  .refine(
    (value) =>
      value.ai !== undefined || value.appearance !== undefined || value.recap !== undefined,
    { message: '至少需要提交 ai/appearance/recap 中的一个设置分区' }
  )

/**
 * POST /api/ai/test 请求体：可空；兼容扁平字段或 { ai:{...} } 两种形状，
 * 未提交的字段使用已保存设置。
 */
export const aiTestBodySchema = z
  .object({
    ai: z
      .object({
        baseUrl: httpUrl.optional(),
        apiKey: apiKey.optional(),
        model: z.string({ invalid_type_error: '模型必须是字符串' }).trim().max(200).optional(),
        timeoutMs: timeoutMs.optional(),
        retry: retry.optional()
      })
      .optional(),
    baseUrl: httpUrl.optional(),
    apiKey: apiKey.optional(),
    model: z.string({ invalid_type_error: '模型必须是字符串' }).trim().max(200).optional(),
    timeoutMs: timeoutMs.optional(),
    retry: retry.optional()
  })
  .optional()

/**
 * 用 zod schema 校验输入；失败抛 AppError('VALIDATION')，detail.fields 形如
 * [{ path: 'ai.baseUrl', message: '...' }]。
 * @template T
 * @param {import('zod').ZodType<T>} schema
 * @param {unknown} input
 * @returns {T}
 */
export function parseOrThrow(schema, input) {
  const result = schema.safeParse(input)
  if (result.success) return result.data
  const fields = result.error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join('.') : 'body',
    message: issue.message
  }))
  const summary = fields.map((field) => `${field.path}: ${field.message}`).join('；')
  throw new AppError('VALIDATION', `参数校验失败：${summary}`, { detail: { fields } })
}

/* ------------------------------------------------------------------ */
/* M2：文章 / 导入 / 词库 / 阅读计时                                     */
/* ------------------------------------------------------------------ */

/** 单篇正文上限（02-DATA-API §3） */
export const MAX_ARTICLE_CHARS = 100000
/** 单次批量导入篇数上限（task-3） */
export const MAX_IMPORT_ITEMS = 300
/** 单次批量导入累计字符上限（task-3） */
export const MAX_IMPORT_TOTAL_CHARS = 100000
/** 文件导入预览的原始内容上限（前端限制文件 ≤2MB） */
export const MAX_IMPORT_PREVIEW_CHARS = 2000000

const titleField = z
  .string({ invalid_type_error: '标题必须是字符串' })
  .trim()
  .max(100, '标题最多 100 字')

/** POST /api/articles：粘贴创建 */
export const articleCreateSchema = z.object({
  title: titleField.optional(),
  content: z
    .string({ required_error: '正文不能为空', invalid_type_error: '正文必须是字符串' })
    .trim()
    .min(20, '正文至少需要 20 个字符')
    .max(MAX_ARTICLE_CHARS, `正文最多 ${MAX_ARTICLE_CHARS} 字符`),
  sourceFormat: z
    .literal('paste', {
      errorMap: () => ({ message: "sourceFormat 只支持 'paste'" })
    })
    .optional(),
  force: z.boolean({ invalid_type_error: 'force 必须是布尔值' }).optional()
})

/** PATCH /api/articles/:id：只允许改标题 */
export const articleUpdateSchema = z.object({
  title: z
    .string({ required_error: '标题不能为空', invalid_type_error: '标题必须是字符串' })
    .trim()
    .min(1, '标题不能为空')
    .max(100, '标题最多 100 字')
})

/** GET /api/articles 查询参数 */
export const articlesQuerySchema = z.object({
  status: z
    .enum(['queued', 'reading', 'recap', 'done'], {
      errorMap: () => ({ message: 'status 只能是 queued/reading/recap/done' })
    })
    .optional(),
  q: z.string({ invalid_type_error: 'q 必须是字符串' }).trim().max(200, '搜索词过长').optional(),
  sort: z
    .enum(['queue', 'updated'], {
      errorMap: () => ({ message: 'sort 只能是 queue/updated' })
    })
    .optional()
})

/** POST /api/articles/reorder：待读队列完整顺序 */
export const reorderSchema = z.object({
  ids: z
    .array(
      z
        .number({ invalid_type_error: 'ids 必须是数字数组' })
        .int('ids 必须是整数')
        .positive('ids 必须是正整数'),
      {
        required_error: 'ids 不能为空'
      }
    )
    .min(1, 'ids 不能为空')
    .max(1000, '一次最多重排 1000 篇')
    .superRefine((ids, ctx) => {
      if (new Set(ids).size !== ids.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'ids 不能重复' })
      }
    })
})

/** POST /api/articles/import/preview */
export const importPreviewSchema = z.object({
  filename: z
    .string({ required_error: 'filename 不能为空', invalid_type_error: 'filename 必须是字符串' })
    .trim()
    .min(1, 'filename 不能为空')
    .max(260, 'filename 过长'),
  content: z
    .string({ required_error: '文件内容不能为空', invalid_type_error: '文件内容必须是字符串' })
    .min(1, '文件内容不能为空')
    .max(MAX_IMPORT_PREVIEW_CHARS, '文件过大，最多 2MB')
})

const importItemSchema = z.object({
  title: titleField.optional(),
  content: z
    .string({ required_error: '正文不能为空', invalid_type_error: '正文必须是字符串' })
    .trim()
    .min(1, '正文不能为空')
    .max(MAX_ARTICLE_CHARS, `单篇正文最多 ${MAX_ARTICLE_CHARS} 字符`),
  sourceFormat: z.enum(['md', 'txt'], {
    errorMap: () => ({ message: "sourceFormat 只支持 'md' 或 'txt'" })
  })
})

/** POST /api/articles/import/commit：批量导入（事务） */
export const importCommitSchema = z
  .object({
    items: z
      .array(importItemSchema)
      .min(1, 'items 不能为空')
      .max(MAX_IMPORT_ITEMS, `一次最多导入 ${MAX_IMPORT_ITEMS} 篇`)
  })
  .superRefine((value, ctx) => {
    const totalChars = value.items.reduce((sum, item) => sum + item.content.length, 0)
    if (totalChars > MAX_IMPORT_TOTAL_CHARS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['items'],
        message: `单次导入累计正文不能超过 ${MAX_IMPORT_TOTAL_CHARS} 字符（当前 ${totalChars}），请分批导入`
      })
    }
  })

/** POST /api/words */
export const wordCreateSchema = z.object({
  word: z
    .string({ required_error: 'word 不能为空', invalid_type_error: 'word 必须是字符串' })
    .trim()
    .min(1, 'word 不能为空')
    .max(100, '单词过长'),
  articleId: z.number({ invalid_type_error: 'articleId 必须是数字' }).int().positive().optional()
})

/** GET /api/words 查询参数 */
export const wordsQuerySchema = z.object({
  q: z.string({ invalid_type_error: 'q 必须是字符串' }).trim().max(200, '搜索词过长').optional(),
  sort: z
    .enum(['created', 'alpha'], {
      errorMap: () => ({ message: 'sort 只能是 created/alpha' })
    })
    .optional()
})

const idField = z
  .number({ invalid_type_error: 'id 必须是数字' })
  .int('id 必须是整数')
  .positive('id 必须是正整数')

/** POST /api/reading/tick */
export const readingTickSchema = z.object({
  sessionId: idField.optional(),
  articleId: idField.optional(),
  seconds: z
    .number({ required_error: 'seconds 不能为空', invalid_type_error: 'seconds 必须是数字' })
    .finite('seconds 必须是有限数字')
})

/** POST /api/reading/end */
export const readingEndSchema = z.object({
  sessionId: idField.optional(),
  articleId: idField.optional()
})

/**
 * 解析路径参数里的正整数 id。
 * @param {unknown} value
 * @param {string} [field]
 * @returns {number}
 */
export function parseIdParam(value, field = 'id') {
  const text = String(value ?? '').trim()
  if (!/^\d+$/.test(text)) {
    throw new AppError('VALIDATION', `${field} 必须是正整数`, {
      detail: { fields: [{ path: field, message: '必须是正整数' }] }
    })
  }
  const number = Number(text)
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new AppError('VALIDATION', `${field} 必须是正整数`, {
      detail: { fields: [{ path: field, message: '必须是正整数' }] }
    })
  }
  return number
}

/**
 * 去掉查询串里的空值（?status= → 忽略，而不是校验失败）。
 * @param {Record<string, unknown>} query
 * @returns {Record<string, unknown>}
 */
export function cleanQuery(query) {
  /** @type {Record<string, unknown>} */
  const cleaned = {}
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null) continue
    if (typeof value === 'string' && value.trim().length === 0) continue
    cleaned[key] = value
  }
  return cleaned
}

/** GET /api/dict/lookup 查询参数 */
export const dictLookupQuerySchema = z.object({
  word: z
    .string({ required_error: 'word 不能为空', invalid_type_error: 'word 必须是字符串' })
    .trim()
    .min(1, 'word 不能为空')
    .max(100, '单词过长')
})

/** GET /api/dict/suggest 查询参数 */
export const dictSuggestQuerySchema = z.object({
  q: z
    .string({ required_error: 'q 不能为空', invalid_type_error: 'q 必须是字符串' })
    .trim()
    .min(1, 'q 不能为空')
    .max(100, '搜索词过长')
})

/** GET /api/words/export 查询参数 */
export const wordsExportQuerySchema = z.object({
  format: z
    .enum(['csv', 'json'], {
      errorMap: () => ({ message: 'format 只能是 csv 或 json' })
    })
    .default('csv')
})

/** POST /api/articles/:id/sentences/:idx/submit */
export const translationSubmitSchema = z.object({
  translation: z
    .string({ required_error: '译文不能为空', invalid_type_error: '译文必须是字符串' })
    .trim()
    .min(1, '译文不能为空')
    .max(2000, '译文最多 2000 字')
})

/** POST /api/articles/:id/sentences/:idx/chat */
export const chatMessageSchema = z.object({
  message: z
    .string({ required_error: '问题不能为空', invalid_type_error: '问题必须是字符串' })
    .trim()
    .min(1, '问题不能为空')
    .max(2000, '问题最多 2000 字')
})

/**
 * 解析路径参数里的非负整数（句子 idx 从 0 开始）。
 * @param {unknown} value
 * @param {string} [field]
 * @returns {number}
 */
export function parseNonNegativeIntParam(value, field = 'idx') {
  const text = String(value ?? '').trim()
  if (!/^\d+$/.test(text)) {
    throw new AppError('VALIDATION', `${field} 必须是非负整数`, {
      detail: { fields: [{ path: field, message: '必须是非负整数' }] }
    })
  }
  const number = Number(text)
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new AppError('VALIDATION', `${field} 必须是非负整数`, {
      detail: { fields: [{ path: field, message: '必须是非负整数' }] }
    })
  }
  return number
}

/** POST /api/articles/:id/recap/answer */
export const recapAnswerSchema = z.object({
  questionId: z
    .number({ required_error: 'questionId 不能为空', invalid_type_error: 'questionId 必须是数字' })
    .int('questionId 必须是整数')
    .positive('questionId 必须为正整数'),
  answer: z
    .string({ required_error: '回答不能为空', invalid_type_error: '回答必须是字符串' })
    .trim()
    .min(1, '回答不能为空')
    .max(4000, '回答最多 4000 字')
})

/** POST /api/articles/:id/recap/skip */
export const recapSkipSchema = z.object({
  questionId: z
    .number({ required_error: 'questionId 不能为空', invalid_type_error: 'questionId 必须是数字' })
    .int('questionId 必须是整数')
    .positive('questionId 必须为正整数')
})

/** PATCH /api/articles/:id/summary */
export const summaryNotesSchema = z.object({
  userNotes: z
    .string({ required_error: 'userNotes 不能为空', invalid_type_error: 'userNotes 必须是字符串' })
    .max(20000, '笔记最多 20000 字')
})

/**
 * 可选整数 query 参数：空串/缺省视为 undefined，其余转 Number 后校验。
 * @param {number} min
 * @param {number} max
 */
function optionalIntQuery(min, max) {
  return z.preprocess(
    (value) => (value === undefined || value === '' ? undefined : Number(value)),
    z
      .number({ invalid_type_error: '必须是数字' })
      .int('必须是整数')
      .min(min, `不能小于 ${min}`)
      .max(max, `不能大于 ${max}`)
      .optional()
  )
}

/** GET /api/stats/calendar */
export const statsCalendarQuerySchema = z.object({
  year: optionalIntQuery(2000, 2100),
  month: optionalIntQuery(1, 12)
})

/** GET /api/logs */
export const logsQuerySchema = z.object({
  limit: z.preprocess(
    (value) => (value === undefined || value === '' ? undefined : Number(value)),
    z
      .number({ invalid_type_error: 'limit 必须是数字' })
      .int('limit 必须是整数')
      .min(1, 'limit 至少为 1')
      .max(1000, 'limit 最多为 1000')
      .default(200)
  )
})

/** GET /api/articles/random */
export const randomArticleQuerySchema = z.object({
  status: z
    .enum(['queued', 'reading', 'recap', 'done'], {
      errorMap: () => ({ message: 'status 只能是 queued/reading/recap/done' })
    })
    .optional()
    .default('done')
})

/** POST /api/system/clear-data：危险操作必须显式 confirm:true */
export const clearDataSchema = z.object({
  confirm: z
    .boolean({
      required_error: 'confirm 必须为 true',
      invalid_type_error: 'confirm 必须为 true'
    })
    .refine((value) => value === true, { message: '必须显式确认（confirm:true）' }),
  keepWords: z.boolean({ invalid_type_error: 'keepWords 必须是布尔值' }).optional().default(true)
})
