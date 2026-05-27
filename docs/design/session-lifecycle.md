# Session 生命周期

## Session 是什么

Session 不是传统的"聊天窗口"。它是 **Agent 执行任务的一段工作记录**。

类比：
- 传统 IDE：人开一个终端 tab 做事
- AI IDE Studio：Agent 开一个 Session 做事

## 创建来源

| 来源 | 触发方式 | 示例 |
|------|---------|------|
| 任务自动派生 | Task 被分配给 Agent 时 | T-051 分配给 Alpha → 自动创建 Session |
| Agent 自主创建 | Agent 判断需要新上下文 | Alpha 发现需要独立调试 → 开新 Session |
| 人手动创建 | 用户点击"新建对话" | 用户想和 Alpha 讨论架构 |
| 模板派生 | 从预设模板创建 | "Code Review" 模板 → 带预设 prompt 的 Session |

## 生命周期状态

```
created → active → [waiting] → completed
                 ↘ suspended ↗
```

- **active**：Agent 正在工作
- **waiting**：等待人确认 / 等待外部依赖
- **suspended**：被暂停（可恢复）
- **completed**：工作完成，归档

## 避免 Session 爆炸

### 问题

如果每个任务都开 Session，任务多了怎么办？

### 策略

1. **自动归档** — Session 完成后立即归档，不再显示在活跃列表
2. **合并策略** — 同一任务的连续小操作在同一 Session 内完成
3. **过期清理** — 超过 7 天未活动的 suspended Session 自动清理对话详情（保留摘要）
4. **容量限制** — 单 Agent 同时活跃 Session ≤ 5
5. **UI 只显示活跃** — 列表默认只显示 active/waiting 状态

### 数量预估

```
正常项目运行时：
├── 活跃 Session：3-5 个
├── 等待确认：1-2 个
├── 归档 Session：无上限但不显示
└── UI 可见总数：~7 个（完全可管理）
```

## Session 与 Task 的关系

```
Task T-051
├── Session S-1 (主开发) ← active
├── Session S-2 (Code Review) ← completed
└── Session S-3 (Bug 修复) ← active

Task T-048
└── Session S-4 (等用户确认) ← waiting
```

- 一个 Task 可以关联多个 Session
- 一个 Session 只属于一个 Task
- Task 完成时，其下所有 Session 自动归档

## 人机交互点

### 人加入现有 Session

- 人在 Workspace 选中一个 Session → 看到对话历史 → 可以追加消息
- Agent 收到人的消息后继续工作
- 类似"中途接管"

### 人创建新 Session

- 在 Agent 下点击"新建对话"
- 选择关联到哪个 Task（或不关联，自由对话）
- 从模板创建或空白创建

## AI 标记任务完成

Agent 判断任务完成的信号：

1. 所有子任务都已完成
2. 测试全部通过
3. 代码已提交
4. 无阻塞问题

Agent 调用 `mark_task_done` 工具：
```
assistant: 所有子任务完成，测试通过。
[调用工具] mark_task_done({ task_id: "T-051", summary: "退款API开发完成，含幂等性校验" })
```

根据 Agent 权限等级：
- L3/L4：直接完成
- L1/L2：标记为 "reviewing"，等人确认
