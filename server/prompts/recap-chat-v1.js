import { buildArticlePrefix } from './common.js'

/**
 * Prompt P5：复盘自由提问（03-AI-SPEC §7，prompt_version = recap-chat-v1）。
 * 流式自由 Markdown；消息写入 recap_sessions.messages_json；不占题号进度。
 */

export const PROMPT_ID = 'recap-chat'
export const PROMPT_VERSION = 'recap-chat-v1'
export const TEMPERATURE = 0.4
export const MAX_TOKENS = 1200
export const MAX_HISTORY_MESSAGES = 10

export const RECAP_CHAT_SYSTEM = `你是 ReadLoop 的英语精读教师，正在复盘环节回答学生的问题。
规则：只回答学生的问题，围绕文章、译文、复盘题或英语知识点；中文；可用 Markdown；不输出 JSON。`

/**
 * 把题组 + 作答 + 点评压缩为紧凑文本（03-AI-SPEC §7.2）。
 * @param {{ questions: object[], answers: object[] }} input
 * @returns {string}
 */
export function formatRecapQaSummary({ questions, answers }) {
  if (!Array.isArray(questions) || questions.length === 0) return '（暂无题目）'
  const answerById = new Map((answers ?? []).map((answer) => [answer.questionId, answer]))
  return questions
    .map((question) => {
      const answer = answerById.get(question.id)
      const status = answer?.skipped
        ? '跳过'
        : answer
          ? `回答：${answer.answer}｜点评：${answer.evaluation?.verdict ?? '（未评估）'}`
          : '未作答'
      return `第 ${question.id} 题（${question.type}）：${question.stem}｜${status}`
    })
    .join('\n')
}

/**
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
 * 构造复盘自由提问 messages：system → 文章前缀 → 任务（题组/作答 + 历史 + 本轮问题）。
 * @param {{ article: { title?: string, content?: string }, questions: object[], answers: object[], history: { role: string, content: string }[], message: string }} input
 * @returns {{ role: 'system' | 'user', content: string }[]}
 */
export function buildRecapChatMessages({ article, questions, answers, history, message }) {
  const task = [
    `【复盘题与作答（最近）】\n${formatRecapQaSummary({ questions, answers })}`,
    `【历史对话】\n${formatHistory(history)}`,
    `【本轮问题】${message}`
  ].join('\n\n')
  return [
    { role: 'system', content: RECAP_CHAT_SYSTEM },
    { role: 'user', content: buildArticlePrefix(article) },
    { role: 'user', content: task }
  ]
}
