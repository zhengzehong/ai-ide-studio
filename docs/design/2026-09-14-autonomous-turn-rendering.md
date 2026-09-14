# 方案:成员自治回合(后台唤醒)在平台侧的渲染与回合化

- 日期:2026-09-14
- 状态:**阶段 1 已实施(待审查)** —— 实施分支 `feat/autonomous-turn-rendering`,复核修正 11 项已并入(见 §10);审查修正 N1–N4 已并入(见 §10.6)
- 作者:coder-glm5 (agent-a7555931);复核:dev-glm(task-a1ce8023)/ dev-deepseek(task-e95bb2ea);实施:dev-deepseek(task-76586133)
- 关联:task-15462a84(分析)、wellcode 端到端测试团队实测案例(team-11f5b1fb / sess-f9506483)、复核汇总 `docs/audit/autonomous-turn-review-summary.md`

---

## 1. 背景与原因

### 1.1 现象(实测案例,2026-09-14 13:46–13:57)

wellcode 端到端测试团队中,成员 WellCode-E2E-Tester 在 13:46:09 发出最后一条可见消息:

> "打包还在 prepare:runtime 阶段…等后台构建完成通知,期间不再空转。构建完成后立即:启动代理 → 录屏 → 拉起 s70 实例 → Playwright 登录 → 全场景执行。"

随后成员会话在 UI 上**一直显示空闲,再无任何输出**。用户自然怀疑:后台构建完成后,成员还能被唤醒吗?唤醒后的执行还能通知到平台吗?

实测答案(日志 + DB + CLI 本地 transcript 三方证据):

| 时刻 | 事实 |
|---|---|
| 13:46:09 | 成员可见回合结束;平台清除回合绑定,UI 显示空闲 |
| 13:46:30 | 成员**确实被 Claude Code 后台唤醒机制自动唤醒**(仅 21 秒后) |
| 13:46:30–13:57:02 | 成员在"隐藏回合"里持续执行:共 **7902 帧**更新 = 6802 条思考 + 693 条正文 + **56 次工具调用** + 239 条工具进度 + 112 条 usage |
| 隐藏回合执行内容 | CLI transcript(D--project-space-govclaw/bef89410….jsonl,525 帧)完整记录:重跑 electron-builder → 修复 electron 二进制 → 启动本地代理 → **录屏 + 启动 s70 实例 → Playwright 登录 → 深链兑换凭据 → 全场景执行**——承诺的后续步骤全部真实执行完 |
| 平台侧 | **7902 帧全部被拒收**:UI 零显示、messages 表零落库、team_mailbox 零汇报、会话状态全程"空闲" |

### 1.2 原因(六层管线,唯一断点)

Claude Code 原生具备"后台任务完成 → 自动唤醒"机制:`task-notification` 是 CLI 的一等回合触发类型(与 human / auto-continuation / scheduled-trigger / coordinator 并列,vendored claude.exe 内枚举实证)。`Bash run_in_background` 的任务退出后,CLI **无需用户输入**自动驱动新回合。

数据流跨层验证:

```
CLI 自治回合(origin=task-notification)
  ① adapter(claude-agent-acp)长命消费者逐帧转发     ← acp-agent.js:865 "forwards every message…so
                                                       background/between-turn output streams live"
  ② 平台 ACP client sessionUpdate 回调               ← 数据完整到达平台进程(drop 日志即平台自己所打)
  ③ acp-runtime-client.ts:116 守卫                   ← **唯一断点**:无回合绑定 → log.warn + return
  ④ 之后的一切都没发生                                ← publish → ws → UI → messages 表落库,全链零残留
```

断点代码(`src/runtime/service/acp-runtime-client.ts:38-40, 116-127`):

```ts
const TURN_SCOPED_SESSION_UPDATES = new Set<string>([
  'agent_message_chunk', 'agent_thought_chunk', 'tool_call', 'tool_call_update', 'usage_update', 'plan', 'user_message_chunk',
])
...
if (!bound.messageId && TURN_SCOPED_SESSION_UPDATES.has(update.sessionUpdate)) {
  log.warn(..., 'dropped ACP turn update without an active turn binding')
  return                                    // ← 7902 帧死在这里
}
```

回合绑定(`bound.messageId`)只在**平台主动派发 prompt** 时由 `beginTurn` 设置、回合结算时 `endTurn` 清除。自治回合没有 prompt RPC → 没有绑定 → 全部帧被防御性丢弃。

