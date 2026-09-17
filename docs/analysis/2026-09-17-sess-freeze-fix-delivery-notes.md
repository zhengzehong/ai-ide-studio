# 交付说明:会话卡死自愈修复(sess-d83044f2 事故)

- 分支:`fix/sess-freeze-selfheal` · 依据:`docs/analysis/2026-09-17-verify-d83044f2-dev-deepseek.md`
- 面向:部署/运维与使用者,交代本修复「改了什么、怎么用、开关怎么取舍」。

## 一、用户能看到什么变化

| 场景 | 修复前 | 修复后 |
|---|---|---|
| 排队中的消息 | 界面毫无反应,只能感到"发消息没反应" | 会话 stage 显示「排队中(前面有未完成回合)」(列表/时间线/移动端可见) |
| 回合被误终结、真实回答照常产出 | 回答内容消失,行被置 completed | 终帧严格按 messageId 归属,不再写到别的回合行上;后到的真实内容仍可从事件流只读还原(`sessions.recoveredDraft`) |
| 回合挂起、普通「停止」无效 | 只能重启平台 | 输入框停止按钮旁新增「强制结束」(⚡,带确认弹窗):终结当前回合并放行排队消息 |

## 二、配置开关与取舍(重要)

新增 `AppConfig`(已同步 edge/protocol.ts 白名单):

| 字段 | 默认 | 说明 |
|---|---|---|
| `promptStuckAutoRecoverEnabled` | **false(关闭)** | 挂起回合**自动**收敛开关;env:`PROMPT_STUCK_AUTO_RECOVER=enabled` |
| `promptStuckAutoRecoverMs` | 1800000(30 分钟) | 静默阈值;**硬钳制下限 30 分钟**,传更小值按 30 分钟生效 |

**为什么默认关闭**(2026-09-17 事故评审结论):

该事故中,04:05 起就有定时唤醒消息排队,而那个"看似卡死"的回合在 05:57-05:59 仍然真的产出了完整答案。
如果自动收敛开启,系统会在约 04:35(静默 30 分钟 + 有排队)就终结这个活着的回合 ——
**后续 05:57-05:59 的真实产出将永远不会产生**,而"终稿只读还原"(#4)只能还原**已经产出**的内容,救不回被终止之后的产出。
因此:

- **默认关闭**,把"6 小时无人察觉"压缩成"可见(排队 stage)+ 秒级可解(强制结束)";
- 建议先跑一段时间、观察 `active prompt watchdog warning` 日志与真实卡死频率,再按部署环境决定是否开启;
- 若开启,自动收敛只在三个条件同时满足时动作:存在排队消息 + 无任何流事件**且**无工具心跳 ≥ 阈值;
  `tool-heartbeat` 只作否决信号(有心跳绝不动),不会误杀长工具/长思考。

## 三、使用方式

1. **人工一键(推荐首选手动)**:回合疑似卡死 → 点停止按钮旁的 ⚡「强制结束」→ 确认。
   平台依次执行:运行时收敛(ACP cancel → 关会话 → 重启 Agent,均有上限)→ 回合置终态(严格归属)→
   清挂起 → 放行排队消息。等价命令:`session.forceFinish`(HTTP `/api/v1/commands` / WS RPC)。
2. **终稿找回**:对"内容被误终结"的历史消息,可调用 `sessions.recoveredDraft`
   (`{sessionId, messageId}`)按 messageId 从 `session_events` 只读合并 message.chunk 还原真实终稿;
   只读 RPC,不写库、不改变消息行状态。
3. **日志留痕**(排查用):终帧归属不一致 → `terminal messageId mismatch; attributing to event messageId`;
   行已终态导致快照被拒 → `running snapshot dropped: message row already terminal`;
   自动收敛触发 → `active prompt stuck with queued messages; forcing finish (auto recover)`。

## 四、回滚

- 关闭自动收敛:不配置开关即可(默认关)。
- 代码回滚:回退分支 `fix/sess-freeze-selfheal`;无数据库结构变更(无新迁移),数据层无需回滚。
