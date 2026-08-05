# Widget 隐藏自主运行 Agent

## 目标

Widget 只展示普通对话 Session 的当天未读和运行中动态，不把自主运行 Agent 的固定 `purpose=autonomy` Session 聚合进来。

## 实施清单

1. 在 Widget 后端统一过滤 `sessions.purpose = 'autonomy'`。
2. 让兼容的 Agent 列表只根据普通对话 Session 计算活动状态，并排除只有自主 Session 的 Agent。
3. 增加 RPC 集成回归测试，覆盖 Session、Agent 聚合及自主 Session 不泄漏。
4. 更新 Widget 协议/架构说明并运行定向验证。

## 验收标准

- 自主 Session 不出现在 `widget.sessions.list`、`widget.sessionActivity.list`、`widget.agentActivity.list`。
- 只有自主 Session 的 Agent 不出现在 `widget.agents.list`。
- 普通 Agent 的运行中和未读 Widget 展示保持不变。
- 不修改自主 Agent 的运行逻辑，不重启 PRD 服务。
