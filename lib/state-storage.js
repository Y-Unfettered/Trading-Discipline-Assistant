"use strict";

const crypto = require("node:crypto");

// Collections that grow continuously or are updated by background jobs live as
// individual SQLite records. The remaining small configuration/state envelope
// stays in app_state so older exports remain easy to understand and restore.
const EXTRACTED_COLLECTIONS = Object.freeze([
  "informationEvents",
  "informationCollectionRuns",
  "informationProcessingRuns",
  "informationContentRuns",
  "informationImpactConfirmations",
  "informationEventClusters",
  "informationEvidencePromotions",
  "influenceAssessments",
  "probabilityReports",
  "forecastResolutions",
  "auditLog"
]);

const COLLECTION_MARKER = "__extractedCollections";

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  }
  return value;
}

function hashPayload(payload) {
  return crypto.createHash("sha256").update(payload).digest("hex");
}

function recordKey(item, index) {
  const explicit = item && typeof item === "object"
    ? item.id || item.snapshotId || item.forecastId || item.runId
    : null;
  if (explicit) return String(explicit);
  return `generated-${index}-${hashPayload(JSON.stringify(stableValue(item))).slice(0, 24)}`;
}

function splitStoreCollections(store) {
  const core = JSON.parse(JSON.stringify(store));
  const collections = new Map();
  for (const name of EXTRACTED_COLLECTIONS) {
    const values = Array.isArray(core[name]) ? core[name] : [];
    collections.set(name, values.map((item, position) => {
      const payload = JSON.stringify(item);
      return {
        collection: name,
        recordKey: recordKey(item, position),
        position,
        payload,
        contentHash: hashPayload(payload)
      };
    }));
    delete core[name];
  }
  core[COLLECTION_MARKER] = [...EXTRACTED_COLLECTIONS];
  return { core, collections };
}

function hydrateStoreCollections(core, collectionRows = new Map()) {
  const store = JSON.parse(JSON.stringify(core || {}));
  const marker = Array.isArray(store[COLLECTION_MARKER]) ? store[COLLECTION_MARKER] : [];
  delete store[COLLECTION_MARKER];
  for (const name of marker) {
    const rows = collectionRows.get(name) || [];
    store[name] = [...rows]
      .sort((a, b) => Number(a.position) - Number(b.position))
      .map(row => JSON.parse(row.payload));
  }
  return store;
}

function shouldKeepStateSnapshot(revision, reason = "") {
  const important = /migration|restore|import|compact|reconciliation|baseline/i.test(String(reason));
  return important || Number(revision) <= 2 || Number(revision) % 25 === 0;
}

function isDestructiveBackupReason(reason = "") {
  return /restore|delete|prune|import|correction|reconciliation|baseline|compact|migration/i.test(String(reason));
}

function shouldCreateBackup({ reason = "", newestBackupAt = null, now = new Date(), intervalMs = 6 * 60 * 60 * 1000 } = {}) {
  if (isDestructiveBackupReason(reason)) return true;
  if (!newestBackupAt) return true;
  const newest = new Date(newestBackupAt).getTime();
  return !Number.isFinite(newest) || now.getTime() - newest >= intervalMs;
}

module.exports = {
  COLLECTION_MARKER,
  EXTRACTED_COLLECTIONS,
  hydrateStoreCollections,
  isDestructiveBackupReason,
  shouldCreateBackup,
  shouldKeepStateSnapshot,
  splitStoreCollections
};
