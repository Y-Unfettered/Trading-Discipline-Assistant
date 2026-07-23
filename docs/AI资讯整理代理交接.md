# AI 资讯整理代理交接手册

## 1. 这本手册解决什么问题

本手册用于把本地“资讯影响中心”的待处理资讯交给任意本地 AI 代理整理，不依赖 Codex，也不要求某一家模型厂商。

系统职责分为两层：

- 采集器：持续采集标题、来源、发布时间和原文，并保存在本机；没有 AI 也能正常工作。
- AI 代理：读取已经保存的正文，生成摘要、事实、标签、事件方向、事件强度和阅读优先级，再通过 HTTP 接口回写。

AI 代理不得直接修改 `data/store.json` 或 SQLite 数据库，也不得修改原始标题、原文、来源和发布时间。所有任务领取和结果写入都必须经过本手册规定的 HTTP API。

## 2. 哪些 AI 工具可以使用

适合：

- 能打开本机项目目录并执行终端命令的 Codex、Claude Code、Gemini CLI 或其他编程代理；
- 能读取本地文件，并能访问 `http://127.0.0.1:3768` 的桌面 AI 代理；
- 自己编写的 MCP、CLI 或本地脚本。

不适合直接自动执行：

- 只能在网页里聊天、不能读取 `D:\交易` 的普通聊天机器人；
- 不能访问本机 `127.0.0.1` 的远程代理；
- 只能看标题、拿不到任务正文的模型。

如果某个 AI 工具只能聊天，可以让它生成整理结果，但仍需要另一个本地工具负责领取任务和回写，不建议长期采用人工复制粘贴。

## 3. 交给 AI 前的准备

### 3.1 打开项目

让 AI 代理打开目录：

```text
D:\交易
```

### 3.2 确认应用正在运行

默认地址：

```text
http://127.0.0.1:3768
```

如果没有运行，在 `D:\交易` 中执行：

```powershell
npm start
```

可使用以下只读请求检查服务：

```powershell
Invoke-RestMethod -Uri 'http://127.0.0.1:3768/api/information-processing/instructions'
```

能返回 `information-processing/v1.2.0` 即表示 AI 整理接口可用。

### 3.3 AI 必读材料

代理开始前必须完整阅读：

1. `docs/AI资讯整理代理交接.md`：操作流程；
2. `docs/规则体系-v1-资讯影响与概率研报闭环.md`：影响因子、来源等级和公司九段传导规则；
3. `schemas/information-processing-result.v1.schema.json`：机器可校验的返回字段；
4. `GET /api/information-processing/instructions`：当前运行中的协议版本和约束。

文件说明与运行接口冲突时，代理应停止写入并报告版本不一致，不能自行猜测。

当前协议版本：`information-processing/v1.2.0`。  
当前排序规则版本：`information-ranking/v1.2.0`。

## 4. 第一次测试的推荐方式

第一次不要一次领取 50 或 100 条。先让 AI 只处理 5 条，检查结果质量和网页展示，再逐步增加到每批 10–20 条。

推荐验收顺序：

1. 只读查看待处理数量；
2. 领取 5 条；
3. AI 逐条阅读本地正文；
4. 回写 5 条结果，无法可靠处理的条目必须作为失败项回写；
5. 在网页“资讯影响中心”刷新；
6. 检查摘要、标签、分数和排序理由；
7. 确认没有凭标题编事实、没有把影响分写成涨跌预测；
8. 质量合格后再处理下一批。

重要：领取批次会把条目标记为“处理中”。代理领取后不能直接退出。如果代理意外中断，应恢复原批次，不要重新领取一批。

## 5. 标准执行流程

### 第一步：读取当前规则

```http
GET /api/information-processing/instructions
```

AI 必须核对：

- `schemaVersion`；
- `ruleVersion`；
- `constraints`；
- `resultSchema`。

### 第二步：只读查看待处理资讯

```http
GET /api/information-processing/pending?limit=5
```

