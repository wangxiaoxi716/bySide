# bySide 的 Cloudflare Pages 部署

## 项目与部署范围

| 项目 | 配置 |
| --- | --- |
| 源仓库 | https://github.com/wangxiaoxi716/bySide |
| 首次适配的源提交 | `855157042cbeb1d1ddf5018e185445f4a5ee530c` |
| Cloudflare Pages 项目名 | `byside` |
| Cloudflare 分配的默认域名 | `byside-49n.pages.dev` |
| 目标自定义域名 | `byside.purechaosspace.com` |
| 部署方式 | GitHub Actions 在 main 推送后执行 Wrangler Direct Upload |
| 工作流 | `.github/workflows/deploy-cloudflare.yml` |
| 工作目录 | 仓库内的 `yatuan-companion/` |
| 配置文件 | `yatuan-companion/wrangler.jsonc` |
| 静态资源目录 | `yatuan-companion/dist/` |
| 兼容日期 | `2026-08-06` |

静态页面直接由 Pages 提供；`dist/_routes.json` 仅将 `/api/*` 交给 `functions/api/[[path]].js`。云端函数使用 Web Request/Response，不运行 Node HTTP 服务器，也不读取本地 `.env`。

`server.mjs` 保留为原有的本机运行方式，使用 `npm run dev` 启动。仓库根目录的 Java/Spring 服务未被这套前端使用，因此不包含在本次部署中。

现有 Pages 项目继续使用 Direct Upload，由 GitHub Actions 负责自动执行上传。工作流与所需源文件进入远端 `main`、并配置好下面的部署 Secret 后，**main 的任何 push 都会触发检查和部署**，不设置文件路径过滤。因此仅修改文档或 Java 文件也会触发工作流，但发布范围始终只有 `yatuan-companion/dist/`、`yatuan-companion/functions/` 及其 Wrangler 配置，不部署 Java 服务或本机 Node 服务。

自动部署直接读取 GitHub 上该次提交的文件。必须将 `.github/workflows/deploy-cloudflare.yml`、`yatuan-companion/wrangler.jsonc`、`functions/`、Cloudflare 测试，以及本次改过的 `dist/` 文件提交并合并到 `main`；只修改本地文件不会更新线上站点。仓库中的 `dist/` 就是待发布内容，当前工作流没有另行生成前端构建产物的步骤。

## GitHub 自动部署配置

在仓库的 **Settings → Secrets and variables → Actions** 配置：

| 名称 | 保存位置 | 是否必需 | 用途 |
| --- | --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | Repository secret | 是 | 授权工作流向现有 Cloudflare Pages 项目发布 |
| `CLOUDFLARE_ACCOUNT_ID` | Repository variable | 否 | 覆盖目标账户；未设置时回退为 `e6ebca3973fc52dc5a1c00e82d70961f` |

部署 Token 应拥有目标 Cloudflare 账户的 Pages 编辑/部署权限。Token 值只写入 GitHub Secret，不写入代码、工作流或本文档。工作流仅在部署步骤注入它；GitHub 自带的 `GITHUB_TOKEN` 只使用 `contents: read` 权限，用于读取仓库和确认最新 main 提交。

工作流使用 Node.js 22、固定版本的官方 GitHub checkout/setup-node Actions，以及 Wrangler `4.118.0`，不需要安装第三方 GitHub App。流程是：

1. 检出触发本次执行的提交，运行 `npm run check` 和 `node --test tests/cloudflare*.test.mjs`。
2. 通过 GitHub API 检查该提交仍是 `main` 最新提交；过时的排队执行或旧提交重跑会跳过发布。
3. 从 `yatuan-companion/` 上传 `dist/` 并打包 `functions/`，发布到已有 `byside` 项目的 `main` 生产分支。

同一分支的工作流串行执行，不中断已经开始的上传，避免旧上传在新版本之后才完成。校验失败或上传未成功时，工作流不会主动删除或停用当前生产版本，Pages 继续提供上一个成功部署。已知原仓库的全量测试存在基线失败，因此自动部署只运行上述语法检查和 Cloudflare 定向测试，不运行 `npm test`。

日常更新时，正常提交并 push/合并到 `main` 即可。在 GitHub **Actions → Deploy bySide to Cloudflare Pages** 查看执行记录；也可以使用 **Run workflow** 手动运行并选择 `main`。手动选择其他分支时，发布任务会跳过。

