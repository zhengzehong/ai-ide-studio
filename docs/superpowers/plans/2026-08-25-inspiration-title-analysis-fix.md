# 灵感自动标题与整理提交修复计划

## 目标

- 未设置人工标题时，使用正文原文生成最多 60 个字符的自动标题，不概括、不提前按句子截断。
- AI 整理工具同一轮可以修正暂存结果，只在 prompt 正常结束后提交最终版本。
- 旧 revision、旧 attempt 和占位探测不得污染正式结果。

## 实施清单

- [x] 增加自动标题纯函数和前后端回归测试。
- [x] 增加 migration 053：`title_mode`、`analysis_attempt_id`，回填旧日期标题。
- [x] PC 编辑器支持 auto/manual 标题模式，后端作为标题规则的最终权威。
- [x] publish 工具增加 attemptId、严格字段说明和最低有效内容校验。
- [x] store 支持 stage/overwrite/finalize/requeue，runner 在 prompt 结束后提交。
- [x] 固定系统发布协议与用户整理偏好分离。
- [x] 更新数据模型、架构总览和 README。
- [x] 运行定向测试、全量测试、lint、类型检查、build 和 diff-check。
- [ ] 代码审查后提交并合并 `prd`，不重启在线服务。

## 验收标准

- 示例正文完整成为标题；超过 60 字只在末尾截断并加省略号。
- 人工标题不会随正文变化；清空标题恢复自动模式。
- 同一 attempt 的最后一份有效 publish 成为最终结果，placeholder 不会提交。
- prompt 无 publish、失败、重启、旧 revision 和旧 attempt 均有确定状态。
- PRD 合并只包含本任务文件，不包含主工作区现有未提交修改。
