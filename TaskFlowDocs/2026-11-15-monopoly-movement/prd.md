# 大富翁掷骰和逐格移动
> Task version: v1
> Status: checking

## Goal
掷骰时先看到骰子转动，再看到角色逐格走到目的地，桌面投影同步这些过程。

## Task Kind
- Kind: capability

## Background / Confirmed Facts
- 用户要求棋子有行走过程、骰子有转动过程；当前游戏直接显示最终结果。
- 现有纯游戏规则函数和跨窗口投影同步已经可用。

## Requirements
- 人类与芽团掷骰都播放动画；前进时逐格经过沿途位置，经过起点也正确展示。
- 等动画到达目的地后再结算地产、事件和奖金；播放期间阻止重复掷骰或切换棋局。
- 投影显示相同骰面和沿途位置；兼容不支持或选择减少动画的环境。

## Acceptance Criteria
- 1–6 点时依次显示每一格，并在结束后保持原有规则与最终状态。
- 双人和单人模式都可运行，投影画面同步显示过程。
- 本地相关检查和浏览器检查通过。

## External Facts
- Depends on external facts: no，依据现有游戏和用户描述。

## In Scope
大富翁动画、投影同步与必要验证。

## Out of Scope
更改游戏规则、摄像头设备调试、远程推送。

## Risks / Deferred Items
实际物理摄像头投影仍按用户此前要求暂不调试。

## Open Questions
无。