这个接口不会占用任务。响应中的 `counts` 会告诉代理：

- `completed`：已经整理完成；
- `pending`：尚未整理；
- `processing`：已经被某个批次领取；
- `failed`：此前处理失败，可以重新领取；
- `excludedHeadlineOnly`：只有标题、已禁止交给 AI 推断的线索。

### 第三步：创建并领取测试批次

```http
POST /api/information-processing/runs
Content-Type: application/json

{
  "confirmed": true,
  "processor": "代理工具和模型名称",
  "limit": 5
}
```

`processor` 应使用稳定且容易识别的名称，例如：

```text
Claude-Code-Sonnet-2026-07
Gemini-CLI-Pro-test
Local-Agent-Qwen3
```

代理必须保存响应中的：

- `run.id`：本批次编号；
- `run.ruleVersion`：本批采用的规则版本；
- `task.items`：本批全部任务。

每条任务中的 `eventId` 和 `inputHash` 必须原样回传，不得重新计算或修改。

### 第四步：判断是否具备可整理内容

每条任务包含：

- `title`、`summary`、来源和时间；
- `contentStatus`：正文状态；
- `contentKind`：内容类型；
- `contentOrigin`：内容来源；
- `contentText`：本地保存的正文或完整快讯；
- 已有的证券和行业线索。

处理规则：

| 内容状态 | AI 应怎样处理 |
|---|---|
| `complete` + `article` | 阅读完整正文后整理，可以正常评估置信度 |
| `complete` + `brief` | 按完整快讯处理，不要把快讯扩写成不存在的长文 |
| `summary_only` + `substantial_summary` | 可以整理，但必须降低置信度，并在排序理由中注明未取得完整原文 |
| `pending` 且 `contentText` 为空 | 不得只看标题推断，放进 `failures` |
| `headline_only` | 后端会自动排除，正常情况下不会出现在任务中 |

### 第五步：逐条生成结构化结果

每条可处理资讯都必须返回：

- `shortSummary`：两三句话说明发生了什么、主体是谁、关键时间或数字是什么；
- `keyFacts`：只写正文可以直接支持的事实；
- `topicTags`：政策、公司公告、商品价格、监管、产业趋势等主题；
- `industryTags`：正文明确关联的行业；
- `assetCodes`：正文明确点名或具有可靠关联的六位 A 股代码；
- `eventType`：简洁稳定的事件类型；
- `direction`：`positive`、`negative`、`neutral` 或 `unknown`；
- `attentionPriorityScore`：0–100，决定用户先看什么；
- `eventStrength`：0–100，衡量事件本身强弱；
- `rankingReason`：为什么值得或不值得优先看；
- `confidence`：0–1，代表当前整理结果的证据置信度；
- `assetImpacts`：只有公司传导证据充分时才填写，否则必须为空数组。
- `holdingRelevance`：逐一核对任务提供的 `portfolioHoldings`，自动生成持仓影响初评，包括相关度、影响幅度、时间范围、传导路径、证据状态、关键证据和缺失证据；没有合理关联时为空数组。

即使资讯不重要，也必须生成低分结果，不能直接跳过。只有正文缺失、内容损坏或无法可靠理解时才放入 `failures`。

## 6. 建议评分口径

### 6.1 阅读优先级 `attentionPriorityScore`

这个分数回答“我应该先看哪条”，不是“明天上涨概率”。

| 分数 | 含义 | 典型情况 |
|---:|---|---|
| 90–100 | 立即关注 | 正式重大政策、监管处罚、业绩重大变化、明确合同或突发系统性事件 |
| 70–89 | 高优先级 | 权威来源、明确对象和时间，可能影响重要行业或持仓 |
| 50–69 | 值得阅读 | 有实际信息量，但预算、执行或公司传导仍不完整 |
| 30–49 | 一般资讯 | 行业动态、重复报道、影响范围有限或兑现较远 |
| 0–29 | 低价值线索 | 娱乐热搜、缺乏新增事实、与中国股票关系很弱或明显重复 |

