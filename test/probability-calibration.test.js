"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { summarizeProbabilityCalibration } = require("../lib/probability-calibration");

test("calibration remains collecting before enough resolved forecasts", () => {
  const reports = [{ id: "r1", horizon: "5d", experimentalProbabilities: { bull: 0.5, base: 0.3, bear: 0.2 } }];
  const resolutions = [{ forecastId: "r1", actualOutcome: "bull", brierScore: 0.126667, resolvedAt: "2026-07-30" }];
  const summary = summarizeProbabilityCalibration(reports, resolutions, { horizon: "5d" });
  assert.equal(summary.status, "collecting");
  assert.equal(summary.resolvedSampleSize, 1);
  assert.equal(summary.remainingSampleSize, 29);
});

test("calibration only validates a sufficiently accurate and calibrated sample", () => {
  const reports = [];
  const resolutions = [];
  for (let index = 0; index < 30; index += 1) {
    reports.push({ id: `r${index}`, horizon: "5d", experimentalProbabilities: { bull: 0.8, base: 0.1, bear: 0.1 } });
    resolutions.push({ forecastId: `r${index}`, actualOutcome: "bull", brierScore: 0.01, resolvedAt: `2026-08-${String(index + 1).padStart(2, "0")}` });
  }
  const summary = summarizeProbabilityCalibration(reports, resolutions, { horizon: "5d" });
  assert.equal(summary.resolvedSampleSize, 30);
  assert.ok(summary.brierScore < summary.baselineBrierScore);
  assert.equal(summary.status, "collecting");
  assert.ok(summary.expectedCalibrationError > 0.15, "overconfident samples must not pass calibration");
});
