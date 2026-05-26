# 记忆模型详解

## 核心挑战

AI Agent 需要记忆来保持连贯性，但 LLM 的 prefix cache 机制要求 prompt 前缀尽量稳定。如果记忆动态变化，每次更新都会导致缓存失效，增加 TTFT（首 token 延迟）和成本。

## 解决方案：分层记忆 + RAG 检索

### 第一层：System Prompt（完全稳定）

```
你是 Alpha，PayFlow 项目的开发智能体。
你的专长：TypeScript, Node.js, 支付系统。
你的行为准则：...
```

这部分 **永远不变**，保证 prefix cache 始终命中。

### 第二层：任务概况（极少变化）

```
你当前的任务：
- T-048: Issue#42修复 (等用户确认)
- T-051: 退款功能开发 (进行中) ← 当前
```

只有任务状态变更时才更新。频率低，对缓存影响小。

### 第三层：对话历史（append-only）

```
user: 帮我实现退款接口
assistant: 好的，我来分析需求...
user: 加上幂等性检查
assistant: ...
```

只追加不修改，prefix cache 自然增量命中。

### 第四层：动态记忆（通过工具调用）

Agent 需要查阅记忆时，**主动调用** `recall_memory` 工具：

```
assistant: [调用工具] recall_memory({ query: "退款接口的错误处理方案" })
tool_result: "在 T-035 中决定使用 Result<T, E> 模式处理错误，详见 ..."
```

结果作为 **tool response** 出现在对话历史中，自然追加在末尾，不影响前面的缓存。

## 关键设计原则

### 1. 静态放前面，动态放后面

```
[System Prompt]          ← 100% cache hit
[Agent 角色定义]         ← 100% cache hit
[任务概况]               ← ~95% cache hit
[对话历史 msg 1..N-1]   ← 增量 cache hit
[新消息 N]              ← 新计算
[recall_memory 结果]    ← tool response，在新消息之后
```

### 2. 记忆不塞 prompt，按需检索

**错误做法：**
```
System: 你是 Alpha。以下是你的记忆：
- 用户偏好驼峰命名
- 退款接口用 Result 模式
- 上次 Code Review 的结论是...
- ...（200条记忆）
```
→ 每次记忆更新都废掉整个 cache

**正确做法：**
```
System: 你是 Alpha。你可以通过 recall_memory 工具查询历史知识。
```
→ 需要时再查，结果出现在对话末尾

### 3. Agent 记忆的初始化和积累

**初始化来源：**
- 项目的 README / ARCHITECTURE.md 等文档（自动索引）
- 首次交互时的用户偏好设定
- Agent 模板预置的领域知识

**积累方式：**
- Session 结束时，Agent 自动总结关键决策写入记忆库
- 人工标记的"重要信息"
- Code Review 结论
- 错误修复经验

### 4. 多任务下的记忆隔离

一个 Agent 同时有 T-048 和 T-051 两个任务：

```
Agent 级记忆（全局）：
├── 项目架构知识
├── 代码规范偏好
└── 历史决策记录

Session 级上下文（隔离）：
├── Session-A (处理 T-048)：独立对话历史
└── Session-B (处理 T-051)：独立对话历史
```

- Agent **知道**自己有两个任务（System Prompt 中的概况）
- 但每个 Session 只**聚焦**当前任务
- 需要跨任务信息时，通过 recall_memory 检索

## 多 Agent 协作的记忆流

场景：任务 T-100 需要 Dev Agent 和 Test Agent 协作

```
1. Dev Agent 完成编码，Session-D 产出摘要写入共享记忆
2. Test Agent 接手，其 Session-T 通过 recall_memory 获取 Dev 的产出
3. Test Agent 发现 Bug，产出写入共享记忆
4. Dev Agent 的新 Session-D2 通过 recall_memory 获取 Bug 报告
```

**共享记忆 = Task 级知识库**，所有参与该 Task 的 Agent 都可以检索。

## 人参与时的记忆

- 人说的话就是对话历史的一部分（自然 append）
- 人标记的决策会额外写入 Agent 记忆
- 人可以手动清理/编辑 Agent 记忆（管理界面）
