# 贡献指南

感谢你愿意改进 ReadLoop。提交前请先了解这几条约定。

## 开发环境

- Windows 10/11（托盘与安装脚本依赖 .NET Framework 的 `csc.exe`）
- Node.js 20+（推荐 22/24）
- 本地调试不要求 ECDICT 词典；划词查词与词库相关功能需要 `stardict.db`

```bat
npm ci
npm run dev            :: 服务 5178 + Vite 5173
npm run build          :: 构建前端到 server/public
npm test               :: 单元 + 集成（node:test）
npm run lint
npx playwright test    :: E2E，需要本机 Edge + dev-data/e2e/stardict.db
npm run mock:ai        :: 本地 Mock AI（5179），E2E 用
```

E2E 依赖词典：把 ECDICT 的 `stardict.db` 复制到 `dev-data/e2e/stardict.db`（该目录已 gitignore），否则词库相关用例会失败。

## 代码风格

- ESM、2 空格、不写分号、单引号；`npm run lint` / `npm run format` 使用仓库的 ESLint + Prettier 配置。
- Vue 组件放在 `web/src/components/<域>/`，单文件尽量 ≤ 400 行；颜色只用 `web/src/styles/tokens.css` 的变量，不在组件里写死色值。
- 服务端按 `routes → services → repositories` 分层：路由只做校验与响应，业务在 service，SQL 在 repository。
- 提示词改动：prompt 文件带版本号（如 `recap-q-v2.js`），改动行为时升版本并同步 `server/test/unit/*prompts*.test.js` 与文档。
- 数据/接口约定以 `docs/02-DATA-API.md` 为准；当前仓库保留 `docs/ARCHITECTURE.md` 作为总览。

## 提交 PR

1. 先开 issue 描述问题或需求（小改动可直接 PR）。
2. 一个 PR 只做一件事；附上复现步骤与验证命令输出。
3. 必须通过：`npm run lint`、`npm test`；涉及前端交互时尽量补 E2E。
4. 涉及 UI 的 PR 附截图（明/暗主题各一张更好）。
5. 提交信息用中文或英文皆可，建议 `fix(scope): ...` / `feat(scope): ...`。

## 安全与隐私

- 不要提交真实 API Key、个人文章、`%APPDATA%\readloop` 数据、日志或词典文件。
- 发现安全问题请私信维护者，不要在公开 issue 里贴 Key 或数据。

## 行为准则

保持友善、就事论事；不欢迎人身攻击、歧视性言论或与项目无关的推广。
