# 团队邮箱会话线硬隔离 v3 —— 交付说明（dev-deepseek）

- 任务：task-70cf97f3（实现团队邮箱会话线硬隔离 v3，用户已拍板"硬隔离，不开看全公司的口子"）
- worktree：`.claude/worktrees/wt-mailbox-line-scope`，分支 `feat/mailbox-line-scope`（对基：prd `28e1b006`）
- 设计基准：`docs/analysis/2026-09-17-wakeup-routing-dev-deepseek.md`（本案分析）
- **未合并 prd**：按派单要求，本分支只推分支，等双审通过后再合并（合并时需重新对基，见 §4）

---

## 1. 交付内容（对照 v3 定稿逐条）

### 1.1 邮件强制归属（防"丢汇报"复发）

| 项 | 实现位置 |
| --- | --- |
| `team_mailbox.conversation_id` + 索引 | `src/store/migrations/075-team-mailbox-conversation.ts`（prd 最新迁移 074 → 本分支取 075，与另一线无撞号） |
| 写入落列 | `src/store/teams.ts` `teamMailboxStore.create`（`conversation_id`，缺省 NULL 仅遗留/直写） |
| 四级兜底 | `src/core/team-line-scope.ts` `resolveMailboxLine`：① 发送会话所在线 → ② 任务 `initiator_session_id` 所在线 → ③ 成员主格线（`team_members.session_id`）→ ④ 团队默认线 |
| 全链路落空 → 拒收 + warn | 同上返回 `null` + `log.warn`；`src/core/team-line-service.ts` `resolveMailboxLineOrReject` 抛错（带原因与解法），`teamService.sendMailbox` 调用它 |
| 默认线规则（我定，派单授权的两选一） | **最早的活跃线**：`created_at ASC, rowid ASC`（`src/store/team-conversations.ts` `listActiveByCreation`）。不引入显式配置：团队建线是显式动作，最早那条即"主会场"；`rowid` 兜底保证同毫秒建线也确定化 |

**agent 建团队开首线**（补充设计，需评审确认）：建线原本只是**人**在团队面板里的动作（RPC `team.conversation.create`），agent 没有建线工具；而硬隔离下无活跃线的团队**收不了任何 mailbox**（写入无归属 → 拒收），等于"成员汇报必丢"。因此 `team.create` **工具**（agent 路径）建团队时同步开一条首线（`teamService.ensureDefaultConversation`），语义与面板首线完全一致（同名"新团队会话"、master = Leader 格子）。UI/RPC 建团队路径**不变**（不自动建线，面板空态保持原样）。

### 1.2 agent 工具视图按线过滤（不设 `all=true` 之类的全局口子）

| 工具 | 变化 |
| --- | --- |
| `team.get` | `teamService.detailForLine`：成员限本线有格子者、任务与 mailbox 按线过滤，结果附 `lineScope`（含命中层级 `via`） |
| `team.mailbox.list` | `listMailboxForLine`（本线邮件 + 归属缺省行仅在默认线可见），结果附 `lineScope` |
| `team.task.list` | `listTasksForLine`（无来源会话的历史任务归默认线） |
| `team.status` | 成员=线内参与者；格子=本线格子；排队/在飞只聚合本线格子；`lastReport` 用线内口径；任务统计按线 |
| 无活跃线 | 四个工具**拒绝并明示**（"没有任何活跃会话线…请先在团队面板创建或恢复"），不退回"看全团队" |
| 唤醒模板 | 原话术不变（`请先使用 team.get …`），仅末尾追加触发内容快照（§1.3） |

**人的视野不动**：`teamService.detail` / `currentBySession`（RPC `teams.detail` / `teams.current`，UI 团队面板）与 `listMailbox` 全量口径不变 → `src/core/team-view.ts` + `listMailbox` 转发。成员名册仍可达：`team.member.list` 未过滤（属团队级身份信息）。

### 1.3 唤醒修复

| 项 | 实现位置 |
| --- | --- |
| 覆盖层单槽 → **拼接**（去重 + 40k 上限） | `src/core/team-wake-coordinator.ts` `appendToPending`（去重按整段文本比较，重复通知不重复拼接） |
| 定时器"最早截止时间优先" | `armWakeTimer` + `wakeDeadlines`：2s 的邮件唤醒不必等 15s 静默窗口；连续通知不会把窗口无限延后 |
| 唤醒落线 | `notifyMailbox` 优先用写入时钉死的 `message.conversation_id` → 该线 Leader 格子；缺失时回退 `sourceSessionId` 反查 |
| 末尾附触发内容快照 | `buildLeaderWakePrompt({ trigger })` → `withWakeTriggerSnapshot`：任务状态行 + 相关邮件摘要（`teamMailboxStore.listByTask`，**按触发邮件所在线过滤**，正文截断 160 字），**追加在整条 prompt 末尾**，原话术一字不改 |
| `Team Leader wake scheduled` debug→info | `scheduleLeaderWake` / `appendLeaderWake`：`log.info({ reason, via, leaderSessionId, delayMs })`（`reason`=mailbox/task/dispatch-failed/recovery/silent-turn；`via`=preferred/member-line/latest-active/member-bound） |

