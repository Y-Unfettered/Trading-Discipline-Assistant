"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { REQUIRED_TRANSMISSION_STAGES } = require("../lib/influence-engine");

const ROOT = path.resolve(__dirname, "..");

async function waitForServer(baseUrl, child) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode != null) throw new Error(`server exited with ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/api/rulebooks`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("server did not become ready");
}

async function request(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const payload = await response.json();
  return { response, payload };
}

function disciplineInput() {
  return {
    date: "2026-07-22",
    assetCode: "000001",
    riskEffect: "increase",
    plan: { active: true, invalidated: false, triggerDefined: true, riskExitDefined: true },
    evidence: { reasonRecorded: true, factsLinked: true, thesisStated: true, thesisStatus: "valid", scenarioDefined: true },
    execution: { actionAllowed: true, triggerSatisfied: true, withinTolerance: true, timely: true },
    risk: { positionWithinLimit: true, tradeRiskWithinLimit: true, stopNotLoosened: true, dailyLimitRespected: true, loserRiskNotExpanded: true },
    adjustment: { deviationVerified: true, emotionControlled: true, noRevengeSequence: true, frequencyWithinRule: true },
    record: { tradeComplete: true, rationaleComplete: true, emotionComplete: true, reviewComplete: true }
  };
}

