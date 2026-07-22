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
const badTradeId = "1784513398556-6bfa6e3c4af958";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

fs.mkdirSync(backupDir, { recursive: true });
const database = new DatabaseSync(databaseFile);
const row = database.prepare("SELECT revision, payload FROM app_state WHERE id = 1").get();
if (!row) throw new Error("app_state is missing");
const store = JSON.parse(row.payload);
const trade = store.trades.find(item => String(item.id) === badTradeId);
if (!trade) throw new Error(`trade ${badTradeId} was not found`);
if (String(trade.code) === "002475" && trade.name === "立讯精密") {
  console.log("Trade data is already repaired.");
  process.exit(0);
}
if (String(trade.code) !== "002185" || trade.name !== "立讯精密" || Number(trade.quantity) !== 100) {
  throw new Error("The target trade no longer matches the known corrupted record; repair aborted.");
}

fs.writeFileSync(
  path.join(backupDir, `${stamp}-before-2026-07-20-trade-repair.json`),
  JSON.stringify(store, null, 2),
  "utf8"
);

const correctionEventId = `discipline-${Date.now()}-identity-correction`;
Object.assign(trade, {
  code: "002475",
  name: "立讯精密",
  market: "SZ",
  premarketPlanExists: false,
  planBeforeTrade: false,
  matchedRuleCode: null,
  disciplineEventIds: [correctionEventId],
  violations: ["无盘前计划", "当日交易次数偏多", "无覆盖该标的的生效计划", "用户标记为偏离计划"]
});

store.disciplineEvents = (store.disciplineEvents || []).filter(item => String(item.tradeId) !== badTradeId);
store.disciplineEvents.push({
  id: correctionEventId,
  tradeId: badTradeId,
  date: "2026-07-20",
  assetCode: "002475",
  planId: trade.planId || null,
  planVersion: trade.planVersion || null,
  code: "NO_CONFIRMED_PLAN",
  severity: "critical",
  title: "无覆盖该标的的生效计划",
  evidence: "当日生效计划未包含立讯精密（002475）；原记录误用了华天科技代码，现已校正。",
  plannedValue: "已确认计划",
  actualValue: "无",
  createdAt: new Date().toISOString()
});

const ledgerEvent = (store.ledger?.events || []).find(item => item.type === "TRADE_RECORDED" && String(item.tradeId) === badTradeId);
if (!ledgerEvent) throw new Error("The matching ledger event was not found");
ledgerEvent.trade = JSON.parse(JSON.stringify(trade));

store.account.todayPnl = null;
store.auditLog ||= [];
store.auditLog.push({
  id: `audit-${Date.now()}`,
  type: "trade-identity-corrected",
  tradeId: badTradeId,
  from: { code: "002185", name: "立讯精密" },
  to: { code: "002475", name: "立讯精密" },
  note: "依据用户确认：2026-07-20 华天科技与立讯精密各买入100股",
  createdAt: new Date().toISOString()
});

rebuildLedgerProjection(store);
store.schemaVersion = Math.max(4, Number(store.schemaVersion || 0));
store.updatedAt = new Date().toISOString();
const payload = JSON.stringify(store);
const nextRevision = Number(row.revision) + 1;

database.exec("BEGIN IMMEDIATE");
try {
  database.prepare("UPDATE app_state SET revision = ?, payload = ?, updated_at = ? WHERE id = 1")
    .run(nextRevision, payload, store.updatedAt);
  database.prepare("INSERT INTO state_versions (revision, reason, payload, created_at) VALUES (?, ?, ?, ?)")
    .run(nextRevision, "repair-2026-07-20-trade-identity", payload, store.updatedAt);
  database.exec("COMMIT");
} catch (error) {
  database.exec("ROLLBACK");
  throw error;
} finally {
  database.close();
}

const tmpStoreFile = `${storeFile}.repair.tmp`;
fs.writeFileSync(tmpStoreFile, JSON.stringify(store, null, 2), "utf8");
fs.renameSync(tmpStoreFile, storeFile);

const summary = {
  revision: nextRevision,
  availableCash: store.account.availableCash,
  holdings: store.holdings.map(({ code, name, quantity, cost, lastPrice }) => ({ code, name, quantity, cost, lastPrice })),
  marketValue: store.holdings.reduce((sum, item) => sum + Number(item.quantity) * Number(item.lastPrice), 0),
  totalAssets: store.account.availableCash + store.holdings.reduce((sum, item) => sum + Number(item.quantity) * Number(item.lastPrice), 0) + Number(store.account.pendingSettlementAdjustment || 0)
};
console.log(JSON.stringify(summary, null, 2));
