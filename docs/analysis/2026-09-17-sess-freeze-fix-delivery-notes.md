# 交付说明:会话卡死自愈修复(sess-d83044f2 事故)

- 分支:`fix/sess-freeze-selfheal` · 依据:`docs/analysis/2026-09-17-verify-d83044f2-dev-deepseek.md`
- 面向:部署/运维与使用者,交代本修复「改了什么、怎么用、开关怎么取舍」。
- 本文档已按双审(一审 glm / 二审 deepseek)修复轮更新:归属四场景契约、forceFinish 身份守卫与兜底、
  心跳否决位删除、以及三处口径修正(时间线可见性 / 终稿找回路径 / applied 留痕)。

## 一、用户能看到什么变化

| 场景 | 修复前 | 修复后 |
|---|---|---|
| 排队中的消息 | 界面毫无反应,只能感到"发消息没反应" | 会话 stage 显示「排队中(前面有未完成回合)」;列表行指示、移动端、dashboard 的会话时间线(SessionTimeline)按 stage 展示。**聊天消息流本身不渲染该 lifecycle 行**(它不进 `visibleLifecycleEvents`),这是有意的:排队不是消息 |
| 回合被误终结、真实回答照常产出 | 回答内容消失,行被置 completed | 终帧按四场景契约归属(见 §三),不再写到别的回合行上;内容只落在事件流里时,可由 `sessions.recoveredDraft` 只读合并还原 |
| 进程退出/合成终帧(exit-*、done-*) | 真实行僵死 + 多出一条「执行失败」幽灵行 | 归属规则回落真实 running 行置终态,不再为合成 id 建行(B1 修复) |
| 回合挂起、普通「停止」无效 | 只能重启平台 | 工作台会话输入框停止按钮旁新增「强制结束」(⚡,带确认弹窗):终结当前回合并放行排队消息(团队面板 TeamChatPane 本轮未接,仍用普通停止;会话详情侧的命令入口 `session.forceFinish` 对全部会话可用) |

## 二、配置开关与取舍(重要)

新增 `AppConfig`(已同步 edge/protocol.ts 白名单):

| 字段 | 默认 | 说明 |
|---|---|---|
| `promptStuckAutoRecoverEnabled` | **false(关闭)** | 挂起回合**自动**收敛开关;env:`PROMPT_STUCK_AUTO_RECOVER=enabled` |
| `promptStuckAutoRecoverMs` | 1800000(30 分钟) | 静默阈值;**硬钳制下限 30 分钟**(模块初值与配置入口都过钳制),传更小值按 30 分钟生效 |

**为什么默认关闭**(2026-09-17 事故评审结论):

