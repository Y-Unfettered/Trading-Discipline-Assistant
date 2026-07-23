"use strict";

const BAYESIAN_MODEL_VERSION = "bayes-evidence/v1.0.0";
const OUTCOMES = ["bull", "base", "bear"];

function round(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function normalizeDistribution(value = {}) {
  const raw = OUTCOMES.map(key => Number(value[key]));
  const valid = raw.every(item => Number.isFinite(item) && item >= 0) && raw.some(item => item > 0);
  const values = valid ? raw : [1, 1, 1];
  const total = values.reduce((sum, item) => sum + item, 0);
  return Object.fromEntries(OUTCOMES.map((key, index) => [key, round(values[index] / total)]));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value)));
}

function heuristicLikelihoodRatios(signal = {}) {
  if (signal.likelihoodRatios && OUTCOMES.every(key => Number(signal.likelihoodRatios[key]) > 0)) {
    return Object.fromEntries(OUTCOMES.map(key => [key, clamp(signal.likelihoodRatios[key], 0.5, 2)]));
  }
  const direction = clamp(signal.direction || 0, -1, 1);
  const reliability = clamp(signal.reliability || 0, 0, 1);
  const weight = clamp(signal.weight == null ? 1 : signal.weight, 0, 2);
  // Conservative by design: one heuristic signal can change odds, but cannot
  // dominate a prior. Larger ratios must come from a calibrated model later.
  const effect = direction * reliability * weight * 0.6;
  return {
    bull: round(Math.exp(effect)),
    base: round(Math.exp(-Math.abs(effect) * 0.25)),
    bear: round(Math.exp(-effect))
  };
}

function correlationGroup(signal, index) {
  return String(signal.correlationGroup || signal.eventClusterId || signal.groupId || `independent-${index}`);
}

function informationStrength(ratios) {
  const logs = OUTCOMES.map(key => Math.log(Number(ratios[key]) || 1));
  return Math.max(...logs) - Math.min(...logs);
}

function buildBayesianUpdate(input = {}) {
  const prior = normalizeDistribution(input.prior);
  const grouped = new Map();
  (input.evidence || input.signals || []).forEach((signal, index) => {
    const ratios = heuristicLikelihoodRatios(signal);
    const entry = { signal, index, ratios, strength: informationStrength(ratios) };
    const key = correlationGroup(signal, index);
    if (!grouped.has(key) || grouped.get(key).strength < entry.strength) grouped.set(key, entry);
  });
  let logScores = Object.fromEntries(OUTCOMES.map(key => [key, Math.log(Math.max(prior[key], 1e-12))]));
  const trace = [];
  for (const [groupId, entry] of grouped) {
    const before = normalizeDistribution(Object.fromEntries(OUTCOMES.map(key => [key, Math.exp(logScores[key])])));
    for (const key of OUTCOMES) logScores[key] += Math.log(entry.ratios[key]);
    const after = normalizeDistribution(Object.fromEntries(OUTCOMES.map(key => [key, Math.exp(logScores[key])])));
    trace.push({
      groupId,
      signalName: entry.signal.name || "未命名证据",
      evidenceRefs: entry.signal.evidenceRefs || [],
      likelihoodRatios: entry.ratios,
      prior: before,
      posterior: after,
      heuristic: !entry.signal.likelihoodRatios
    });
  }
  const posterior = normalizeDistribution(Object.fromEntries(OUTCOMES.map(key => [key, Math.exp(logScores[key])])));
  const ignoredCorrelatedCount = Math.max(0, (input.evidence || input.signals || []).length - grouped.size);
  return {
    schemaVersion: BAYESIAN_MODEL_VERSION,
    status: "experimental",
    prior,
    posterior,
    trace,
    evidenceGroupCount: grouped.size,
    ignoredCorrelatedCount,
    warnings: [
      "当前似然比采用保守启发式映射，后续必须用已结算样本校准。",
      ...(ignoredCorrelatedCount ? [`已忽略 ${ignoredCorrelatedCount} 条同组重复证据，避免重复报道造成过度自信。`] : [])
    ]
  };
}

module.exports = {
  BAYESIAN_MODEL_VERSION,
  buildBayesianUpdate,
  heuristicLikelihoodRatios,
  normalizeDistribution
};
