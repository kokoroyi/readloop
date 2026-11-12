import { test, expect } from '@playwright/test'
import { configureMockAi, createArticle, resetSettings, uniqueSuffix } from './helpers.js'

/**
 * E2E-4 复盘与小结（05-TEST-IMPL-PLAN §4）+ E2E-6 重新精读。
 * 数据准备：Mock AI 下把一篇文章的句子全部提交批改，再走 UI 进入复盘。
 * 注意 C 回合卡片一次只展开一题：已答题目折叠保留，未到题目不渲染。
 */

/** 把文章所有句子提交一遍（Mock AI 即时返回）。 */
async function processAllSentences(request, articleId, sentenceCount) {
  const translations = [
    '我到的时候图书馆几乎没人。',
    '我有个很好的座位。',
    '这位老馆员很和善，但我没有抬头。',
    '一个年轻男人和一个年轻女人坐在我后面。',
    '他们大声说话。'
  ]
  for (let idx = 0; idx < sentenceCount; idx += 1) {
    const res = await request.post(`/api/articles/${articleId}/sentences/${idx}/submit`, {
      data: { translation: translations[idx % translations.length] }
    })
    if (!res.ok()) throw new Error(`提交第 ${idx} 句失败：${res.status()} ${await res.text()}`)
  }
}

/** 回答第 index 个回合卡片并等待评估（Mock AI 即时返回）。 */
async function answerTurn(page, index, text) {
  const turn = page.locator('.recap-turn').nth(index)
  await expect(turn).toHaveClass(/is-current/)
  await turn.locator('textarea[aria-label="回答输入"]').fill(text)
  await turn.locator('button[aria-label="发送回答"]').click()
  // 作答后卡片可能自动折叠为摘要（评估内容变成摘要文案），所以等整卡出现判定词
  await expect(turn).toContainText(/部分正确|正确|不正确/, { timeout: 30_000 })
  return turn
}

test.describe('E2E-4 复盘与小结', () => {
  test.beforeEach(async ({ request }) => {
    await resetSettings(request)
    await configureMockAi(request)
  })

  test('进入复盘 → 作答 → 跳题 → 自由提问 → 浮窗 → 小结 → 笔记 → 导出 → 重新精读', async ({
    page,
    request
  }) => {
    const token = uniqueSuffix()
    const article = await createArticle(request, {
      title: `E2E recap ${token}`,
      content:
        'The quiet library was almost empty when I arrived. I found a seat near the window and opened my notebook. ' +
        'The old librarian was very kind, but I did not look up. ' +
        'A woman in a red coat was reading poems by the door. She looked up and asked if I enjoyed the book.'
    })

    try {
      await request.post(`/api/articles/${article.id}/start`)
      await processAllSentences(request, article.id, 5)

      await page.goto(`/read/${article.id}`)
      await expect(page.locator('.complete-banner')).toBeVisible()
      await page.locator('button[aria-label="进入复盘"]').click()

      // 复盘：一次一题（Mock 出题 3 题）
      await expect(page.locator('.recap-topbar')).toContainText('第 1 / 3 题', { timeout: 20_000 })
      await expect(page.locator('.recap-turn')).toHaveCount(1)
      await expect(page.locator('.turn-stem').first()).not.toBeEmpty()

      // 第 1 题作答 → 评估
      const firstTurn = await answerTurn(page, 0, '作者因为后排吵闹，没能听清演员。')
      await expect(firstTurn.locator('.eval-extension')).toBeVisible()
      await expect(page.locator('.recap-topbar')).toContainText('第 2 / 3 题')
      await expect(page.locator('.recap-turn')).toHaveCount(2)

      // 第 2 题：跳过
      await page.locator('button[aria-label="跳过本题"]').click()
      const dialog = page.getByRole('dialog')
      if (await dialog.isVisible().catch(() => false)) {
        await dialog.getByRole('button', { name: /跳过/ }).click()
      }
      await expect(page.locator('.recap-topbar')).toContainText('第 3 / 3 题')

      // 自由提问（SSE）
      const chat = page.locator('.recap-chat')
      await chat.locator('.recap-chat-input').fill('这篇文章主要想表达什么？')
      await chat.locator('button[aria-label="发送提问"]').click()
      await expect(chat.locator('.recap-bubble.assistant').first()).toBeVisible({ timeout: 20_000 })

      // 原文浮窗：折叠 / 关闭 / 恢复
      await expect(page.locator('.float-window')).toBeVisible()
      await expect(page.locator('.float-window .float-body')).toBeVisible()
      await page.locator('button[aria-label="折叠原文浮窗"]').click()
      await expect(page.locator('.float-window .float-body')).toHaveCount(0)
      await page.locator('button[aria-label="折叠原文浮窗"]').click()
      await expect(page.locator('.float-window .float-body')).toBeVisible()
      await page.locator('button[aria-label="关闭原文浮窗"]').click()
      await expect(page.locator('.float-window')).toHaveCount(0)
      await page.locator('button[aria-label="显示原文"]').click()
      await expect(page.locator('.float-window')).toBeVisible()

      // 第 3 题作答后结束复盘
      await answerTurn(page, 2, '文章描述了作者一次不愉快的图书馆经历。')
      await page.locator('button[aria-label="结束并生成小结"]').click()
      const finishDialog = page.getByRole('dialog')
      await finishDialog.getByRole('button', { name: /结束|生成/ }).click()

      // 小结页
      await expect(page).toHaveURL(/\/read\/\d+\/summary/, { timeout: 30_000 })
      await expect(page.locator('.summary-title')).toBeVisible()
      await expect(page.locator('.summary-overview')).not.toBeEmpty()
      await expect(page.locator('.issue-chips')).toBeVisible()
      await expect(page.locator('.cmp-row').first()).toBeVisible()
      await expect(page.locator('.kp-item').first()).toBeVisible()

      // 笔记自动保存 + 刷新保持
      const notes = page.locator('textarea.summary-notes')
      await notes.fill('复盘笔记：注意 quiet 与 quietly 的区别。')
      await page.waitForTimeout(1800)
      await page.reload()
      await expect(page.locator('textarea.summary-notes')).toHaveValue(/library/)

      // 导出 Markdown
      const downloadPromise = page.waitForEvent('download')
      await page.locator('button[aria-label="导出 Markdown"]').click()
      const download = await downloadPromise
      expect(download.suggestedFilename()).toMatch(/readloop-summary-\d+\.md/)

      // 重新精读
      await page.locator('button[aria-label="重新精读"]').click()
      const rereadDialog = page.getByRole('dialog')
      await rereadDialog.getByRole('button', { name: /重新精读/ }).click()
      await expect(page).toHaveURL(new RegExp(`/read/${article.id}$`), { timeout: 20_000 })
      await expect(page.locator('.sentence-row').first()).toBeVisible()
      await expect(page.locator('.read-meta').first()).toContainText('已处理 0')
    } finally {
      await request.delete(`/api/articles/${article.id}`)
    }
  })
})

