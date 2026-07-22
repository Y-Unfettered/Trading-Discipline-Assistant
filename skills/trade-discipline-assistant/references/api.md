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
9. CLI 客户端

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

## 9. CLI 客户端

在 Skill 目录运行：

```bash
python scripts/trade_assistant_client.py status
python scripts/trade_assistant_client.py stock-search 惠科股份
python scripts/trade_assistant_client.py review-export --output review.json
python scripts/trade_assistant_client.py analysis report.json
python scripts/trade_assistant_client.py analysis report.json --confirm
```

`research`、`plan-ai` 和 `analysis` 默认只预览；只有显式 `--confirm` 才提交。
