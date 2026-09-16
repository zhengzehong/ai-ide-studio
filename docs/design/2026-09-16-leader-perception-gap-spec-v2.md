# Leader 感知盲区方案 v2 · Spec 级(2026-09-16)

> v1(根因分析)见 `2026-09-16-leader-perception-gap-solution.md`。本档按用户要求把两个核心点做实:
> "你要加工具、加什么值、加什么东西,就得明确:第一,核心要做什么,访问的内容是什么;第二,要做什么,操作逻辑是什么。"
>
> 调研人:dev-deepseek(task-b2602f7a,只读调研)。Master 已抽查 4 处要害断言,全部与当前 prd 工作树实测一致:
> ① `session:committed_done` 在最终文本落库之后才发出(sessions.ts:160→175);② mailbox 唤醒白名单 report/result/question/blocked(team-wake-coordinator.ts:11,19);③ 团队派发署名 team-assignment/team-directed(teams.ts:206);④ 消息落库 role='agent'(sessions.ts:167)。

---

# 一、调研点 1:`team.status` 工具精确契约

**核心要做什么**:leader 调用一次,拿到每个成员"现在干到哪、多久没吭声"的只读快照。**访问的内容**:格子会话运行态、派发队列深度、mailbox 汇报记录、名下团队任务及事件。

## 1.1 签名与鉴权

```
name: team.status
description: 一次查看团队成员运行态与汇报态(只读快照)。适用于用户询问进度、
  被唤醒后跟进、总结前核对。这是查询快照不是订阅:系统会在成员汇报时自动唤醒你,不要轮询本工具。
inputSchema: { teamId?: string }   // 缺省 = 上下文团队;两者皆空报 "teamId 不能为空"
权限: TEAM_PERMISSIONS(执行上限 10s)
```

- **leader 与普通成员都可见**(挂 `TEAM_READONLY_TOOLS`,不进 leader 初始隐藏表)。理由:成员本就允许读 mailbox/task 列表,运行态对成员也不新增敏感面。
- **前端零改动**(工具走平台工具协议)、**零迁移**(不加表不加列)。

## 1.2 返回结构

### 1.2.1 先看真实示例(leader 调用一次拿到的 JSON)

以本团队为例:dev-glm 正在跑(还排着 2 条没派发),dev-deepseek 已停,reviewer 两人空闲:

```json
{
  "teamId": "team-a617cb61",
  "teamName": "双人并行开发",
  "memberCount": 4,
  "runningMembers": 1,
  "allIdle": false,
  "generatedAt": "2026-09-16T13:40:12.345Z",
  "members": [
    {
      "memberId": "tm-c7031da0",
      "name": "dev-glm",
      "role": "member",
      "agentId": "agent-6fc857a4",
      "runtimeState": "running",
      "cells": [
        {
          "conversationId": "tc-1",
          "conversationTitle": "双人线",
          "sessionId": "sess-070eefb5",
          "state": "running",
          "stage": "正在思考..."
        }
      ],
      "hasPendingMemberPrompt": 2,
      "isMemberPromptInFlight": true,
      "lastReport": {
        "type": "report",
        "at": "2026-09-16T13:12:00.000Z",
        "sinceLastReportMs": 1680000,
        "taskId": "task-b2602f7a"
      },
      "taskTotal": 2,
      "taskRunning": 1,
      "taskNeedsInput": 0,
      "taskLastUpdateAt": "2026-09-16T13:05:00.000Z",
      "taskTitles": ["修复空指针"]
    },
    {
      "memberId": "tm-14b93587",
      "name": "dev-deepseek",
      "role": "member",
      "agentId": "agent-ceb9deb7",
      "runtimeState": "idle",
      "cells": [
        {
          "conversationId": "tc-1",
          "conversationTitle": "双人线",
          "sessionId": "sess-86e1595e",
          "state": "idle",
          "stage": null
        }
      ],
      "hasPendingMemberPrompt": 0,
      "isMemberPromptInFlight": false,
      "lastReport": {
        "type": "report",
        "at": "2026-09-16T13:17:46.933Z",
        "sinceLastReportMs": 1345000,
        "taskId": "task-b2602f7a"
      },
      "taskTotal": 1,
      "taskRunning": 0,
      "taskNeedsInput": 0,
      "taskLastUpdateAt": "2026-09-16T13:17:46.933Z",
      "taskTitles": []
    },
    {
      "memberId": "tm-34f00299",
      "name": "reviewer-glm",
      "role": "member",
      "agentId": "agent-0884919f",
      "runtimeState": "idle",
      "cells": [
        { "conversationId": "tc-1", "conversationTitle": "双人线", "sessionId": "sess-xxxx", "state": "idle", "stage": null }
      ],
      "hasPendingMemberPrompt": 0,
      "isMemberPromptInFlight": false,
      "lastReport": null,
      "taskTotal": 0,
      "taskRunning": 0,
      "taskNeedsInput": 0,
      "taskLastUpdateAt": null,
      "taskTitles": []
    }
  ]
}
```