test("decision rule APIs preview, persist immutably, query, and resolve forecasts", async t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "trade-decision-api-"));
  const port = 42000 + Math.floor(Math.random() * 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(ROOT, "server.js")], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      TRADE_DATA_DIR: path.join(tempRoot, "data"),
      TRADE_REPORT_DIR: path.join(tempRoot, "reports"),
      TRADE_AUTO_STOCK_REFRESH: "false"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk.toString(); });
  t.after(async () => {
    child.kill();
    await new Promise(resolve => child.once("exit", resolve));
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  await waitForServer(baseUrl, child);
  let result = await request(baseUrl, "/api/rulebooks");
  assert.equal(result.response.status, 200, stderr);
  assert.equal(result.payload.discipline.version, "discipline/v2.0.0");
  assert.equal(result.payload.informationCollection.version, "information-source/v1.3.0");
  assert.equal(result.payload.informationContent.version, "information-content/v1.1.0");

  const sourceInput = { name: "官方 JSON Feed", adapter: "json_feed", sourceType: "regulator_or_government", enabled: false, config: { url: "https://example.gov.cn/feed.json", token: "must-not-persist" } };
  result = await request(baseUrl, "/api/information-sources/preview", { method: "POST", body: JSON.stringify({ input: sourceInput }) });
  assert.equal(result.response.status, 200, stderr);
  assert.equal(result.payload.source.config.token, undefined);
  result = await request(baseUrl, "/api/information-sources", { method: "POST", body: JSON.stringify({ input: sourceInput }) });
  assert.equal(result.response.status, 400, stderr);
  result = await request(baseUrl, "/api/information-sources", { method: "POST", body: JSON.stringify({ input: sourceInput, confirmed: true }) });
  assert.equal(result.response.status, 201, stderr);
  assert.equal(result.payload.source.config.token, undefined);
  const informationSourceId = result.payload.source.id;
  result = await request(baseUrl, "/api/information-sources");
  assert.equal(result.payload.sources.length, 1, stderr);
  result = await request(baseUrl, `/api/information-sources/${encodeURIComponent(informationSourceId)}`, { method: "PUT", body: JSON.stringify({ input: { name: "官方 JSON Feed（已核验）", enabled: false }, confirmed: true }) });
  assert.equal(result.response.status, 200, stderr);
  assert.equal(result.payload.source.name, "官方 JSON Feed（已核验）");
  result = await request(baseUrl, "/api/information-sources/newsnow-defaults", { method: "POST", body: JSON.stringify({ confirmed: true }) });
  assert.equal(result.response.status, 201, stderr);
  assert.equal(result.payload.added.length, 14, stderr);
  assert.ok(result.payload.added.every(source => source.adapter === "newsnow" && source.enabled));
  result = await request(baseUrl, "/api/information-runtime");
  assert.equal(result.response.status, 200, stderr);
  assert.equal(result.payload.schemaVersion, "information-runtime/v1.0.0");
  assert.equal(typeof result.payload.counts.analyzable, "number");
  result = await request(baseUrl, "/api/information-sources/newsnow-defaults", { method: "POST", body: JSON.stringify({ confirmed: true }) });
  assert.equal(result.response.status, 200, stderr);
  assert.equal(result.payload.added.length, 0, stderr);
  assert.equal(result.payload.existing.length, 14, stderr);

  result = await request(baseUrl, "/api/evidence", { method: "POST", body: JSON.stringify({ kind: "fact", assetCode: "000001", title: "投标资格事实", content: "公司公告披露具备同类项目资格。", source: "公司公告", sourceLevel: "L1", sourceUrl: "https://example.com/filing", publishedAt: "2026-07-22T08:00:00+08:00" }) });
  assert.equal(result.response.status, 201, stderr);
  const relationEvidenceId = result.payload.record.id;
  const relationInput = { assetCode: "000001", stage: "company_eligibility", status: "supported", score: 4, title: "具备同类项目投标资格", details: "资格来自公司法定公告。", evidenceIds: [relationEvidenceId], validAsOf: "2026-07-22" };
  result = await request(baseUrl, "/api/company-relations/preview", { method: "POST", body: JSON.stringify({ input: relationInput }) });
  assert.equal(result.response.status, 200, stderr);
  assert.equal(result.payload.relation.score, 4);
  result = await request(baseUrl, "/api/company-relations", { method: "POST", body: JSON.stringify({ input: { ...relationInput, evidenceIds: [] }, confirmed: true }) });
  assert.equal(result.response.status, 400, stderr);
  result = await request(baseUrl, "/api/company-relations", { method: "POST", body: JSON.stringify({ input: relationInput, confirmed: true }) });
  assert.equal(result.response.status, 201, stderr);
  assert.equal(result.payload.relation.score, 4);
  result = await request(baseUrl, "/api/company-relations", { method: "POST", body: JSON.stringify({ input: relationInput, confirmed: true }) });
  assert.equal(result.response.status, 200, stderr);
  assert.equal(result.payload.duplicate, true);
  result = await request(baseUrl, "/api/company-relations?assetCode=000001");
  assert.equal(result.payload.relations.length, 1, stderr);

  result = await request(baseUrl, "/api/discipline-assessments/preview", { method: "POST", body: JSON.stringify({ input: disciplineInput() }) });
  assert.equal(result.payload.score, 100, stderr);

  result = await request(baseUrl, "/api/discipline-assessments", { method: "POST", body: JSON.stringify({ input: disciplineInput() }) });
  assert.equal(result.response.status, 400, stderr);
  result = await request(baseUrl, "/api/discipline-assessments", { method: "POST", body: JSON.stringify({ input: disciplineInput(), confirmed: true }) });
  assert.equal(result.response.status, 201, stderr);
  const disciplineId = result.payload.assessment.id;
  assert.ok(disciplineId);

  result = await request(baseUrl, "/api/discipline-assessments?date=2026-07-22");
  assert.equal(result.payload.assessments.length, 1, stderr);
  assert.equal(result.payload.summary.score, 100);

  result = await request(baseUrl, "/api/holdings", { method: "PUT", body: JSON.stringify({ holdings: [{ code: "000001", name: "测试持仓", market: "SZ", quantity: 100, cost: 10 }], note: "AI持仓影响确认测试" }) });
  assert.equal(result.response.status, 200, stderr);
  assert.equal(result.payload.holdings.length, 1, stderr);

  const informationInput = {
    title: "国家级算力网络项目启动招标",
    summary: "官方原文明确项目范围、预算和投标截止时间。",
    sourceName: "测试政府部门",
    sourceUrl: "https://example.gov.cn/procurement/20260722",
    sourceType: "procurement_or_award",
    publishedAt: "2026-07-22T09:00:00+08:00",
    assetCodes: ["000001"],
    industryTags: ["光纤"]
  };
  result = await request(baseUrl, "/api/information-events/preview", { method: "POST", body: JSON.stringify({ input: informationInput }) });
  assert.equal(result.response.status, 200, stderr);
  assert.equal(result.payload.duplicateId, null);
  assert.ok(result.payload.event.originalHash);
  result = await request(baseUrl, "/api/information-events", { method: "POST", body: JSON.stringify({ input: informationInput }) });
  assert.equal(result.response.status, 400, stderr);
  result = await request(baseUrl, "/api/information-events", { method: "POST", body: JSON.stringify({ input: informationInput, confirmed: true }) });
  assert.equal(result.response.status, 201, stderr);
  const informationEventId = result.payload.event.id;
  result = await request(baseUrl, "/api/information-events", { method: "POST", body: JSON.stringify({ input: informationInput, confirmed: true }) });
  assert.equal(result.response.status, 200, stderr);
  assert.equal(result.payload.duplicate, true);
  assert.equal(result.payload.event.id, informationEventId);

  result = await request(baseUrl, "/api/information-processing/instructions");
  assert.equal(result.response.status, 200, stderr);
  assert.equal(result.payload.ruleVersion, "information-ranking/v1.2.0");
  assert.ok(result.payload.resultSchema.required.includes("attentionPriorityScore"));
  assert.ok(result.payload.resultSchema.required.includes("holdingRelevance"));
  result = await request(baseUrl, "/api/information-processing/pending?limit=10");
  assert.equal(result.response.status, 200, stderr);
  assert.equal(result.payload.items.length, 1);
  result = await request(baseUrl, "/api/information-processing/runs", { method: "POST", body: JSON.stringify({ processor: "test-agent", limit: 10 }) });
  assert.equal(result.response.status, 400, stderr);
  result = await request(baseUrl, "/api/information-processing/runs", { method: "POST", body: JSON.stringify({ confirmed: true, processor: "test-agent", limit: 10 }) });
  assert.equal(result.response.status, 201, stderr);
  const processingRunId = result.payload.run.id;
  const processingItem = result.payload.task.items[0];
  const processingResult = {
    eventId: processingItem.eventId,
    inputHash: processingItem.inputHash,
    shortSummary: "国家级算力网络项目明确了范围、预算和投标时间。",
    keyFacts: ["项目范围明确", "预算明确", "投标时间明确"],
    topicTags: ["政策", "招投标"],
    industryTags: ["光纤"],
    assetCodes: ["000001"],
    eventType: "项目招标",
    direction: "positive",
    attentionPriorityScore: 88,
    eventStrength: 84,
    assetImpacts: [{ assetCode: "000001", score: 35, reason: "存在需求传导，但尚未确认公司中标。" }],
    holdingRelevance: [{
      assetCode: "000001",
      assetName: "测试持仓",
      relation: "direct",
      direction: "positive",
      relevanceScore: 88,
      impactScore: 58,
      impactTimeframe: "short_term",
      assessmentStatus: "provisional",
      confidence: 0.7,
      reason: "项目需求与持仓公司业务直接相关，但尚未确认中标。",
      transmissionPath: ["国家级项目招标", "光纤需求增加", "持仓公司潜在订单"],
      keyEvidence: ["项目范围、预算和投标时间已经明确"],
      missingEvidence: ["尚缺公司中标公告和收入占比"],
      evidenceBasis: "article_explicit"
    }],
    rankingReason: "国家级项目且预算、时间和范围明确，应优先阅读。",
    confidence: 0.81
  };
  result = await request(baseUrl, "/api/information-processing/results", { method: "POST", body: JSON.stringify({ confirmed: true, runId: processingRunId, processor: "test-agent", ruleVersion: "information-ranking/v1.2.0", results: [{ ...processingResult, inputHash: "0".repeat(64) }], failures: [] }) });
  assert.equal(result.response.status, 400, stderr);
  result = await request(baseUrl, "/api/information-processing/results", { method: "POST", body: JSON.stringify({ confirmed: true, runId: processingRunId, processor: "test-agent", ruleVersion: "information-ranking/v1.2.0", results: [processingResult], failures: [] }) });
  assert.equal(result.response.status, 200, stderr);
  assert.equal(result.payload.run.status, "completed");
  assert.equal(result.payload.acceptedCount, 1);
  result = await request(baseUrl, `/api/information-processing/runs/${encodeURIComponent(processingRunId)}`);
  assert.equal(result.response.status, 200, stderr);
  assert.equal(result.payload.run.completedCount, 1);
  result = await request(baseUrl, "/api/information-processing/pending?limit=10");
  assert.equal(result.payload.counts.completed, 1, stderr);
  assert.equal(result.payload.items.length, 0, stderr);
  result = await request(baseUrl, "/api/information-events");
  assert.equal(result.payload.events[0].aiProcessingStatus, "completed", stderr);
  assert.equal(result.payload.events[0].aiEnrichment.attentionPriorityScore, 88, stderr);
  assert.equal(result.payload.events[0].aiEnrichment.holdingRelevance[0].requiresUserConfirmation, true, stderr);
  result = await request(baseUrl, `/api/information-events/${encodeURIComponent(informationEventId)}/holding-impact-confirmations`, { method: "POST", body: JSON.stringify({ assetCode: "000001", decision: "confirmed" }) });
  assert.equal(result.response.status, 400, stderr);
  result = await request(baseUrl, `/api/information-events/${encodeURIComponent(informationEventId)}/holding-impact-confirmations`, { method: "POST", body: JSON.stringify({ confirmed: true, assetCode: "000001", decision: "confirmed" }) });
  assert.equal(result.response.status, 201, stderr);
  assert.equal(result.payload.confirmation.decision, "confirmed", stderr);
  result = await request(baseUrl, `/api/information-events/${encodeURIComponent(informationEventId)}/holding-impact-confirmations`, { method: "POST", body: JSON.stringify({ confirmed: true, assetCode: "000001", decision: "confirmed" }) });
  assert.equal(result.response.status, 200, stderr);
  assert.equal(result.payload.duplicate, true, stderr);
  result = await request(baseUrl, "/api/store");
  assert.equal(result.payload.informationImpactConfirmations.length, 1, stderr);
  assert.equal(result.payload.informationEvidencePromotions.length, 1, stderr);
  assert.equal(result.payload.informationEvidencePromotions[0].confirmationId, result.payload.informationImpactConfirmations[0].id, stderr);
  assert.ok(result.payload.evidenceRecords.some(item => item.id === result.payload.informationEvidencePromotions[0].factEvidenceId), stderr);
  assert.ok(result.payload.evidenceRecords.some(item => item.id === result.payload.informationEvidencePromotions[0].analysisEvidenceId), stderr);
  assert.ok(result.payload.assets.some(item => item.id === "CN:SZ:000001"), stderr);
  result = await request(baseUrl, "/api/storage/status");
  assert.equal(result.response.status, 200, stderr);
  assert.ok(result.payload.collectionRecordCount > 0, stderr);
  assert.ok(result.payload.stateVersionCount <= 24, stderr);

  const blockedContentInput = {
    title: "本地地址安全测试",
    summary: "该条目用于确认原文抓取器不会访问本机或内网。",
    sourceName: "测试来源",
    sourceUrl: "http://127.0.0.1/private",
    sourceType: "anonymous",
    publishedAt: "2026-07-21T09:00:00+08:00"
  };
  result = await request(baseUrl, "/api/information-events", { method: "POST", body: JSON.stringify({ input: blockedContentInput, confirmed: true }) });
  assert.equal(result.response.status, 201, stderr);
  const blockedContentEventId = result.payload.event.id;
  result = await request(baseUrl, "/api/information-content/run", { method: "POST", body: JSON.stringify({ eventId: blockedContentEventId, confirmed: true }) });
  assert.equal(result.response.status, 200, stderr);
  assert.equal(result.payload.run.failedCount, 1, stderr);
  result = await request(baseUrl, `/api/information-content/${encodeURIComponent(blockedContentEventId)}`);
  assert.equal(result.response.status, 200, stderr);
  assert.equal(result.payload.status, "failed", stderr);
  assert.match(result.payload.content.error, /本机或内网/);

  const influenceInput = {
    eventId: informationEventId,
    assetCode: "000001",
    source: { type: "regulator_or_government" },
    information: { credibility: 5, originalAvailable: true, independentCorroborationCount: 1 },
    event: { direction: 1, authority: 5, enforceability: 5, specificity: 4, budget: 4, novelty: 4, scope: 4, duration: 4, timing: 4 },
    market: { pricedIn: 1 },
    transmission: REQUIRED_TRANSMISSION_STAGES.map(key => ({ key, score: 4, critical: true, evidenceRefs: [`E-${key}`] }))
  };
  result = await request(baseUrl, "/api/influence-assessments", { method: "POST", body: JSON.stringify({ input: influenceInput, confirmed: true }) });
  assert.equal(result.response.status, 201, stderr);
  assert.ok(result.payload.assessment.result.companyImpactScore > 0);
  result = await request(baseUrl, `/api/information-events?assetCode=000001`);
  assert.equal(result.payload.events.length, 1, stderr);
  assert.equal(result.payload.events[0].status, "assessing");
  assert.equal(result.payload.events[0].assessmentIds.length, 1);
  result = await request(baseUrl, `/api/information-events/${encodeURIComponent(informationEventId)}/status`, { method: "PUT", body: JSON.stringify({ status: "reviewed" }) });
  assert.equal(result.response.status, 200, stderr);
  assert.equal(result.payload.event.status, "reviewed");

  const probabilityInput = {
    asOf: "2026-07-22T15:30:00+08:00",
    asset: { code: "000001" },
    horizon: "5d",
    outcomeDefinition: { benchmark: "000300", bull: "excess_return > 2%", bear: "excess_return < -2%" },
    signals: [{ name: "相对强度", direction: 0.6, reliability: 0.8, weight: 1, evidenceRefs: ["market-close-2026-07-22"] }],
    probabilities: { bull: 0.5, base: 0.3, bear: 0.2 },
    calibration: { modelId: "model-a", resolvedSampleSize: 50, brierScore: 0.2, baselineBrierScore: 0.22 }
  };
  result = await request(baseUrl, "/api/probability-reports", { method: "POST", body: JSON.stringify({ input: probabilityInput, confirmed: true }) });
  assert.equal(result.response.status, 201, stderr);
  const reportId = result.payload.report.id;
  assert.deepEqual(result.payload.report.probabilities, probabilityInput.probabilities);

  result = await request(baseUrl, `/api/probability-reports/${encodeURIComponent(reportId)}/resolve`, {
    method: "POST",
    body: JSON.stringify({ confirmed: true, resolution: { actualOutcome: "bull", resolvedAt: "2026-07-29T15:00:00+08:00" } })
  });
  assert.equal(result.response.status, 201, stderr);
  assert.equal(result.payload.resolution.brierScore, 0.126667);

  result = await request(baseUrl, `/api/probability-reports/${encodeURIComponent(reportId)}/resolve`, {
    method: "POST",
    body: JSON.stringify({ confirmed: true, resolution: { actualOutcome: "base" } })
  });
  assert.equal(result.response.status, 400, stderr);
});

