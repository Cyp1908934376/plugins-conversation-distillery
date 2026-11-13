# 对话蒸馏库 / Conversation distillery

把本机每一次会话收集起来，自动蒸馏成「目标 → 结果 → 工具路径 → 失败信号 → 可复用经验」，再用这些经验优化下一次的提示词与上下文。

## 它做什么

1. **自动收集**：启动时扫描会话语料（默认最近 200 个），之后每个回合结束自动重算该会话的摘要；已存在的摘要通过事件指纹跳过，不重复读取。
2. **规则蒸馏**（确定性、零 token）：从会话日志中提取用户消息、助手结论、工具调用链、工具报错、单次工具输出大小、注入上下文条数、上下文压缩次数、回合中止情况，计算 0–100 的质量分并生成具体建议。
3. **自动模型蒸馏**：回合结束后等待 25 秒（可配置），自动把该会话交给模型做结构化蒸馏，输出目标、结果、关键决策、失误、提示词改进、上下文改进、可复用模式。每天有 token 上限，避免失控消耗。
4. **跨会话经验**：把重复出现的教训按类型聚合（提示词过长、需求过短、工具失败、输出过大、注入过多等），形成全局建议。
5. **提示词优化**：`optimize_prompt` 用历史高频问题给草稿提示词补全目标、约束、验收标准、输出格式与定位信息。

## 使用方式

### 左侧栏页面

左侧栏会出现「对话蒸馏库」图标（烧瓶形），点进去是完整库页面：

- 顶部：会话数、平均质量分、今日 tokens、待蒸馏数
- 左列：会话列表（可搜索标题 / 目标 / 会话 id）
- 右列：目标、结果、经验、提示词与上下文建议、模型蒸馏结果（含本次消耗的 tokens）
- 右上角：重新扫描、导出报告；详情右上角：重新蒸馏当前会话

输入框下方只保留一行极简状态：`对话蒸馏库 · 120 · 12.4k tokens · 自动蒸馏`，点击可直接打开左侧页面。

### 代理工具

工具名：`conversation_library`

| action | 作用 |
|---|---|
| `list` | 列出会话摘要与质量分（库为空时自动先扫描） |
| `digest` | 蒸馏单个会话；`deep: true` 调用模型深度蒸馏；省略 `sessionId` 用当前会话 |
| `refresh` | 重新扫描语料 |
| `advice` | 汇总跨会话经验，附今日 token 用量 |
| `optimize_prompt` | 传入 `prompt`，返回补全后的提示词；`deep: true` 让模型改写 |
| `export` | 生成 Markdown 报告并写出到存储目录 |

### HTTP 接口（已认证，仅供本页使用）

- `GET /api/conversation-distillery/summary`（轻量：数量、质量分、token 用量）
- `GET /api/conversation-distillery/library`
- `GET /api/conversation-distillery/digest?sessionId=…`
- `GET /api/conversation-distillery/refresh?sessionId=…`
- `GET /api/conversation-distillery/scan?limit=…`
- `GET /api/conversation-distillery/distill?sessionId=…&force=1`
- `GET /api/conversation-distillery/advice`
- `GET /api/conversation-distillery/export`

## 数据位置

默认写在 DSH 配置目录，**不上传、不写会话日志**：

```
~/.dsh/conversation-distillery/library.json   # 摘要缓存 + 今日 token 账本
~/.dsh/conversation-distillery/report.md      # 最近一次导出的报告
```

可以用 `storeDir` 配置项改到别的目录。摘要缓存随时可以删除，删掉后下一次扫描会重建。

## 配置

`cordis.patch.yml` 中本插件的 `config`：

| 字段 | 默认值 | 说明 |
|---|---|---|
| `autoCollect` | `true` | 是否在回合结束时自动蒸馏 |
| `initialScanLimit` | `200` | 启动时扫描的最近会话数 |
| `debounceMs` | `4000` | 回合结束后的合并等待时间（规则蒸馏） |
| `autoDeep` | `true` | 是否自动调用模型做深度蒸馏 |
| `autoDeepDelayMs` | `25000` | 回合结束后等待多久再自动蒸馏，用于合并连续回合 |
| `deepMaxTokens` | `1600` | 单次模型蒸馏的输出上限 |
| `deepDailyTokenBudget` | `400000` | 每日自动蒸馏 token 上限，`0` 表示不限制 |
| `storeDir` | `''` | 自定义缓存目录 |
| `deepProvider` / `deepModel` | `''` | 深度蒸馏使用的模型；留空时用当前会话模型或默认模型 |
| `maxEntries` | `400` | 页面最多返回的会话数 |

## 已知边界

- 规则蒸馏只看会话日志，不判断代码是否正确；质量分是启发式指标，不是评分权威。
- 自动蒸馏是"每轮结束 + 25 秒静默"触发，长会话会持续消耗 token；用 `deepDailyTokenBudget` 控制上限，超出后当天只做规则蒸馏。
- 深度蒸馏受模型与 token 预算影响；推理模型若只输出推理内容，会明确报错，建议换非推理模型或调大预算。
- 会话语料本身由 DSH 的 session-query 服务提供；插件从不修改会话日志。
