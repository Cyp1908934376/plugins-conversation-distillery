# 对话蒸馏库 / Conversation distillery

把本机每一次会话收集起来，蒸馏成「目标 → 结果 → 工具路径 → 失败信号 → 可复用经验」，再用这些经验优化下一次的提示词与上下文。

## 它做什么

1. **自动收集**：插件启动时扫描会话语料（默认最近 200 个），之后每个回合结束自动重算该会话的摘要；已存在的摘要通过事件指纹跳过，不重复读取。
2. **规则蒸馏**（确定性、零 token）：从会话日志中提取用户消息、助手结论、工具调用链、工具报错、单次工具输出大小、注入上下文条数、上下文压缩次数、回合中止情况，计算 0–100 的质量分并生成具体建议。
3. **模型蒸馏**（按需）：`deep: true` 时把压缩后的对话交给当前会话的模型，输出结构化 JSON：目标、结果、关键决策、失误、提示词改进、上下文改进、可复用模式。
4. **跨会话经验**：把重复出现的教训按类型聚合（提示词过长、需求过短、工具失败、输出过大、注入过多等），形成全局建议。
5. **提示词优化**：`optimize_prompt` 用历史高频问题给草稿提示词补全目标、约束、验收标准、输出格式与定位信息。

## 使用方式

### 代理工具

工具名：`conversation_library`

| action | 作用 |
|---|---|
| `list` | 列出会话摘要与质量分（库为空时自动先扫描） |
| `digest` | 蒸馏单个会话；`deep: true` 调用模型深度蒸馏；省略 `sessionId` 用当前会话 |
| `refresh` | 重新扫描语料 |
| `advice` | 汇总跨会话经验 |
| `optimize_prompt` | 传入 `prompt`，返回补全后的提示词；`deep: true` 让模型改写 |
| `export` | 生成 Markdown 报告并写出到存储目录 |

### Web 界面

输入框下方会多出一行「对话蒸馏库 · N 个会话」：

- 展开后左侧是会话列表（质量分、回合数、日期），右侧是目标、结果、经验与提示词/上下文建议。
- **重新扫描**：重新扫描最近 60 个会话。
- **蒸馏当前对话**：立即重算当前会话的规则蒸馏。
- **深度蒸馏**：调用模型对当前会话做结构化蒸馏（会产生 token 消耗）。
- **导出报告**：在新标签页打开完整 Markdown 报告。

### HTTP 接口（已认证，仅供本页使用）

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
~/.dsh/conversation-distillery/library.json   # 摘要缓存
~/.dsh/conversation-distillery/report.md      # 最近一次导出的报告
```

可以用 `storeDir` 配置项改到别的目录。摘要缓存随时可以删除，删掉后下一次扫描会重建。

## 配置

`cordis.patch.yml` 中本插件的 `config`：

| 字段 | 默认值 | 说明 |
|---|---|---|
| `autoCollect` | `true` | 是否在回合结束时自动蒸馏 |
| `initialScanLimit` | `200` | 启动时扫描的最近会话数 |
| `debounceMs` | `4000` | 回合结束后的合并等待时间 |
| `startupDelayMs` | `6000` | 启动后延迟扫描，避免和启动争抢 IO |
| `storeDir` | `''` | 自定义缓存目录 |
| `deepProvider` / `deepModel` | `''` | 深度蒸馏使用的模型；留空时用当前会话模型或默认模型 |
| `maxEntries` | `400` | 面板最多返回的会话数 |

## 已知边界

- 规则蒸馏只看会话日志，不判断代码是否正确；质量分是启发式指标，不是评分权威。
- 深度蒸馏受模型与 token 预算影响；推理模型若只输出推理内容，会明确报错，建议换非推理模型或调大预算。
- 会话语料本身由 DSH 的 session-query 服务提供；插件从不修改会话日志。
