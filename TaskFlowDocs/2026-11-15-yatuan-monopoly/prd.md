# 芽团大富翁
> Task version: v1
> Status: in_progress

## Goal
在现有棋室中增加可玩的芽团大富翁，并生成游戏卡片图片。

## Task Kind
- Kind: capability

## Background / Confirmed Facts
现有棋室使用原生 HTML、CSS 和 JavaScript；五子棋和井字棋均提供本地游戏体验。

## Requirements
- 以 16 格环形棋盘实现掷骰、经过起点奖励、地产购买、租金、事件卡和破产结算。
- 支持一人对芽团以及两人同屏；游戏状态、规则和资金在本地运行。
- 达到 12 轮后按现金与地产价值结算，提供规则、重新开始和可辨认的当前回合。
- 生成并集成地产卡和事件卡插画，并在现有棋室增加游戏切换入口。

## Acceptance Criteria
- 可从现有棋室进入大富翁，在桌面和手机上完成对局。
- 购买、租金、事件、起点奖励、破产和终局结算逻辑正确；电脑与双人模式均能推进。
- 卡片插画在地产购买和事件展示中可见，文字清晰可读。
- 相关自动化测试、项目语法检查和浏览器交互验证完成；基线失败单独注明。

## External Facts
- Depends on external facts: no
- Why not: 本地游戏规则由本需求和仓库现有交互确定。

## In Scope
本地游戏、卡片图、桌面与手机布局、棋室入口、测试和说明。

## Out of Scope
真实货币、跨设备联机、账号或持久化游戏存档。

## Risks / Deferred Items
完整测试可能保留 main 已知的演示及语音测试失败。

## Open Questions
无阻塞问题。
