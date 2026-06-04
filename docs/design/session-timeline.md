# 会话时间线设计文档

## 目标

会话用久了不记得历史做了什么。时间线通过大模型每 3 轮定期整理摘要，生成高密度的工作回顾。用户偶尔查看，不是常驻界面。

## 效果示例

```
📋 会话时间线 · 12 轮 · 3 小时

10:17  分析 openclaw v5.28 与 v6.1 版本差异并生成对比报告 (T1-2)
          ── 间隔 3.5 小时 ──
14:02  修复 WebSocket 相关 3 个 bug：重连、消息去重、初始化时序 (T3-5)
15:30  添加 TurnContentView 组件，分离执行过程与最终回复 (T6)
16:10  全局 UI 字号统一 +2px，涉及 24 个组件 (T7-8)
16:45  实现 .md 文件 Markdown 预览功能 (T9)
          ── 以下未整理 ──
17:20  🔧 修复 StreamingBuffer...                    (T10 · 未整理)
17:50  🔧 代码审查 · 3 个问题                        (T11 · 未整理)
18:15  ⏳ 进行中...                                   (T12)
```

最后 2 轮还没到 3 轮触发阈值，显示**原始占位**（从用户消息前缀自动提取），等再来 1 轮或手动触发后由模型整理。

---

## 一、摘要模型配置

项目设置中增加配置项：

```typescript
interface TimelineSummaryConfig {
  enabled: boolean
  provider: string        // openai / deepseek / 自定义
  model: string           // deepseek-v4-flash / gpt-4o-mini 等
  apiKey?: string
  baseUrl?: string
  triggerInterval: number  // 每 N 轮触发一次（默认 3）
}
```

推荐轻量模型（deepseek-v4-flash、gpt-4o-mini），成本可忽略。

---

## 二、核心机制

### 2.1 两种状态

| 状态 | 说明 |
|------|------|
| `raw` 原始占位 | Turn 完成时自动生成。取用户消息前 30 字，前缀 🔧，不调用模型 |
| `refined` 模型整理 | 大模型生成，高质量，可能合并多轮为一条 |

### 2.2 触发规则

每次 `session:done` 时递增未整理计数器，达到 `triggerInterval`（默认 3）时触发模型整理：

```
Turn 1 done → 存 raw → 未整理=1 → 不触发
Turn 2 done → 存 raw → 未整理=2 → 不触发
Turn 3 done → 存 raw → 未整理=3 → ✅ 触发模型整理
                                      ↓
                                   异步调用模型，不阻塞
                                      ↓
                                   模型输出 JSON → 覆盖写入 DB
                                      ↓
                                   WS 推 timeline:updated

Turn 4 done → 存 raw → 未整理=1 → 不触发
Turn 5 done → 存 raw → 未整理=2 → 不触发
Turn 6 done → 存 raw → 未整理=3 → ✅ 触发模型整理
```

### 2.3 模型输入（只传 2 样东西）

**模型输入 = 最近 5 条已有摘要 + 最近几轮的用户输入和 Agent 最终输出**

不传工具调用、不传文件变更、不传 diff，太多了没必要。用户输入和 Agent 最终回复已经足够让模型理解每轮做了什么。

#### 输入 JSON 示例

```json
{
  "existing_summaries": [
    { "id": "tl-001", "time": "10:17", "text": "分析版本差异并生成报告", "turns": "1-2" },
    { "id": "tl-002", "time": "14:02", "text": "重构 WebSocket 重连机制", "turns": "3" }
  ],
  "new_turns": [
    {
      "turn": 4,
      "time": "14:28",
      "user_input": "消息合并有问题，重复消息还出现",
      "agent_output": "消息合并逻辑已优化，问题出在 optimistic message 和服务端消息的去重判断上。现在通过 clientMessageId 匹配。"
    },
    {
      "turn": 5,
      "time": "14:55",
      "user_input": "session store 初始化有时序问题，有时候会话数据加载不出来",
      "agent_output": "初始化时序已修复。根本原因是 setupListeners 在 fetchSessions 之前调用，导致事件监听丢失。"
    },
    {
      "turn": 6,
      "time": "15:30",
      "user_input": "帮我加一个 TurnContentView 组件，把执行过程和最终回复分开显示",
      "agent_output": "TurnContentView 组件已添加。主体为折叠面板展示中间过程（工具调用、思考），最终回复独立渲染在底部。"
    }
  ]
}
```

字段裁剪规则：

| 字段 | 裁剪 |
|------|------|
| `user_input` | 取前 150 字 |
| `agent_output` | 取 Agent 最终回复的前 200 字（跳过工具输出和思考） |
| `existing_summaries` | 取最近 5 条，不是全量 |

### 2.4 模型 Prompt

