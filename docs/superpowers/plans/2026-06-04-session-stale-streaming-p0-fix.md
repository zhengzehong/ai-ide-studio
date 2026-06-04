# P0 修复：切换会话后后台完成仍卡在流式状态

## 目标

修复长会话/后台会话完成后，数据库已有最终消息但前端切回仍显示旧 streaming 状态的问题。

## 范围

- 仅处理 P0：runtime/stale 标记、activity idle、selectSession、fetchMessages、fetchEvents、单测。
- 不重写对话时间线、不调整执行过程 UI、不改变工具详情懒加载策略。

## 步骤

1. 增加会话 runtime/stale 状态
   - 为每个会话记录 running / unread / needsRefresh。
   - 后台完成时清理该会话缓存中的 streamingMessage。
   - 验收：后台 idle 后不会保留旧流式缓存。

2. 修复 activity idle 与切换恢复
   - activity running/idle 更新 runtime 状态。
   - selectSession 对 stale/idle 会话不恢复 streamingMessage。
   - 验收：切回已完成后台会话不会显示旧“正在执行”。

3. 修复消息/事件加载后的 streaming 清理
   - fetchMessages 拉到最终 agent 消息后清 streaming。
   - fetchEvents 在 idle/已有最终消息时不保留旧 streaming。
   - 验收：最终 messages 优先于旧 streaming 缓存。

4. 补单测
   - 后台 idle 清理 stale streaming。
   - 切回 stale 会话加载最终消息并保持 streaming 为空。
   - idle fetchEvents 不保留旧 streaming。

5. 验证
   - 运行相关 unit test。
   - 尽量运行 npm test / npm run build / npm run lint / git diff --check。
