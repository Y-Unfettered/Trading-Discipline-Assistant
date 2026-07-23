"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateDiscipline, summarizeDiscipline } = require("../lib/discipline-engine");
const { evaluateInfluence, REQUIRED_TRANSMISSION_STAGES } = require("../lib/influence-engine");
const { buildProbabilityReport, multiclassBrier, resolveForecast } = require("../lib/probability-engine");

function completeDisciplineInput(overrides = {}) {
  return {
    tradeId: "trade-1",
    date: "2026-07-22",
    assetCode: "000001",
    riskEffect: "increase",
    plan: { active: true, invalidated: false, triggerDefined: true, riskExitDefined: true },
    evidence: { reasonRecorded: true, factsLinked: true, thesisStated: true, thesisStatus: "valid", scenarioDefined: true },
    execution: { actionAllowed: true, triggerSatisfied: true, withinTolerance: true, timely: true },
    risk: { positionWithinLimit: true, tradeRiskWithinLimit: true, stopNotLoosened: true, dailyLimitRespected: true, loserRiskNotExpanded: true },
    adjustment: { deviationVerified: true, emotionControlled: true, noRevengeSequence: true, frequencyWithinRule: true },
    record: { tradeComplete: true, rationaleComplete: true, emotionComplete: true, reviewComplete: true },
    ...overrides
  };
}

function completeTransmission() {
  return REQUIRED_TRANSMISSION_STAGES.map(key => ({ key, score: 4, critical: ["budget_funded", "product_match", "company_eligibility", "economic_materiality"].includes(key), evidenceRefs: [`E-${key}`] }));
}

test("discipline score evaluates process and does not change with profit or loss", () => {
  const profitable = evaluateDiscipline(completeDisciplineInput({ outcome: { pnl: 1000 } }));
  const losing = evaluateDiscipline(completeDisciplineInput({ outcome: { pnl: -1000 } }));
  assert.equal(profitable.score, 100);
  assert.equal(losing.score, 100);
  assert.equal(profitable.outcomeAffectsDisciplineScore, false);
  assert.equal(losing.classification, "compliant");
});

test("hard risk violations cap the score even when other fields look complete", () => {
  const input = completeDisciplineInput();
  input.plan.active = false;
  const result = evaluateDiscipline(input);
  assert.equal(result.assessmentStatus, "final");
  assert.ok(result.score <= 39);
  assert.equal(result.classification, "critical_violation");
  assert.ok(result.events.some(event => event.code === "NO_ACTIVE_PLAN"));
});

test("missing critical records produce no fake final score", () => {
  const result = evaluateDiscipline({ riskEffect: "increase", record: { tradeComplete: true } });
  assert.equal(result.score, null);
  assert.equal(result.assessmentStatus, "incomplete");
  assert.ok(result.missingRequired.includes("plan.active"));
});

test("emergency pure de-risking is not treated as an ordinary plan violation", () => {
  const input = completeDisciplineInput({ riskEffect: "reduce", emergencyDeRisk: true });
  input.plan.active = false;
  input.execution.actionAllowed = false;
  input.execution.triggerSatisfied = false;
  const result = evaluateDiscipline(input);
  assert.ok(result.events.some(event => event.code === "EMERGENCY_DE_RISK"));
  assert.ok(!result.events.some(event => event.severity === "critical"));
});

test("discipline summary penalizes the worst decision and detects repeated events", () => {
  const good = evaluateDiscipline(completeDisciplineInput());
  const badInput = completeDisciplineInput();
  badInput.risk.positionWithinLimit = false;
  const bad = evaluateDiscipline(badInput);
  const summary = summarizeDiscipline([good, bad, bad]);
  assert.ok(summary.score < summary.weightedMean);
  assert.deepEqual(summary.repeatedEvents[0], { code: "POSITION_LIMIT_EXCEEDED", count: 2 });
});

test("influence engine requires a complete company transmission chain", () => {
  const base = {
    source: { type: "regulator_or_government" },
    information: { credibility: 5, originalAvailable: true, independentCorroborationCount: 1, contradiction: 0 },
    event: { direction: 1, authority: 5, enforceability: 5, specificity: 4, budget: 4, novelty: 4, scope: 4, duration: 4, timing: 4 },
    market: { pricedIn: 1 },
    transmission: completeTransmission()
  };
  const complete = evaluateInfluence(base);
  assert.equal(complete.status, "assessable");
  assert.ok(complete.companyImpactScore > 0);
  assert.equal(complete.scoreMeaning.includes("不是上涨或下跌概率"), true);

  const incomplete = evaluateInfluence({ ...base, transmission: base.transmission.filter(stage => stage.key !== "company_eligibility") });
  assert.equal(incomplete.status, "needs_research");
  assert.equal(incomplete.companyImpactScore, null);

  const missingEvidence = completeTransmission();
  missingEvidence.find(stage => stage.key === "company_eligibility").evidenceRefs = [];
  const unsupported = evaluateInfluence({ ...base, transmission: missingEvidence });
  assert.equal(unsupported.status, "needs_research");
  assert.equal(unsupported.companyImpactScore, null);
  assert.ok(unsupported.transmission.missingEvidence.includes("company_eligibility"));
});

test("a broken transmission stage rejects company impact", () => {
  const stages = completeTransmission();
  stages.find(stage => stage.key === "product_match").score = 0;
  const result = evaluateInfluence({
    source: { type: "exchange_filing" },
    information: { credibility: 5 },
    event: { direction: 1, authority: 5, enforceability: 5, specificity: 5, budget: 5, novelty: 5, scope: 5, duration: 5, timing: 5 },
    transmission: stages
  });
  assert.equal(result.status, "rejected_transmission");
  assert.equal(result.companyImpactScore, 0);
});

test("probability engine hides uncalibrated probabilities and scores validated forecasts", () => {
  const input = {
    asOf: "2026-07-22T15:30:00+08:00",
    asset: { code: "000001" },
    horizon: "5d",
    outcomeDefinition: { benchmark: "000300", bull: "excess_return > 2%", bear: "excess_return < -2%" },
    signals: [{ name: "相对强度", direction: 0.6, reliability: 0.8, weight: 1 }],
    probabilities: { bull: 0.5, base: 0.3, bear: 0.2 },
    calibration: { modelId: "model-a", resolvedSampleSize: 12, brierScore: 0.2, baselineBrierScore: 0.22 }
  };
  const cold = buildProbabilityReport(input);
  assert.equal(cold.probabilities, null);
  assert.equal(cold.calibrationStatus, "cold_start");

  const validated = buildProbabilityReport({ ...input, calibration: { ...input.calibration, resolvedSampleSize: 50 } });
  assert.deepEqual(validated.probabilities, input.probabilities);
  assert.equal(multiclassBrier(validated.probabilities, "bull"), 0.126667);
  const resolution = resolveForecast({ id: "forecast-1", ...validated }, { actualOutcome: "bull", resolvedAt: "2026-07-29T15:00:00+08:00" });
  assert.equal(resolution.forecastId, "forecast-1");
  assert.equal(resolution.brierScore, 0.126667);
});
