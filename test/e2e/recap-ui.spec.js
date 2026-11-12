import { test, expect } from '@playwright/test'
import { configureMockAi, createArticle, resetSettings, uniqueSuffix } from './helpers.js'

/**
 * 复盘视图 UI（M7 迭代）：
 * 回合卡片手动折叠（当前/非当前题）、自由提问 Markdown（标题/表格/分隔线）渲染、
 * 消息区拖拽调高与记忆、textarea Enter/Shift+Enter、只读态隐藏拖拽手柄。
 */

async function seedRecap(request) {
  const token = uniqueSuffix()
  const article = await createArticle(request, {
    title: `E2E recap ui ${token}`,
    content:
      'The quiet library was almost empty when I arrived. I found a seat near the window and opened my notebook. ' +
      'The old librarian was very kind, but I did not look up.'
  })
  await request.post(`/api/articles/${article.id}/start`)
  for (let idx = 0; idx < 3; idx += 1) {
    const res = await request.post(`/api/articles/${article.id}/sentences/${idx}/submit`, {
      data: { translation: `第 ${idx + 1} 句译文。` }
    })
    if (!res.ok()) throw new Error(`submit 失败：${res.status()} ${await res.text()}`)
  }
  const start = await request.post(`/api/articles/${article.id}/recap/start`)
  if (!start.ok()) throw new Error(`recap/start 失败：${start.status()} ${await start.text()}`)
  const recap = await start.json()
  // 先在接口层答第 1 题，让页面进入「1 已答 + 1 当前」状态
  const answer = await request.post(`/api/articles/${article.id}/recap/answer`, {
    data: { questionId: recap.recap.questions[0].id, answer: '接口预置的第 1 题答案。' }
  })
  if (!answer.ok()) throw new Error(`answer 失败：${answer.status()} ${await answer.text()}`)
  return article
}

async function finishRecap(page, articleId) {
  await page.goto(`/read/${articleId}`)
  await page.locator('button[aria-label="结束并生成小结"]').click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: /结束|生成/ }).click()
  await expect(page).toHaveURL(/\/read\/\d+\/summary/, { timeout: 30_000 })
}