该事故中,04:05 起就有定时唤醒消息排队,而那个"看似卡死"的回合在 05:57-05:59 仍然真的产出了完整答案。
如果自动收敛开启,系统会在约 04:35(静默 30 分钟 + 有排队)就终结这个活着的回合 ——
**后续 05:57-05:59 的真实产出将永远不会产生**,而"终稿只读还原"(#4)只能还原**已经产出**的内容,救不回被终止之后的产出。
因此:

- **默认关闭**,把"6 小时无人察觉"压缩成"可见(排队 stage)+ 秒级可解(强制结束)";
- 建议先跑一段时间、观察 `active prompt watchdog warning` 日志与真实卡死频率,再按部署环境决定是否开启;
- 若开启,自动收敛只在**两个条件**同时满足时动作:存在排队消息 + 无任何上行流事件 ≥ 阈值。
- **安全垫是流事件静默(lastProgressAt),且它是启发式而非硬保证**:工具心跳/工具更新帧会经
  session:update 路径刷新 lastProgressAt,但平台**无法保证帧连续** —— 本事故本身就是"活回合静默
  2h08m 后仍产出真答案"。因此某长工具若长时间不产生任何上行帧,启用自动收敛的部署会在阈值处
  终结它;这正是默认关 + 阈值下限 30min 的理由。
- 曾实现的"独立心跳否决位"已删除 —— ACP 工具心跳只存在于 runtime 子进程(process 模式跨进程)
  或 embedded 的 acp 会话键下,API 进程的诊断态永远看不到它,保留一个永不生效的判据只会误导
  (二审 N2/P2-6)。回归用例断言诊断态不再携带该字段,若未来重新引入必须同时提供跨进程上报通道。

## 三、终帧归属四场景契约(本次修复核心)

`src/core/terminal-attribution.ts` 的纯函数是唯一判定点,四场景同时成立(单测 + 集成用例固定):

| # | 场景 | 归属行 |
|---|---|---|
| ① | 事故场景:pending 与事件同 id(合成回合 auto-* 自带内容) | 事件 id 赢,刚启动的真回合行不许动 |
| ② | 异 id done + 无活跃过程且 pending 有内容(集成契约:done 携带 `done-<sid>`) | 信任 pending(真实流式行) |
| ③ | 事件 id 无对应行 + 有活跃过程(**exit- / done- 前缀**的合成 id) | 回落活跃过程的真实行,**严禁建幽灵行** |
| ④ | 迟到 done(事件=旧行 id,新回合已接管);**auto-* 一律走本档** | 事件 id 赢,新回合的聚合内容不外溢 |

内容来源与归属行强绑定:只有与目标行同 messageId 的聚合(过程快照 / pending)才能写进去。
若归属目标是一条不存在且非 auto-* 的行,会留痕 `terminal attribution targets a message row that does not exist`。

三点边界(复审确认后如实记录):

- **auto-\* 排除在 ③ 之外**(P1-R1):自主回合不注册执行过程、行尚未补建,而"在飞 + 新提示到达"
  时 pending.id 可能已翻转为真实行 —— 若让它命中 ③,真实行会被合成终帧提前终态化(内容只能靠
  事件流还原)。排除后 auto-* 走 ④:事件 id 赢、不碰真实行,与事故修复前的行为等价。
- **错误终帧也受"严禁幽灵行"约束**(F1):exit-* 在"无过程、无 pending"时若带 error,过去会补建一条
  「执行失败」行;现在改为跳过 + 留痕(`error terminal for an unknown non-autonomous id skipped`)
  —— 该组合只可能是对已结算回合的迟到退出帧,补建反而是虚假失败消息。
- **无 id 的 pending 聚合**(F4,既有妥协):聚合整体没有 messageId 时,内容会写进归属行;
  若该聚合实际来自另一回合即为外溢。触发需所有帧都不带 messageId(平台帧基本都带),风险极低,
  本次不改行为,仅记录。

## 四、使用方式

1. **人工一键(推荐首选手动)**:回合疑似卡死 → 点停止按钮旁的 ⚡「强制结束」→ 确认。
   平台依次执行:运行时收敛(ACP cancel → 关会话 → 重启 Agent,均有上限)→ 回合置终态(严格归属)→
   清挂起 → 放行排队消息。等价命令:`session.forceFinish`(HTTP `/api/v1/commands` / WS RPC)。
   两点保证:
   - **回合身份核对**:若运行时收敛期间原回合已自行收尾、新回合已接管,强制结束跳过全部清理,
     不会踩掉新回合的占位与看门狗状态(日志:`force finish superseded by a newer turn`);
   - **行兜底**:活跃过程 id 取不到时,按会话反查最新 running 的 agent 行置终态;
     若行已是终态则跳过合成终帧,不重复写 `message.done` 事件。
   - **命令回执措辞**:若运行时收敛期间新回合已接管,命令返回成功但日志为
     `session force finish skipped; a newer turn has taken over the session`(没有执行任何清理)。
2. **终稿找回**:`sessions.recoveredDraft`(`{sessionId, messageId}`)按 messageId 从 `session_events`
   只读合并 message.chunk 还原真实终稿;只读 RPC,不写库、不改变消息行状态。
   **注意:该 RPC 目前没有 UI 入口**(只能在脚本/自定义客户端调用);产品侧的自动路径是
   "终态行无同源内容且仍 running"时由平台自己调用它兜底写入。
3. **日志留痕**(排查用):
   - 终帧归属不一致 → `terminal messageId mismatch; attributing per attribution rule`(带 event/process/pending id 与来源);
   - 归属到不存在的行 → `terminal attribution targets a message row that does not exist`;
   - 错误终帧不再补建幽灵行 → `error terminal for an unknown non-autonomous id skipped; no ghost row created`;
   - 迟到终帧不清在飞回合 stage → `skipped stage cleanup; the session stage belongs to a newer turn`;
   - 终态写入未命中 running 行(`applied=false`)→ `terminal write was not applied to a running row; content may be dropped by the write guard`;
   - 行已终态导致快照被拒 → `running snapshot dropped: message row already terminal`;
   - 强制结束命中新回合而跳过 → `force finish superseded by a newer turn; skipping terminalization and cleanup`
     / `prompt cleanup skipped; a newer turn owns the session`;
   - 自动收敛触发 → `active prompt stuck with queued messages; forcing finish (auto recover)`。

## 五、回滚

- 关闭自动收敛:不配置开关即可(默认关)。
- 代码回滚:回退分支 `fix/sess-freeze-selfheal`;无数据库结构变更(无新迁移),数据层无需回滚。
  `insertTerminalMessage` 补建行现在写入 `started_at = completed_at`(此前为 NULL),回滚不影响既有数据。