### 1.4 加固

| 项 | 实现位置 |
| --- | --- |
| 同线已处理轻量标记 | `deliveredWakeSignatures`（内存态、120s 窗口、500 条上限、键=`线会话:签名`；签名 `mailbox:<id>` / `task:<id>:<status>`）→ 已唤醒过的邮件不再被重启对账二次唤醒 |
| report/result 无 taskId → 拒收 | `sendTeamMailboxHandler`：错误信息含"未绑任务的汇报不会投递"，并给出改法（补 taskId / 改 type=message / question / blocked）；服务层保留写入能力但 `log.warn` 留痕（避免破坏既有服务层调用方与测试） |
| `getBySession` 补 `ORDER BY` | `src/store/team-conversations.ts`：`ORDER BY tc.updated_at DESC, tc.id ASC`（最近活动的线优先，id 兜底） |
| 描述同步 | `src/tools/team-seed.ts` 与 handler 描述同步更新（含 `team.status` 的单一来源测试） |
| 文件行数守卫 | `src/core/teams.ts` 触达 400 行守卫（`tests/unit/file-size-policy.test.ts`）→ 按既有先例（`team-archive.ts`）拆出 `team-line-service.ts`（按线读写口径）与 `team-view.ts`（人的视野读模型）；合并后 380 行 |

---

## 2. 验收清单自查

| 验收项 | 结果 | 证据 |
| --- | --- | --- |
| 两线各一封邮件各自只见本线 | ✅ | `tests/unit/team-line-scope.test.ts` "两线各一封邮件各一个任务，各自只见本线"（team.get / mailbox.list / task.list 三处断言） |
| 无归属必落默认线或拒收不静默丢 | ✅ | ④ 默认线两例（含同毫秒建线确定化）+ "无活跃线 → 写入拒收 + 不落库" + 只读工具拒绝并明示 |
| 同 tmail 不在他线重复入桶 | ✅ | 遗留 NULL 行只在默认线可见、他线为空 |
| 被吞邮件场景内容可达 | ✅ | "3 封任务邮件 + 任务完成同窗：一封唤醒含全部内容"（回归本案 3 封被吞） |
| 归属四级兜底 | ✅ | ①会话 ②任务（任务线 ≠ 成员主格线时证明优先级）③成员主格 ④默认线 各一例 |
| 拼接唤醒 | ✅ | 覆盖层拼接 + 最早截止时间 + 快照末尾（三例） |
| 拒收路径 | ✅ | 写入（无活跃线）与工具层（report/result 无 taskId）两条 |
| `getBySession` 确定性 | ✅ | 同一 session 命中两线 → 随"最近更新"翻转，可复现 |
| 同线已投递标记 | ✅ | 已唤醒邮件 `recoverPendingWake` 返回 false 且不再唤醒 |
| 唤醒话术保留原话术 | ✅ | 断言 `请先使用 team.get 查看最新 Team 状态` 仍在 |
| UI 团队面板全量不动 | ✅ | `team-view.ts` / `listMailbox` 未过滤；`tests/unit/team-current-rpc.test.ts` 全绿 |

---

## 3. 验证结果（本分支 @ `feat/mailbox-line-scope`，基于 prd `28e1b006`）

- `npx vitest run tests/unit/team- tests/integration/team-`：**45 文件 / 364 用例全绿**（含新增 `team-line-scope.test.ts` 18 例）
- 新增测试连跑 3 次（含受影响的 6 个既有套件）：**98 用例 × 3 全绿**（无 flake）
- 全量 `npx vitest run`：**504 文件 / 2983 用例通过**，1 失败为既有环境 flake
  - `tests/integration/model-proxy-runtime.test.ts` "codex independent Runtime…"：Windows 临时目录 `EPERM`（`afterEach` `rmSync`），单独跑 3 次中 2 次通过；`git diff prd -- tests/integration/model-proxy-runtime.test.ts` 为空（本分支未触碰该文件），改动不涉及 model-proxy/runtime，属既有 flake（与本轮此前 session 中记录的一致）
- `npm run lint`：全绿（src + ui + mobile）
- `npm run build`：全绿（tsc + ui + mobile）
- `npx tsc --noEmit -p tsconfig.server.json`：0 error
- CLAUDE.md 规约：本次**未新增/修改 `AppConfig` 字段**，`src/edge/protocol.ts` 白名单无需同步（已自查）

---

