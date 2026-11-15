# Spec — 大富翁掷骰和逐格移动
> Task version: v1

## Objective and Success Criteria
骰子转动、显示最终点数，然后棋子按点数逐格走到落点；结算仅在动画结束后发生。

## Architecture Boundaries and Responsibilities
游戏规则仍由 `monopoly-core.js` 负责；动画仅持有独立的展示快照，直至应用最终规则状态。投影订阅并渲染相同展示快照。

## Project Structure / Affected Files
大富翁动画与页面、样式、投影渲染与样式、相关自动测试。

## Interfaces, Data Flow, and Contracts
展示快照提供阶段、骰面、各玩家的临时位置及正在走的步数；每个画面通过现有棋室消息发布，结束后发布最终游戏状态。

## Invariants and Compatibility
单次只计算一次随机点数；规则状态不被动画帧改写。防止重复操作，退出页面或重置时取消计时。单人和双人游戏，以及无动画字段的旧投影快照继续可用。

## Validation and Error Semantics
投影对可选动画字段进行范围校验，无效时回退到规则状态。尊重系统减少动画设置。

## Code and Test Constraints
自动测试覆盖逐格、绕过起点、最终状态与投影；本地浏览器检查实际过程，不调试实体摄像头。

## Design Decisions and Alternatives
随机结果由原有规则函数产生一次，动画基于结果构造；结算事件、金钱和卡片不会提前显示。

## Open Questions
无。