评分时同时考虑：来源可靠性、信息新颖度、影响范围、时间紧迫性、是否涉及持仓或候选标的、原文是否完整。

### 6.2 事件强度 `eventStrength`

按照规则手册中的八项维度综合判断：权威层级、执行强度、措施明确度、预算、新颖度、覆盖范围、持续时间和兑现时点。

高级别会议上的宽泛表态不能仅凭“国家级”三个字获得 90 分；没有具体措施、责任主体、预算和时间表时应明显降分。

### 6.3 方向 `direction`

方向描述事件本身的潜在影响，不是股价预测：

- `positive`：证据显示需求、收入、政策环境或行业条件改善；
- `negative`：证据显示处罚、需求下降、成本上升或经营条件恶化；
- `neutral`：信息明确但没有明显正负方向；
- `unknown`：当前内容不足以判断。

同一政策可能对行业为正、对某些成本承担方为负。无法区分时应使用 `unknown`，不能强行选正面。

### 6.4 公司影响 `assetImpacts`

仅仅“属于某个概念”不能填写公司影响。至少需要检查：

1. 是否创造真实需求；
2. 是否有预算或付费主体；
3. 是否匹配公司的具体产品；
4. 是否存在采购或合同路径；
5. 公司是否有资质和准入；
6. 是否有历史项目或客户关系；
7. 是否有交付能力；
8. 对收入、利润和现金流是否重要；
9. 何时可能确认收入和回款。

任务正文不能支撑这些节点时：

```json
"assetImpacts": []
```

宁可留空，也不能用行业联想制造公司利好。

### 6.5 当前持仓关联 `holdingRelevance`

每个 AI 任务都会携带领取任务时的 `portfolioHoldings`。代理必须逐一检查资讯是否与持仓存在：

- `direct`：正文直接点名公司或其明确项目；
- `industry`：与公司所处行业直接相关；
- `upstream` / `downstream`：影响公司的关键供应端或需求端；
- `commodity`：影响公司主要商品价格、产量、库存或成本；
- `macro`：通过汇率、利率、地缘冲突、能源成本或风险偏好间接传导。

持仓关联必须填写：

- `relevanceScore`：0–100，消息与持仓的相关程度；
- `impactScore`：-100 到 100，证据约束下的公司影响初评分，正数偏正面、负数偏负面；
- `impactTimeframe`：`immediate`、`short_term`、`medium_term`、`long_term` 或 `unknown`；
- `assessmentStatus`：`supported`（证据较充分）、`provisional`（初步判断）或 `insufficient`（证据不足）；
- `confidence`：该持仓影响判断自身的0–1置信度；
- `transmissionPath`：从事件到行业、商品、上下游再到公司的明确传导路径；
- `keyEvidence`：正文或可靠资料能够直接支撑的事实；
- `missingEvidence`：订单、招投标资格、客户准入、产能、收入占比等尚未取得的关键证据；
- `reason` 和 `evidenceBasis`：简洁结论及其证据层级。

后端会根据相关度、影响幅度、证据状态和置信度自动决定 `requiresUserConfirmation`。用户不再填写整套表格，只对少数重要项目点击“确认合理”或“标记不准确”。`impactScore`不是涨跌概率，也不是买卖指令。宏观推断必须降低置信度并明确传导链，不能把任何国际新闻都强行关联到持仓。

### 6.6 置信度 `confidence`

建议参考：

- 一手正式原文且事实明确：`0.80–0.95`；
- 权威媒体完整正文：`0.65–0.85`；
- 完整快讯但细节有限：`0.55–0.75`；
- 只有较完整摘要：`0.35–0.60`；
- 只有标题或正文为空：不要提交成功结果，应放入 `failures`。

## 7. 回写结果