```
你是对话时间线整理助手。根据已有摘要和新增对话，输出更新后的完整摘要列表。

规则：
1. 每条摘要 15-40 字中文，说清做了什么
2. 如果新增轮次和已有摘要在做同一件事，合并为一条，turns 写范围如 "3-5"
3. 如果已有摘要描述需要更准确，直接更新文本
4. 如果已有摘要不需要改动，原样保留在输出中
5. 闲聊写"简单问候"
6. 不要加序号和时间

重要：输出必须包含所有条目（已有的+新增的），我会用输出直接覆盖数据库中对应的记录。
如果某条已有摘要不需要改，也必须原样输出，不能省略。

输出严格 JSON 数组：
[
  { "id": "tl-001", "text": "摘要内容", "turns": "1-2", "time": "10:17" },
  { "id": "tl-002", "text": "摘要内容", "turns": "3-5", "time": "14:02" },
  { "text": "新摘要", "turns": "6", "time": "15:30" }
]

说明：
- 带 id 的是已有条目（保留或更新文本）
- 不带 id 的是新增条目（后端会自动分配 id）
- 如果两条被合并，保留其中一条的 id，更新 turns 范围
- 被合并掉的条目不要出现在输出中

已有摘要：
{existing_summaries}

新增轮次：
{new_turns}

输出 JSON：
```

### 2.5 模型输出处理

```typescript
interface TimelineOutputItem {
  id?: string     // 有 id = 已有条目的保留/更新，无 id = 新增
  text: string    // 摘要文本
  turns: string   // "1" 或 "3-5"
  time: string    // 起始时间 "14:02"
}

async function applyModelOutput(
  sessionId: string,
  inputIds: string[],         // 传给模型的那 5 条的 id 列表
  output: TimelineOutputItem[]
) {
  // 1. 从 output 中提取所有带 id 的条目 → 这些是保留/更新的
  const keepOrUpdate = output.filter(o => o.id)
  const keepIds = new Set(keepOrUpdate.map(o => o.id))

  // 2. inputIds 中不在 keepIds 里的 → 被合并删除了
  const deleteIds = inputIds.filter(id => !keepIds.has(id))

  // 3. 执行数据库操作（一个事务）
  db.transaction(() => {
    // 删除被合并的
    for (const id of deleteIds) {
      db.delete('timeline_summaries', id)
    }
    // 更新保留的
    for (const item of keepOrUpdate) {
      db.update('timeline_summaries', item.id, {
        summary: item.text,
        turns: item.turns,
        status: 'refined',
        model_used: config.model
      })
    }
    // 插入新增的
    for (const item of output.filter(o => !o.id)) {
      db.insert('timeline_summaries', {
        id: generateId(),
        session_id: sessionId,
        summary: item.text,
        turns: item.turns,
        status: 'refined',
        turn_start_at: item.time,
        model_used: config.model
      })
    }
    // 删除这几轮的 raw 占位（已被 refined 替代）
    db.deleteRawByTurnRange(sessionId, newTurnRange)
  })

  // 4. WS 推送完整时间线
  ws.send('timeline:updated', { sessionId })
}
```

**核心逻辑总结**：

```
传给模型 5 条（id 已知）+ 3 轮新对话
     ↓
模型输出完整列表（可能 4 条、可能 6 条、可能还是 5 条）
     ↓
有 id 的 → 和传入的 5 个 id 对比
  - 存在于输出 → 更新 text/turns
  - 不存在于输出 → 被合并删掉了 → DELETE
无 id 的 → 新增 → INSERT
     ↓
DB 事务写入 → WS 通知前端刷新
```

---

## 三、原始占位生成

Turn 完成但没触发模型时，后端自动生成 raw 占位并入库：

```typescript
function generateRawPlaceholder(userMessage: string): string {
  const text = (userMessage || '').trim().slice(0, 30)
  return text ? `🔧 ${text}...` : '对话进行中'
}
```

raw 占位特征：
- 灰色文字 + 🔧 前缀
- 显示 `未整理` 标签
- 模型整理后自动被替换或合并

---

## 四、数据持久化

### 4.1 表结构

```sql
CREATE TABLE timeline_summaries (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL,
  turns         TEXT NOT NULL,              -- "1" 或 "3-5"
  summary       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'raw', -- raw / refined
  turn_start_at TEXT NOT NULL,
  model_used    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_tl_session ON timeline_summaries(session_id);
```

### 4.2 数据生命周期

```
Turn N 完成
  → INSERT INTO timeline_summaries (status='raw', summary='🔧 用户消息前30字...')
  → raw_count = SELECT COUNT(*) WHERE session_id=? AND status='raw'
  → IF raw_count >= triggerInterval:
      → 取最近 5 条 (refined 优先，不够用 raw 补) 作为 existing_summaries
      → 取所有 raw 条目的 turn 对应的对话内容作为 new_turns
      → 调用模型 → 解析 JSON → applyModelOutput()
      → raw_count 重置为 0
```

### 4.3 前端查询

```
打开时间线浮层
  → RPC timeline.list { sessionId }
  → 后端查 timeline_summaries WHERE session_id=? ORDER BY turn_start_at
  → 返回所有条目（refined + raw 混合）
  → 前端按 status 区分渲染样式
```

