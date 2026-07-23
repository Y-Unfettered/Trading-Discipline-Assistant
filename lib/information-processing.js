"use strict";

const crypto = require("crypto");

const PROCESSING_SCHEMA_VERSION = "information-processing/v1.2.0";
const PROCESSING_RULEBOOK_VERSION = "information-ranking/v1.2.0";
const DIRECTIONS = new Set(["positive", "negative", "neutral", "unknown"]);
const HOLDING_RELATIONS = new Set(["direct", "industry", "upstream", "downstream", "commodity", "macro"]);
const HOLDING_EVIDENCE_LEVELS = new Set(["article_explicit", "industry_chain", "macro_chain"]);
const HOLDING_ASSESSMENT_STATUSES = new Set(["supported", "provisional", "insufficient"]);
const IMPACT_TIMEFRAMES = new Set(["immediate", "short_term", "medium_term", "long_term", "unknown"]);

const RESULT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "InformationProcessingResult",
  type: "object",
  required: [
    "eventId", "inputHash", "shortSummary", "keyFacts", "topicTags", "industryTags",
    "assetCodes", "eventType", "direction", "attentionPriorityScore", "eventStrength",
    "holdingRelevance", "rankingReason", "confidence"
  ],
  properties: {
    eventId: { type: "string", minLength: 1 },
    inputHash: { type: "string", minLength: 64, maxLength: 64 },
    shortSummary: { type: "string", minLength: 1, maxLength: 1000 },
    keyFacts: { type: "array", maxItems: 12, items: { type: "string", minLength: 1, maxLength: 500 } },
    topicTags: { type: "array", maxItems: 20, items: { type: "string", minLength: 1, maxLength: 40 } },
    industryTags: { type: "array", maxItems: 20, items: { type: "string", minLength: 1, maxLength: 40 } },
    assetCodes: { type: "array", maxItems: 20, items: { type: "string", pattern: "^[0-9]{6}$" } },
    eventType: { type: "string", minLength: 1, maxLength: 80 },
    direction: { enum: [...DIRECTIONS] },
    attentionPriorityScore: { type: "integer", minimum: 0, maximum: 100 },
    eventStrength: { type: "integer", minimum: 0, maximum: 100 },
    assetImpacts: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        required: ["assetCode", "score", "reason"],
        properties: {
          assetCode: { type: "string", pattern: "^[0-9]{6}$" },
          score: { type: "integer", minimum: -100, maximum: 100 },
          reason: { type: "string", minLength: 1, maxLength: 500 }
        }
      }
    },
    holdingRelevance: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "assetCode", "assetName", "relation", "direction", "relevanceScore", "impactScore",
          "impactTimeframe", "assessmentStatus", "confidence", "reason", "transmissionPath",
          "keyEvidence", "missingEvidence", "evidenceBasis"
        ],
        properties: {
          assetCode: { type: "string", pattern: "^[0-9]{6}$" },
          assetName: { type: "string", minLength: 1, maxLength: 80 },
          relation: { enum: [...HOLDING_RELATIONS] },
          direction: { enum: [...DIRECTIONS] },
          relevanceScore: { type: "integer", minimum: 0, maximum: 100 },
          impactScore: { type: "integer", minimum: -100, maximum: 100 },
          impactTimeframe: { enum: [...IMPACT_TIMEFRAMES] },
          assessmentStatus: { enum: [...HOLDING_ASSESSMENT_STATUSES] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          reason: { type: "string", minLength: 1, maxLength: 500 },
          transmissionPath: { type: "array", maxItems: 8, items: { type: "string", minLength: 1, maxLength: 160 } },
          keyEvidence: { type: "array", maxItems: 8, items: { type: "string", minLength: 1, maxLength: 300 } },
          missingEvidence: { type: "array", maxItems: 8, items: { type: "string", minLength: 1, maxLength: 300 } },
          requiresUserConfirmation: { type: "boolean", readOnly: true },
          confirmationReason: { type: ["string", "null"], maxLength: 300, readOnly: true },
          evidenceBasis: { enum: [...HOLDING_EVIDENCE_LEVELS] }
        }
      }
    },
    rankingReason: { type: "string", minLength: 1, maxLength: 1000 },
    confidence: { type: "number", minimum: 0, maximum: 1 }
  },
  additionalProperties: false
};

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function limitedText(value, field, maxLength, required = false) {
  const text = clean(value);
  if (required && !text) throw new Error(`${field}不能为空`);
  if (text.length > maxLength) throw new Error(`${field}不能超过${maxLength}个字符`);
  return text;
}