```http
POST /api/information-processing/results
Content-Type: application/json

{
  "confirmed": true,
  "runId": "领取批次返回的 run.id",
  "processor": "必须与领取批次时完全一致",
  "ruleVersion": "information-ranking/v1.2.0",
  "results": [
    {
      "eventId": "information-event-...",
      "inputHash": "任务提供的64位哈希",
      "shortSummary": "两三句话摘要",
      "keyFacts": ["正文可直接支持的事实一", "事实二"],
      "topicTags": ["政策", "产业建设"],
      "industryTags": ["光通信"],
      "assetCodes": [],
      "eventType": "产业政策",
      "direction": "positive",
      "attentionPriorityScore": 78,
      "eventStrength": 70,
      "assetImpacts": [],
      "holdingRelevance": [
        {
          "assetCode": "601899",
          "assetName": "紫金矿业",
          "relation": "commodity",
          "direction": "unknown",
          "relevanceScore": 78,
          "impactScore": 45,
          "impactTimeframe": "short_term",
          "assessmentStatus": "provisional",
          "confidence": 0.62,
          "reason": "事件可能经能源成本和避险情绪影响有色与贵金属，但当前快讯缺少持续性证据。",
          "transmissionPath": ["地缘冲突", "能源与贵金属价格波动", "矿业公司售价与成本"],
          "keyEvidence": ["正文明确涉及能源运输风险"],
          "missingEvidence": ["尚缺公司能源成本敞口和售价联动数据"],
          "evidenceBasis": "macro_chain"
        }
      ],
      "rankingReason": "政策主体权威且提出明确建设方向，但预算、采购路径和具体公司受益仍待核验。",
      "confidence": 0.76
    }
  ],
  "failures": [
    {
      "eventId": "information-event-...",
      "inputHash": "任务提供的64位哈希",
      "error": "本地正文为空，不能仅凭标题可靠整理"
    }
  ]
}
```

后端会校验：

- 字段是否完整；
- 分数和置信度是否在范围内；
- 证券代码是否为六位数字；
- `processor` 是否与领取时一致；
- 条目是否属于当前批次；
- `inputHash` 是否仍然有效。

资讯正文或元数据发生变化后，旧哈希会被拒绝。代理应重新读取原批次或重新领取待处理任务，不能强行覆盖。

`requiresUserConfirmation` 和 `confirmationReason` 由后端根据AI结果自动计算，代理不需要生成。用户在网页点击确认后，系统通过以下接口保存不可变确认记录：

```http
POST /api/information-events/{eventId}/holding-impact-confirmations
```

这个接口属于用户确认流程，不由AI代理代替用户调用。

## 8. 完成后网页会发生什么

成功回写后，刷新“资讯影响中心”：

1. 顶部“AI 可处理 / 已整理”数量增加；
2. 资讯表格中的“整理状态”变为“已整理”；
3. 打开资讯详情，可以看到：
   - AI 两三句话摘要；
   - 阅读优先级分数；
   - 主题和行业标签；
   - 当前持仓的相关度、影响初评分、时间范围、传导路径、关键证据和缺失证据；
   - 排序理由；
4. 高关联、高影响或证据存疑时，页面只让用户点击“确认合理”或“标记不准确”，不再要求逐项填写复杂表单；
5. 选择“智能优先”后，当前持仓相关资讯优先，其余按阅读优先级排列；
6. 全部可处理资讯都整理完成时，页面可以默认使用智能优先；
7. 只完成一部分时，页面仍默认保持时间顺序，避免未处理资讯被错误压到后面；
8. AI 停止工作不会影响采集、正文保存、搜索、分页和原文阅读。

整理结果不会自动下单，不会生成“今天必须买卖”的命令，也不会把阅读优先级当作涨跌概率。

## 9. 可以直接复制给其他 AI 的提示词

### 9.1 第一次测试：只处理 5 条