## 4. 冲突评估（对基：prd 已从 `28e1b006` 前进到 `c9018955`）

**prd 新进的 3 个提交**（另一线"通知必达闭环 P0+P1"）：`5be061f1` / `a9426a41` / `c9018955`，改动文件与我的重叠面：

| 文件 | 两侧都改 | 合并结果（实测） |
| --- | --- | --- |
| `src/core/teams.ts` | ✅ | **冲突**：import 段（对方 `team-task-assignee.js` vs 我 `team-line-service/team-view`）+ 我移走的 `detail`/`currentBySession` vs 对方保留的内联实现 → 解法：两段都保留（import 合并且保留我的 `...teamLineService, ...teamViewService` 展开），机械可解 |
| `src/tools/handlers/team/team-tools.ts` | ✅ | **冲突**：`team.mailbox.send` 描述行 + 变量段（对方 `toMemberId` 自寄告警 vs 我 `type/taskId` 拒收）+ 尾部返回（对方 `warning` vs 我 `lineScope`）→ 解法：三段都合并保留，机械可解 |
| `src/core/team-prompts.ts` / `team-wake-coordinator.ts` | ✅ | 自动合并成功（改动区域不同：对方唤醒口径/去任务门槛，我拼接+快照+日志） |
| `tests/unit/team-mailbox-wake-types.test.ts` | ✅ | 文本自动合并，但**语义冲突**：对方新增的 P1-E′ 用例引用夹具旧属性 `fixture.memberSession.id`，而我把夹具改为 `memberSessionId`（线上形态：成员格子会话）→ 需 2 行改名（`sed` 已验） |
| `tests/unit/team-silent-turn-wake.test.ts` | ✅ | 自动合并成功 |
| `team-task-assignee.ts`（对方新增）/ 我的新文件 | — | 无重叠 |

**实测（在临时 scratch 分支上真做了一遍合并，非估算）**：
- 冲突文件数：**2**（`teams.ts`、`team-tools.ts`）+ 语义冲突 **1**（合并后的测试夹具引用）
- 解决后：`tsc -p tsconfig.server.json` 0 error；`teams.ts` **380 行**（≤400 守卫）；`tests/unit/team- + tests/integration/team-` **49 文件 / 405 用例全绿**（两侧用例同时通过）
- 解决后**全量套件**：`505 文件 / 2994 用例通过`、**0 失败**（exit=0；连既有 `model-proxy-runtime` 临时目录 flake 本轮也未出现）
- 结论：**可合并，工作量约 3 个文件的小改 + 1 处测试改名**；不需要谁先 rebase——直接 `git merge` 后按上表解法处理即可
- 说明：该 merge 只在临时 scratch 分支上验证后**已丢弃**（本分支保持"只推分支、不合并"的交付形态），解法与验证结论记录在本节，合并时按此复现
- 注意点（语义层面，非文本冲突）：对方 `dispatchMessage` 新增 `backfillTaskAssignee` / `withAssigneeWarning`，与我的 mailbox 归属无关，但 **合并后 `team.mailbox.send` 的描述行需以合并版为准**，`src/tools/team-seed.ts` 我已同步（对方那 3 个提交没同步 seed，属他们的遗漏，合并时以我的为准即可）

---

## 5. 已知问题 / 风险 / 假设

1. **线上影响（本分支合并后立即生效）**：现有 agent 若发 `type=report/result` 不带 `taskId`，将被工具层拒收（错误信息给出改法）。生产数据：team-a617cb61 历史 mailbox 中 report/result 无 taskId 占比不低（约 28%）→ 合并后成员会被迫补 `taskId` 或改类型（这正是用户要的"汇报必达"口径），但**首次触发时会有可观测的失败峰值**，建议合并后盯一轮 `team.mailbox.send` 错误日志（`未绑任务的汇报不会投递`）。
2. **无活跃线团队的写入/读取一律拒绝**（设计如此）。已实测生产库：所有**活跃**团队都有 ≥1 活跃线；归档团队无线（其 mailbox 本就不可用）。写入侧唯一的生产调用方是 agent 工具 `team.mailbox.send`（`teamService.sendMailbox` 在 `src/` 内仅被 `src/tools/handlers/team/team-tools.ts` 调用；RPC 网关没有任何 mailbox 写入路径——`grep -rn mailbox src/gateway/rpc/*.ts` 为空），所以**无活跃线拒绝的实际影响面 = agent 的 mailbox 写入**；agent 建团队路径已补首线（§1.1），而在 UI/RPC 创建团队、人尚未点"新建会话线"之前，该团队还收不到成员汇报（与"无归属即拒收"同源，属预期行为，需在验收时确认可接受）。
3. **遗留数据（migration 075 之前）不回填**：`conversation_id=NULL` 的行只在默认线可见；无来源会话的历史任务同理。若某团队有多条线且历史汇报重要，管理员需要手工把关键行指到对应线（本分支不提供回填脚本，避免固化历史瞬时状态）。
4. **团队默认线 = 最早的活跃线**：若最早的线被归档，默认线自动顺延到下一条活跃线（`listActiveByCreation` 只取 active）；这是"默认线"语义的自然延伸，但**归档最早线会让随后的无归属写入改线**，属行为变更点。
5. **同线已投递标记是内存态**（重启即清空，500 条上限 FIFO）：进程重启后 `recoverPendingWake` 的既有守卫（`last_message_at` 比较）仍生效，不会重复轰炸；但极端情况下（重启 + 存量邮件 + leader 从未活跃）可能出现一次重复唤醒，接受。
6. **`team.status` 的契约变化**：成员可见性=线内参与者、运行态/排队/在飞只算本线（原为"primary + 全部格子"跨线聚合，F1 回放用例已按新契约改写为线隔离用例）。跨线聚合视图现在只存在于人的视野（UI 团队面板），agent 侧不再可见——这是 v3 的明确取舍，请评审确认。

