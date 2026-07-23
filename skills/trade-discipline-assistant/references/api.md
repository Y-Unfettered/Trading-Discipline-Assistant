# 本地接口与代理接入

## 目录

1. 连接与通用规则
2. 只读状态
3. 证券目录
4. 账户与持仓
5. 计划与确认
6. 盘中成交
7. 盘后复盘
8. 跨代理 AI 导入
9. 资讯采集与公司关系
10. 纪律、影响因子与概率研报规则
11. CLI 客户端

## 1. 连接与通用规则

基础地址默认 `http://127.0.0.1:3768`，只监听本机。请求和响应使用 UTF-8 JSON。

- 先 GET，再决定是否写入。
- 对批量、AI 和高影响写入先调用 preview。
- 写入成功后重新 GET 核验。
- HTTP 非 2xx 时读取 `error` 并停止，不重试非幂等写入。

## 2. 只读状态

- `GET /api/dashboard`：账户摘要、数据健康、纪律摘要、日流程、选定计划和下个交易日。
- `GET /api/store`：完整本地状态；包含私人账户数据，只在确有需要时读取。
- `GET /api/plans?date=YYYY-MM-DD`：计划、当前选定版本和历史版本。
- `GET /api/planned-assets`：计划交易标的。
- `GET /api/evidence?assetCode=001399`：某证券证据卡。
- `GET /api/analyses`：纪律分析历史。

## 3. 证券目录

- `GET /api/stocks/search?q=惠科股份`：按名称或代码查询。本地未命中时会尝试实时发现并补库。
- `GET /api/stocks/status`：返回 `count`、`updatedAt` 和 `stale`。
- `POST /api/stocks/refresh`：强制刷新全市场目录。需要用户授权；远端失败时不应删除现有可用目录。

证券市场值为 `SH`、`SZ` 或 `BJ`。证券名称必须以查询返回的代码—名称映射为准。

## 4. 账户与持仓

- `PUT /api/account`：保存券商账户快照。示例：

```json
{"availableCash": 10000, "brokerTotalAssets": 25000, "todayPnl": -120, "holdingPnl": [{"code": "001399", "value": -80}]}
```

- `PUT /api/holdings`：整体持仓校正。只在用户已核对券商持仓并明确授权时调用；传入 `holdings` 数组和 `note`。
- `POST /api/trades/import/preview`：预览券商 CSV。
- `POST /api/trades/import`：确认无阻塞错误后原子导入；默认保持 `atomic: true`。

## 5. 计划与确认

- `PUT /api/plans`：保存新草稿或新版本。至少包含 `planForDate`、`planFormat: "v0.3"`、`changeReason` 和 `rules`。
- `POST /api/plans/{id}/confirm`：用户明确确认后调用，body 为 `{"reason":"已核对风险和三种情景"}`。
- `POST /api/plans/{id}/invalidate`：用户确认失效原因后调用。

每个规则优先包含：`code`、`name`、`direction`、`triggerCondition`、`allowedActions`、`maxPositionPct`、`maxRiskPct`、`stopPrice`、`reduceCondition`、`exitCondition`、`forbidden`、`invalidationCondition`、`defaultAction`、`flexibleRange`、`baseScenario`、`bullScenario`、`bearScenario`。

不得让 AI 自动确认计划。修改已生效计划会形成新版本并回到待确认。

## 6. 盘中成交

`POST /api/trades` 只记录已经发生的真实成交，不代表下单：

```json
{
  "date": "2026-07-21",
  "time": "10:02:00",
  "code": "001399",
  "name": "惠科股份",
  "side": "BUY",
  "quantity": 100,
  "price": 27.5,
  "fee": null,
  "reason": "券商成交回报",
  "ruleTrigger": "计划中的可观察触发条件",
  "executionStatus": "followed",
  "planFollowed": true
}
```

应用会绑定当天生效计划，并返回 `disciplineEvents`。费用未知时使用 `null`，盘后通过 `PUT /api/trades/{id}/fee` 补录。

## 7. 盘后复盘

- `POST /api/market-close/refresh`：body `{"date":"YYYY-MM-DD"}`。
- `PUT /api/daily-session`：合并阶段记录。盘后示例：

```json
{"date":"2026-07-21","session":{"postmarket":{"factsCorrection":"...","executionEvidence":"...","deviationContext":"...","correctionRule":"...","completedAt":"ISO 8601"}}}
```

- `POST /api/research/technicals`：刷新市场和持仓技术数据。
- `PUT /api/research/external-factors`：写入带来源外部因素。
- `POST /api/plans/generate-from-review`：资料齐全后生成下一交易日草稿。
- `POST /api/review/export`：生成代理中立复盘包并返回外部报告导入结构。

## 8. 跨代理 AI 导入

### 研究包

读取 `GET /api/research-import/prompts?target=证券名或代码`。生成 `trade-research/v1` 后：

1. `POST /api/research-import/preview`，body `{"packet": {...}}`；
2. 用户确认；
3. `POST /api/research-import/commit`，body `{"packet": {...}, "confirmed": true}`。

### 计划包

先保存用户计划骨架，再读取 `/api/plan-ai-import/context?planId=...`。生成 `trade-plan-ai/v1` 后：

