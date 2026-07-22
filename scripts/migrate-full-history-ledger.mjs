import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");
const { rebuildLedgerProjection } = require("../lib/ledger");

const root = path.resolve(import.meta.dirname, "..");
const dataDir = path.join(root, "data");
const databaseFile = path.join(dataDir, "trade-discipline.sqlite");
const storeFile = path.join(dataDir, "store.json");
const backupDir = path.join(dataDir, "backups");
const database = new DatabaseSync(databaseFile);
const row = database.prepare("SELECT revision, payload FROM app_state WHERE id = 1").get();
if (!row) throw new Error("app_state is missing");
const store = JSON.parse(row.payload);
if (store.ledger?.mode === "full-history") {
  console.log("Ledger is already in full-history mode.");
  database.close();
  process.exit(0);
}

const before = {
  cash: Number(store.account?.availableCash || 0),
  holdings: (store.holdings || []).map(item => ({ code: String(item.code), quantity: Number(item.quantity), cost: Number(item.cost) }))
};
store.ledger ||= { version: 1, events: [] };
store.ledger.mode = "full-history";
store.ledger.baseline = { availableCash: 0, realizedPnl: 0, holdings: [], note: "账户事实由完整资金明细从零重放" };
rebuildLedgerProjection(store);

const after = {
  cash: Number(store.account.availableCash || 0),
  holdings: store.holdings.map(item => ({ code: String(item.code), quantity: Number(item.quantity), cost: Number(item.cost) }))
};
const close = (a, b, tolerance = 0.005) => Math.abs(Number(a) - Number(b)) <= tolerance;
const holdingsMatch = before.holdings.length === after.holdings.length && before.holdings.every(item => {
  const candidate = after.holdings.find(row => row.code === item.code);
  return candidate && close(candidate.quantity, item.quantity, 0.000001) && close(candidate.cost, item.cost, 0.000001);
});
if (!close(before.cash, after.cash) || !holdingsMatch) {
  throw new Error(`Full-history replay did not match current account: ${JSON.stringify({ before, after })}`);
}

const now = new Date().toISOString();
const stamp = now.replace(/[:.]/g, "-");
fs.mkdirSync(backupDir, { recursive: true });
fs.writeFileSync(path.join(backupDir, `${stamp}-before-full-history-ledger.json`), row.payload, "utf8");
store.auditLog ||= [];
store.auditLog.push({
  id: `audit-${Date.now()}`,
  type: "ledger-mode-migrated",
  mode: "full-history",
  sourceRows: Number(store.fundingLedger?.length || 0) + Number(store.trades?.length || 0),
  validation: { cashMatched: true, holdingsMatched: true },
  createdAt: now
});
store.updatedAt = now;
const payload = JSON.stringify(store);
const nextRevision = Number(row.revision) + 1;

database.exec("BEGIN IMMEDIATE");
try {
  database.prepare("UPDATE app_state SET revision = ?, payload = ?, updated_at = ? WHERE id = 1")
    .run(nextRevision, payload, now);
  database.prepare("INSERT INTO state_versions (revision, reason, payload, created_at) VALUES (?, ?, ?, ?)")
    .run(nextRevision, "full-history-ledger-migration", payload, now);
  database.exec("COMMIT");
} catch (error) {
  database.exec("ROLLBACK");
  throw error;
} finally {
  database.close();
}

const tmp = `${storeFile}.full-history.tmp`;
fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf8");
fs.renameSync(tmp, storeFile);
console.log(JSON.stringify({ revision: nextRevision, mode: store.ledger.mode, sourceRows: store.ledger.sourceRowCount, cash: store.account.availableCash, holdings: store.holdings }, null, 2));
