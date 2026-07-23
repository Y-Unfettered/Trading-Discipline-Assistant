"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PROCESSING_RULEBOOK_VERSION,
  agentInstructions,
  eventInputHash,
  normalizeProcessingResult,
  pendingInformationEvents,
  processingState,
  processingTaskItem
} = require("../lib/information-processing");

function event(overrides = {}) {
  return {
    id: "information-event-1",
    title: "国家级算力网络项目发布",
    summary: "项目明确建设范围和完成时间。",
    sourceName: "测试来源",
    sourceType: "established_media",
    sourceUrl: "https://example.com/news/1",
    publishedAt: "2026-07-22T10:00:00+08:00",
    collectedAt: "2026-07-22T10:01:00+08:00",
    originalHash: "original-1",
    status: "new",
    assetCodes: [],
    industryTags: [],
    ...overrides
  };
}

function resultFor(item, overrides = {}) {
  return {
    eventId: item.eventId,
    inputHash: item.inputHash,
    shortSummary: "国家级算力网络项目明确了建设范围和完成时间。",
    keyFacts: ["项目范围明确", "完成时间明确"],
    topicTags: ["政策", "基础设施"],
    industryTags: ["算力网络"],
    assetCodes: ["000001"],
    eventType: "政策发布",
    direction: "positive",
    attentionPriorityScore: 82,
    eventStrength: 76,
    assetImpacts: [],
    holdingRelevance: [],
    rankingReason: "事件层级和时间要求明确，值得优先阅读。",
    confidence: 0.78,
    ...overrides
  };
}

test("information processing exposes provider-neutral instructions and stable task hashes", () => {
  const instructions = agentInstructions();
  assert.equal(instructions.ruleVersion, PROCESSING_RULEBOOK_VERSION);
  assert.match(instructions.workflow.join(" "), /information-processing\/results/);
  const item = processingTaskItem(event(), { holdings: [{ code: "000001", name: "平安银行" }] });
  assert.equal(item.inputHash, eventInputHash(event()));
  assert.equal(item.inputHash.length, 64);
  assert.deepEqual(item.portfolioHoldings, [{ assetCode: "000001", assetName: "平安银行" }]);
});

test("information processing validates normalized results and invalidates stale input", () => {
  const sourceEvent = event();
  const item = processingTaskItem(sourceEvent);
  const enrichment = normalizeProcessingResult(resultFor(item), sourceEvent, { processor: "test-agent", ruleVersion: PROCESSING_RULEBOOK_VERSION, holdings: [] });
  assert.equal(enrichment.attentionPriorityScore, 82);
  assert.equal(enrichment.processor, "test-agent");
  const completed = { ...sourceEvent, aiEnrichment: enrichment, aiProcessingStatus: "completed" };
  assert.equal(processingState(completed), "completed");
  assert.equal(pendingInformationEvents([completed]).length, 0);
  completed.summary = "内容已经变化";
  assert.equal(processingState(completed), "pending");
  assert.throws(() => normalizeProcessingResult(resultFor(item), completed, { processor: "test-agent" }), /已发生变化/);
});

test("information processing only accepts relevance links to the frozen portfolio", () => {
  const sourceEvent = event();
  const item = processingTaskItem(sourceEvent, { holdings: [{ code: "601899", name: "紫金矿业" }] });
  const result = resultFor(item, {
    holdingRelevance: [{
      assetCode: "601899",
      assetName: "紫金矿业",
      relation: "commodity",
      direction: "unknown",
      relevanceScore: 78,
      impactScore: 45,
      impactTimeframe: "short_term",
      assessmentStatus: "provisional",
      confidence: 0.62,
      reason: "事件可能经商品价格和能源成本传导，但方向仍待核验。",
      transmissionPath: ["地缘冲突", "商品价格波动", "矿业公司成本与售价"],
      keyEvidence: ["资讯明确涉及大宗商品运输风险"],
      missingEvidence: ["尚缺公司具体成本敞口和售价联动数据"],
      evidenceBasis: "macro_chain"
    }]
  });
  const enrichment = normalizeProcessingResult(result, sourceEvent, { processor: "test-agent", ruleVersion: PROCESSING_RULEBOOK_VERSION, holdings: [{ code: "601899", name: "紫金矿业" }] });
  assert.equal(enrichment.holdingRelevance[0].assetName, "紫金矿业");
  assert.equal(enrichment.holdingRelevance[0].impactScore, 45);
  assert.equal(enrichment.holdingRelevance[0].requiresUserConfirmation, true);
  assert.match(enrichment.holdingRelevance[0].confirmationReason, /证据/);
  assert.throws(() => normalizeProcessingResult({ ...result, holdingRelevance: [{ ...result.holdingRelevance[0], assetCode: "000001" }] }, sourceEvent, { processor: "test-agent", holdings: [{ code: "601899", name: "紫金矿业" }] }), /当前持仓/);
});

test("failed and untouched items remain available while archived items are excluded", () => {
  const events = [
    event({ id: "new", publishedAt: "2026-07-22T11:00:00+08:00" }),
    event({ id: "failed", aiProcessingStatus: "failed" }),
    event({ id: "archived", status: "archived" })
  ];
  assert.deepEqual(pendingInformationEvents(events).map(item => item.id), ["new", "failed"]);
});
