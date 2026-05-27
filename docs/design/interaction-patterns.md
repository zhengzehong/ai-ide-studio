# 交互模式

## 人与 Agent 的交互方式

### 1. 直接对话（最常见）

用户选中一个 Session → 输入消息 → Agent 回复

```
用户: 退款接口加上金额校验
Alpha: 好的，我来添加。需要确认校验规则：
       1. 退款金额 ≤ 原订单金额
       2. 退款金额 > 0
       用哪个方案？
```

### 2. 决策点（Agent 请求确认）

Agent 遇到需要人决策的情况时，创建决策点：

```
[决策点] Alpha 需要你的确认
问题：发现 payment-service 有两种错误处理模式，统一用哪种？
├── 选项A: Result<T, E> 模式（类型安全）
├── 选项B: try-catch + 自定义 Error（简单直接）
└── 选项C: 让我自己决定
```

UI 展示为黄色卡片 + 按钮选项。

### 3. 通知（Agent 汇报）

Agent 完成工作或发现问题时，推送通知：

```
[通知] Alpha 完成了 T-051 的子任务 "实现退款接口"
[通知] Beta 发现 3 个测试用例失败
[通知] Gamma 检测到 main 分支有安全漏洞
```

通知在顶栏显示徽章，点击查看详情或跳转到对应 Session。

### 4. 任务委派

用户创建任务并指派给 Agent：

```
用户 → 新建任务
├── 名称: 实现退款API
├── 优先级: P1
├── 指派: Alpha (Dev)
├── 描述: 支持全额/部分退款，需要幂等性
└── → Alpha 自动创建 Session 开始工作
```

### 5. 人参与多 Agent 协作

场景：一个任务需要 Dev 和 Test 配合

```
T-100: 实现支付回调
├── Alpha (Dev): Session-D → 编码
│   └── Alpha: "开发完成，请 Beta review"
├── Beta (Test): Session-T → 写测试
│   └── Beta: "发现边界条件问题，已反馈给 Alpha"
├── Alpha (Dev): Session-D2 → 修复
└── 用户: 可以在任何 Session 中加入对话
```

用户在 Workspace 的 Agent 树中看到所有参与者和 Session，自由选择加入。

## 对话消息的丰富程度

### 思考块（Thinking）

```
[思考] 分析退款接口的需求...
├── 需要支持全额退款和部分退款
├── 幂等性可以用 idempotency_key 实现
├── 需要考虑并发场景下的重复请求
└── 决定使用数据库唯一约束 + Redis 锁
```

默认折叠，点击展开查看 Agent 的推理过程。

### 工具调用（Tool Calls）

```
[工具调用] read_file("src/services/payment.ts")
├── 状态: ✓ 成功
└── [展开查看结果]

[工具调用] run_tests("test/refund.spec.ts")
├── 状态: ✓ 通过 (12/12)
└── [展开查看输出]

[工具调用] git_commit("feat: add refund API")
├── 状态: ✓ 已提交
└── commit: a1b2c3d
```

### 代码编辑

```
[文件编辑] src/services/refund.ts
├── +15 行 / -3 行
└── [查看 diff]
```

## 用户的工作流程

### 典型日常

1. **打开 Dashboard** — 查看今日概览
   - 3 个任务进行中
   - Alpha 完成了 2 个子任务
   - Beta 发现 1 个 Bug 等待确认

2. **处理通知** — 点击 Beta 的通知
   - 跳转到 Workspace → Beta 的 Session
   - 查看 Bug 详情
   - 回复"先跳过这个，不影响主流程"

3. **创建新任务** — Dashboard 点击"新建任务"
   - 填写需求
   - 指派给 Alpha
   - Alpha 自动开始工作

4. **检查任务看板** — 切换到 TaskBoard
   - 看到所有任务的状态分布
   - 拖拽调整优先级

5. **查看 Agent 工作** — 回到 Workspace
   - 左栏看到 Alpha 正在编码
   - 点击进入 Session 观察过程
   - 觉得不对 → 发消息纠正方向

## 键盘快捷键设计

| 快捷键 | 操作 |
|--------|------|
| Ctrl+K | 全局命令面板 |
| Ctrl+N | 新建任务 |
| Ctrl+1/2/3/4 | 切换页面 |
| Ctrl+Enter | 发送消息 |
| Esc | 关闭弹窗 |
