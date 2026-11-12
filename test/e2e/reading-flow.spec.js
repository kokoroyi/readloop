import { test, expect } from '@playwright/test'
import { configureMockAi, createArticle, resetSettings, uniqueSuffix } from './helpers.js'

/**
 * E2E-3 完整精读（05-TEST-IMPL-PLAN §4）：
 * 提交 → 批改 → 追问 → 折叠 → 跳过 → 刷新恢复。
 * 依赖 tools/mock-ai.mjs 的 correct/followup fixture（playwright.config 已拉起）。
 */
test.describe('E2E-3 精读闭环', () => {
  test.beforeEach(async ({ request }) => {
    await resetSettings(request)
    await configureMockAi(request)
  })

  test('提交译文、批改、追问、折叠、跳过、刷新恢复', async ({ page, request }) => {
    const token = uniqueSuffix()
    const article = await createArticle(request, {
      title: `E2E flow ${token}`,
      content:
        'The quiet library was almost empty when I arrived. I found a seat near the window and opened my notebook. ' +
        'The old librarian was very kind, but I did not look up. ' +
        'A woman in a red coat was reading poems by the door.'
    })

    try {
      await page.goto(`/read/${article.id}`)
      const rows = page.locator('.sentence-row')
      await expect(rows).toHaveCount(4)

      // 第 1 句：提交译文
      const first = rows.nth(0)
      await expect(first).toHaveClass(/current/)
      await first.locator('input.answer-input').fill('我到的时候图书馆几乎没人。')
      await first.locator('button[aria-label="提交译文"]').click()

      // 阻塞等待批改：submitting → corrected
      await expect(first).toHaveClass(/status-submitting/, { timeout: 10_000 })
      await expect(first).toHaveClass(/status-corrected/, { timeout: 30_000 })

      const note = first.locator('.margin-note')
      await expect(note).toBeVisible()
      // 展开态：问题条目 + 参考译文 + 我的译文
      await expect(note.locator('.issue-item').first()).toBeVisible()
      await expect(note.locator('.issue-type').first()).toContainText(/漏译|误译|理解偏差/)
      await expect(note.locator('.ref-translation')).toBeVisible()
      await expect(note.locator('.my-translation')).toBeVisible()

      // 折叠 → 摘要
      const head = note.locator('.margin-note-head')
      await expect(head).toHaveAttribute('aria-expanded', 'true')
      await head.click()
      await expect(head).toHaveAttribute('aria-expanded', 'false')
      await expect(note.locator('.margin-summary')).toBeVisible()
      await head.click()
      await expect(head).toHaveAttribute('aria-expanded', 'true')

      // 句内追问（SSE）
      await note.locator('.chat-input').fill('为什么这里用过去时？')
      await note.getByRole('button', { name: '发送追问' }).click()
      const assistant = note.locator('.chat-bubble.assistant').first()
      await expect(assistant).toBeVisible({ timeout: 20_000 })
      await expect(assistant).toContainText(/quiet|形容词|表语|补充/)

      // 第 2 句：先点「下一句」推进，再跳过
      await first.getByRole('button', { name: '下一句' }).click()
      const second = rows.nth(1)
      await expect(second).toHaveClass(/current/)
      // 「下一句」即刻收起上一句批注（不用等下一句提交）
      await expect(first.locator('.margin-note-head')).toHaveAttribute('aria-expanded', 'false')
      await second.locator('button[aria-label="跳过这句"]').click()
      const dialog = page.getByRole('dialog')
      await dialog.getByRole('button', { name: /跳过/ }).click()
      await expect(second).toHaveClass(/status-skipped/)
      await expect(page.locator('.read-meta').first()).toContainText('已处理 2')

      // 刷新：状态 / 批改内容 / 追问 全部恢复
      await page.reload()
      await expect(rows.nth(0)).toHaveClass(/status-corrected/)
      await expect(rows.nth(1)).toHaveClass(/status-skipped/)
      await expect(rows.nth(0).locator('.ref-translation')).toBeVisible()
      await expect(rows.nth(0).locator('.chat-bubble.assistant').first()).toBeVisible()
      await expect(page.locator('.sentence-row.current')).toHaveCount(1)
    } finally {
      await request.delete(`/api/articles/${article.id}`)
    }
  })

  test('AI 未配置时给出引导，不产生错误状态', async ({ page, request }) => {
    // 覆盖 beforeEach 的 Mock 配置：清空 Key
    await request.put('/api/settings', { data: { ai: { apiKey: '' } } })
    const token = uniqueSuffix()
    const article = await createArticle(request, {
      title: `E2E noai ${token}`,
      content: 'First sentence here. Second sentence follows it.'
    })
    try {
      await page.goto(`/read/${article.id}`)
      await expect(page.locator('.ai-banner')).toBeVisible()
      await expect(page.locator('.ai-banner')).toContainText('AI 未配置')
      const first = page.locator('.sentence-row').first()
      // 未配置时输入框禁用，提交按钮换成「去设置 AI」引导
      await expect(first.locator('input.answer-input')).toBeDisabled()
      await expect(first.getByRole('button', { name: '去设置 AI' })).toBeVisible()
      await expect(first).toHaveClass(/status-pending/)
    } finally {
      await request.delete(`/api/articles/${article.id}`)
    }
  })
})