自动部署是否已实际验证，请看本文末尾的独立记录；首次手动上线成功不等同于 GitHub Actions 已验证。

## 云端变量和 Secrets

| 名称 | 类型 | 用途 |
| --- | --- | --- |
| `YATUAN_AI_ENDPOINT` | 环境变量 | 完整的 HTTPS Chat Completions 地址，由服务端固定 |
| `YATUAN_AI_MODEL` | 环境变量 | 服务端使用的模型名称 |
| `YATUAN_AI_KEY` | Secret | AI 上游鉴权密钥 |
| `YATUAN_TTS_KEY` | Secret | 豆包 TTS 上游鉴权密钥 |

接口和模型的默认配置位于 `wrangler.jsonc` 的 `vars`。`YATUAN_AI_KEY` 和 `YATUAN_TTS_KEY` 是应用运行时密钥，仍保存在现有 Cloudflare Pages 项目的 Secrets 中，自动发布会沿用这些配置；无需复制到 GitHub。GitHub 的 `CLOUDFLARE_API_TOKEN` 仅用于部署，不承担 AI/TTS 鉴权。不要把任何密钥写进 `dist/`、配置文件、代码、提交记录或本文档。

可以在 Cloudflare 控制台中进入 **Workers & Pages → byside → Settings → Variables and Secrets**，为 Production 设置 Secrets；也可以从 `yatuan-companion/` 使用交互式命令输入：

```sh
npx wrangler@4.118.0 pages secret put YATUAN_AI_KEY --project-name byside
npx wrangler@4.118.0 pages secret put YATUAN_TTS_KEY --project-name byside
```

修改变量或 Secrets 后可在 GitHub Actions 手动运行 main 工作流，使新部署使用更新的配置。需要预览环境时，单独检查其变量和 Secrets，避免把 Production 配置已完成等同于 Preview 已完成；当前工作流只发布 Production。

三个接口保持与前端兼容：

- `GET /api/health`：返回 `configured`、公开模型名和同源聊天接口地址，不返回密钥或真实上游地址。
- `POST /api/chat/completions`：使用云端配置的接口、模型和密钥，接受经过校验的聊天和图片内容。
- `POST /api/tts`：使用独立 TTS Secret，返回 MP3 音频；无需同时配置 AI 密钥。

AI 配置不完整时 health 返回 `configured: false`，聊天请求返回 `503 not_configured`。TTS 密钥缺失时对应请求返回 `503 not_configured`。前端会探测云端的同源 API，并保留用户已经设置的自定义代理地址。

## 本地检查与手动发布备用命令

以下命令均在仓库的 `yatuan-companion/` 目录执行。本地建议使用与工作流一致的 Node.js 22；本机运行的最低要求仍是 Node.js 20。手动发布另外需要已登录目标 Cloudflare 账号或配置好部署 Token 的 Wrangler。

```sh
npm run check
node --check 'functions/api/[[path]].js'
node --test tests/cloudflare*.test.mjs
```

2026-10-17 本地执行 `node --test tests/cloudflare*.test.mjs`：**16 项通过、0 项失败**。其中 15 项覆盖云端 API 的输入验证、同源策略、固定上游配置、密钥隔离、超时、体积限制、限流和 TTS；另 1 项验证 HTTPS 线上页面自动发现同源 AI，同时不覆盖用户的自定义代理。

常规更新由 main push 自动发布。需要从本地手动发布时，确认当前目录包含 `wrangler.jsonc`、`dist/` 和 `functions/`，并避免同时运行 GitHub 自动发布：

```sh
npx wrangler@4.118.0 pages deploy dist --project-name byside --branch main
```

Wrangler 会打包 `functions/` 并上传 `dist/`。不要只上传静态目录的压缩包，否则无法同时发布这份 Functions API。首次在本机使用 Wrangler 或切换账号时，可先执行 `npx wrangler@4.118.0 login` 和 `npx wrangler@4.118.0 whoami` 确认身份。

目标自定义域名应在 Pages 项目的 **Custom domains** 中关联，并等待 DNS 和 HTTPS 证书生效。默认域名是 `byside-49n.pages.dev`，不是 `byside.pages.dev`。

## 已保留的行为与限制