---

## 五、UI 交互设计

### 5.1 定位：不占用任务列表

时间线是**偶尔查看**的功能，不是常驻面板。不能占用右侧区域（那是任务列表/其他面板的位置）。

方案：**对话区内的浮层弹出**

```
┌─────────────────────────────────────────────────────┐
│  Agent信息                      [📋 时间线 ▾]       │
├─────────────────────────────────────────────────────┤
│                                                     │
│  对话内容       ┌──────────────────────────┐        │
│                 │ 📋 会话时间线       [✕]  │        │
│  👤 ...        │ 12 轮 · 3h              │        │
│  🤖 ...        │                          │        │
│                 │ 10:17 分析版本差异 T1-2  │        │
│                 │   ── 间隔 3.5h ──        │        │
│                 │ 14:02 修复WS 3个bug T3-5│        │
│                 │ 15:30 添加组件 T6        │        │
│  ...           │ 16:10 字号调整 T7-8      │        │
│                 │ 16:45 MD预览 T9          │        │
│                 │ ── 以下未整理 ──          │        │
│                 │ 17:20 🔧 Stream... T10   │        │
│                 │ 17:50 🔧 审查... T11     │        │
│                 │                          │        │
│                 │ [✨ 整理全部]            │        │
│                 └──────────────────────────┘        │
│                                                     │
│  [输入消息...]                                       │
└─────────────────────────────────────────────────────┘
```

特点：
- 从顶栏「📋 时间线」按钮点击弹出
- **浮层**，不挤压对话区宽度，不占用右侧面板
- 绝对定位在对话区右上角，最大高度 70vh
- 点击外部或 ✕ 关闭
- 不影响任务列表、Agent 面板等其他功能区域

### 5.2 条目样式

| 类型 | 样式 |
|------|------|
| `refined` | 蓝色圆点 · 黑色文字 · 标注 (T1-2) |
| `raw` | 灰色圆点 · 灰色文字 · 🔧 前缀 · `未整理` 标签 |
| 生成中 | 灰色脉冲圆点 · `⏳ 整理中...` |
| 当前 Turn | 绿色脉冲 · `进行中...` |
| 失败 | `⚠️ 整理失败` + 重试按钮 |

### 5.3 交互

1. **点击条目** → 关闭浮层，对话区滚动到对应 Turn
2. **时间间隔** → 两条间隔 > 30 分钟插入分隔线
3. **「整理全部」按钮** → 强制触发模型整理所有 raw，不等 3 轮
4. **实时追加** → 新 Turn 完成后 raw 占位追加；达到阈值后自动整理替换

---

## 六、后端接口

### RPC

```typescript
// 获取时间线
'timeline.list' → { sessionId } → TimelineSummary[]

// 手动触发整理（不等 3 轮）
'timeline.refine' → { sessionId } → void
```

### WS 事件

```typescript
// 整理完成，通知前端刷新
'timeline:updated' → { sessionId }
```

前端收到 `timeline:updated` 后，如果时间线浮层正在展示，则重新调 `timeline.list` 刷新。

---

## 七、首次打开历史会话

对已有历史但无摘要的会话，用户首次点击时间线：

```
1. 后端发现 timeline_summaries 为空
2. 按 Turn 切分历史，每轮生成 raw 占位 → 批量 INSERT
3. 返回 raw 列表给前端先展示
4. 后台按每 3 轮一组分批调用模型
5. 每批完成后 WS 推 timeline:updated → 前端逐步刷新
```

---

## 八、成本估算

以 deepseek-v4-flash、每 3 轮触发一次：

| 项目 | 数据 |
|------|------|
| 单次输入 | ~800 token（5 条摘要 + 3 轮对话摘要） |
| 单次输出 | ~200 token |
| 单次成本 | < ¥0.001 |
| 日均 50 轮 ÷ 3 = 17 次 | < ¥0.02/天 |
| 月成本 | < ¥0.6 |

---

## 九、实现计划

### 阶段一

- [ ] `timeline_summaries` 表 + migration
- [ ] 时间线模型配置（项目设置页）
- [ ] raw 占位生成 + 入库
- [ ] 每 3 轮触发模型整理（Prompt → JSON 解析 → DB 覆盖写入）
- [ ] `timeline.list` / `timeline.refine` RPC
- [ ] `timeline:updated` WS 事件
- [ ] `TimelinePopover` 前端浮层组件
- [ ] 顶栏时间线按钮
- [ ] 点击条目跳转 Turn
- [ ] 历史会话批量补生成

### 阶段二

- [ ] 会话级一句话总摘要
- [ ] 跨会话摘要搜索

---

## 十、不做的事

- **不传工具调用和文件变更给模型** — 用户输入 + Agent 回复已足够
- **不每轮调用模型** — 每 3 轮一次，省 token
- **不做右侧常驻面板** — 浮层弹出，不抢任务列表位置
- **不阻塞对话** — 整理完全异步
- **不做跨会话时间线** — 那是任务系统的事
