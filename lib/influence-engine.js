"use strict";

const RULEBOOK_VERSION = "influence/v1.0.0";

const SOURCE_DEFAULTS = {
  exchange_filing: 5,
  regulator_or_government: 5,
  procurement_or_award: 5,
  company_official: 4,
  audited_or_official_statistics: 5,
  established_media: 3.5,
  industry_media: 3,
  social_verified_identity: 2,
  social_unverified: 1,
  anonymous: 0.5
};

const EVENT_WEIGHTS = {
  authority: 0.15,
  enforceability: 0.2,
  specificity: 0.15,
  budget: 0.15,
  novelty: 0.1,
  scope: 0.08,
  duration: 0.07,
  timing: 0.1
};

const REQUIRED_TRANSMISSION_STAGES = [
  "demand_created",
  "budget_funded",
  "product_match",
  "procurement_route",
  "company_eligibility",
  "access_history",
  "capacity_delivery",
  "economic_materiality",
  "timing_recognition"
];

const CRITICAL_TRANSMISSION_STAGES = new Set([
  "demand_created",
  "budget_funded",
  "product_match",
  "procurement_route",
  "company_eligibility",
  "economic_materiality"
]);

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value)));
}

function five(value) {
  return clamp(value, 0, 5);
}

function weightedAverage(values, weights) {
  let total = 0;
  let weightTotal = 0;
  for (const [key, weight] of Object.entries(weights)) {
    if (values[key] == null) continue;
    total += five(values[key]) * weight;
    weightTotal += weight;
  }
  return weightTotal ? total / weightTotal : null;
}

function sourceAssessment(input = {}) {
  const reliability = input.source?.reliability == null
    ? SOURCE_DEFAULTS[input.source?.type] ?? 1
    : five(input.source.reliability);
  const credibility = input.information?.credibility == null ? null : five(input.information.credibility);
  const originalBonus = input.information?.originalAvailable === true ? 0.35 : 0;
  const independent = clamp(input.information?.independentCorroborationCount || 0, 0, 3);
  const corroborationBonus = independent * 0.2;
  if (credibility == null) return { reliability: reliability * 20, credibility: null, score: null };
  return {
    reliability: Math.round(reliability * 20),
    credibility: Math.round(credibility * 20),
    score: Math.round(clamp((reliability * 0.45 + credibility * 0.55 + originalBonus + corroborationBonus) / 5 * 100))
  };
}

function transmissionAssessment(stages = []) {
  const byKey = new Map(stages.map(stage => [stage.key, stage]));
  const missing = REQUIRED_TRANSMISSION_STAGES.filter(key => !byKey.has(key) || byKey.get(key).score == null);
  const criticalMissing = REQUIRED_TRANSMISSION_STAGES.filter(key => {
    if (!CRITICAL_TRANSMISSION_STAGES.has(key)) return false;
    const stage = byKey.get(key);
    return !stage || stage.score == null || !Array.isArray(stage.evidenceRefs) || !stage.evidenceRefs.some(Boolean);
  });
  const missingEvidence = REQUIRED_TRANSMISSION_STAGES.filter(key => {
    const stage = byKey.get(key);
    return stage?.score != null && (!Array.isArray(stage.evidenceRefs) || !stage.evidenceRefs.some(Boolean));
  });
  const contradicted = stages.filter(stage => stage.status === "contradicted" || Number(stage.score) === 0).map(stage => stage.key);
  const scored = stages.filter(stage => stage.score != null);
  let score = null;
  if (scored.length) {
    if (contradicted.length) score = 0;
    else {
      let weightedLog = 0;
      let totalWeight = 0;
      for (const stage of scored) {
        const weight = CRITICAL_TRANSMISSION_STAGES.has(stage.key) ? 2 : 1;
        const normalized = Math.max(0.05, five(stage.score) / 5);
        weightedLog += Math.log(normalized) * weight;
        totalWeight += weight;
      }
      score = Math.round(Math.exp(weightedLog / totalWeight) * 100);
    }
  }
  return {
    score,
    status: contradicted.length ? "broken" : (criticalMissing.length || missing.length ? "hypothesis" : "supported"),
    missingStages: missing,
    criticalMissing,
    missingEvidence,
    contradictedStages: contradicted,
    stages
  };
}

function priorityLabel(score) {
  if (score >= 70) return "P0_immediate_review";
  if (score >= 50) return "P1_review_today";
  if (score >= 30) return "P2_track";
  return "P3_archive";
}

function impactLabel(score) {
  const magnitude = Math.abs(score);
  if (magnitude >= 60) return "high";
  if (magnitude >= 35) return "medium";
  if (magnitude >= 15) return "low";
  return "weak_or_unproven";
}

function evaluateInfluence(input = {}) {
  const source = sourceAssessment(input);
  const eventMean = weightedAverage(input.event || {}, EVENT_WEIGHTS);
  const eventStrength = eventMean == null ? null : Math.round(eventMean / 5 * 100);
  const transmission = transmissionAssessment(input.transmission || []);
  const direction = [-1, 0, 1].includes(Number(input.event?.direction)) ? Number(input.event.direction) : 0;
  const pricedIn = five(input.market?.pricedIn ?? 0) / 5;
  const contradiction = five(input.information?.contradiction ?? 0) / 5;
  const timeDecay = clamp(input.event?.timeDecay ?? 100) / 100;
  const sourceFactor = source.score == null ? null : source.score / 100;
  const transmissionReady = transmission.status !== "hypothesis" && transmission.score != null;
  let companyImpactScore = null;
  if (sourceFactor != null && eventStrength != null && transmissionReady) {
    const raw = eventStrength * sourceFactor * (transmission.score / 100) * timeDecay * (1 - pricedIn * 0.6) * (1 - contradiction * 0.8);
    companyImpactScore = Math.round(raw * direction);
  }
  const attentionPriorityScore = source.score == null || eventStrength == null
    ? null
    : Math.round(eventStrength * 0.65 + source.score * 0.35);
  const requiredMissing = [];
  if (source.score == null) requiredMissing.push("information.credibility");
  if (eventStrength == null) requiredMissing.push("event materiality fields");
  requiredMissing.push(...transmission.criticalMissing.map(key => `transmission.${key}`));
  const status = transmission.status === "broken"
    ? "rejected_transmission"
    : requiredMissing.length || transmission.status === "hypothesis"
      ? "needs_research"
      : source.score < 60
        ? "weak_evidence"
        : "assessable";

  return {
    schemaVersion: RULEBOOK_VERSION,
    status,
    direction,
    source,
    eventStrength,
    transmission,
    attentionPriorityScore,
    attentionPriority: attentionPriorityScore == null ? "unscored" : priorityLabel(attentionPriorityScore),
    companyImpactScore,
    companyImpactLevel: companyImpactScore == null ? "unscored" : impactLabel(companyImpactScore),
    scoreMeaning: "影响分用于信息排序，不是上涨或下跌概率，也不直接生成买卖动作。",
    requiredMissing,
    nextVerification: transmission.contradictedStages.length
      ? `传导链在 ${transmission.contradictedStages.join(", ")} 处断裂。`
      : transmission.missingStages.length
        ? `继续核验：${transmission.missingStages.join(", ")}。`
        : "继续跟踪预算、招投标、合同、收入确认和市场计价变化。"
  };
}

module.exports = {
  RULEBOOK_VERSION,
  SOURCE_DEFAULTS,
  EVENT_WEIGHTS,
  REQUIRED_TRANSMISSION_STAGES,
  CRITICAL_TRANSMISSION_STAGES,
  evaluateInfluence
};
