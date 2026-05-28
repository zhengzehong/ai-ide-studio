# 项目智能体工作流

## 核心设计

平台长期采用两层 Agent 模型：

```text
Agent 模板（全局） -> 添加到项目 -> 项目智能体实例 -> Session 会话 -> 对话
```

- **Agent 模板**：全局资产，放在 Agent 广场里管理。模板描述一个角色的默认名称、类型、运行时、图标、系统提示词和技能标签。
- **项目智能体**：模板添加到具体项目后生成的运行时实例，写入 `agents.project_id`，工作台只显示当前项目的智能体。
- **Session**：项目智能体下的一段对话。创建 Session 时会使用项目 `work_dir` 作为 ACP 工作目录，并按 `agentId + projectId + sessionId` 解析工具可见性。

这样可以保证文件访问、任务归属、MCP 工具方法可见性和会话历史都被项目边界隔离。

## 用户操作路径

1. 左上角创建或选择项目。
2. 进入 **Agent 广场**。
3. 在模板卡片上点击 **添加到项目**。
4. 在弹窗中确认目标项目、智能体名称、运行时和系统提示词快照。
5. 点击 **添加并打开工作台**。
6. 在工作台左侧展开项目智能体，点击 **新建会话**。
7. 在输入框发消息；模型、模式、命令、图片上传和工具调用展示由 ACP capabilities 决定。

## 模板快照规则

添加到项目时，系统会复制模板字段到 `agents`：

- `name`
- `type`
- `runtime`
- `icon`
- `system_prompt`
- `config_json.templateId`
- `config_json.skills`

模板之后被编辑，不会自动修改已经添加到项目的智能体。后续如需同步模板，应作为显式功能实现，避免误改项目运行时配置。

## 后端 RPC

| 方法 | 作用 |
|---|---|
| `agents.list { projectId }` | 列出当前项目智能体 |
| `agents.deployTemplate { projectId, templateId, name?, runtime?, systemPrompt?, icon? }` | 从全局模板添加项目智能体 |
| `agents.createCustom { projectId, name, agentType, runtime, systemPrompt?, icon? }` | 创建项目自定义智能体 |
| `agents.update { agentId, name?, agentType?, runtime?, systemPrompt?, icon? }` | 更新项目智能体 |
| `agents.delete { agentId }` | 删除项目智能体 |

`agents.create` 保留为旧兼容接口，不作为前端主流程使用。

## 前端入口

- **Agent 广场**：管理全局模板，并提供“添加到项目”。
- **工作台**：如果当前项目没有智能体，显示空状态和“添加智能体”入口。
- **概览页**：快捷操作“添加智能体”跳转到 Agent 广场，不再创建全局 Agent。

## 工具与技能绑定

模板可以表达推荐能力，但运行时最终生效的工具/技能应绑定到项目或项目智能体：

```text
global binding + project binding + agent binding -> Session 工具可见性
```

HTTP MCP token 仍由后端根据 `agentId/projectId/sessionId` 生成，只返回该上下文可见的方法。