function stringList(value, field, maxItems, maxLength) {
  if (!Array.isArray(value)) throw new Error(`${field}必须是数组`);
  if (value.length > maxItems) throw new Error(`${field}最多${maxItems}项`);
  return [...new Set(value.map(item => limitedText(item, field, maxLength)).filter(Boolean))];
}

function integer(value, field, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${field}必须是${min}到${max}之间的整数`);
  return number;
}

function eventInputHash(event) {
  const payload = {
    id: clean(event.id),
    title: clean(event.title),
    summary: clean(event.summary),
    sourceName: clean(event.sourceName),
    sourceUrl: clean(event.sourceUrl),
    publishedAt: clean(event.publishedAt),
    originalHash: clean(event.originalHash),
    contentHash: clean(event.contentHash)
  };
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function processingState(event) {
  const currentHash = eventInputHash(event);
  if (event.aiEnrichment?.inputHash === currentHash && event.aiEnrichment?.ruleVersion === PROCESSING_RULEBOOK_VERSION) return "completed";
  if (event.aiProcessingStatus === "processing") return "processing";
  if (event.aiProcessingStatus === "failed") return "failed";
  return "pending";
}

function pendingInformationEvents(events, options = {}) {
  const limit = Math.max(1, Math.min(100, Number(options.limit || 50)));
  const includeProcessing = options.includeProcessing === true;
  return [...(events || [])]
    .filter(event => event.status !== "archived")
    .filter(event => event.contentStatus !== "headline_only")
    .filter(event => {
      const state = processingState(event);
      return state === "pending" || state === "failed" || (includeProcessing && state === "processing");
    })
    .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)))
    .slice(0, limit);
}

function processingTaskItem(event, context = {}) {
  return {
    eventId: event.id,
    inputHash: eventInputHash(event),
    title: event.title,
    summary: event.summary,
    sourceName: event.sourceName,
    sourceType: event.sourceType,
    sourceUrl: event.sourceUrl,
    publishedAt: event.publishedAt,
    collectedAt: event.collectedAt,
    contentStatus: event.contentStatus || "pending",
    contentOrigin: event.contentOrigin || null,
    contentKind: event.contentKind || null,
    contentText: event.contentText || null,
    existingAssetCodes: event.assetCodes || [],
    existingIndustryTags: event.industryTags || [],
    portfolioHoldings: (context.holdings || []).map(holding => ({
      assetCode: clean(holding.assetCode || holding.code),
      assetName: clean(holding.assetName || holding.name)
    })).filter(holding => /^\d{6}$/.test(holding.assetCode) && holding.assetName)
  };
}

function normalizeProcessingResult(input, event, context = {}) {
  if (!event) throw new Error("AI整理结果对应的资讯不存在");
  const eventId = clean(input?.eventId);
  if (eventId !== event.id) throw new Error("AI整理结果的eventId不匹配");
  const expectedHash = eventInputHash(event);
  if (clean(input.inputHash) !== expectedHash) throw new Error(`资讯 ${event.id} 已发生变化，请重新获取后再处理`);
  const direction = clean(input.direction);
  if (!DIRECTIONS.has(direction)) throw new Error("direction必须是positive、negative、neutral或unknown");
  const assetCodes = stringList(input.assetCodes, "assetCodes", 20, 6);
  if (assetCodes.some(code => !/^\d{6}$/.test(code))) throw new Error("assetCodes只能包含六位证券代码");
  const assetImpacts = input.assetImpacts == null ? [] : input.assetImpacts;
  if (!Array.isArray(assetImpacts) || assetImpacts.length > 20) throw new Error("assetImpacts必须是最多20项的数组");
  const normalizedImpacts = assetImpacts.map(item => {
    const assetCode = clean(item?.assetCode);
    if (!/^\d{6}$/.test(assetCode)) throw new Error("assetImpacts.assetCode必须是六位证券代码");
    return {
      assetCode,
      score: integer(item.score, "assetImpacts.score", -100, 100),
      reason: limitedText(item.reason, "assetImpacts.reason", 500, true)
    };
  });
  const holdingRelevance = input.holdingRelevance;
  if (!Array.isArray(holdingRelevance) || holdingRelevance.length > 20) throw new Error("holdingRelevance必须是最多20项的数组");
  const holdings = new Map((context.holdings || []).map(holding => [clean(holding.assetCode || holding.code), clean(holding.assetName || holding.name)]));
  const normalizedHoldingRelevance = holdingRelevance.map(item => {
    const assetCode = clean(item?.assetCode);
    const expectedName = holdings.get(assetCode);
    if (!expectedName) throw new Error("holdingRelevance只能关联领取任务时的当前持仓");
    const relation = clean(item.relation);
    if (!HOLDING_RELATIONS.has(relation)) throw new Error("holdingRelevance.relation不合法");
    const holdingDirection = clean(item.direction);
    if (!DIRECTIONS.has(holdingDirection)) throw new Error("holdingRelevance.direction不合法");
    const evidenceBasis = clean(item.evidenceBasis);
    if (!HOLDING_EVIDENCE_LEVELS.has(evidenceBasis)) throw new Error("holdingRelevance.evidenceBasis不合法");
    const assessmentStatus = clean(item.assessmentStatus);
    if (!HOLDING_ASSESSMENT_STATUSES.has(assessmentStatus)) throw new Error("holdingRelevance.assessmentStatus不合法");
    const impactTimeframe = clean(item.impactTimeframe);
    if (!IMPACT_TIMEFRAMES.has(impactTimeframe)) throw new Error("holdingRelevance.impactTimeframe不合法");
    const relevanceScore = integer(item.relevanceScore, "holdingRelevance.relevanceScore", 0, 100);
    const impactScore = integer(item.impactScore, "holdingRelevance.impactScore", -100, 100);
    if (holdingDirection === "positive" && impactScore < 0) throw new Error("正向持仓影响的impactScore不能为负数");
    if (holdingDirection === "negative" && impactScore > 0) throw new Error("负向持仓影响的impactScore不能为正数");
    if (holdingDirection === "neutral" && impactScore !== 0) throw new Error("中性持仓影响的impactScore必须为0");
    const holdingConfidence = Number(item.confidence);
    if (!Number.isFinite(holdingConfidence) || holdingConfidence < 0 || holdingConfidence > 1) throw new Error("holdingRelevance.confidence必须是0到1之间的数字");
    const transmissionPath = stringList(item.transmissionPath, "holdingRelevance.transmissionPath", 8, 160);
    const keyEvidence = stringList(item.keyEvidence, "holdingRelevance.keyEvidence", 8, 300);
    const missingEvidence = stringList(item.missingEvidence, "holdingRelevance.missingEvidence", 8, 300);
    if (!transmissionPath.length) throw new Error("holdingRelevance.transmissionPath至少需要一项");
    if (assessmentStatus === "supported" && !keyEvidence.length) throw new Error("证据充分的持仓影响必须填写keyEvidence");
    const requiresUserConfirmation = relevanceScore >= 70 && (
      Math.abs(impactScore) >= 50 || assessmentStatus !== "supported" || holdingConfidence < 0.75
    );
    const confirmationReason = requiresUserConfirmation
      ? assessmentStatus !== "supported"
        ? "持仓相关性较高，但公司传导证据尚未完全闭合"
        : holdingConfidence < 0.75
          ? "持仓相关性较高，但AI置信度不足"
          : "持仓相关性和影响幅度都较高，需要人工确认后再作为重点结论"
      : null;
    return {
      assetCode,
      assetName: expectedName,
      relation,
      direction: holdingDirection,
      relevanceScore,
      impactScore,
      impactTimeframe,
      assessmentStatus,
      confidence: holdingConfidence,
      reason: limitedText(item.reason, "holdingRelevance.reason", 500, true),
      transmissionPath,
      keyEvidence,
      missingEvidence,
      requiresUserConfirmation,
      confirmationReason,
      evidenceBasis
    };
  });
  const now = new Date().toISOString();
  return {
    schemaVersion: PROCESSING_SCHEMA_VERSION,
    ruleVersion: clean(context.ruleVersion || PROCESSING_RULEBOOK_VERSION),
    eventId,
    inputHash: expectedHash,
    shortSummary: limitedText(input.shortSummary, "shortSummary", 1000, true),
    keyFacts: stringList(input.keyFacts, "keyFacts", 12, 500),
    topicTags: stringList(input.topicTags, "topicTags", 20, 40),
    industryTags: stringList(input.industryTags, "industryTags", 20, 40),
    assetCodes,
    eventType: limitedText(input.eventType, "eventType", 80, true),
    direction,
    attentionPriorityScore: integer(input.attentionPriorityScore, "attentionPriorityScore", 0, 100),
    eventStrength: integer(input.eventStrength, "eventStrength", 0, 100),
    assetImpacts: normalizedImpacts,
    holdingRelevance: normalizedHoldingRelevance,
    rankingReason: limitedText(input.rankingReason, "rankingReason", 1000, true),
    confidence: (() => {
      const value = Number(input.confidence);
      if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("confidence必须是0到1之间的数字");
      return value;
    })(),
    processor: limitedText(context.processor, "processor", 120, true),
    processedAt: now
  };
}

function agentInstructions() {
  return {
    schemaVersion: PROCESSING_SCHEMA_VERSION,
    ruleVersion: PROCESSING_RULEBOOK_VERSION,
    purpose: "采集器只负责收集；AI代理按统一规则生成标签、摘要、持仓影响初评和排序分，用户只在必要时确认，不得修改原文。",
    documentation: [
      "docs/AI资讯整理代理交接.md",
      "docs/规则体系-v1-资讯影响与概率研报闭环.md",
      "schemas/information-processing-result.v1.schema.json"
    ],
    workflow: [
      "GET /api/information-processing/instructions 读取规则和输出结构",
      "POST /api/information-processing/runs 创建并领取一批待处理资讯",
      "逐条阅读任务中的原文或摘要，按规则生成结果",
      "POST /api/information-processing/results 回写；不得直接修改数据库",
      "GET /api/information-processing/runs 查看批次状态"
    ],
    constraints: [
      "原始标题、摘要、正文、来源和发布时间禁止改写",
      "阅读优先级不是涨跌概率，也不是买卖指令",
      "公司影响没有依据时assetImpacts必须为空",
      "逐一检查portfolioHoldings；无合理关联时holdingRelevance必须为空，有关联时必须给出影响幅度、时间范围、传导路径、证据和缺失证据",
      "holdingRelevance中的impactScore是证据约束下的公司影响初评分，不是涨跌概率或买卖指令",
      "行业利好不能直接等同公司受益；未核验订单、客户准入、产能、收入占比时assessmentStatus不得写supported",
      "unknown方向允许impactScore表达潜在幅度，但必须降低confidence并列出missingEvidence",
      "持仓相关性可以提高阅读优先级，但不能抬高事件本身的eventStrength",
      "contentStatus为headline_only的条目不进入AI任务；不得只凭标题生成事实、影响分或公司结论",
      "contentKind为substantial_summary时必须降低置信度，并在排序理由中说明尚未取得完整原文",
      "必须原样回传eventId和inputHash，内容已变化时后端会拒绝旧结果",
      "不得因为条目不重要而省略结果；低重要性应给低分并说明原因"
    ],
    resultSchema: RESULT_SCHEMA
  };
}

module.exports = {
  PROCESSING_SCHEMA_VERSION,
  PROCESSING_RULEBOOK_VERSION,
  RESULT_SCHEMA,
  eventInputHash,
  processingState,
  pendingInformationEvents,
  processingTaskItem,
  normalizeProcessingResult,
  agentInstructions
};
