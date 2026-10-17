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

## Java 后端

已有 Java 服务保留在 `src/`，Maven 配置为 `pom.xml`。芽团本机演示当前使用其目录内的 Node.js 代理，尚未直接对接这套 Java 接口。