1. `POST /api/plan-ai-import/preview`；
2. 核对 `changedCount` 大于 0；
3. 用户确认；
4. `POST /api/plan-ai-import/commit`，设置 `confirmed: true`。

计划包只能写 AI 辅助字段，不能覆盖用户风险和动作字段。

### 纪律复盘包

先调用 `POST /api/review/export`。根据返回的 `packet` 生成：

```json
{
  "schemaVersion": "trade-review-ai/v1",
  "snapshotId": "必须等于最新复盘包 snapshotId",
  "generatedAt": "ISO 8601",
  "provider": "代理或模型名称",
  "content": "中文 Markdown 纪律复盘"
}
```

先 `POST /api/analysis/import/preview`；用户确认后再 `POST /api/analysis/import`，body 为 `{"packet": {...}, "confirmed": true}`。导入会生成新的历史报告，不覆盖旧报告。

## 9. 资讯采集与公司关系

- `GET /api/information-sources`：读取来源配置、费用策略和最近采集运行。
- `POST /api/information-sources/preview`：校验来源配置，不写入。
- `POST /api/information-sources`：确认后新增 `rss_atom`、`json_feed`、`sec_edgar_submissions` 或 `federal_register` 免费官方来源；随机窗口默认为 50–75 分钟。
- `PUT /api/information-sources/{id}`：确认后启用、停用或更新来源。
- `POST /api/information-collection/run`：确认后立即运行全部已启用来源，或传入 `sourceId` 运行指定来源。
- `POST /api/information-events/preview`：校验原文事实字段并检查重复。
- `POST /api/information-events`：确认后保存事件；重复内容返回已有事件，不重复写入。
- `PUT /api/information-events/{id}/status`：更新为 `new`、`assessing`、`reviewed` 或 `archived`。
- `GET /api/company-relations?assetCode=001399`：读取公司九段传导关系。
- `POST /api/company-relations/preview`：校验公司关系和事实引用，不写入。
- `POST /api/company-relations`：确认后追加关系结论。`supported` 和 `contradicted` 必须引用事实卡；不覆盖旧结论。

自动采集仅使用已核验的免费官方适配器。X 属于付费来源，旧配置会自动停用且后端拒绝执行；没有稳定合法接口的网页来源不得通过模拟登录或绕过访问限制接入主程序。

## 10. 纪律、影响因子与概率研报规则

- `GET /api/rulebooks`：读取当前规则版本、评分维度、事件权重和公司传导节点。
- `POST /api/discipline-assessments/preview`：传入 `{"input": {...}}`，只计算纪律分、硬规则上限和记录缺口。
- `POST /api/discipline-assessments`：用户确认后传入 `{"input": {...}, "confirmed": true}`，保存不可覆盖评估。
- `POST /api/influence-assessments/preview`：计算来源、事件强度、公司传导链和信息优先级。
- `POST /api/influence-assessments`：确认后保存影响评估；影响分不是涨跌概率。
- `GET /api/information-processing/instructions`：读取当前AI资讯整理、持仓影响初评协议和输出结构。
- `POST /api/information-events/{eventId}/holding-impact-confirmations`：用户对需要人工核实的AI持仓影响点击确认合理或标记不准确；AI代理不得代替用户调用。
- `POST /api/probability-reports/preview`：生成冷启动证据权重或经过校准的概率报告。
- `POST /api/probability-reports`：确认后冻结报告和结果口径。
- `POST /api/probability-reports/{id}/resolve`：到期后确认实际情景并计算 Brier 分；同一报告不能重复结算。

关键记录不足时不得把 `observedScore` 冒充正式 `score`。公司传导链缺关键节点时不得把事件强度冒充公司影响。`calibrationStatus=cold_start` 时不得把 `evidenceWeights` 描述为概率。

保存概率研报时，每个信号必须包含 `evidenceRefs`。只有 `resolvedSampleSize >= 30`、模型 Brier 分低于基线且存在模型编号时，接口才发布 `probabilities`。

## 11. CLI 客户端

在 Skill 目录运行：

```bash
python scripts/trade_assistant_client.py status
python scripts/trade_assistant_client.py stock-search 惠科股份
python scripts/trade_assistant_client.py review-export --output review.json
python scripts/trade_assistant_client.py analysis report.json
python scripts/trade_assistant_client.py analysis report.json --confirm
python scripts/trade_assistant_client.py rulebooks
python scripts/trade_assistant_client.py discipline discipline-input.json
python scripts/trade_assistant_client.py discipline discipline-input.json --confirm
python scripts/trade_assistant_client.py influence influence-input.json --confirm
python scripts/trade_assistant_client.py probability probability-input.json --confirm
python scripts/trade_assistant_client.py probability-resolve REPORT_ID resolution.json --confirm
python scripts/trade_assistant_client.py information-sources
python scripts/trade_assistant_client.py information-source source.json --confirm
python scripts/trade_assistant_client.py information-run SOURCE_ID --confirm
python scripts/trade_assistant_client.py information-event event.json --confirm
python scripts/trade_assistant_client.py company-relation relation.json --confirm
```

`research`、`plan-ai`、`analysis`、`discipline`、`influence`、`probability`、`information-source`、`information-event` 和 `company-relation` 默认只预览；只有显式 `--confirm` 才提交。
