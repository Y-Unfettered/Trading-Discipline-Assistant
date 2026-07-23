"use strict";

const { BAYESIAN_MODEL_VERSION } = require("./bayesian-engine");

const UNIFORM_BASELINE_BRIER = 2 / 9;

function round(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function calibrationError(samples) {
  if (!samples.length) return null;
  const bins = new Map();
  for (const sample of samples) {
    const probabilities = sample.resolution.resolvedProbabilities || sample.report.probabilities || sample.report.experimentalProbabilities;
    if (!probabilities) continue;
    const entries = Object.entries(probabilities).sort((a, b) => Number(b[1]) - Number(a[1]));
    const confidence = Number(entries[0]?.[1] || 0);
    const correct = entries[0]?.[0] === sample.resolution.actualOutcome ? 1 : 0;
    const key = Math.min(9, Math.floor(confidence * 10));
    if (!bins.has(key)) bins.set(key, []);
    bins.get(key).push({ confidence, correct });
  }
  let weighted = 0;
  let count = 0;
  for (const rows of bins.values()) {
    const confidence = mean(rows.map(item => item.confidence));
    const accuracy = mean(rows.map(item => item.correct));
    weighted += Math.abs(confidence - accuracy) * rows.length;
    count += rows.length;
  }
  return count ? round(weighted / count) : null;
}

function summarizeProbabilityCalibration(reports = [], resolutions = [], filters = {}) {
  const reportById = new Map(reports.map(item => [item.id, item]));
  const samples = resolutions.map(resolution => ({ resolution, report: reportById.get(resolution.forecastId) }))
    .filter(item => item.report)
    .filter(item => !filters.horizon || item.report.horizon === filters.horizon)
    .filter(item => {
      const modelId = item.report.calibration?.modelId || item.report.bayesian?.schemaVersion || BAYESIAN_MODEL_VERSION;
      return !filters.modelId || modelId === filters.modelId;
    })
    .sort((a, b) => String(a.resolution.resolvedAt).localeCompare(String(b.resolution.resolvedAt)))
    .slice(-100);
  const brierValues = samples.map(item => Number(item.resolution.brierScore)).filter(Number.isFinite);
  const brierScore = mean(brierValues);
  const baselineBrierScore = samples.length
    ? mean(samples.map(item => Number(item.report.calibration?.baselineBrierScore)).filter(value => Number.isFinite(value) && value > 0)) ?? UNIFORM_BASELINE_BRIER
    : UNIFORM_BASELINE_BRIER;
  const expectedCalibrationError = calibrationError(samples);
  const eligible = samples.length >= 30
    && brierScore != null
    && brierScore < baselineBrierScore
    && expectedCalibrationError != null
    && expectedCalibrationError <= 0.15;
  return {
    schemaVersion: "probability-calibration/v1",
    modelId: filters.modelId || BAYESIAN_MODEL_VERSION,
    horizon: filters.horizon || null,
    resolvedSampleSize: samples.length,
    brierScore: brierScore == null ? null : round(brierScore),
    baselineBrierScore: round(baselineBrierScore),
    expectedCalibrationError,
    eligible,
    status: eligible ? "validated" : "collecting",
    minimumSampleSize: 30,
    remainingSampleSize: Math.max(0, 30 - samples.length)
  };
}

module.exports = {
  UNIFORM_BASELINE_BRIER,
  summarizeProbabilityCalibration
};
