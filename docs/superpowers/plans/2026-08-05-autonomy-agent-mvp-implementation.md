# 自主 Agent MVP 实施计划

## 目标

实现固定独立自主 Session、关注点、简化排班、GFM Markdown 汇报、文件工作记忆、独立自主提示词、特权模式和 10 分钟防堆积调度，并提供 PC 自主工作页面。

## 实施清单

- [x] migration 049：Session purpose、自主汇报表和唯一索引。
- [x] 自主配置、固定 Session、memory.md 和独立提示词核心服务。
- [x] 特权模式严格 ACK、自主 tick、忙碌跳过与停用取消。
- [x] `studio.autonomy.plan.update` 和 `studio.autonomy.report` 工具。
- [x] autonomy RPC、协议类型和实时事件。
- [x] PC 自主页面、Markdown 汇报/记忆和自主 Session 入口。
- [x] Workspace 隐藏自主 Session，但 URL 指定时可打开。
- [x] 单元/集成/前端测试与架构文档。
- [x] 全量测试、lint、build、diff check 和代码审查。
- [ ] 合并 `prd`，不启动或重启服务。

## 非目标

- APP 自主页面。
- 子任务、子会话和多 Agent 编排。
- 审批策略和 HTML 汇报渲染器。
- 复杂日历和人工排班编辑器。
