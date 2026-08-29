# 移动端「灵感」功能实现方案(v1)

> 对应交互原型:`docs/design/mobile-inspiration-prototype.html` v4.1(commit d4a7956)
> 状态:方案待确认,**未执行**

## 一、结论

- **后端(gateway/core/DB):零改动**。12 个灵感 RPC 已挂在 ws 网关注册表上,移动端 wsClient 与 PC UI 走同一条 ws 通道、同一种 owner 鉴权(任务 RPC 已在移动端正常调用,鉴权语义相同),直接复用。
- **变更范围:仅 `mobile/`**,新增 4 个文件 + 修改 2 个文件,约 900~1100 行。
- 已核实的关键事实:
  - RPC:`inspiration.get / configure / session.rebuild / note.create / note.update / note.get / note.organize / note.setCompleted / note.delete / candidate.update / candidate.createTask`(src/gateway/rpc/inspiration.ts,registry.ts:27 已注册)
  - 事件:`inspiration:update {projectId, noteId?}` 以 `scope:'all'` 广播(src/gateway/realtime-event-source.ts:86),移动端 wsClient 可收到
  - 数据:`inspiration.get` 一次返回 `{config, notes[]}` 全量(含 summary/result/candidates),列表与详情共用,无需单独详情接口
  - 限流:sourceMarkdown ≤ 50,000 字符、图片 ≤ 10 张(v1 移动端只做文字,不用图片)

## 二、移动端改动清单

### 新增

| 文件 | 内容 |
|---|---|
| `mobile/src/stores/inspiration.store.ts` | zustand store:`byProject: Record<projectId, {notes, config}>`、`loadSequence` 竞态守卫(照抄 PC store 模式);actions:`load(projectId)`、`saveNote(sourceMarkdown)`、`remove(noteId)`、`setCompleted(noteId, completed)`、`organize(noteId)`、`setupListeners()`(inspiration:update 且 projectId 匹配 → 静默 reload;reconnected → reload) |
| `mobile/src/pages/InspirationPage.tsx` | 列表页 = 原型 v4.1:任务页式头部(💡 灵感)→ 筛选 chips(全部/进行中/已完成 + 计数)→ 卡片流(标题 2 行截断 / 摘要 1 行 / AI 摘要块 / 状态点 + 时间,完成态划线置灰)→ **底部停靠工具条**(全宽白底贴 tab 栏:安静项目 chip + 紫色圆形 +)→ 项目 bottom sheet(icon+名称+n 条+✓)→ 下拉刷新 + 列表左右滑切项目。状态色:draft 灰 / queued+processing 紫(呼吸) / ready 绿 / needs_input 橙 / failed 红,全部用 index.css token |
| `mobile/src/pages/InspirationRecordPage.tsx` | `/inspiration/new`:全屏 textarea 自动聚焦、字数计数(50k 上限)、说明文案"只管写,标题自动取正文前 60 字";保存 = `inspiration.note.create({projectId, titleMode:'auto', sourceMarkdown})` → 返回列表 + toast"已保存,AI 正在后台整理" |
| `mobile/src/pages/InspirationDetailPage.tsx` | `/inspiration/:noteId`:按状态机渲染 — processing/queued:旋转提示"AI 正在整理"+原文;failed:红块错误信息 + 原文不丢失;draft:引导"整理一下";ready/needs_input:AI 摘要引用块(紫色左边框)+ 整理结果(react-markdown + rehype-sanitize,mobile 已有依赖)+ 待确认问题列表(橙框)+ 候选任务卡片(v1 **只读展示**,不提供创建按钮);底部操作栏:删除(ConfirmDialog,复用现有组件)+ 主操作(标记完成/重新打开、重新整理、整理一下) |

### 修改

| 文件 | 内容 |
|---|---|
| `mobile/src/components/MobileShell.tsx` | tabs 数组加「灵感」(Lightbulb 图标,会话与任务之间),5 tab 布局 |
| `mobile/src/App.tsx` | 注册 3 条路由 `/inspiration`、`/inspiration/new`、`/inspiration/:noteId`(MobileShell 下);bootstrapMobileData 增加 inspiration store 预载 |

### 复用(不新建)

- 项目切换:**直接用全局 `app.store.setCurrentProject`**(与会话页同一数据源,切一次全 App 联动,原型行为一致)
- `ActionSheet` 模式(任务页长按同款)→ 项目 bottom sheet;`ConfirmDialog` → 删除确认;`showToast`
- 设计 token:`mobile/src/index.css` CSS 变量,零新增颜色

## 三、明确不做(v1 边界)

- 图片/语音附件记录(RPC 已支持 images,UI 后续版本再加)
- 候选任务「创建任务」按钮(需要 agent/session 选择 UI,v2;移动端先只读展示,创建去 PC 端)
- 灵感配置界面(未配置 organizerAgentId 时显示引导卡片"到 PC 端配置灵感助手",不做移动端配置表单)
- 会话内继续追问(详情页放"到 PC 端灵感会话继续讨论"提示)

## 四、边界与降级

- `inspiration:update` 属于其他项目 → 不刷新当前列表(避免串项目闪烁);属于当前项目 → 静默 reload,不转圈
- 竞态:loadSequence 递增守卫,慢响应不覆盖新数据(PC store 已踩过的坑直接照抄)
- guest 模式调用 RPC 会被 requireOwner 拒绝 → catch 后 toast 错误,页面留空态
- 列表空态区分"项目还没配灵感助手"(引导去 PC 配置)和"配置了但没记录"(引导点 +)
- 下拉刷新与左右滑手势互斥判定(横向位移 > 纵向 1.8 倍才触发切项目),避免和纵向滚动/点击冲突

## 五、验证方式

mobile 无测试基建(mobile/package.json 无 test script),v1 验证口径:

1. `mobile: npm run build`(tsc -b + vite build)EXIT=0,web 与 android 目标
2. 根目录 eslint(`npm run lint`)不新增告警
3. 真机冒烟(vite preview / debug APK):记一条 → 状态流转(待整理→整理中→方案已生成,ws 推送驱动)→ 下拉刷新 → 左右滑切项目 → 删除 → 标记完成 → 失败态展示(挑一条 failed 数据)
4. 回归:tab 从 4 改 5,检查其余 4 页无布局挤压

> 如需 vitest 单测(store 纯逻辑部分),要给 mobile 加测试依赖,建议作为独立小任务另行确认,v1 不夹带。

## 六、交付流程(按既定门禁)

1. 本 worktree(feat/mobile-restyle)实现 → 自验(tsc/build 真实退出码)→ 自审 diff → commit
2. `formal.code.merge` 事件送 code-reviewer 审查(approved 才放行)
3. 合并 prd 分支
4. APK:当前 prd 已领先已发布 APK 两个合并(424b279、01721d3),加上本功能建议一起打包;版本号 0.2.0 → 0.3.0 是否随本次 bump,打包前确认

## 七、工作量

纯前端 4 新增 + 2 修改,估 0.5~1 天(含自验与审查往返)。