**为什么当初会这样设计**:平台消息模型以 prompt 为回合单位,turn-scoped 帧需要 messageId 归属到具体消息;回合外帧没有归属落点,于是被整体拒收。这是"归属问题"造成的静默黑洞,不是通道故障——**数据完整、执行真实发生、到达平台,仅在一处被拒收**。

### 1.3 同一断点吃掉的第二个场景

回合被**取消**后的残留流:H200 会话(sess-29c0886a)14:03–14:04 因回合取消清除绑定后,CLI 残余输出 9095 条 tool_call_update 同样被丢。本方案一并覆盖。

---

## 2. 目标

1. **自动起回合**:自治回合无需用户/平台派发 prompt,平台侧自动合成回合,内容正常渲染落库;
2. **用户端自动可见**:当前会话实时流式渲染;非当前会话正确翻转"正在执行"状态、结算后打未读标记;
3. **正确归属 agent**:内容落到成员自己的会话 timeline,团队视图按既有"成员会话→team_members"聚合自动带出成员名;
4. **回合化**:自治执行在 timeline 中呈现为一个**独立的新回合**(带"[后台唤醒]"来源注记),历史重载后形态不变;
5. 覆盖全部自治来源(task-notification / peer / coordinator / observer / observer-activity)+ 取消回合残留流。

**不需要做的**:不改 CLI、不改协作约定(成员仍按规则主动 mailbox 汇报);core/UI 渲染层零改动。

---

## 3. 现状管线逐层结论(可行性依据)

| # | 层 | 位置 | 对"无回合上下文更新"的态度 | 需要改吗 |
|---|---|---|---|---|
| 1 | adapter 转发 | `@agentclientprotocol/claude-agent-acp/dist/acp-agent.js:865` | 全部转发(7902 帧实证到达) | 不改 |
| 2 | 平台 ACP client | `src/runtime/service/acp-runtime-client.ts:116` | **唯一断点:drop** | **改** |
| 3 | runtime→core 发射 | `src/runtime/api/runtime-ingress.ts:15-25` | 无条件 `events.emit('session:update')`,事件自带 `agentId` | 不改 |
| 4 | core 回合聚合 | `src/core/sessions.ts:85-89` | **无 pending turn 时自动 `createPendingTurn()`**——核心层设计上就支持回合外更新 | 不改 |
| 5 | 落库 + ws 广播 | `src/core/sessions.ts:102-127` / `src/gateway/ws-handler.ts:63` | 按 messageId 归属 `appendEvent`,无回合门槛;ws 消息带 `sessionId+agentId` | 不改 |
| 6 | UI 渲染 | `ui/src/stores/session.store.ts:2490-2501` | `streamingBuffer` 按 messageId 聚合,**不要求会话 running** | 不改 |

两个关键既有机制(方案直接复用):

- **回合结算链路**(`src/core/sessions.ts:134-210`):`session:done` → `finalizeSessionMessage` → `finalizePendingTurn` → `commitFinalMessage` 写 agent 消息行(messages 表)+ `appendEvent('message.done')` + `session:committed_done`(UI flush + done)。**合成一个 `session:done` 即可完整复用**,消息落库、UI finalize、idle 翻转、未读标记全自动生效。
- **UI 接收**(`session.store.ts:2490-2501`):只按 `contentDelta / thinking / toolCall / toolCallUpdate` 推入 `streamingBuffer`,按 messageId 聚合;`session:done`(:2506-2536)负责 finalize + 未读/状态翻转。

---

## 4. 方案设计

### 4.1 总体思路

在 `acp-runtime-client.ts` 的守卫处把 **drop 改为"合成回合"**:自治回合的第一帧到达时,host 合成回合绑定并翻转 running;内容帧走既有管线正常渲染落库;结束检测触发时由 host **合成 `session:done`**,复用既有结算链路。

```
自治帧到达(sessionUpdate, 无绑定)
  → onAutonomousTurnStart(sessionId)          ← 新钩子(替代 drop)
      · 合成 messageId: `auto-<uuid>`
      · beginTurn(sessionId, syntheticMessageId)
      · touchSdkSession(豁免空闲清扫,见 4.4)
      · publish session:activity running
      · 发一条 role:system 注记 "[后台唤醒]"(回合开头来源标记)
  → 后续帧正常 publish(既有管线:渲染 + 落库 + 核心自动建 pending turn)
  → 结束检测(见 4.3)触发
  → 合成 RuntimeDoneEvent(stopReason: 'end_turn')   ← 复用既有 session:done 链路
      · 核心 finalizePendingTurn + commitFinalMessage(消息行落库)
      · UI finalize + idle 翻转 + 未读标记
```

