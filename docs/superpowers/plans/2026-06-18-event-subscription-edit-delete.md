# 2026-06-18 事件订阅规则编辑删除

## 目标

补齐事件中心订阅规则的编辑和删除能力。订阅规则删除后不再匹配新事件，历史消费记录保留；订阅规则编辑只影响后续事件匹配，不回滚已有消费记录。

## 实施步骤

1. 补服务层测试
   - 验证订阅规则可更新名称、过滤条件、消费 Agent、会话策略和启用状态。
   - 验证更新后新事件按新过滤条件匹配。
   - 验证删除订阅后不再生成新的消费记录，已有消费记录仍保留。

2. 后端能力
   - `src/store/event-subscriptions.ts` 增加 `update` 和 `remove`。
   - `src/core/event-center.ts` 增加 `updateSubscription` 和 `deleteSubscription`，复用创建订阅的校验和 filter normalization。
   - `src/gateway/rpc/event-center.ts` 增加 `eventSubscriptions.update` 和 `eventSubscriptions.delete`。
   - `src/types/ws-protocol.ts` 补充对应消息类型。

3. 前端能力
   - `ui/src/stores/event-center.store.ts` 增加 `updateSubscription` 和 `deleteSubscription`。
   - `SubscriptionCreateModal` 支持编辑模式并反填现有 filter。
   - `SubscriptionPanel` 详情区增加编辑、启停、删除操作。

4. 验证
   - 运行事件中心相关单测。
   - 运行 `npm test`、`npm run lint`、`npm run build`。
   - 检查 diff，确认未触碰无关文件。

## 验收标准

- 用户可以编辑订阅规则，并看到列表和详情刷新。
- 用户可以删除订阅规则，删除后规则不再显示，不再匹配新事件。
- 历史事件详情中的已有消费记录不被删除。
- 新增和既有事件中心测试通过。