```text
你现在是本地“交易纪律助手”的资讯整理代理。项目目录是 D:\交易，应用默认运行在 http://127.0.0.1:3768。

请不要只给我操作建议，直接在本机完成一次小批量测试，但不得直接修改 data/store.json 或 SQLite。

严格按以下顺序执行：
1. 完整阅读：
   - docs/AI资讯整理代理交接.md
   - docs/规则体系-v1-资讯影响与概率研报闭环.md
   - schemas/information-processing-result.v1.schema.json
2. 调用 GET /api/information-processing/instructions，核对 schemaVersion、ruleVersion 和 constraints。
3. 调用 GET /api/information-processing/pending?limit=5，只读报告待处理数量。
4. 如果存在待处理资讯，调用 POST /api/information-processing/runs，使用 confirmed=true、limit=5，processor 填写你当前的工具和模型名称。
5. 保存 run.id、processor、ruleVersion，以及每条任务的 eventId 和 inputHash。
6. 逐条优先阅读 contentText：
   - 完整文章或完整快讯可以正常整理；
   - substantial_summary 必须降低置信度并注明未取得完整原文；
   - 正文为空时不得只凭标题推断，放入 failures。
7. 为每条可处理资讯生成符合 schema 的 shortSummary、keyFacts、topicTags、industryTags、assetCodes、eventType、direction、attentionPriorityScore、eventStrength、rankingReason、confidence、assetImpacts 和 holdingRelevance。
8. 逐一核对任务中的 portfolioHoldings。存在合理关联时，holdingRelevance 必须填写 relevanceScore、impactScore、impactTimeframe、assessmentStatus、confidence、transmissionPath、keyEvidence、missingEvidence、reason 和 evidenceBasis；没有关联时必须为空。持仓相关性可以提高阅读优先级，但不能抬高事件本身的 eventStrength。
9. attentionPriorityScore 只表示阅读顺序，不是涨跌概率或买卖信号。没有完整公司传导证据时 assetImpacts 必须为空数组，不得用概念联想制造公司利好。
10. 通过 POST /api/information-processing/results 回写本批全部成功结果和失败项。processor 必须与领取时完全一致，eventId 和 inputHash 必须原样回传。
11. 调用 GET /api/information-processing/runs/{runId} 验证批次最终状态。

完成后只向我汇报：runId、processor、批次状态、领取数、成功数、失败数、最高优先级的三条资讯及其评分、失败原因，以及我应该在网页哪里检查结果。不要声称已经完成尚未实际写入的结果。
```

### 9.2 质量确认后：连续处理多批

```text
请按照 D:\交易\docs\AI资讯整理代理交接.md 的规则继续整理资讯。每批最多 15 条，一批完成并验证成功后才能领取下一批。本次最多处理 3 批；如果正文为空、接口版本变化、连续出现校验错误或服务不可用，立即停止并报告，不要直接修改数据库。每批都要报告 runId、成功数和失败数，最后汇总最高优先级资讯。
```

### 9.3 恢复一个被中断的批次

```text
上一个 AI 代理领取资讯批次后中断了。请先调用 GET /api/information-processing/runs 查看最近仍为 processing 的批次，再调用 GET /api/information-processing/runs/{runId} 恢复该批任务。必须沿用该批次原来的 processor 字符串，不要重新领取重复任务。按照 D:\交易\docs\AI资讯整理代理交接.md 完成剩余条目并通过 results 接口回写，最后验证批次状态。
```

## 10. AI 完成时应该给你的交接结果

合格的完成报告应类似：

```text
批次：information-processing-run-...
代理：Claude-Code-Sonnet-2026-07
状态：completed
领取：5 条
成功：4 条
失败：1 条

最高优先级：
1. 某政策正式发布，82 分——主体权威、有明确执行时间，但公司传导待核验。
2. 某公司披露重大合同，79 分——合同金额明确，需要继续核验收入占比。
3. 某行业价格变化，61 分——行业相关性明确，但持续性未知。

失败：
- 某资讯本地正文为空，未凭标题生成结论。

网页检查：资讯影响中心 → 刷新 → 智能优先；点击具体资讯查看 AI 摘要、标签和排序理由。
```

