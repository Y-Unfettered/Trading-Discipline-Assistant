"use strict";

const { BAYESIAN_MODEL_VERSION, buildBayesianUpdate } = require("./bayesian-engine");

const SCHEMA_VERSION = "probability-report/v1.1.0";
const OUTCOMES = ["bull", "base", "bear"];

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function normalizeProbabilities(probabilities = {}) {
  const values = OUTCOMES.map(key => Number(probabilities[key]));
  if (values.some(value => !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new Error("三种情景概率必须是 0 到 1 之间的数字");
  }
  const sum = values.reduce((total, value) => total + value, 0);
  if (Math.abs(sum - 1) > 0.0001) throw new Error("三种情景概率之和必须等于 1");
  return Object.fromEntries(OUTCOMES.map((key, index) => [key, round(values[index])]));
}

function evidenceWeights(signals = []) {
  const scores = { bull: 0, base: 0, bear: 0 };
  const reasons = { bull: [], base: [], bear: [] };
  for (const signal of signals) {
    const direction = Math.max(-1, Math.min(1, Number(signal.direction || 0)));
    const reliability = Math.max(0, Math.min(1, Number(signal.reliability || 0)));
    const weight = Math.max(0, Number(signal.weight || 1));
    const strength = Math.abs(direction) * reliability * weight;
    const bucket = direction > 0.15 ? "bull" : direction < -0.15 ? "bear" : "base";
    scores[bucket] += strength;
    reasons[bucket].push({ name: signal.name || "未命名信号", strength: round(strength), evidenceRefs: signal.evidenceRefs || [] });
  }
  const total = Object.values(scores).reduce((sum, value) => sum + value, 0);
  const relativeWeights = total
    ? Object.fromEntries(OUTCOMES.map(key => [key, round(scores[key] / total)]))
    : { bull: 1 / 3, base: 1 / 3, bear: 1 / 3 };
  return { relativeWeights, reasons };
}

function buildProbabilityReport(input = {}) {
  const evidence = evidenceWeights(input.signals || []);
  const bayesian = buildBayesianUpdate({ prior: input.prior, signals: input.signals || [] });
  const calibration = input.calibration || {};
  const eligible = Number(calibration.resolvedSampleSize || 0) >= 30
    && calibration.brierScore != null
    && calibration.baselineBrierScore != null
    && Number.isFinite(Number(calibration.brierScore))
    && Number.isFinite(Number(calibration.baselineBrierScore))
    && Number(calibration.brierScore) < Number(calibration.baselineBrierScore)
    && typeof calibration.modelId === "string"
    && calibration.modelId.length > 0;
  let probabilities = null;
  let calibrationStatus = "cold_start";
  const warnings = [];
  if (input.probabilities) {
    const normalized = normalizeProbabilities(input.probabilities);
    if (eligible) {
      probabilities = normalized;
      calibrationStatus = "validated";
    } else {
      warnings.push("样本量或样本外校准未达标，暂不把相对权重显示为概率。");
    }
  } else if (eligible) {
    probabilities = bayesian.posterior;
    calibrationStatus = "validated";
  }
  if (!input.outcomeDefinition?.benchmark || !input.outcomeDefinition?.bull || !input.outcomeDefinition?.bear) {
    warnings.push("缺少冻结的结果定义；该报告不能进入事后校准样本。");
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    asOf: input.asOf || null,
    asset: input.asset || null,
    horizon: input.horizon || null,
    outcomeDefinition: input.outcomeDefinition || null,
    evidenceWeights: evidence.relativeWeights,
    evidenceReasons: evidence.reasons,
    bayesian,
    experimentalProbabilities: bayesian.posterior,
    probabilities,
    calibrationStatus,
    calibration: {
      modelId: calibration.modelId || BAYESIAN_MODEL_VERSION,
      resolvedSampleSize: Number(calibration.resolvedSampleSize || 0),
      brierScore: calibration.brierScore != null && Number.isFinite(Number(calibration.brierScore)) ? Number(calibration.brierScore) : null,
      baselineBrierScore: calibration.baselineBrierScore != null && Number.isFinite(Number(calibration.baselineBrierScore)) ? Number(calibration.baselineBrierScore) : null
    },
    warnings,
    statement: probabilities
      ? "概率来自达到最低样本量且样本外 Brier 分优于基线的模型，仍不构成涨跌承诺。"
      : "当前仅展示证据相对权重，不展示未经校准的伪概率。"
  };
}

function multiclassBrier(probabilities, actualOutcome) {
  const normalized = normalizeProbabilities(probabilities);
  if (!OUTCOMES.includes(actualOutcome)) throw new Error("实际结果必须是 bull、base 或 bear");
  return round(OUTCOMES.reduce((sum, key) => {
    const observed = key === actualOutcome ? 1 : 0;
    return sum + (normalized[key] - observed) ** 2;
  }, 0) / OUTCOMES.length, 6);
}

function resolveForecast(forecast = {}, resolution = {}) {
  const resolvedProbabilities = forecast.probabilities || forecast.experimentalProbabilities || forecast.bayesian?.posterior;
  if (!resolvedProbabilities) throw new Error("报告没有可结算的冻结概率分布");
  if (!resolution.actualOutcome) throw new Error("缺少实际情景结果");
  return {
    schemaVersion: SCHEMA_VERSION,
    forecastId: forecast.id || null,
    resolvedAt: resolution.resolvedAt || new Date().toISOString(),
    actualOutcome: resolution.actualOutcome,
    actualData: resolution.actualData || null,
    brierScore: multiclassBrier(resolvedProbabilities, resolution.actualOutcome),
    probabilitySource: forecast.probabilities ? "validated" : "experimental_bayesian",
    resolvedProbabilities,
    outcomeDefinition: forecast.outcomeDefinition,
    immutableForecastAsOf: forecast.asOf
  };
}

module.exports = {
  SCHEMA_VERSION,
  OUTCOMES,
  buildProbabilityReport,
  multiclassBrier,
  resolveForecast
};
