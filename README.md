# bySide

桌边 AI 陪伴项目。

## 芽团前端与本机演示

完整项目位于 [`yatuan-companion/`](yatuan-companion/)，包含手机与电脑控制台、黑底桌面投影、芽团与人物形象、成长演示、语音交互、摄像头观察，以及本机 Node.js AI 代理。

需要 Node.js 20 或更高版本，无需安装第三方依赖：

```sh
git clone https://github.com/wangxiaoxi716/bySide.git
cd bySide/yatuan-companion
cp .env.example .env
```

在本机 `.env` 中填写自己的 API Key，然后启动：

```sh
npm run dev
```

打开 <http://127.0.0.1:4173>。详细功能与配置见 [芽团 README](yatuan-companion/README.md)，启动后可在网页中打开 [接线与使用说明](http://127.0.0.1:4173/help.html)。`.env` 不会提交到仓库。

```sh
npm run check
npm test
```

## 技术栈

本项目前后端统一使用 Node.js：

- 前端：`yatuan-companion/dist/` 下的原生 HTML / CSS / JavaScript，无构建步骤。
- 后端：`yatuan-companion/server.mjs`，零第三方依赖的 HTTP 服务，负责静态托管与 AI 代理转发。

## 关于 Java 代码（已弃用）

`src/` 与 `pom.xml` 是早期的 Java 后端实现，**已停止维护**，仅作为参考保留，不参与运行、构建与测试。前端不再对接它，请勿据此排查问题。后续如需清理，可直接删除这两个路径。
