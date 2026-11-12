import { z } from 'zod'
import { AppError } from '../lib/errors.js'
import { buildArticlePrefix } from './common.js'

/**
 * Prompt P4：答题评估（03-AI-SPEC §6，prompt_version = recap-eval-v1）。
 */

export const PROMPT_ID = 'recap-eval'
export const PROMPT_VERSION = 'recap-eval-v1'
export const TEMPERATURE = 0.3
export const MAX_TOKENS = 500

export const RECAP_EVAL_SYSTEM = `你是 ReadLoop 的英语精读教师，正在评估学生对复盘题的回答。
规则：
1. 只评估这一道题的回答，不扩展成新课。
2. verdict 只能是：正确、部分正确、不正确。
3. comment 用中文指出对在哪里、不对在哪里（≤120 字）。
4. extension 可选：给一条与该题相关的知识扩展（≤150 字），没有就不给。
5. 不输出 Markdown 标题、代码围栏或额外字段。

只输出 JSON：{"verdict":"正确|部分正确|不正确","comment":"…","extension":"…"}`

export const RECAP_EVAL_REPAIR_HINT = `上次输出不是合法 JSON 或不符合评估结构要求。请只输出一个 JSON 对象，不要 Markdown 代码围栏或多余文字。
结构：{"verdict":"正确|部分正确|不正确","comment":"简短中文点评","extension":"可选知识扩展"}`

/** 评估 Schema（03-AI-SPEC §6.3） */
export const recapEvaluationSchema = z
  .object({
    verdict: z.enum(['正确', '部分正确', '不正确'], {
      errorMap: () => ({ message: 'verdict 只能是 正确/部分正确/不正确' })
    }),
    comment: z.string().min(1, 'comment 不能为空').max(300, 'comment 最长 300 字'),
    extension: z.string().max(300, 'extension 最长 300 字').optional()
  })
  .strict()

/**
 * @param {unknown} raw
 * @returns {{ verdict: '正确' | '部分正确' | '不正确', comment: string, extension?: string }}
 */
export function parseRecapEvaluation(raw) {
  const text = String(raw ?? '').trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text)
  let parsed
  try {
    parsed = JSON.parse(fenced ? fenced[1].trim() : text)
  } catch (error) {
    throw new AppError('AI_FORMAT', '评估输出不是合法 JSON', { cause: error })
  }
  const result = recapEvaluationSchema.safeParse(parsed)
  if (!result.success) {
    throw new AppError('AI_FORMAT', '评估输出结构不符合 Schema', {
      detail: result.error.issues.slice(0, 5).map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message
      }))
    })
  }
  return result.data
}

/**
 * 构造评估任务消息（03-AI-SPEC §6.2）。
 * @param {{ question: { stem: string, intent: string }, relatedSentences: string[], answer: string, referenceInfo: string }} input
 * @returns {string}
 */
export function buildRecapEvalTask({ question, relatedSentences, answer, referenceInfo }) {
  return [
    `【题目】${question.stem}`,
    `【考察点】${question.intent}`,
    `【相关句子】\n${relatedSentences.join('\n')}`,
    `【学生的回答】${answer}`,
    `【参考信息】\n${referenceInfo}`
  ].join('\n\n')
}

/**
 * 构造评估 messages。
 * @param {{ article: { title?: string, content?: string }, question: object, relatedSentences: string[], answer: string, referenceInfo: string }} input
 * @returns {{ role: 'system' | 'user', content: string }[]}
 */
export function buildRecapEvalMessages(input) {
  return [
    { role: 'system', content: RECAP_EVAL_SYSTEM },
    { role: 'user', content: buildArticlePrefix(input.article) },
    {
      role: 'user',
      content: buildRecapEvalTask({
        question: input.question,
        relatedSentences: input.relatedSentences,
        answer: input.answer,
        referenceInfo: input.referenceInfo
      })
    }
  ]
}