- 聊天和 TTS 都要求同源 JSON POST；不开放跨域 CORS。上游地址不能由浏览器请求覆盖，重定向不会携带密钥继续跳转；上游错误信息不会直接返回或记录。
- 请求体及 AI 上游响应最大 2 MiB；TTS 上游响应最大 8 MiB，解码后的音频最大 5 MiB。聊天上游超时为 28 秒，TTS 为 30 秒；传入请求体读取上限为 15 秒。
- 聊天和 TTS 共用每个 Worker isolate 的内存限流：每分钟 30 次，最多 2 个并发请求。不同 isolate 的计数不共享，重建后也会重置，因此这不是全站总额度控制。需要限制使用者或建立全局配额时，另行配置 Cloudflare Access、平台限流或 Durable Object。
- 聊天、记忆、图片和偏好仍保存在当前浏览器中。控制页与投影页沿用原有的同浏览器、同来源同步方式；不同设备之间仍不自动同步。默认域名和自定义域名也属于不同来源，各自拥有独立的浏览器数据。
- 本地测试使用伪密钥，不证明真实 AI/TTS 账号或配额可用；线上真实能力以部署后的验证为准。

## 首次手动部署验证记录

2026-10-17（Asia/Shanghai）首次通过本机 Wrangler 手动部署并完成以下实测。这些记录属于首次手动上线，不代表后续 GitHub Actions 已运行成功。

- Production 部署 URL：https://dac5ba5d.byside-49n.pages.dev 。
- 默认域名：https://byside-49n.pages.dev 。
- 自定义域名：https://byside.purechaosspace.com ；Cloudflare 显示 Active / SSL enabled，CNAME 指向 byside-49n.pages.dev。
- `/api/health` 返回 HTTP 200、`configured: true`、`model: deepseek-flash`。
- DeepSeek 实际请求返回 HTTP 200 和“芽团在线。”；浏览器中发送文字也收到了实际 AI 回复。
- 豆包 TTS 实际请求返回 HTTP 200、16,365 字节的有效 MP3（24 kHz 单声道）。
- 新增 Cloudflare 测试 16 项通过，Functions 构建成功。原仓库测试仍存在旧演示时长和异步 TTS mock 不匹配的基线失败，未为部署改变原交互时长。
- 首页嵌入棋盘和独立棋盘页面均已在 Chrome 验证显示，独立棋盘落子正常。首次嵌入加载曾暂时卡住，刷新后恢复；未修改棋局逻辑。
- 验证截图位于仓库根目录 `verification/`（域名 Active、真实 AI 聊天和嵌入棋盘）。
- 两把实际密钥仅存于 Cloudflare Secret，没有写入仓库、静态文件或本说明。
- 首次上线使用 Direct Upload 手动命令。当时尚未配置 GitHub 自动发布，也尚未把适配改动推送到远端；后续自动部署的启用与实测单独记录如下。

Cloudflare Workers 的上游请求使用 `redirect: manual`，由状态码判断并拒绝重定向，不跟随重定向发送密钥。健康检查允许 10 秒等待，适应云端首次访问延迟。

## GitHub Actions 自动部署验证记录

2026-10-17 23:12（Asia/Shanghai）已由 main 推送触发并成功完成首次自动部署。

- 启用提交：`dc071775281e768061d4bbec54ff26a1f6485f15`，包含工作流和完整 Cloudflare 适配源文件。
- GitHub Secret `CLOUDFLARE_API_TOKEN` 已配置；专用令牌仅含当前账户的 Cloudflare Pages Edit 权限，不设置到期日，可在 Cloudflare 撤销。
- [首次自动部署运行记录](https://github.com/wangxiaoxi716/bySide/actions/runs/39044008856)：事件为 push，分支 main，22 秒完成，所有步骤成功。
- 云端 JavaScript 语法检查和 16 项 Cloudflare 测试均通过；静态资源与 Functions 一并发布。
- 自动生成的 Production URL：https://b0934c90.byside-49n.pages.dev 。
- 自定义域名 `/api/health` 实测返回 `configured: true`、`model: deepseek-flash`；原有 AI/TTS Secret 继续由 Cloudflare 管理。
- 工作流固定使用 Ubuntu 24.04、官方 checkout/setup-node 的 Node 24 运行时版本；应用本身使用 Node.js 22 和 Wrangler 4.118.0。

后续每次 main 推送都可在仓库 Actions 查看对应的发布状态；该记录保存首次成功的事实，最新 Production 以 Actions 和 Cloudflare 控制台为准。