## 6. 下一步

1. ~~等双审~~ 双审**均已通过**（一审 `docs/review/2026-09-17-mailbox-line-scope-review-glm.md`、二审 `2026-09-17-mailbox-line-scope-review-deepseek.md`）；Leader 裁决：**F2 合并前必修**（本分支已补，见 §7），F1 记为已知边界另立后续任务。
2. 等 F2 增量确认（双 reviewer 仅确认 F2）→ 通过后执行合并（见 §8 合并 checklist）。
3. 合并后建议跟进（不在本分支范围）：`team-identity-transition` 等**会话线迁移**场景下 mailbox 归属的再验证；mailbox 归属的**回填脚本**（若用户需要历史汇报归线）。

## 7. 微补丁（F2 + 两审顺手项，commit 见分支 log）

| 项 | 来源 | 实现 |
| --- | --- | --- |
| 唤醒快照按线 | 二审 F2 | `teamMailboxStore.listByTask(taskId, limit, line?)` 增加可选线过滤（复用 `MAILBOX_LINE_SCOPE_SQL` 口径）；`buildWakeTriggerSnapshot` 经 `snapshotLineFilter`（邮件触发的唤醒取该邮件所在线，遗留 NULL 行按默认线；任务触发的唤醒取任务所在线）只取本线邮件摘要。**任务状态行保留**（"为什么被叫醒"的必要信息，不属于任何线私密内容） |
| F2 单测 | 工单必补 | `tests/unit/team-line-scope.test.ts`「唤醒快照按线（F2）」：同一 taskId 两线各一封 report，两线各自唤醒 → 各线快照只含本线邮件摘要 + 任务状态行两线都在；并附**反证**（不带线过滤时两封都在），证明"只含本线"来自线过滤而非数据缺失 |
| F6① 表述如实化 | 二审 | §5.2 改为"写入侧唯一生产调用方是 agent 工具，RPC 无 mailbox 写入路径"（`grep -rn mailbox src/gateway/rpc/*.ts` 为空，已核） |
| F6③ prompt 模板提示 | 二审（合并时改 prd 侧） | 合并时在 `buildTeamMemberPrompt` 的协作规则补一句"显式 type=report/result 缺 taskId 会被系统拒收"（与工具层拒收口径一致，减少成员往返） |
| P2-1 description 三合一 | 一审 | 本分支已写入 `team.mailbox.send` 描述（线隔离语义 + 必带 taskId + toMemberId 指引），`src/tools/team-seed.ts` 同步；合并时以该合并版为准 |

## 8. 合并 checklist（合并 prd 时逐条执行，结果写进合并后汇报）

- [ ] `WAKE_TASK_STATUSES` 取 **prd 版本（带 `export`**，`team-silent-turn` 依赖；漏了 tsc 必挂）（一审 P2-2）
- [ ] `team.mailbox.send` description 三合一（§7 P2-1）——不丢 prd 侧"不要填自己"的提示
- [ ] 迁移号复查：合并前看 prd 最新迁移号是否已到 075，撞号则本分支迁移顺延（一审 P3-3）
- [ ] 夹具改名 2 行：`tests/unit/team-mailbox-wake-types.test.ts` 的 `memberSessionId`（对方新用例引用旧属性名）
- [ ] `teams.ts` / `team-tools.ts` / `team-prompts.ts` 按 §4 实测解法处理（两审均已复核语义相容）
- [ ] F6③ prompt 模板补"report/result 缺 taskId 会被拒收"（§7）
- [ ] 合并后 prd 上：全量 `npm test`（既有 flake 除外）+ `npm run lint` + `npm run build` 复验 → 通过后才把 task 置 completed