一眼读法:`runtimeState` 看他在不在干活;`hasPendingMemberPrompt>0` 说明你派的话还压着没开始;`lastReport.sinceLastReportMs` 看他多久没吭声(1680000ms≈28 分钟);`lastReport=null` 表示他从没汇报过;`taskRunning`/`taskNeedsInput` 看名下任务卡在哪。

### 1.2.2 逐字段说明(名 / 类型 / 语义 / 数据源)

**顶层**:

| 字段 | 类型 | 语义 | 数据源 |
|---|---|---|---|
| teamId / teamName | string | 团队标识与名称 | teamStore.get |
| memberCount | number | 活跃成员数(含 leader) | teamMemberStore.list 过滤 status='active' |
| runningMembers | number | 运行中成员数 | 由 members[].runtimeState 聚合 |
| allIdle | boolean | 是否全体空闲(无 running / 无排队 / 无在飞) | 同上 |
| generatedAt | string(ISO) | 快照生成时刻 | new Date() |
| members | MemberStatus[] | 逐成员明细 | — |

**MemberStatus**(leader 排最前,其余按名升序):

| 字段 | 类型 | 语义 | 数据源 | 空闲示例 | 运行中示例 |
|---|---|---|---|---|---|
| memberId / name / role / agentId | string | 成员标识 | TeamMemberRow | — | — |
| runtimeState | `running`\|`idle` | 该成员**全部线格子+primary 会话的并集**(任一 running 即 running) | `resolveSessionRuntimeState`(session-runtime-state.ts:21-27) ← `listGridActivity`(team-conversations.ts:120-134)+ `sessionManager.isPromptActive` | "idle" | "running" |
| cells | Array | 各线格子逐一列出:conversationId / 标题 / sessionId / state / stage | listGridActivity + list() 取标题 | [{state:"idle",stage:null}] | [{state:"running",stage:"正在思考..."}] |
| hasPendingMemberPrompt | number | **排队深度**(FIFO 未派发条数)。多线同时积压时显示**最深处(max)而非合计**——深度按"primary + 全部格子"逐会话取 max,避免把同一成员多条线的积压相加成失真的总量 | **新增导出** `getMemberQueueDepth()`(team-member-dispatcher.ts:28 私有 Map) | 0 | 2 |
| isMemberPromptInFlight | boolean | prompt 已发出、回合未结束 | **新增导出** `isMemberPromptInFlight()`(:26) | false | true |
| lastReport | object\|null | 最后一条**唤醒级** mailbox(口径=白名单 report/result/question/blocked,或 message 且带 taskId) | **新增** `teamMailboxStore.latestFromMember()` | {type:"report", sinceLastReportMs:1680000} | {type:"report", sinceLastReportMs:420000} |
| taskTotal / taskRunning / taskNeedsInput | number | 名下任务 总数 / running 数 / needs_input 数 | taskStore.listByTeam 按 assignee_member_id 过滤计数 | 2/0/0 | 2/1/0 |
| taskLastUpdateAt | string\|null | 名下任务最后更新时间 | **新增** `taskEventStore.listLastEventByTaskIds()`(复用既有 ROW_NUMBER SQL 模式;tasks 表无 updated_at,事件表是唯一可靠源) | ISO 时刻 | 同左 |
| taskTitles | string[] | 未终态任务标题(leader 决策用) | 同上过滤 | ["修复空指针"] | 同左 |

