"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  COLLECTION_MARKER,
  EXTRACTED_COLLECTIONS,
  hydrateStoreCollections,
  shouldCreateBackup,
  shouldKeepStateSnapshot,
  splitStoreCollections
} = require("../lib/state-storage");

test("high-volume collections round-trip without remaining in the core state envelope", () => {
  const store = {
    schemaVersion: 4,
    account: { availableCash: 100 },
    informationEvents: [{ id: "event-1", title: "政策发布" }],
    informationImpactConfirmations: [],
    auditLog: [{ id: "audit-1", type: "test" }]
  };
  const split = splitStoreCollections(store);
  assert.equal(split.core.informationEvents, undefined);
  assert.deepEqual(split.core[COLLECTION_MARKER], EXTRACTED_COLLECTIONS);
  const rows = new Map([...split.collections].map(([name, values]) => [name, values.map(item => ({ position: item.position, payload: item.payload }))]));
  const hydrated = hydrateStoreCollections(split.core, rows);
  assert.deepEqual(hydrated.informationEvents, store.informationEvents);
  assert.deepEqual(hydrated.auditLog, store.auditLog);
  assert.deepEqual(hydrated.informationImpactConfirmations, []);
  assert.equal(hydrated.account.availableCash, 100);
});

test("state snapshots are periodic while destructive operations always create recovery points", () => {
  assert.equal(shouldKeepStateSnapshot(24, "ordinary-write"), false);
  assert.equal(shouldKeepStateSnapshot(25, "ordinary-write"), true);
  assert.equal(shouldKeepStateSnapshot(26, "backup-restore"), true);
  const now = new Date("2026-07-23T12:00:00Z");
  assert.equal(shouldCreateBackup({ reason: "ordinary-write", newestBackupAt: "2026-07-23T10:00:00Z", now }), false);
  assert.equal(shouldCreateBackup({ reason: "ordinary-write", newestBackupAt: "2026-07-23T05:00:00Z", now }), true);
  assert.equal(shouldCreateBackup({ reason: "trade-delete", newestBackupAt: "2026-07-23T11:59:00Z", now }), true);
});
