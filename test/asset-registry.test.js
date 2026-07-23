"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  backfillDecisionContexts,
  canonicalAssetId,
  decisionContextForTrade,
  ensureAssetRegistry
} = require("../lib/asset-registry");

test("one canonical A-share identity links holdings, evidence, plans and information", () => {
  const store = {
    assets: [],
    holdings: [{ code: "600000", market: "SH", name: "浦发银行", quantity: 100 }],
    plannedAssets: [{ code: "600000", name: "浦发银行" }],
    trades: [], evidenceRecords: [{ id: "e1", assetCode: "600000" }], companyRelations: [],
    influenceAssessments: [], informationImpactConfirmations: [], probabilityReports: [],
    plans: [{ id: "p1", version: 1, rules: [{ code: "600000", name: "浦发银行" }] }],
    planVersions: [], researchSnapshots: [],
    informationEvents: [{ id: "i1", assetCodes: ["600000"], aiEnrichment: { holdingRelevance: [{ assetCode: "600000", assetName: "浦发银行" }] } }]
  };
  ensureAssetRegistry(store, "2026-07-23T00:00:00Z");
  assert.equal(store.assets.length, 1);
  assert.equal(store.assets[0].id, "CN:SH:600000");
  assert.equal(store.evidenceRecords[0].assetId, store.assets[0].id);
  assert.deepEqual(store.informationEvents[0].assetIds, [store.assets[0].id]);
  assert.equal(store.plans[0].rules[0].assetId, store.assets[0].id);
  assert.equal(canonicalAssetId("920267", "BJ"), "CN:BJ:920267");
});

test("decision context freezes the plan, research and evidence lineage", () => {
  const store = {
    holdings: [{ code: "000001", assetId: "CN:SZ:000001", quantity: 200, cost: 10 }],
    informationImpactConfirmations: [{ id: "c1", assetCode: "000001", decision: "confirmed", confirmedAt: "2026-07-23T09:00:00Z" }]
  };
  const trade = { id: "t1", code: "000001", market: "SZ", assetId: "CN:SZ:000001", evidenceIds: ["e2"], createdAt: "2026-07-23T10:00:00Z" };
  const plan = { id: "p1", version: 2, contentHash: "hash", generatedFromResearchId: "r1", evidenceIds: ["e1"] };
  const context = decisionContextForTrade(store, trade, plan, { code: "000001" });
  assert.equal(context.planRef.version, 2);
  assert.deepEqual(context.researchRevisionIds, ["r1"]);
  assert.deepEqual(context.evidenceIds, ["e1", "e2"]);
  assert.deepEqual(context.informationImpactConfirmationIds, ["c1"]);
  const legacy = { ...store, trades: [trade], plans: [plan], planVersions: [{ ...plan, rules: [{ code: "000001" }] }] };
  trade.planId = "p1"; trade.planVersion = 2;
  backfillDecisionContexts(legacy);
  assert.equal(trade.decisionContext.captureMode, "legacy-backfill");
});
