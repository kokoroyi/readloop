import { buildArticlePrefix } from './common.js'

/**
 * Prompt P2：句内追问（03-AI-SPEC §4，prompt_version = followup-v1）。
 * 流式自由 Markdown；不做 JSON 校验。
 */

export const PROMPT_ID = 'followup'
export const PROMPT_VERSION = 'followup-v1'
export const TEMPERATURE = 0.4
export const MAX_TOKENS = 1200
/** 流式：格式非法/中断的判定与历史限制 */
export const MAX_HISTORY_MESSAGES = 10
export const STREAM_IDLE_TIMEOUT_MS = 30000
export const STREAM_TOTAL_TIMEOUT_MS = 180000

export const FOLLOWUP_SYSTEM = `你是 ReadLoop 的英语精读教师。用户会就当前句的翻译与批改结果继续提问。
规则：
1. 只回答被问的问题；若问题与当前句无关，简短说明后仍围绕当前句回答。
2. 用中文讲解；必要时给 1-2 个英文例句并附中文解释。
3. 不用“同学/您”，不用鼓励套话；直接、简洁。
4. 可使用 Markdown（段落/列表/加粗/行内代码），不要输出 JSON 或代码围栏包裹整段回答。`

/**
 * 把最近历史消息格式化为紧凑文本（角色标注，03-AI-SPEC §4.2）。
 * @param {{ role: string, content: string }[]} history
 * @returns {string}
 */
export function formatHistory(history) {
  if (!Array.isArray(history) || history.length === 0) return '（无）'
  return history
    .slice(-MAX_HISTORY_MESSAGES)
    .map((message) => `${message.role === 'assistant' ? '助手' : '用户'}：${message.content}`)
    .join('\n')
}

/**
 * 构造追问 messages：system 固定 → 文章前缀 → 任务（当前句/译文/批改/历史/本轮问题）。
 * @param {{
 *   article: { title?: string, content?: string },
 *   sentence: string,
 *   translation: string | null,
 *   correction: object | null,
 *   history: { role: string, content: string }[],
 *   message: string
 * }} input
 * @returns {{ role: 'system' | 'user', content: string }[]}
 */
export function buildFollowupMessages({
  article,
  sentence,
  translation,
  correction,
  history,
  message
}) {
  const correctionText = correction ? JSON.stringify(correction) : '（暂无批改结果）'
  const task = [
    `【当前句】${sentence}`,
    `【我的译文】${translation ?? '（尚未提交译文）'}`,
    `【批改结果】\n${correctionText}`,
    `【历史追问】\n${formatHistory(history)}`,
    `【本轮问题】${message}`
  ].join('\n\n')
  return [
    { role: 'system', content: FOLLOWUP_SYSTEM },
    { role: 'user', content: buildArticlePrefix(article) },
    { role: 'user', content: task }
  ]
}