## 1.3 实现路径(9 处改动,约 +152 行)

| # | 文件 | 改动 | 行数 |
|---|---|---|---|
| 1 | **新建** `src/tools/handlers/team/team-status-tool.ts` | getTeamStatusHandler(组装上表) | +110 |
| 2-3 | handlers 两个 index.ts | 导出 + register | +3 |
| 4 | team-seed.ts | TEAM_BUILTIN_TOOLS 加一条(teamTool() 工厂) | +12 |
| 5 | team-profiles.ts:25 | TEAM_READONLY_TOOLS 追加 | +1 |
| 6 | store/team-conversations.ts:120-134 | listGridActivity SELECT 补 member_id(该函数当前零消费者,加列零风险) | +2 |
| 7 | store/teams.ts teamMailboxStore | 新增 latestFromMember()(一条 SQL) | +10 |
| 8 | store/task-events.ts | 新增 listLastEventByTaskIds() | +18 |
| 9 | core/team-member-dispatcher.ts | 导出两个只读探针 | +8 |

---

# 二、调研点 2:静默回合兜底唤醒(含用户新增硬要求:带成员最后回复)

**核心要做什么**:成员回合结束但整轮没给 leader 发过任何汇报时,系统兜底唤醒 leader,**并把成员最后回复的原文带给 leader**——正常结束、出错、被中断三种都要带。**访问的内容**:回合来源署名、窗口内 mailbox/任务事件、格子会话最后一条 agent 消息、错误信息。

## 2.1 判定链(步骤级)

```
挂载点: session:committed_done(不能是 session:done —— 后者触发时最终文本还没落库,
        会读到 running 快照或空串;先例 project-secretary.ts:312 同款监听)

Step 0 身份过滤   member = getBySession(会话);leader 自己的回合不触发;
                  会话不属于任何团队线 / 团队非活跃 → 不触发
Step 1 来源锁     本回合最后一条 human 消息的 sender_role 必须 ∈ {team-assignment, team-directed}
                  (即团队派发/用户定向)——系统唤醒回合(sender_role=team-system/system 等)天然排除
Step 2 汇报判定   时间窗起点 = 该 human 消息时间戳(与回合开始同源,不能用回合结束时刻,
                  否则回合内的正常汇报会被误判为"没汇报")
                  以下任一命中 → 正常路径,不触发兜底:
                  a) 窗口内该成员发过唤醒级 mailbox(白名单口径同上)
                  b) 名下任务窗口内有状态更新事件(updated/manual_status_change/assigned_agent)
Step 3 降噪三闸   a) 名下有未完成任务才发(env 可关)
                  b) 同成员无新进展抑制:上次提醒后 60 分钟内无任何新 mailbox/任务事件 → 不发(防循环)
                  c) 频次帽:每成员每小时 6 条,超出丢弃记日志
Step 4 组装+入桶  取最后一条 agent 消息文本(截 600 字)→ 按档位拼模板 →
                  走 teamWakeCoordinator 新入口,复用 15s 合并桶 + 忙时保 pending 机制
```

**两处必须注意的坑**(调研实测发现):
1. 现有合并桶是**覆盖**语义(同一窗口两个成员只留最后一个)——静默通知必须改成**追加**,否则丢报。
2. 读取最后回复必须在 `committed_done` 之后,`session:done` 时点读会拿到空串。

## 2.2 唤醒 prompt 四档模板(全文要点)

**档 ① 正常结束未汇报**(end_turn/max_tokens/refusal):
> 系统通知:Team 成员回合结束,但本回合没有给你发过汇报。
> Team / Member / 所在会话线 / 名下任务 / 距派发时长
> **成员最后回复(截断至 600 字)**:`<原文>`(纯工具回合无文本时回退:"本回合无文本输出;最后动作:`<最后一个 process item 标题>`")
> 请判断是"已完成"还是"仍在进行":可先用 team.status 核实运行态;若其实已完成,让他自己补一条汇报(不要代写)。

