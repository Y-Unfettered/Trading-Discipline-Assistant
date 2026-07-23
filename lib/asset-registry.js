"use strict";

const ASSET_ID_VERSION = "asset-id/v1";
const DECISION_CONTEXT_VERSION = "trade-decision-context/v1";

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function normalizeMarket(market, code = "") {
  const value = clean(market).toUpperCase();
  if (["SH", "SSE", "XSHG"].includes(value)) return "SH";
  if (["SZ", "SZSE", "XSHE"].includes(value)) return "SZ";
  if (["BJ", "BSE", "XBEI"].includes(value)) return "BJ";
  if (/^[6894]/.test(clean(code))) return clean(code).startsWith("6") ? "SH" : "BJ";
  return "SZ";
}

function canonicalAssetId(code, market) {
  const normalizedCode = clean(code);
  if (!/^\d{6}$/.test(normalizedCode)) return null;
  return `CN:${normalizeMarket(market, normalizedCode)}:${normalizedCode}`;
}

function candidateOf(value = {}) {
  const code = clean(value.code || value.assetCode || value.asset?.code);
  const market = normalizeMarket(value.market || value.asset?.market, code);
  return {
    id: canonicalAssetId(code, market),
    code,
    market,
    name: clean(value.name || value.assetName || value.asset?.name)
  };
}

function ensureAssetRegistry(store, now = new Date().toISOString()) {
  store.assets ||= [];
  const registry = new Map();
  for (const item of store.assets) {
    const candidate = candidateOf(item);
    if (!candidate.id) continue;
    Object.assign(item, candidate, { id: candidate.id, schemaVersion: ASSET_ID_VERSION });
    registry.set(candidate.id, item);
  }

  const register = value => {
    const candidate = candidateOf(value);
    if (!candidate.id) return null;
    let asset = registry.get(candidate.id);
    if (!asset) {
      asset = { ...candidate, schemaVersion: ASSET_ID_VERSION, aliases: [], createdAt: now, updatedAt: now };
      store.assets.push(asset);
      registry.set(candidate.id, asset);
    } else if (!asset.name && candidate.name) {
      asset.name = candidate.name;
      asset.updatedAt = now;
    }
    return asset;
  };

  for (const item of [...(store.holdings || []), ...(store.plannedAssets || []), ...(store.trades || [])]) {
    const asset = register(item);
    if (asset) item.assetId = asset.id;
  }
  for (const evidence of store.evidenceRecords || []) {
    const asset = register(evidence);
    if (asset) evidence.assetId = asset.id;
  }
  for (const relation of store.companyRelations || []) {
    const asset = register(relation);
    if (asset) relation.assetId = asset.id;
  }
  for (const assessment of store.influenceAssessments || []) {
    const asset = register(assessment);
    if (asset) assessment.assetId = asset.id;
  }
  for (const confirmation of store.informationImpactConfirmations || []) {
    const asset = register(confirmation);
    if (asset) confirmation.assetId = asset.id;
  }
  for (const report of store.probabilityReports || []) {
    const asset = register(report.asset || report);
    if (asset) report.assetId = asset.id;
  }
  for (const plan of [...(store.plans || []), ...(store.planVersions || [])]) {
    for (const rule of plan.rules || []) {
      const asset = register(rule);
      if (asset) rule.assetId = asset.id;
    }
  }
  for (const research of store.researchSnapshots || []) {
    for (const item of research.holdingsTechnical || []) {
      const asset = register(item);
      if (asset) item.assetId = asset.id;
    }
  }
  for (const event of store.informationEvents || []) {
    const ids = [];
    for (const code of event.assetCodes || []) {
      const known = [...registry.values()].find(asset => asset.code === clean(code));
      const asset = known || register({ code });
      if (asset) ids.push(asset.id);
    }
    for (const link of event.aiEnrichment?.holdingRelevance || []) {
      const asset = register(link);
      if (asset) {
        link.assetId = asset.id;
        ids.push(asset.id);
      }
    }
    event.assetIds = [...new Set(ids)];
  }
  return store.assets;
}

function decisionContextForTrade(store, trade, plan = null, rule = null, options = {}) {
  const assetId = trade.assetId || canonicalAssetId(trade.code, trade.market);
  const evidenceIds = [...new Set([
    ...(plan?.evidenceIds || []),
    ...(trade.evidenceIds || [])
  ].filter(Boolean))];
  const researchRevisionIds = [...new Set([
    plan?.generatedFromResearchId,
    options.researchRevisionId
  ].filter(Boolean))];
  const confirmationIds = (store.informationImpactConfirmations || [])
    .filter(item => item.decision === "confirmed" && (item.assetId === assetId || String(item.assetCode) === String(trade.code)))
    .filter(item => !item.confirmedAt || !trade.createdAt || String(item.confirmedAt) <= String(trade.createdAt))
    .map(item => item.id);
  const holding = (store.holdings || []).find(item => item.assetId === assetId || String(item.code) === String(trade.code));
  return {
    schemaVersion: DECISION_CONTEXT_VERSION,
    capturedAt: options.capturedAt || trade.createdAt || new Date().toISOString(),
    captureMode: options.captureMode || "recorded-after-execution",
    assetId,
    planRef: plan ? {
      id: plan.id,
      version: plan.version,
      snapshotKey: plan.snapshotKey || `${plan.id}:v${plan.version}`,
      contentHash: plan.contentHash || trade.planHash || null,
      matchedRuleCode: rule?.code || trade.matchedRuleCode || null
    } : null,
    researchRevisionIds,
    evidenceIds,
    informationImpactConfirmationIds: confirmationIds,
    positionBefore: options.positionBefore || (holding ? {
      quantity: Number(holding.quantity || 0),
      cost: Number(holding.cost || 0),
      lastPrice: holding.lastPrice == null ? null : Number(holding.lastPrice)
    } : null),
    accountBefore: options.accountBefore || null
  };
}

function backfillDecisionContexts(store) {
  for (const trade of store.trades || []) {
    if (trade.decisionContext?.schemaVersion) continue;
    const plan = (store.planVersions || []).find(item => item.id === trade.planId && Number(item.version) === Number(trade.planVersion))
      || (store.plans || []).find(item => item.id === trade.planId && Number(item.version) === Number(trade.planVersion));
    const rule = (plan?.rules || []).find(item => String(item.code) === String(trade.code));
    trade.decisionContext = decisionContextForTrade(store, trade, plan, rule, {
      captureMode: "legacy-backfill",
      capturedAt: trade.createdAt
    });
  }
}

module.exports = {
  ASSET_ID_VERSION,
  DECISION_CONTEXT_VERSION,
  backfillDecisionContexts,
  canonicalAssetId,
  decisionContextForTrade,
  ensureAssetRegistry,
  normalizeMarket
};
