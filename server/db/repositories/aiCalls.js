/**
 * ai_calls 仓库：每次逻辑 AI 调用一行（重试合并，03-AI-SPEC §1.3）。
 */

/**
 * @param {import('better-sqlite3').Database} db
 */
export function createAiCallsRepository(db) {
  const insertStmt = db.prepare(`
    INSERT INTO ai_calls
      (purpose, prompt_id, prompt_version, model, status, prompt_preview, error,
       duration_ms, input_tokens, output_tokens, created_at)
    VALUES
      (@purpose, @promptId, @promptVersion, @model, @status, @promptPreview, @error,
       @durationMs, @inputTokens, @outputTokens, @createdAt)
  `)
  const recentStmt = db.prepare('SELECT * FROM ai_calls ORDER BY id DESC LIMIT ?')

  return {
    /**
     * @param {{ purpose: string, promptId?: string | null, promptVersion?: string | null, model?: string | null, status: 'ok' | 'error' | 'degraded', promptPreview?: string | null, error?: string | null, durationMs?: number | null, inputTokens?: number | null, outputTokens?: number | null, createdAt: string }} input
     * @returns {number}
     */
    insert(input) {
      const result = insertStmt.run({
        purpose: input.purpose,
        promptId: input.promptId ?? null,
        promptVersion: input.promptVersion ?? null,
        model: input.model ?? null,
        status: input.status,
        promptPreview: input.promptPreview ?? null,
        error: input.error ?? null,
        durationMs: input.durationMs ?? null,
        inputTokens: input.inputTokens ?? null,
        outputTokens: input.outputTokens ?? null,
        createdAt: input.createdAt
      })
      return Number(result.lastInsertRowid)
    },

    /**
     * 最近 N 条（设置页/诊断用，M5 接入）。
     * @param {number} [limit]
     * @returns {object[]}
     */
    recent(limit = 50) {
      return recentStmt.all(limit)
    }
  }
}