如果 AI 只说“已经分析好了”，却没有 `runId`、成功数和最终接口状态，应当视为没有完成交接。

## 11. 常见问题与恢复方法

### 11.1 服务连接失败

- 确认 `D:\交易` 中的应用是否正在运行；
- 执行 `npm start`；
- 再访问 `GET /api/information-processing/instructions`；
- 不要因为接口不可用就直接编辑数据库。

### 11.2 领取后 AI 中断

- 先查询 `GET /api/information-processing/runs`；
- 找到状态为 `processing` 的批次；
- 用 `GET /api/information-processing/runs/{runId}` 重新取得任务；
- 回写时沿用原来的 `processor`。

### 11.3 `inputHash` 不匹配

说明资讯正文或元数据在代理处理期间发生了变化。放弃旧结果，重新读取任务；不能自行伪造哈希。

### 11.4 正文为空

将该条放入 `failures`，错误写明“正文为空，不能仅凭标题可靠整理”。之后可以在网页中对原文执行重新抓取，再让 AI 重新领取失败项。

### 11.5 只有摘要

允许整理，但必须降低 `confidence`，并在 `rankingReason` 中明确“尚未取得完整原文”。不得补充摘要之外的数字、主体或因果关系。

### 11.6 部分结果校验失败

先检查 schema、字段类型、六位证券代码、分数范围和 `processor`。修正 JSON 后重新提交，不要绕过后端校验。

## 12. 降级与安全边界

- 没有任何 AI 结果：资讯库按发布时间倒序；
- 只有部分资讯完成：默认仍按时间排序，可以手动选择“智能优先”；
- 全部有效资讯完成：可以默认按阅读优先级排序；
- AI 处理失败：采集、正文保存、分页、搜索和阅读原文不受影响；
- AI 只负责整理和辅助判断，不负责交易，不得执行买卖；
- 不得把阅读优先级、事件强度或公司影响分解释为确定收益或上涨概率；
- 不得绕过网站限速、登录、付费或访问限制去补充材料；
- 不得修改或覆盖用户的原始资讯、历史评估和交易记录。

## 13. 最小验收标准

一次 AI 整理只有同时满足以下条件才算成功：

1. 有真实 `runId`；
2. 批次状态为 `completed` 或明确说明 `partial`；
3. 每条任务都进入成功结果或失败列表；
4. 正文为空的资讯没有被凭标题编写事实；
5. 低重要性资讯得到低分而不是被省略；
6. 公司证据不足时 `assetImpacts` 为空；
7. 每条资讯都核对当前持仓，合理关联包含影响幅度、传导路径、证据状态和缺失证据，没有关联时不强行填写；
8. 网页详情能看到摘要、标签、分数、持仓影响初评和排序理由，必要项目可以进行一键确认；
9. 原始标题、正文、来源和发布时间没有被修改；
10. 报告明确说明评分不是买卖指令或涨跌概率。

## 14. 资讯确认后的自动闭环（2026-07-23 更新）

AI 代理仍只负责整理资讯，不直接创建研究证据。完成整理后，系统按以下流程工作：

1. `aiEnrichment.holdingRelevance` 给出持仓影响初评；
2. 需要确认的项目由用户点击“确认”或“否定”；
3. 确认后系统自动写入 `informationImpactConfirmations`；
4. 系统自动创建事实证据卡、持仓影响分析卡和 `informationEvidencePromotions`；
5. 概率研报选择标的时，自动导入这些已确认的持仓证据；
6. 同一资讯事件簇中的重复报道使用同一个 `correlationGroup`，贝叶斯更新只计一次主要证据。

代理不得自行绕过确认接口直接伪造 `evidenceRecords`，也不得把未确认的 AI 持仓影响送入概率模型。若确认接口返回 `promotion`，说明证据闭环已经完成；若用户选择 `rejected`，则不应生成转化记录。