**档 ② 出错终止**(stopReason=error,ACP 失败/进程退出两条 emit 路径都覆盖):
> 系统通知:成员回合以错误终止(error),且本回合没有给你发过汇报。
> 错误信息:`<ev.error 原文>` + 成员最后回复(可能不完整,同①截断)
> 建议:先 team.status 核实是否恢复空闲,再决定重派或人工处理。

**档 ③ 被中断**(cancelled):
> 系统通知:成员的回合被中断,且中断前没有给你发过汇报。
> 中断事实 + 成员停止时说到哪(`<累计文本>`,取消时 content 为回合内累计快照——实测确认)
> 请先确认中断是否符合预期;任务仍需推进则重新派发并带上本节上下文。

**档 ④ 崩溃**(无任何回合结束事件):**本档明确不管**——进程退出时若有活跃回合,平台会补发 error 结束事件(归档②);网关整体崩溃则无事件,结构性漏报,**交 P2 周期扫描兜底**。实施时不得把此路径当 bug 修。

**文本来源细节**:本仓消息 role 是 `'agent'`(非 assistant),content 本身就只有纯文本(工具调用单独存表),天然不混入工具块;截断策略 = 折叠连续空行 → 600 字 + "…"。

## 2.3 防 ping-pong(三道锁)

1. **来源锁**:只有团队派发/定向回合参与判定,所有系统注入回合(唤醒/watch/needReply/排班等 8 种署名)天然排除。
2. **无新进展不重发**:上次提醒后 60 分钟无新事件不再提醒(防"唤醒→重派→又静默→再唤醒"循环)。
3. **频次帽**:每成员每小时 6 条。

## 2.4 降噪参数(默认值 + 依据,全部 env 可调)

| 参数 | 默认 | 依据 |
|---|---|---|
| 合并/延迟窗口 | 15s | 与现有任务唤醒延迟同量级,给回合尾部落库留窗;多成员同结束合成一封 |
| 每成员每小时上限 | 6 | 典型任务 2~4 回合 × 1.5 余量;0=关闭 |
| 无新进展抑制窗 | 60min | 覆盖一个长任务回合 |
| 回复截断 | 600 字 | 一屏结论,整封唤醒约 1.5k token |
| 有任务才提醒 | 开 | 无任务成员的静默收尾价值低、噪音高 |

## 2.5 改动面(点 2 部分,5 处约 +244 行)与测试

改动:team-wake-coordinator.ts(+130,监听/判定/入桶)、team-prompts.ts(+70,四档模板)、store/sessions.ts(+18,最后 human/agent 消息查询)、store/teams.ts(+10,窗口内 mailbox 查询)、store/task-events.ts(+16)。

**测试用例 21 条**(新建两个单测文件),关键守卫:
- 回合内发过 report → 不触发;只更新任务状态 → 不触发且既有任务唤醒照常
- 系统署名回合 / leader 回合 / 无线会话 → 不触发
- error 带 ev.error、cancelled 带累计文本、纯工具回合走回退文案
- 同成员两次静默只发 1 次(抑制);第 7 次丢弃(频次帽);两成员 15s 内合并成 1 封
- **回归守卫**:用 committed_done 时读到的必须是最终文本而非空串(防误用 session:done 的坑)

---

# 三、汇总与待确认

| 项 | 内容 | 规模 |
|---|---|---|
| P0a | team.status 工具(字段级契约如上)+ 实现路径 9 处 | ≈1.5 人日 |
| P0b | 静默回合兜底唤醒(判定链+四档模板+三道锁+21 条测试) | ≈2~2.5 人日 |
| P1(备选,v1 已定义未细化) | 欠汇报代提醒推给成员 + leader 提示词引导 | ≈1 人日 |
| P2(观察位) | 崩溃路径唯一兜底,等 P0b 噪音数据再定 | 3~4 人日 |

**建议本期 P0a + P0b**(≈3.5~4 人日);P1 可加;P2 保留观察位。

## 请拍板
1. 本期范围:P0a+P0b,还是 P0a+P0b+P1?
2. 确认后流程照旧:实施 → reviewer-glm 一审 → reviewer-deepseek 二审 → Master 合并。
