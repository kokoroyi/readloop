# 架构概览

ReadLoop 是一个**单机**英语精读工具：一个本地 Node 服务负责数据、AI 调用与页面托管，浏览器负责界面，Windows 托盘负责启动/停止与开机自启。没有 Electron、没有云端账号、没有本地模型。

```
┌────────────────┐   HTTP/SSE   ┌──────────────────────────┐
│ 浏览器（Vue 3） │ ───────────> │ Node + Express 5（5178）  │
│  Vite 构建 SPA  │ <─────────── │  /api/* + 静态资源        │
└────────────────┘              └───────┬──────────┬───────┘
                                        │          │
                                 SQLite │          │ OpenAI 兼容 /v1/chat/completions
                                        ▼          ▼
                          %APPDATA%\readloop\    用户配置的 AI 服务
                          ├─ readloop.db          （DeepSeek/OpenAI/本地网关均可）
                          ├─ stardict.db（ECDICT）
                          ├─ logs\
                          └─ backups\
```

## 目录

| 路径 | 说明 |
|---|---|
| `server/` | Express 服务：`routes/` 校验与响应、`services/` 业务、`db/repositories/` SQL、`prompts/` 版本化提示词、`lib/` 工具 |
| `server/db/schema.sql` | SQLite 表结构（articles / sentences / sentence_work / sessions / recap / summary / words / ai_calls / settings …） |
| `web/` | Vue 3 + Vite SPA：`pages/` 路由页、`components/` 按域拆分、`stores/` 状态、`styles/` 设计令牌与页面样式 |
| `test/e2e/` | Playwright E2E（本机 Edge + 真实后端 + Mock AI） |
| `tools/` | `setup.ps1`、Mock AI、词典校验、真实 AI 验收、清理工具 |
| `tray/` | WinForms 托盘源码（`Tray.cs`）与 `csc.exe` 编译脚本 |

## 关键数据流

1. **导入**：`POST /api/articles/import/preview` 解析 `.md`/`.txt`（标题拆节点、清洗 Markdown 任务标记）→ `import/commit` 事务写库并进入待读队列。
2. **精读**：`start` 创建阅读会话与逐句 work；每句 `submit` 调 `correct-v1`，AI 返回 `issues + referenceTranslation`；失败的句子保留可重试；`skip` 记为未完成。
3. **复盘**：全部句处理完后 `recap/start` 用 `recap-q-v2` 按逐句记录出题；逐题 `answer` 调 `recap-eval-v1`；`chat` 是 SSE 自由提问（`recap-chat-v1`）；`finish` 用 `summary-v1` 生成小结。
4. **统计**：阅读会话心跳累计 `active_seconds`（仅 ≥30 秒计入），按本地时区聚合日历与连续天数。

## AI 调用约定

- 所有任务走 `lib/aiClient.js`：全局串行队列 + 超时/重试/错误分类 + JSON 模式 + 失败降级（批改失败保留可重试、出题失败给通用题、小结失败给简版），**任何 AI 失败都不阻塞阅读**。
- 同一篇文章的所有调用共享**逐字节稳定的文章前缀**（`prompts/common.js`），便于命中服务商的前缀缓存；全文上限 12000 字符。
- 提示词按任务分文件并带版本号，`ai_calls` 记录用途、模型、耗时、tokens 与 prompt 版本（不存全文，仅 500 字预览）。

## 前端约定

- 设计令牌集中在 `web/src/styles/tokens.css`（纸感浅色 + 深色），组件不写死颜色。
- 精读视图为「B 句行稿纸」：左侧句子流 + 行内输入，右侧页边批注；复盘为「C 回合卡片 + 可缩放原文浮窗」。
- ADHD 阅读增强：Bionic 三段渐变 / 语义加粗 / 语义高亮，参数通过 CSS 变量由 `applyAppearance()` 注入，作用于句子正文。
- SSE 用于句内追问与复盘自由提问；其余请求为普通 JSON。

## 测试策略

- `server/test/unit`：解析器、提示词 schema、AI 客户端、统计/日历等纯逻辑。
- `server/test/integration`：临时数据目录起真实服务，用本地 Mock AI 覆盖批改/复盘/小结/词库/设置等闭环。
- `test/e2e`：Playwright 驱动真实浏览器，覆盖导入→精读→复盘→小结→导出、设置、词库、ADHD 等关键路径。

## 扩展点

- **换模型/供应商**：设置页填任意 OpenAI 兼容 `baseUrl/apiKey/model` 即可，无需改代码。
- **加 AI 任务**：在 `server/prompts/` 加版本化 prompt，在 service 里通过 `aiClient.chatJson/chatStream` 调用，并补对应单元/集成测试。
- **换 UI 主题**：改 `web/src/styles/tokens.css` 的语义令牌；深色主题用 `[data-theme="dark"]`。
