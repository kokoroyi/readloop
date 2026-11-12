#!/usr/bin/env node
/**
 * ReadLoop Mock AI —— 本地 OpenAI 兼容服务，用于开发联调与自动化测试。
 *
 * 端点：
 *   POST /v1/chat/completions  按 system 关键字识别任务并返回 fixture（支持 stream:true）
 *   GET  /v1/models            返回两个假模型
 *   POST /__reset              清空请求记录
 *   GET  /__requests           读取请求记录（断言 messages / 调用次数）
 *
 * 故障注入：请求头 x-mock-mode 优先，其次环境变量 MOCK_AI_MODE。
 *   success | invalid-json | timeout | http-500 | http-401 | rate-limit | slow | cancel
 *
 * 端口：--port、MOCK_AI_PORT 或 5179。
 * 用法：npm run mock:ai
 */

import http from 'node:http'

const PORT = Number(process.env.MOCK_AI_PORT || process.env.PORT || 5179)
const MODELS = ['mock-model', 'mock-model-2']

/** 已收到的请求记录（测试断言用） */
const requests = []

/** 各任务 fixture（与 03-AI-SPEC 的 JSON 结构一致） */
const FIXTURES = {
  correct: {
    type: 'json',
    body: {
      issues: [
        {
          type: '误译',
          fragment: '几乎空无一人',
          explain: 'almost empty 指“几乎没有人”，不是“很安静”；这里混了程度和对象，译文偏差。'
        }
      ],
      referenceTranslation: '我到的时候，安静的图书馆几乎空无一人。'
    }
  },
  followup: {
    type: 'text',
    body:
      '这句话里 `quiet` 是形容词作定语，修饰 `library`。\n\n' +
      '补充：`quiet`（安静的）是形容词，`quietly`（安静地）是副词；`almost` 表示“几乎”，常与形容词连用。'
  },
  'recap-questions': {
    type: 'json',
    body: {
      questions: [
        {
          id: 1,
          type: '理解',
          stem: '作者为什么在图书馆一直待到太阳落山？',
          intent: '考察对开篇情节与时间线索的理解',
          sentenceRefs: [3, 4]
        },
        {
          id: 2,
          type: '翻译',
          stem: '请翻译：The quiet library was almost empty when I arrived.',
          intent: '考察 almost 与 quiet 的准确表达',
          sentenceRefs: [0]
        },
        {
          id: 3,
          type: '语法',
          stem: '文中「a shelf of travel books」为什么用 of 短语？',
          intent: '考察名词所有格与介词短语作定语',
          sentenceRefs: [2]
        }
      ]
    }
  },
  'recap-evaluate': {
    type: 'json',
    body: {
      verdict: '部分正确',
      comment: '方向对，但漏掉了“窗边的座位”这一细节。',
      extension: '注意 almost 的位置：almost empty 表示“几乎空无一人”，不能译成“非常安静”。'
    }
  },
  'recap-chat': {
    type: 'text',
    body:
      '## 问题一：the last page 指什么\n\n' +
      '`the last page` 指**祖父笔记本的最后一页**，也是全文情绪落点。\n\n' +
      '- 先指出字面指代，再说它在文中的作用\n' +
      '- 只回答“最后一页”会显得过于抽象\n\n' +
      '### 对比表\n\n' +
      '| 原句 | 你的译法 | 更贴的译法 |\n' +
      '|---|---|---|\n' +
      '| almost empty | 几乎空无一人 | 几乎没什么人 |\n' +
      '| pointed me to | 指给我 | 示意我去 |\n\n' +
      '---\n\n' +
      '> 提示：复盘自由提问的 Markdown 应正常渲染（标题/列表/表格/分隔线）。'
  },
  summary: {
    type: 'json',
    body: {
      overview: '本文以一次图书馆经历切入，复习了过去时叙事、形容词作定语与介词短语等要点。',
      issueSummary: { 误译: 2, 漏译: 1, 理解偏差: 1 },
      knowledgePoints: [
        { title: '过去时叙事中的动作顺序', explain: '按时间先后使用一般过去时，避免时态跳跃。', example: 'I found a seat and opened my notebook.' },
        { title: 'quiet 的用法', explain: 'quiet 作定语修饰名词；副词形式为 quietly。', example: 'The library was quiet.' }
      ],
      weakSentences: [{ idx: 3, reason: '漏译了 almost 的“几乎”' }],
      suggestions: ['下篇先读一遍再逐句译', '注意副词与形容词的区分']
    }
  }
}