test.describe('复盘视图 UI', () => {
  test.beforeEach(async ({ request }) => {
    await resetSettings(request)
    await configureMockAi(request)
    // 关闭原文浮窗默认打开，避免遮挡自由提问发送按钮
    await request.put('/api/settings', { data: { recap: { floatWindowDefaultOpen: false } } })
  })

  test.afterEach(async ({ request }) => {
    // 恢复默认，避免影响其它用例（浮窗默认打开）
    await request.put('/api/settings', {
      data: { recap: { floatWindowDefaultOpen: true, showReference: true } }
    })
  })

  test('卡片可手动折叠/展开，当前题折叠后仍可下一题', async ({ page, request }) => {
    const article = await seedRecap(request)
    try {
      await page.goto(`/read/${article.id}`)
      const turns = page.locator('.recap-turn')
      await expect(turns).toHaveCount(2, { timeout: 20_000 })

      // 第 1 题（已答、折叠）：点头部展开
      const first = turns.nth(0)
      await expect(first.locator('.turn-body')).toHaveCount(0)
      await first.locator('.turn-head-toggle').click()
      await expect(first.locator('.turn-body')).toBeVisible()

      // 再收起
      await first.locator('button[aria-label="收起本题"]').click()
      await expect(first.locator('.turn-body')).toHaveCount(0)
      await expect(first.locator('.turn-expand')).toContainText('展开')

      // 当前题作答 → 保持展开；再手动收起；折叠摘要行仍有「下一题」
      const current = turns.nth(1)
      await current.locator('textarea[aria-label="回答输入"]').fill('界面作答的第二题答案。')
      await current.locator('button[aria-label="发送回答"]').click()
      await expect(current.locator('.turn-eval')).toBeVisible({ timeout: 30_000 })
      await expect(current.locator('.turn-body')).toBeVisible()
      await current.locator('button[aria-label="收起本题"]').click()
      await expect(current.locator('.turn-body')).toHaveCount(0)
      const nextInHead = current.locator('button[aria-label="下一题"]')
      await expect(nextInHead).toBeVisible()
      await nextInHead.click()

      // 进入第 3 题；上一题保持折叠
      await expect(page.locator('.recap-topbar')).toContainText(/第 3 \/ \d+ 题/)
      await expect(turns).toHaveCount(3)
      await expect(turns.nth(1).locator('.turn-body')).toHaveCount(0)
    } finally {
      await request.delete(`/api/articles/${article.id}`)
    }
  })

  test('自由提问渲染 Markdown（标题/表格/分隔线），消息区可拖拽调高并记忆', async ({
    page,
    request
  }) => {
    const article = await seedRecap(request)
    try {
      await page.goto(`/read/${article.id}`)
      const chat = page.locator('.recap-chat')
      await expect(chat).toBeVisible({ timeout: 20_000 })

      // textarea：Shift+Enter 换行不发送
      const input = chat.locator('.recap-chat-input')
      await expect(input).toHaveJSProperty('tagName', 'TEXTAREA')
      await input.fill('第一行')
      await input.press('Shift+Enter')
      await input.type('第二行')
      await expect(input).toHaveValue(/第一行\n第二行/)
      await input.fill('')

      // 发送 → Mock AI 返回含标题/列表/引用/表格/分隔线的 Markdown
      await input.fill('这篇文章的结构是什么？')
      await chat.locator('button[aria-label="发送提问"]').click()
      const bubble = chat.locator('.recap-bubble.assistant').first()
      await expect(bubble).toBeVisible({ timeout: 20_000 })
      await expect(bubble.locator('.md-heading').first()).toBeVisible()
      await expect(bubble.locator('[data-md-table]')).toBeVisible()
      await expect(bubble.locator('[data-md-table] th').first()).toBeVisible()
      await expect(bubble.locator('.md-hr').first()).toBeVisible()
      await expect(bubble).not.toContainText('| did not pay')

      // 拖拽手柄调高（向上拖 80px）
      const resizer = page.locator('[data-chat-resizer]')
      await expect(resizer).toBeVisible()
      const list = page.locator('.recap-chat-list')
      const before = (await list.boundingBox()).height
      await resizer.scrollIntoViewIfNeeded()
      await page.waitForTimeout(100)
      const handle = await resizer.boundingBox()
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
      await page.mouse.down()
      await page.mouse.move(handle.x + handle.width / 2, handle.y - 80, { steps: 10 })
      await page.mouse.up()
      await expect
        .poll(async () => Math.abs((await list.boundingBox()).height - before))
        .toBeGreaterThan(40)
      const savedHeight = await page.evaluate(() => localStorage.getItem('rl.recapChatHeight'))
      expect(Number(savedHeight)).toBeGreaterThan(0)

      // 刷新保持；双击复位
      await page.reload()
      const reloadedHeight = (await page.locator('.recap-chat-list').boundingBox()).height
      expect(Math.abs(reloadedHeight - Number(savedHeight))).toBeLessThan(8)
      await page.locator('[data-chat-resizer]').dblclick()
      await expect
        .poll(async () => (await page.locator('.recap-chat-list').boundingBox()).height)
        .toBeLessThan(reloadedHeight - 20)

      // 结束复盘 → done 只读页：无拖拽手柄、显示只读提示、历史 Markdown 表格仍渲染
      await finishRecap(page, article.id)
      await page.goto(`/read/${article.id}`)
      await expect(page.locator('.recap-chat-readonly')).toBeVisible({ timeout: 20_000 })
      await expect(page.locator('[data-chat-resizer]')).toHaveCount(0)
      await expect(page.locator('.recap-bubble.assistant [data-md-table]').first()).toBeVisible()
    } finally {
      await request.delete(`/api/articles/${article.id}`)
    }
  })
})