### 4.2 改动点 1:守卫改钩子(`acp-runtime-client.ts`)

- `:116-127` drop 分支改为调用 `options.onAutonomousTurnStart?.(bound.ourSessionId)` 后**继续正常处理**(publish 走 `:128` 的兜底 messageId 路径——合成绑定后走正常 messageId);
- 钩子幂等:绑定已存在时不重复触发;
- 非自治来源的误触发无害:合成回合与真回合共用同一套归属机制。

### 4.3 改动点 2:结束检测与合成 done(`sdk-runtime-host.ts`)

自治回合在 ACP 协议层**没有结束信号**(回合结束 = prompt RPC 的 stopReason 响应;adapter 在 `:1964-1971` 明确把 task-notification 的 result 划为 autonomous lane,不走回合结算,仅发 usage_update;CLI 的 `session_state_changed: idle` 帧被 adapter 内部 #825 记账吸收、不转发)。因此结束靠检测,三级递进:

| 级 | 手段 | 说明 |
|---|---|---|
| 基础 | **静默超时**:最后一条 turn-scoped 帧后 10–15s 无新帧 → 合成 done | 简单可靠;长工具调用(构建)期间无帧 → 可能误判提前结算(见风险 R1/R6) |
| 增强 | **无绑定 usage_update 视为终结启发**:adapter 对自治回合的 result 只发这一个终结帧(`:2038-2050` "their cost is real but is reported separately via the usage_update below") | 与静默超时组合,把误判窗口从 10–15s 缩到亚秒 |
| 终态 | **patch adapter**(`patch-package`):在 `:1971` `isAutonomousResult` 分支发一个显式终结帧(携带 `origin.kind`),同时把回合开头的 task-notification 原文(user 帧)转发出来 | 消除全部启发误判;"[后台唤醒]"注记可带 trigger 详情 |

**互斥处理**:真 prompt 到达(`beginTurn` 真绑定)时取消静默定时器;真回合结算(`endTurn`)后恢复检测——避免真回合被自治超时误结算。

**为什么选"合成 done"而不是新写状态机**:核心 finalize、消息行落库、UI finalize、idle 翻转、未读标记全部挂在既有 `session:done` 链路上,合成 done 是唯一不改 core/UI 的结算方式。

### 4.4 改动点 3:空闲清扫豁免(必须)

`RuntimeIdleSweep` 按 `session.lastUsedAt` 判空闲断连(`sdk-runtime-idle.ts:21`,`sessionIdleMs` 后 `closeSession`,提示"会话已因空闲断开")。`lastUsedAt` 只在 ensure/prompt 时 touch(`sdk-runtime-host.ts:158,221,325`)——**自治回合期间平台不 touch,长构建会被清扫中途断连,回合夭折**(本例构建约 7 分钟,若 `sessionIdleMs` 小于时长必然命中)。

处理:合成回合期间**持续豁免**——`onAutonomousTurnStart` 时 `touchSdkSession`,且自治活跃帧到达时周期性 touch;或更简单:合成回合绑定存在时 sweep 直接跳过该会话。

### 4.5 不改动但依赖的既有行为

- **core 自动建回合**(`sessions.ts:85-89`):无 pending turn 自动 `createPendingTurn()` → 自治帧自动聚合;
- **UI 归属**:ws 消息带 `sessionId+agentId` → 前端按会话归属;团队视图按"成员会话→team_members"聚合带出成员名;
- **mailbox 汇报**:MCP 工具执行走独立通道,不受本方案影响;成员在自治回合里调 `team.mailbox.send(taskId)` 仍照常写入并唤醒 Master(既有链路)。

---

## 5. 风险清单与缓解

| # | 风险 | 影响 | 缓解 | 接受度 |
|---|---|---|---|---|
| R1 | **假结束切段**:静默超时误判 → 提前 finalize → 后续帧到达重开新回合,一段执行切成两个回合 | 回合切分,内容不丢 | 增强启发(usage 终结帧)大幅缩小误判窗口;长工具活跃时延长超时(tool_call 未完成状态时 10–15s → 60s);终态 patch 后无误判 | 接受(终态消除) |
| R2 | **与真 prompt 并发的内容串段**:自治回合进行中平台派真 prompt → 真绑定覆盖合成绑定 → 自治残余帧(usage 等)归属到真回合 | 小概率统计/归属污染 | CLI 串行执行(adapter turnQueue 排队),内容帧大体不交叠;usage 帧污染影响仅统计 | 接受 |
| R3 | **空闲清扫中途断连** | 自治回合夭折 | 4.4 豁免(touch / sweep 跳过) | 必须处理 |
| R4 | 会话已被清扫断开后,自治唤醒失效 | 断连期间 CLI 子进程已终止,构建完成不会唤醒 | 与现状一致(断连即无自治);下次 prompt 自动恢复;缓解:豁免本身降低断连概率 | 说明即可 |
| R5 | turnUsage 统计缺口:自治回合无 prompt RPC → 输入 token 缺,输出 token 可从 usage_update 带 | 回合统计字段部分缺失 | 显示层容错(缺省不显示该字段) | 接受 |
| R6 | **长工具调用静默**:构建等单工具期间无 turn-scoped 帧,启发易误判 | 提前结算(同 R1) | tool_call 处于 pending/in_progress 时延长静默阈值;patch 后消除 | 接受 |
| R7 | 权限请求无人响应:自治回合里工具权限照常走 pendingPermissions 交互 | 回合挂起等人工 | 与正常回合行为一致;autoApprovedToolNames 既有规则生效 | 与现状一致 |
| R8 | 未读/状态翻转的副作用:非当前会话合成 done 会打未读标记 | 正向收益(用户能注意到) | 无需处理 | 正向 |
| R9 | 时间线 agent-only 回合:自治回合无前置 human 消息 | 渲染为独立 agent 回合 | 消息行由 finalize 写出,与正常 agent 消息同构;"[后台唤醒]" system 注记作为回合开头 | 低风险,实施时 UI 复测 |
| R10 | 误触发(非自治来源帧无绑定) | 合成一个多余小回合 | 无害:归属机制同一;核心 pending turn 空回合 finalize 时 `turnHasFinalizableContent` 为假,不落消息行 | 接受 |

**总体判断**:R3 必须处理(已入方案),R1/R6 由增强启发+终态 patch 消除,其余均为可接受的小概率/统计级影响。没有发现阻塞级风险。

---

## 6. 改动清单

| 文件 | 改动 | 规模 |
|---|---|---|
| `src/runtime/service/acp-runtime-client.ts` | `:116-127` drop → `onAutonomousTurnStart` 钩子(幂等),接口加钩子选项 | ~20 行 |
| `src/runtime/service/sdk-runtime-host.ts` | 钩子实现:合成 messageId + `beginTurn` + `touchSdkSession` + activity running + "[后台唤醒]" system 注记;静默定时器(基础 15s,活跃 tool_call 时 60s)+ usage 终结启发 → 合成 `RuntimeDoneEvent`;真回合互斥(真 beginTurn 取消定时器/真 endTurn 恢复) | ~80 行 |
| `src/runtime/service/sdk-runtime-idle.ts` | 合成回合绑定存在时 sweep 跳过(或 host 侧 touch) | ~5 行 |
| `src/runtime/service/sdk-runtime-types.ts` | host options 加 `onAutonomousTurnStart` 类型 | ~3 行 |
| (可选终态)`patches/@agentclientprotocol+claude-agent-acp+x.y.z.patch` | autonomous result 显式终结帧 + 开头 user 帧转发 | 上游包补丁,~30 行 |
| core / UI / 协作约定 | **零改动** | — |

## 7. 测试与验证计划

1. **单测**(vitest,仿 `tests/unit/acp-runtime-client` 既有模式):
   - 无绑定 turn-scoped 帧到达 → 触发钩子一次(幂等)→ 帧正常 publish(不 drop);
   - usage 终结帧 + 静默超时 → 合成 done 恰好一次;
   - 真 beginTurn 取消定时器、真 endTurn 恢复;
   - 取消回合残留帧 → 同样合成回合(不 drop)。
2. **集成/手动**:复现 wellcode 场景——成员跑 `run_in_background` 长任务后结束回合,后台任务完成后:UI 实时出现"[后台唤醒]"回合 + 流式渲染 + 会话列表"正在执行"→ 完成后 finalize + idle + 非当前会话未读;历史重载后回合形态不变;团队视图成员名正确。
3. **回归**:正常 prompt 回合、取消回合、清扫断连+恢复路径不受影响。

## 8. 分期建议

| 阶段 | 内容 | 工作量 | 效果 |
|---|---|---|---|
| 阶段 1 | 平台接收(4.2/4.3 基础+增强/4.4 豁免)+ 测试 | ~0.5–1 天 | 完全可见;启发式结束(偶发切段) |
| 阶段 2(可选) | patch adapter 显式终结帧 + trigger 详情 | ~0.5 天 | 消除误判;"[后台唤醒]"带来源详情 |

---

## 9. 结论

**能自动起回合、用户端能自动看到。** 六层管线中五层现成(adapter 转发、runtime→core 发射、core 自动建回合、落库广播、UI 渲染),断点只有 `acp-runtime-client.ts:116` 一个守卫;结算复用既有 `session:done` 链路,core/UI 零改动。风险中唯一的阻塞级项(空闲清扫断连)已入方案强制处理,其余均为可接受或终态消除的小概率影响。

---

## 10. 阶段 1 实施记录(2026-09-14,dev-deepseek / task-76586133)

> 本节由实施者追加:复核 A/B 汇总(`docs/audit/autonomous-turn-review-summary.md`)的 **11 项修正全部并入**,§1–§9 中与修正冲突的表述以本节为准。
> 实施分支:`feat/autonomous-turn-rendering`(基于 prd 5840703,单独 worktree,未合并)。

### 10.1 修正项逐项落地(file:line)

| # | 修正 | 落地 |
|---|---|---|
| P0① | 合成 beginTurn **不带 streamGeneration** | `acp-runtime-client.ts:126-133` `bindSyntheticTurn` 刻意不写 generation(注释说明:写了会被 publish 的 acceptTurnUpdate 二次门整体丢弃);单测 `acp-runtime-client.test.ts` 断言 acceptTurnUpdate 从未被咨询 |
| P0② | session:activity **running/idle 成对 + all-scope** | 开场 `sdk-runtime-host.ts:118`(reason autonomous-wake)、结算 `:165-172`(autonomous-done/cancelled/error);下发 `service.ts:64-75` → `realtime/service.ts:137,155-162` `runtimeMessageDelivery` 对 session:activity 特判 all-scope;单测 `realtime-runtime-delivery.test.ts`;**core 总线回流桥(N1,修于 task-188291f0)**:合成 done 在 `runtime-ingress.ts:54-63` 向 core 总线补发带 `source:'runtime'` 的 idle,runtime 侧听众跳过转发(`realtime-event-source.ts:68-73`),使 dispatcher/wake(核心总线消费者)生产可达;回归 `team-member-dispatcher.test.ts`(驱动真实 `handleRuntimeDone`)+ `runtime-ingress-autonomous-activity.test.ts` |
| P0③ | tier 2 判据 = usage_update **带 `_meta._claude/origin`**;tier 1 升级"**存在未完成 tool 不静默结算**" | `autonomous-turn-tracker.ts:153-163`(origin 判据,流中无 meta usage 不结算)、`:223-236`(tool 活跃不结算);终结帧后 `originSettleDebounceMs=800ms` 合并窗口,连续 cycle 合并;origin 合并窗口同样受两个守卫约束(`:251-273`,修于 task-188291f0):取消在先 → 落 cancelled;工具活跃 → 不中途结算 |
| P0④ | 停止语义 = **可中断**:合成回合登记进 RuntimeActiveTurns(无 generation) | `runtime-active-turns.ts:20-22`(synthetic/onCancelRequested 字段)、`:58-68`(requestCancel 回调)、`:144-167`(beginSyntheticTurn/finishSyntheticTurn/hasActiveTurn);host 开场登记 `sdk-runtime-host.ts:104-115`,cancel 后 tracker 进入短静默+硬截止(`tracker:179-184, 226-235`) |
| P0⑤ | task-relay 合成 done 防提前回传 | `task-relay.ts:113-120` `shouldRelayHubTaskResult`(auto- 前缀过滤),doneHandler 使用 `:159`;单测 `agent-hub-task-relay.test.ts` |
| P1⑥ | 「后台唤醒」注记实时可见 | `shared/autonomous-turn.ts:25` 常量为 **agent contentDelta**(实时进 streamingBuffer;历史重载 UI `session-events.ts` 对 message.chunk 只认 role=agent);`sdk-runtime-host.ts:117` 发布 |
| P1⑦ | 防正常回合 trailing 尾帧幽灵合成 | 实现为**弱帧分类**:usage_update / tool_call_update 无绑定帧永不开启回合(`tracker:127-149`),正常回合结束后的弱帧按 `post-turn-ghost` 分类丢弃(`tracker:173-175, 144-147`)。比"延迟 3-5s 合成"更精确:不丢任何真帧、不产生幽灵回合 |
| P1⑧ | 取消残留单独分型 | 孤儿 tool_call_update(9095 案例)为弱帧 → 直接丢弃,不物化孤儿工具条目、不打后台唤醒注记(`tracker:144-148`);host 集成测试 `sdk-runtime-host-lifecycle.test.ts` 断言零 publishUpdate/publishDone/activity |
| P1⑨ | agent 退出清理合成态 | `sdk-runtime-host.ts:484-494`(进程 exit → dispose 'error')、`:506`(stopAgent → 'cancelled')、`:314`(closeSession)、`:471`(换运行时重启前先收敛,避免 waitForAgentIdle 被长任务阻塞);定时器随 settle 全清(`tracker:255-262`) |
| P2⑩ | 清扫豁免 = session.active=true + done 复位 | `sdk-runtime-host.ts:116`(开场置 true)+ `:146`(结算按 `runtimeTurns.hasActiveTurn` 权威重算,防真回合被误复位);`sdk-runtime-idle.ts:19` 既有跳过逻辑直接生效,该文件无需改动 |
| P2⑪ | 改动清单补全 | 实际改动见 §10.2;`sdk-agent-lifecycle.ts` 未改——退出清理改为 host 层包裹(该模块无 tracker 访问权,host 持有合成态,分层更干净) |

### 10.2 实际改动清单

**新增**
- `src/shared/autonomous-turn.ts` — auto- 前缀约定 / origin meta 判据 / 注记常量
- `src/runtime/service/autonomous-turn-tracker.ts` — 自治回合状态机(分类、tool 跟踪、origin 终结、静默、取消、上限)
- `tests/unit/autonomous-turn-tracker.test.ts`、`tests/unit/realtime-runtime-delivery.test.ts`

**修改**
- `src/runtime/service/acp-runtime-client.ts` — 守卫 drop → `onAutonomousTurnStart` 桥(:49, 140-158);合成绑定(:126);`endSyntheticTurn`(:375);真回合 begin/end 回调(:358-372)
- `src/runtime/service/sdk-runtime-host.ts` — tracker 装配(:74-84)、开场/结算(:97-173)、prompt 前收敛(:299-304)、退出/关闭清理
- `src/runtime/service/runtime-active-turns.ts` — synthetic 字段 + cancel 回调 + 三个新方法
- `src/runtime/service/sdk-runtime-types.ts`(:53)、`acp-runtime-host.ts`(:34)、`sdk-agent-start.ts`(桥透传)、`service.ts`(:64)
- `src/realtime/service.ts` — `runtimeMessageDelivery` all-scope 特判
- `src/core/agent-hub/task-relay.ts` — 合成 done 过滤
- `src/types/ws-protocol.ts` — SessionActivityReason 新增 4 个自治值
- 测试:3 个既有文件扩展(acp-runtime-client / sdk-runtime-host-lifecycle / agent-hub-task-relay / team-member-dispatcher)

### 10.3 与 §1–§9 的差异修正(实施后语义)

- **"core/UI 零改动"收紧**:core 侧 `task-relay.ts` 必须过滤合成 done(P0⑤);UI 零改动成立(注记走 agent contentDelta,活动走既有 session:activity 通道)。
- **A2 未读局限解除**:activity idle 特判 all-scope 后,非订阅客户端也能收到 idle → UI `applySessionActivity` 对非当前会话置未读(`session.store.ts:692-698`),未读不再依赖 session:done 的订阅投递。
- **R3 空闲清扫**:默认 sessionIdleMs=30 分钟,阶段 1 以 session.active 留驻豁免;文档原"长构建必被断"表述按复核 B 修正为"阈值调小或自治 >30 分钟才命中"。
- **R10 修正**:空回合不落库的真实机理 = `turn-finalizer.ts:63-64` 返回 null + `sessions.ts` else 分支只清 stage;且"误触发不落库"仅在**全空**时成立(含 contentDelta 的 trailing 帧会落一条可见消息行)——本方案因注记必然写入开场 contentDelta,合成回合**必有消息行**,这正是"可见性"目标的行为。
- **tier 3 patch(阶段 2 首选动机)**:形态 = adapter 显式转发自治 cycle 边界(含 origin 详情)。原按复核裁决降为"可选";task-188291f0 修正后 **升级为阶段 2 首选动机**——它是 R2 归属污染窗口(§10.5)的结构性解。"接受 R2"的结论保留,但优先级不再含糊。
- **取消升级语义**:用户 stop 合成回合时,cancel 升级阶梯(host 默认 cancelGraceMs=800 / closeGraceMs=1000 / restartGraceMs=1000)可能走到 session-close/agent-restart——与真回合对卡死 turn 的既有语义一致;tracker 的 cancel 硬截止(8s)保证 settled 必然达成。**修正(task-188291f0)**:tracker `cancelSilenceMs` 默认 1500 → **400**(`autonomous-turn-tracker.ts:61`,注释说明必须 < cancelGraceMs),否则默认参数下 800ms 内必不结算、取消直接跳过 'cancel' 级落 session-close(比必要更重);修正后默认参数即达 'cancel' 一级,session-close 仅作兜底(host 测试用默认参数断言升级值,不再压 cancelSilenceMs)。
- **真 prompt 与合成回合冲突**:RuntimeActiveTurns 每会话仅允许一个在册回合,`host.prompt` 先 `disposeSession(end_turn)` 再登记真回合,保证"运行中后台唤醒 + 用户插话"不互斥失败。**注意**:该收敛只解决运行时单回合注册的互斥,不缩小内容归属窗口(见 §10.5 R2 修正后表述)。
- **core 总线回流桥(N1 修正)**:runtime 结算原只走 realtime 流(客户端可见),core 总线 `session:activity` 仅由平台 prompt 生命周期发出 → dispatcher/wake(核心总线消费者)的"合成 idle 唤醒"在生产不可达(原测试靠手动 emit 制造虚假信心)。修正:合成 done 经 `runtime-ingress.ts:54-63` 在持久化完成后向 core 总线补发 `{state:'idle', reason:autonomous-done|cancelled|error, source:'runtime'}`;`realtime-event-source.ts:71` 对 `source==='runtime'` 跳过转发(客户端可见的那条已由 runtime 直发,避免重复广播;先例 = `source==='runtime-persistence'` 的 session:update 跳过)。

### 10.4 验收自证(复核 a–i)

| 判据 | 证据 |
|---|---|
| a. 合成 beginTurn 无 generation | `acp-runtime-client.test.ts` › P0① 测试:acceptTurnUpdate spy 从未被咨询、帧正常发布 |
| b. 无 meta usage 不结算 / 带 meta 才结算 | `autonomous-turn-tracker.test.ts` › "只有带 _claude/origin 的终结帧触发结算";host 集成同断言 |
| c. 有未完成 tool 静默不结算 | tracker › "存在未完成 tool 时静默不结算,工具完成 + 静默后才结算" |
| d. 真回合互斥双向 | tracker › "真回合开始立即结算合成回合…只结算一次";host › "a real prompt settles the open autonomous turn first and still starts" |
| e. dispatcher/wake 在合成 idle 后行为回归 | 生产可达链路(N1 修正后):`team-member-dispatcher.test.ts` › "…settles through the runtime done ingress"(驱动真实 `handleRuntimeDone`,非手动 emit)+ `runtime-ingress-autonomous-activity.test.ts`(总线补发断言)+ `realtime-event-source.test.ts`(runtime 源不重复广播) |
| f. 取消残留不重复渲染 | host › "cancelled-turn residue … never materializes a synthetic turn"(零 publish) |
| g. 非订阅客户端侧栏 running 复位 | `realtime-runtime-delivery.test.ts` › session:activity 特判 all-scope + UI `applySessionActivity` 既有逻辑 |
| h. 无绑定帧触发钩子恰一次(幂等)→ 帧正常 publish | `acp-runtime-client.test.ts` › handleUnboundFrame 恰一次、两帧同 auto- id 发布 |
| i. 合成 done 恰一次 | tracker settle 单次断言(origin/静默/互斥/dispose 各路径)+ host publishDone toHaveBeenCalledTimes(1) |

### 10.5 未覆盖 / 后续

- **wellcode 式真实场景手测未做**:独立 worktree 与主仓共享数据目录/端口,起真机实例有污染风险,留待合并前由 Master 在 prd 环境验证(建议步骤:成员 run_in_background → 任务完成唤醒 → UI 出现"[后台唤醒]"回合 + 流式渲染 → finalize + 未读)。
- **R2 归属污染残余**(真 prompt 与自治帧并发窗口,task-188291f0 修正表述):真回合绑定在 `host.prompt`(`beginTurn`)即生效;CLI 对 prompt 的串行排队意味着真回合的首批帧要等当前自治 cycle **跑完**才开始产生。窗口 = 从真绑定生效到自治 cycle 剩余输出结束的**全程**——长后台任务场景下,用户消息会吸收该自治 cycle 剩余的数分钟输出(工具进度/思考/正文)并归属到真回合名下。`host.prompt` 的先收敛(disposeSession)只解决 RuntimeActiveTurns 单回合注册互斥,**不缩小该窗口**(原表述"CLI 串行 + prompt 前收敛已把窗口压到最小"失实,予以更正)。平台侧无 cycle 边界信号,结构性无解 → 维持"接受"评级,并作为 **tier 3 patch(阶段 2 首选动机)** 的目标问题;缓解说明:CLI 串行保证窗口内不会并发执行两个 turn,污染形态是"归属错位"而非"交错乱序"。
- **阶段 2**:patch adapter 显式转发自治 cycle 边界(含 origin 详情)——**首选动机 = 结构性解决 R2 归属污染窗口**(本轮由"可选"升级);其余(trigger 详情等)继续可选。

### 10.6 审查修正记录(task-188291f0,N1–N4)

> reviewer-glm 独立审查结论"修正后通过",4 项 P2 修正并入;N5(强尾帧幽灵残留)/ N6(ghost 窗口平台级时间戳)按裁决留阶段 2。
> 代码+测试修正提交:`e55f249`;本文档修正随本提交。

| # | 问题 | 修正 | 证据 |
|---|---|---|---|
| N2 | origin-debounce 到期即 settle end_turn,与 silence 路径不对称:① 用户 stop 后被取消 cycle 仍发带 origin meta 的 result 帧 → 合成回合被标"完成"(用户可见错误);② 跨 cycle 合并窗口内 >800ms 帧间隙 + 工具进行中 → 中途结算,工具条目永久 in_progress、后续 tool_call_update 被丢 | `autonomous-turn-tracker.ts:254-271` 加两守卫:取消在先 → settle('cancel','cancelled');工具活跃 → 不结算,转 silence 续期(origin 标记保留,工具完成帧重新触发 debounce 尽快收敛) | `autonomous-turn-tracker.test.ts` 新增:"stop 后 origin 终结帧到达:落'已取消',不落完成"、"合并窗口内工具仍活跃:origin 帧不中途结算,工具完成后再收敛" |
| N3 | `cancelSilenceMs` 默认 1500 > host `cancelGraceMs` 800 → 默认参数下升级必跳过 'cancel' 直落 session-close(比必要更重);旧测试压 5ms 才拿到 'cancel' 本身即失配反证 | 默认 1500 → **400**(`autonomous-turn-tracker.ts:61`,注释写明必须 < cancelGraceMs) | `sdk-runtime-host-lifecycle.test.ts` 取消用例改默认参数,断言升级值 'cancel' |
| N1 | 验收 e 路径生产不可达:core 总线 activity 只由平台 prompt 生命周期发出,runtime 结算只走 realtime 流,无回流桥 → "合成 idle 唤醒 dispatcher/wake"仅测试内手动 emit 成立 | 补 runtime→core 桥:`runtime-ingress.ts:54-63`(合成 done 持久化后补发 `source:'runtime'` idle)+ `realtime-event-source.ts:71`(跳过转发防重复广播)+ `ws-protocol.ts` SessionActivityData.source 字段 | 新增 `tests/integration/runtime-ingress-autonomous-activity.test.ts`(3 用例);`team-member-dispatcher.test.ts` 改为驱动真实 `handleRuntimeDone`;`realtime-event-source.test.ts` 新增跳过断言 |
| N4 | §10.5 R2 表述失实 | 如实改写窗口 = 绑定生效 → 自治 cycle 剩余结束全程;tier 3 升级阶段 2 首选动机 | 本文件 §10.3/§10.5(随本提交) |