test("trade workflow keeps intraday scoring provisional and finalizes it after review", async t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "trade-discipline-flow-"));
  const port = 43000 + Math.floor(Math.random() * 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(ROOT, "server.js")], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), TRADE_DATA_DIR: path.join(tempRoot, "data"), TRADE_REPORT_DIR: path.join(tempRoot, "reports"), TRADE_AUTO_STOCK_REFRESH: "false" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk.toString(); });
  t.after(async () => {
    child.kill();
    await new Promise(resolve => child.once("exit", resolve));
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
  await waitForServer(baseUrl, child);
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  let result = await request(baseUrl, "/api/account", { method: "PUT", body: JSON.stringify({ availableCash: 10000, brokerTotalAssets: 10000, todayPnl: 0 }) });
  assert.equal(result.response.status, 200, stderr);
  result = await request(baseUrl, "/api/plans", { method: "PUT", body: JSON.stringify({
    planFormat: "v0.3", planForDate: today, status: "pending_confirmation", validFrom: `${today}T09:15`, validUntil: `${today}T15:30`, changeReason: "纪律流测试",
    rules: [{ code: "000001", name: "测试标的", direction: "long", triggerCondition: "价格与事实同时确认", allowedActions: "买入、减仓、退出", maxPositionPct: 50, maxRiskPct: 5, stopPrice: 9, exitCondition: "跌破9退出", invalidationCondition: "核心事实失效", defaultAction: "不新增风险", baseScenario: "等待确认", bullScenario: "确认后执行", bearScenario: "退出" }]
  }) });
  assert.equal(result.response.status, 200, stderr);
  const planId = result.payload.plan.id;
  result = await request(baseUrl, `/api/plans/${encodeURIComponent(planId)}/confirm`, { method: "POST", body: JSON.stringify({ reason: "已核对" }) });
  assert.equal(result.response.status, 200, stderr);

  const tradeInput = {
    date: today, time: "10:00:00", code: "000001", name: "测试标的", side: "BUY", quantity: 100, price: 10, fee: 5,
    reason: "价格与事实同时确认", ruleTrigger: "价格与事实同时确认", executionStatus: "followed", planFollowed: true,
    tradeIntent: "open", riskEffect: "increase", thesisStatus: "valid", trendState: "up", triggerSatisfied: true, withinTolerance: true,
    stopChange: "unchanged", factsLinked: true, newInfoVerified: false, emotionState: "calm"
  };
  result = await request(baseUrl, "/api/trades/discipline-preview", { method: "POST", body: JSON.stringify(tradeInput) });
  assert.equal(result.response.status, 200, stderr);
  assert.equal(result.payload.result.score, null);
  assert.ok(result.payload.result.missingRequired.includes("record.reviewComplete"));

  result = await request(baseUrl, "/api/trades", { method: "POST", body: JSON.stringify(tradeInput) });
  assert.equal(result.response.status, 201, stderr);
  assert.equal(result.payload.trade.riskEffect, "increase");
  assert.equal(result.payload.trade.thesisStatus, "valid");
  assert.equal(result.payload.disciplinePreview.assessmentStatus, "incomplete");
  const tradeId = result.payload.trade.id;

  result = await request(baseUrl, `/api/trades/${encodeURIComponent(tradeId)}/discipline-preview`, { method: "POST", body: JSON.stringify({ reviewComplete: true, reviewNote: "按成交当时事实复盘", correctionRule: "下次仍需先绑定触发条件" }) });
  assert.equal(result.response.status, 200, stderr);
  assert.ok(Number.isFinite(result.payload.result.score));
  const finalInput = result.payload.input;

  result = await request(baseUrl, "/api/discipline-assessments", { method: "POST", body: JSON.stringify({ input: finalInput, confirmed: true }) });
  assert.equal(result.response.status, 201, stderr);
  result = await request(baseUrl, "/api/dashboard");
  assert.equal(result.response.status, 200, stderr);
  assert.equal(result.payload.disciplineV2.pendingAssessmentCount, 0);
  assert.equal(result.payload.disciplineV2.assessedCount, 1);
  assert.ok(Number.isFinite(result.payload.disciplineV2.todayScore));
});
