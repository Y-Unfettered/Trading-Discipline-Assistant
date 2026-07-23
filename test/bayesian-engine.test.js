"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildBayesianUpdate } = require("../lib/bayesian-engine");

test("positive reliable evidence raises bull posterior without claiming certainty", () => {
  const result = buildBayesianUpdate({
    prior: { bull: 0.3, base: 0.5, bear: 0.2 },
    signals: [{ name: "政策落地", direction: 1, reliability: 0.9, weight: 1, evidenceRefs: ["e1"] }]
  });
  assert.ok(result.posterior.bull > result.prior.bull);
  assert.ok(result.posterior.bull < 0.6);
  assert.equal(result.status, "experimental");
  assert.equal(result.trace.length, 1);
});

test("correlated reports from one event cluster count only once", () => {
  const result = buildBayesianUpdate({
    signals: [
      { name: "来源一", direction: 0.8, reliability: 0.8, eventClusterId: "cluster-1" },
      { name: "来源二", direction: 0.8, reliability: 0.7, eventClusterId: "cluster-1" },
      { name: "独立公司公告", direction: 0.5, reliability: 0.9, eventClusterId: "cluster-2" }
    ]
  });
  assert.equal(result.evidenceGroupCount, 2);
  assert.equal(result.ignoredCorrelatedCount, 1);
  assert.equal(result.trace.length, 2);
});