/** 根据 system 内容识别任务（与 05-TEST-IMPL-PLAN §2.2 一致） */
function detectPurpose(messages) {
  const system = messages
    .filter((m) => m && m.role === 'system')
    .map((m) => String(m.content || ''))
    .join('\n')
  if (system.includes('逐句中译练习')) return 'correct'
  if (system.includes('出开放题')) return 'recap-questions'
  if (system.includes('评估学生对复盘题的回答')) return 'recap-evaluate'
  if (system.includes('复盘环节回答学生的问题')) return 'recap-chat'
  if (system.includes('生成一份学习小结')) return 'summary'
  if (system.includes('继续提问') || system.includes('英语精读教师')) return 'followup'
  return 'test'
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  })
  res.end(body)
}

function readJson(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        resolve({})
      }
    })
  })
}

function chatPayload(content, { stream, model }) {
  const id = `mock-${Date.now()}`
  if (!stream) {
    return {
      id,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: model || 'mock-model',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 80, total_tokens: 180 }
    }
  }
  return { id, object: 'chat.completion.chunk', model: model || 'mock-model' }
}

function streamText(res, content, { cancelAfter = null } = {}) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  })
  const chunks = content.match(/[\s\S]{1,12}/g) || ['']
  let i = 0
  const timer = setInterval(() => {
    if (cancelAfter != null && i >= cancelAfter) {
      clearInterval(timer)
      res.destroy()
      return
    }
    if (i >= chunks.length) {
      clearInterval(timer)
      res.write('data: [DONE]\n\n')
      res.end()
      return
    }
    const piece = { choices: [{ index: 0, delta: { content: chunks[i++] } }] }
    res.write(`data: ${JSON.stringify(piece)}\n\n`)
  }, 20)
  return timer
}

function withDelay(ms, fn) {
  setTimeout(fn, ms)
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)

  if (req.method === 'GET' && url.pathname === '/v1/models') {
    sendJson(res, 200, { object: 'list', data: MODELS.map((id) => ({ id, object: 'model' })) })
    return
  }

  if (req.method === 'POST' && url.pathname === '/__reset') {
    requests.length = 0
    sendJson(res, 200, { ok: true })
    return
  }

  if (req.method === 'GET' && url.pathname === '/__requests') {
    sendJson(res, 200, { ok: true, count: requests.length, requests })
    return
  }

  if (req.method === 'GET' && url.pathname === '/__health') {
    sendJson(res, 200, { ok: true, service: 'mock-ai', port: PORT })
    return
  }

  if (req.method !== 'POST' || url.pathname !== '/v1/chat/completions') {
    sendJson(res, 404, { error: { message: 'not found', type: 'invalid_request_error' } })
    return
  }

  const body = await readJson(req)
  const mode = req.headers['x-mock-mode'] || process.env.MOCK_AI_MODE || 'success'
  const purpose = detectPurpose(body.messages || [])
  requests.push({
    at: new Date().toISOString(),
    mode: String(mode),
    purpose,
    stream: Boolean(body.stream),
    model: body.model || null,
    messages: body.messages || [],
    temperature: body.temperature ?? null,
    response_format: body.response_format ?? null
  })

  if (mode === 'http-500') {
    sendJson(res, 500, { error: { message: 'mock upstream error', type: 'server_error' } })
    return
  }
  if (mode === 'http-401') {
    sendJson(res, 401, { error: { message: 'mock unauthorized', type: 'authentication_error' } })
    return
  }
  if (mode === 'rate-limit') {
    sendJson(res, 429, { error: { message: 'mock rate limited', type: 'rate_limit_error' } })
    return
  }
  if (mode === 'timeout') {
    // 故意不返回，等客户端超时（进程退出时自动清理）
    return
  }
  if (mode === 'invalid-json') {
    const payload = chatPayload('not json at all', { stream: Boolean(body.stream), model: body.model })
    if (body.stream) streamText(res, 'not json at all')
    else sendJson(res, 200, payload)
    return
  }

  const fixture = FIXTURES[purpose] || { type: 'text', body: 'pong' }
  const content = fixture.type === 'json' ? JSON.stringify(fixture.body) : fixture.body

  const start = () => {
    if (body.stream) {
      streamText(res, content, { cancelAfter: mode === 'cancel' ? 2 : null })
    } else {
      sendJson(res, 200, chatPayload(content, { stream: false, model: body.model }))
    }
  }

  if (mode === 'slow') withDelay(3000, start)
  else start()
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-ai] listening on http://127.0.0.1:${PORT}`)
  console.log(`[mock-ai] models: ${MODELS.join(', ')}`)
  console.log('[mock-ai] modes: success | invalid-json | timeout | http-500 | http-401 | rate-limit | slow | cancel')
})


