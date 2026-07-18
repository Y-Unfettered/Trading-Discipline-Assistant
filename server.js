const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { DatabaseSync } = require("node:sqlite");
const {
  appendCashReconciliationEvent,
  appendFeeAdjustmentEvent,
  appendPositionReconciliationEvent,
  appendTradeEvent,
  ensureLedger,
  rebuildLedgerProjection
} = require("./lib/ledger");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = process.env.TRADE_DATA_DIR ? path.resolve(process.env.TRADE_DATA_DIR) : path.join(ROOT, "data");
const STORE_FILE = path.join(DATA_DIR, "store.json");
const DATABASE_FILE = path.join(DATA_DIR, "trade-discipline.sqlite");
const STOCK_CACHE_FILE = path.join(DATA_DIR, "stocks.json");
const A_SHARE_STOCKS_FILE = path.join(DATA_DIR, "a-share-stocks.json");
const REPORT_DIR = process.env.TRADE_REPORT_DIR ? path.resolve(process.env.TRADE_REPORT_DIR) : path.join(ROOT, "reports");
const BACKUP_DIR = path.join(DATA_DIR, "backups");
const VENDOR_FILES = {
  "/vendor/marked.js": path.join(ROOT, "node_modules", "marked", "lib", "marked.umd.js"),
  "/vendor/purify.js": path.join(ROOT, "node_modules", "dompurify", "dist", "purify.min.js")
};
const PORT = Number(process.env.PORT || 3768);
function findCodexCommand() {
  if (process.env.CODEX_CLI_PATH && fs.existsSync(process.env.CODEX_CLI_PATH)) {
    return process.env.CODEX_CLI_PATH;
  }
  if (process.platform !== "win32") return "codex";

  const appBin = path.join(process.env.LOCALAPPDATA || "", "OpenAI", "Codex", "bin");
  const candidates = [];
  const collect = directory => {
    if (!directory || !fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) collect(fullPath);
      else if (entry.name.toLowerCase() === "codex.exe") candidates.push(fullPath);
    }
  };
  collect(appBin);
  if (candidates.length) {
    return candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  }
  return path.join(process.env.APPDATA || "", "npm", "codex.cmd");
}

const CODEX_COMMAND = findCodexCommand();

for (const dir of [DATA_DIR, REPORT_DIR, BACKUP_DIR]) fs.mkdirSync(dir, { recursive: true });

const initialStore = {
  account: {
    initialCapital: 0,
    realizedPnl: 0,
    availableCash: 0,
    todayPnl: null,
    brokerTotalAssets: null,
    maxRiskPerTradePct: 0.8,
    maxDailyLossPct: 1.2,
    maxPositions: 3
  },
  holdings: [],
  trades: [],
  orders: [],
  dailySessions: {},
  analyses: []
};

function nextTradingDate(fromDate = new Date()) {
  const next = new Date(fromDate);
  do {
    next.setDate(next.getDate() + 1);
  } while ([0, 6].includes(next.getDay()));
  return localDateKey(next);
}

function migrateStore(store) {
  store.schemaVersion = Math.max(4, Number(store.schemaVersion || 0));
  store.account ||= {};
  store.holdings ||= [];
  store.trades ||= [];
  store.orders ||= [];
  store.dailySessions ||= {};
  store.analyses ||= [];
  store.plans ||= [];
  store.planVersions ||= [];
  store.marketCloses ||= {};
  store.auditLog ||= [];
  store.stockPnlSnapshots ||= [];
  store.researchSnapshots ||= [];
  store.plannedAssets ||= [];
  store.evidenceRecords ||= [];
  store.disciplineEvents ||= [];
  store.planConfirmations ||= [];
  store.onboarding ||= {
    version: "0.3.2",
    completedAt: null,
    dismissedAt: null
  };
  store.ledgerBaseline ||= {
    establishedAt: new Date().toISOString(),
    availableCash: Number(store.account.availableCash || 0),
    realizedPnl: Number(store.account.realizedPnl || 0),
    holdings: store.holdings.map(holding => ({ code: holding.code, quantity: holding.quantity, cost: holding.cost })),
    note: "V1迁移基线；此前历史成交不完整，从此版本起按流水和调整记录追踪"
  };
  store.settings ||= {
    autoCloseRefresh: true,
    closeRefreshTime: "15:35",
    closeRetryMinutes: [5, 30],
    backupRetention: 60
  };
  for (const [date, session] of Object.entries(store.dailySessions)) {
    if (!session?.premarket || store.plans.some(plan => plan.planForDate === date)) continue;
    store.plans.push({
      id: `legacy-plan-${date}`,
      planForDate: date,
      sourceReviewDate: null,
      status: date < localDateKey() ? "completed" : "active",
      version: 1,
      ...session.premarket,
      createdAt: session.premarket.completedAt || session.updatedAt || new Date().toISOString(),
      updatedAt: session.updatedAt || session.premarket.completedAt || new Date().toISOString()
    });
  }
  for (const [date, session] of Object.entries(store.dailySessions)) {
    if (!session?.postmarket?.completedAt) continue;
    store.plans.filter(plan => plan.planForDate === date && plan.status === "active").forEach(plan => {
      plan.status = "completed";
      plan.completedAt ||= session.postmarket.completedAt;
    });
  }
  for (const plan of store.plans) {
    const snapshotKey = `${plan.id}:v${Number(plan.version || 1)}`;
    if (store.planVersions.some(item => item.snapshotKey === snapshotKey)) continue;
    store.planVersions.push({
      ...JSON.parse(JSON.stringify(plan)),
      snapshotKey,
      snapshotId: `plan-version-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      savedAt: plan.updatedAt || plan.createdAt || new Date().toISOString()
    });
  }
  ensureLedger(store);
  return store;
}

let database = null;

function openDatabase() {
  if (database) return database;
  database = new DatabaseSync(DATABASE_FILE);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS app_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      revision INTEGER NOT NULL,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS state_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      revision INTEGER NOT NULL,
      reason TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  const existing = database.prepare("SELECT revision FROM app_state WHERE id = 1").get();
  if (!existing) {
    const seed = fs.existsSync(STORE_FILE)
      ? JSON.parse(fs.readFileSync(STORE_FILE, "utf8"))
      : JSON.parse(JSON.stringify(initialStore));
    const migrated = migrateStore(seed);
    const now = new Date().toISOString();
    database.prepare("INSERT INTO app_state (id, revision, payload, updated_at) VALUES (1, 1, ?, ?)")
      .run(JSON.stringify(migrated), now);
    database.prepare("INSERT INTO state_versions (revision, reason, payload, created_at) VALUES (1, 'v0.2-migration', ?, ?)")
      .run(JSON.stringify(migrated), now);
    attachRevision(migrated, 1);
    backupStore("before-v0.2-migration");
    const mirrorTmp = `${STORE_FILE}.tmp`;
    fs.writeFileSync(mirrorTmp, JSON.stringify(migrated, null, 2), "utf8");
    fs.renameSync(mirrorTmp, STORE_FILE);
    fs.writeFileSync(path.join(REPORT_DIR, "review-latest.json"), JSON.stringify(buildReviewPacket(migrated), null, 2), "utf8");
  }
  return database;
}

function attachRevision(store, revision) {
  Object.defineProperty(store, "__revision", {
    value: Number(revision),
    writable: true,
    configurable: true,
    enumerable: false
  });
  return store;
}

function loadStore() {
  const row = openDatabase().prepare("SELECT revision, payload FROM app_state WHERE id = 1").get();
  return attachRevision(migrateStore(JSON.parse(row.payload)), row.revision);
}

function backupStore(reason = "write") {
  if (!fs.existsSync(STORE_FILE)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeReason = String(reason).replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 40) || "write";
  const file = path.join(BACKUP_DIR, `${stamp}-${safeReason}.json`);
  fs.copyFileSync(STORE_FILE, file);
  fs.utimesSync(file, new Date(), new Date());
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(name => name.endsWith(".json"))
    .map(name => ({ name, file: path.join(BACKUP_DIR, name), mtime: Math.max(fs.statSync(path.join(BACKUP_DIR, name)).mtimeMs, fs.statSync(path.join(BACKUP_DIR, name)).birthtimeMs) }))
    .sort((a, b) => b.mtime - a.mtime);
  const retention = Number(loadStoreSafe()?.settings?.backupRetention || 60);
  files.slice(Math.max(10, retention)).forEach(item => fs.unlinkSync(item.file));
  return file;
}

function loadStoreSafe() {
  try { return JSON.parse(fs.readFileSync(STORE_FILE, "utf8")); } catch { return null; }
}

function saveStore(store, reason = "write") {
  backupStore(reason);
  rebuildLedgerProjection(store);
  store.schemaVersion = 3;
  store.updatedAt = new Date().toISOString();
  const db = openDatabase();
  const payload = JSON.stringify(store);
  db.exec("BEGIN IMMEDIATE");
  try {
    const current = db.prepare("SELECT revision FROM app_state WHERE id = 1").get();
    const expectedRevision = Number(store.__revision ?? current.revision);
    if (Number(current.revision) !== expectedRevision) {
      throw new Error("数据已被其他操作更新，请重新加载后再试");
    }
    const nextRevision = Number(current.revision) + 1;
    db.prepare("UPDATE app_state SET revision = ?, payload = ?, updated_at = ? WHERE id = 1")
      .run(nextRevision, payload, store.updatedAt);
    db.prepare("INSERT INTO state_versions (revision, reason, payload, created_at) VALUES (?, ?, ?, ?)")
      .run(nextRevision, String(reason), payload, store.updatedAt);
    db.prepare("DELETE FROM state_versions WHERE id NOT IN (SELECT id FROM state_versions ORDER BY id DESC LIMIT 180)").run();
    db.exec("COMMIT");
    attachRevision(store, nextRevision);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  const tmp = `${STORE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf8");
  fs.renameSync(tmp, STORE_FILE);
  try {
    fs.writeFileSync(path.join(REPORT_DIR, "review-latest.json"), JSON.stringify(buildReviewPacket(store), null, 2), "utf8");
  } catch (error) {
    console.warn("最新复盘包同步失败：", error.message);
  }
}

function loadStockCache() {
  if (!fs.existsSync(STOCK_CACHE_FILE)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(STOCK_CACHE_FILE, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function loadAshareStocks() {
  if (!fs.existsSync(A_SHARE_STOCKS_FILE)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(A_SHARE_STOCKS_FILE, "utf8").replace(/^\uFEFF/, ""));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveStockCache(stocks) {
  const unique = [...new Map(stocks.map(stock => [stock.code, stock])).values()]
    .sort((a, b) => a.code.localeCompare(b.code));
  fs.writeFileSync(STOCK_CACHE_FILE, JSON.stringify(unique, null, 2), "utf8");
}

function normalizeStockText(value) {
  return String(value || "").normalize("NFKC").replace(/\s+/g, "").trim();
}

function stockCatalog(store) {
  const holdings = store.holdings.map(({ code, name, market }) => ({
    code: String(code),
    name,
    market,
    source: "holding"
  }));
  const plannedAssets = (store.plannedAssets || []).map(({ code, name, market }) => ({
    code: String(code),
    name,
    market,
    source: "planned-asset"
  }));
  const aShareStocks = loadAshareStocks();
  return [...new Map(
    [...aShareStocks, ...plannedAssets, ...holdings].map(stock => [stock.code, stock])
  ).values()];
}

async function searchStocks(store, query) {
  const keyword = normalizeStockText(query);
  const local = stockCatalog(store)
    .map(stock => ({ ...stock, code: String(stock.code), name: normalizeStockText(stock.name) }))
    .filter(stock => stock.code.includes(keyword) || stock.name.toLowerCase().includes(keyword.toLowerCase()))
    .sort((a, b) => {
      const score = stock => {
        if (stock.name === keyword || stock.code === keyword) return 0;
        if (stock.name.startsWith(keyword) || stock.code.startsWith(keyword)) return 1;
        if (stock.source === "holding") return 2;
        return 3;
      };
      return score(a) - score(b) || a.code.localeCompare(b.code);
    });
  return keyword ? local.slice(0, 20) : [];
}

const PLAN_STATUSES = new Set(["draft", "pending_confirmation", "confirmed", "active", "adjusted", "invalidated", "completed", "archived"]);
const ASSET_STATUSES = new Set(["watching", "researching", "planning", "planned", "paused", "archived"]);
const EVIDENCE_KINDS = new Set(["fact", "analysis", "user_judgment"]);

function cleanText(value) {
  return String(value ?? "").trim();
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]))
  }
  return value;
}

function contentHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function planContent(plan) {
  const ignored = new Set(["id", "version", "status", "createdAt", "updatedAt", "confirmedAt", "completedAt", "invalidatedAt", "confirmationId", "contentHash"]);
  return Object.fromEntries(Object.entries(plan || {}).filter(([key]) => !ignored.has(key)));
}

function summarizePlanDiff(before, after) {
  const oldValue = planContent(before);
  const newValue = planContent(after);
  const labels = {
    planForDate: "适用日期", validFrom: "生效时间", validUntil: "失效时间", expectedReturn: "预期收益",
    userMarketView: "用户市场判断", systemMarketView: "系统市场整理", accountRules: "账户级限制",
    trainingFocus: "训练目标", rules: "标的规则", evidenceIds: "依据"
  };
  return [...new Set([...Object.keys(oldValue), ...Object.keys(newValue)])]
    .filter(key => JSON.stringify(stableValue(oldValue[key])) !== JSON.stringify(stableValue(newValue[key])))
    .map(key => labels[key] || key);
}

function normalizePlannedAsset(input, existing = {}) {
  const code = cleanText(input.code || existing.code);
  const name = cleanText(input.name || existing.name);
  if (!/^\d{6}$/.test(code)) throw new Error("计划标的代码必须是6位数字");
  if (!name) throw new Error("计划标的名称必须填写");
  const status = cleanText(input.status || existing.status || "watching");
  if (!ASSET_STATUSES.has(status)) throw new Error("计划标的状态不合法");
  const now = new Date().toISOString();
  return {
    ...existing,
    id: existing.id || `asset-${code}-${Date.now()}`,
    code,
    name,
    market: cleanText(input.market || existing.market || (code.startsWith("6") ? "SH" : "SZ")),
    status,
    expectedReturn: cleanText(input.expectedReturn),
    userMarketView: cleanText(input.userMarketView),
    fundamentalView: cleanText(input.fundamentalView),
    technicalView: cleanText(input.technicalView),
    volumePriceView: cleanText(input.volumePriceView),
    trendView: cleanText(input.trendView),
    industry: cleanText(input.industry),
    upstream: cleanText(input.upstream),
    downstream: cleanText(input.downstream),
    linkedIndicators: cleanText(input.linkedIndicators),
    notes: cleanText(input.notes),
    createdAt: existing.createdAt || now,
    updatedAt: now
  };
}

function normalizeEvidence(input, store) {
  const kind = cleanText(input.kind);
  if (!EVIDENCE_KINDS.has(kind)) throw new Error("证据类型必须是事实、分析或用户判断");
  const title = cleanText(input.title);
  const content = cleanText(input.content);
  if (!title || !content) throw new Error("证据标题和内容必须填写");
  const evidenceIds = Array.isArray(input.evidenceIds) ? [...new Set(input.evidenceIds.map(cleanText).filter(Boolean))] : [];
  const unknownEvidence = evidenceIds.filter(id => !store.evidenceRecords.some(item => item.id === id));
  if (unknownEvidence.length) throw new Error("分析引用了不存在的事实证据");
  if (kind === "fact" && (!cleanText(input.source) || !cleanText(input.publishedAt))) {
    throw new Error("事实卡必须填写来源和发布时间");
  }
  if (kind === "analysis" && !evidenceIds.length && cleanText(input.basis) !== "user_judgment") {
    throw new Error("分析卡必须引用事实，或明确选择基于用户判断");
  }
  if (input.correctsId && !store.evidenceRecords.some(item => item.id === input.correctsId)) throw new Error("被更正的证据不存在");
  const now = new Date().toISOString();
  const record = {
    id: `evidence-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    kind,
    title,
    content,
    assetCode: cleanText(input.assetCode),
    source: cleanText(input.source),
    sourceUrl: cleanText(input.sourceUrl),
    publishedAt: cleanText(input.publishedAt),
    capturedAt: now,
    evidenceIds,
    basis: cleanText(input.basis),
    confidence: cleanText(input.confidence || "medium"),
    correctsId: cleanText(input.correctsId) || null,
    createdAt: now
  };
  record.contentHash = contentHash(record);
  return record;
}

function planRuleErrors(rule) {
  const missing = [];
  const requireText = (field, label) => { if (!cleanText(rule[field])) missing.push(label); };
  requireText("direction", "方向");
  requireText("triggerCondition", "触发条件");
  requireText("allowedActions", "允许动作");
  if (!Number.isFinite(Number(rule.maxPositionPct)) || Number(rule.maxPositionPct) <= 0) missing.push("最大仓位");
  if (!Number.isFinite(Number(rule.maxRiskPct)) || Number(rule.maxRiskPct) <= 0) missing.push("单笔最大风险");
  requireText("exitCondition", "退出条件");
  requireText("forbidden", "禁止事项");
  requireText("invalidationCondition", "失效条件");
  requireText("defaultAction", "信息不足默认动作");
  for (const [field, label] of [["baseScenario", "基准情景"], ["bullScenario", "乐观情景"], ["bearScenario", "悲观情景"]]) requireText(field, label);
  return missing;
}

function validatePlanForConfirmation(plan) {
  const errors = [];
  if (!cleanText(plan.planForDate)) errors.push("适用交易日");
  if (!cleanText(plan.validFrom)) errors.push("生效时间");
  if (!cleanText(plan.validUntil)) errors.push("失效时间");
  if (!cleanText(plan.accountRules)) errors.push("账户级限制");
  if (!Array.isArray(plan.rules) || !plan.rules.length) errors.push("至少一个标的规则");
  for (const rule of plan.rules || []) {
    const missing = planRuleErrors(rule);
    if (missing.length) errors.push(`${rule.name || rule.code || "标的"}：${missing.join("、")}`);
  }
  if (errors.length) throw new Error(`计划尚不能确认，缺少：${errors.join("；")}`);
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function json(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 5_000_000) reject(new Error("请求内容过大"));
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("JSON格式错误"));
      }
    });
    req.on("error", reject);
  });
}

function normalizeTrade(input) {
  const side = String(input.side || "").toUpperCase();
  if (!["BUY", "SELL"].includes(side)) throw new Error("交易方向必须是BUY或SELL");
  const quantity = Number(input.quantity);
  const price = Number(input.price);
  const code = String(input.code || "").trim();
  if (!/^\d{6}$/.test(code)) throw new Error("证券代码必须是6位数字");
  if (!Number.isInteger(quantity) || !(quantity > 0) || !Number.isFinite(price) || !(price > 0)) throw new Error("数量必须是正整数，价格必须大于0");
  if (input.fee !== "" && input.fee != null && (!Number.isFinite(Number(input.fee)) || Number(input.fee) < 0)) throw new Error("费用必须是大于或等于0的数字");
  return {
    id: input.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    date: input.date || localDateKey(),
    time: input.time || new Date().toTimeString().slice(0, 5),
    code,
    name: String(input.name || "").trim(),
    market: String(input.market || (String(input.code || "").startsWith("6") ? "SH" : "SZ")),
    side,
    quantity,
    price,
    fee: input.fee === "" || input.fee == null ? null : Number(input.fee),
    reason: String(input.reason || "").trim(),
    ruleTrigger: String(input.ruleTrigger || "").trim(),
    adjustmentReason: String(input.adjustmentReason || "").trim(),
    premarketPlanExists: Boolean(input.premarketPlanExists),
    planFollowed: Boolean(input.planFollowed ?? input.planBeforeTrade),
    planBeforeTrade: Boolean(input.premarketPlanExists),
    executionStatus: ["followed", "delayed", "unplanned"].includes(input.executionStatus) ? input.executionStatus : (input.planFollowed ? "followed" : "unplanned"),
    emotion: String(input.emotion || "").trim(),
    planId: input.planId || null,
    planVersion: input.planVersion == null ? null : Number(input.planVersion),
    planSnapshotKey: input.planSnapshotKey || null,
    planHash: input.planHash || null,
    matchedRuleCode: input.matchedRuleCode || null,
    createdAt: new Date().toISOString()
  };
}

function parseCsvLine(line) {
  const cells = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"' && line[i + 1] === '"') {
      value += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(value.trim());
      value = "";
    } else {
      value += char;
    }
  }
  cells.push(value.trim());
  return cells;
}

function importCsv(store, csvText, updateHoldings = false) {
  const lines = String(csvText || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error("CSV至少需要标题行和一条成交记录");
  const headers = parseCsvLine(lines[0]);
  const aliases = {
    date: ["成交日期", "日期", "发生日期"],
    time: ["成交时间", "时间", "发生时间"],
    code: ["证券代码", "股票代码", "代码"],
    name: ["证券名称", "股票名称", "名称"],
    side: ["买卖标志", "操作", "方向", "委托类别"],
    quantity: ["成交数量", "数量", "成交股数"],
    price: ["成交价格", "成交均价", "价格"],
    fee: ["费用合计", "手续费", "佣金", "印花税及佣金"]
  };
  const indexOf = key => {
    const choices = aliases[key];
    return headers.findIndex(header => choices.some(alias => header.includes(alias)));
  };
  const indexes = Object.fromEntries(Object.keys(aliases).map(key => [key, indexOf(key)]));
  for (const required of ["code", "side", "quantity", "price"]) {
    if (indexes[required] < 0) throw new Error(`CSV中未识别到字段：${aliases[required].join("/")}`);
  }
  const imported = [];
  const skipped = [];
  for (let i = 1; i < lines.length; i += 1) {
    try {
      const cells = parseCsvLine(lines[i]);
      const sideText = cells[indexes.side] || "";
      const side = /买|证券买入/.test(sideText) ? "BUY" : /卖|证券卖出/.test(sideText) ? "SELL" : "";
      const rawDate = indexes.date >= 0 ? cells[indexes.date] : "";
      const dateDigits = rawDate.replace(/\D/g, "");
      const date = dateDigits.length === 8
        ? `${dateDigits.slice(0, 4)}-${dateDigits.slice(4, 6)}-${dateDigits.slice(6, 8)}`
        : rawDate;
      const trade = normalizeTrade({
        date: date || undefined,
        time: indexes.time >= 0 ? cells[indexes.time] : undefined,
        code: cells[indexes.code],
        name: indexes.name >= 0 ? cells[indexes.name] : "",
        side,
        quantity: Number(String(cells[indexes.quantity]).replace(/,/g, "")),
        price: Number(String(cells[indexes.price]).replace(/,/g, "")),
        fee: indexes.fee >= 0 && String(cells[indexes.fee] || "").trim() !== ""
          ? Math.abs(Number(String(cells[indexes.fee]).replace(/,/g, "")))
          : null,
        reason: "从券商成交CSV导入",
        planBeforeTrade: false
      });
      const duplicate = store.trades.some(t =>
        t.date === trade.date && t.time === trade.time && t.code === trade.code &&
        t.side === trade.side && t.quantity === trade.quantity && t.price === trade.price
      );
      if (duplicate) {
        skipped.push({ line: i + 1, reason: "疑似重复记录" });
        continue;
      }
      trade.violations = detectViolations(store, trade);
      trade.accountApplied = Boolean(updateHoldings);
      if (updateHoldings) {
        if (trade.side === "SELL") {
          const holding = store.holdings.find(item => item.code === trade.code);
          if (!holding || holding.quantity < trade.quantity) throw new Error("导入卖出数量超过当前持仓，未更新账本");
        }
      }
      store.trades.push(trade);
      if (updateHoldings) appendTradeEvent(store, trade);
      imported.push(trade);
    } catch (error) {
      skipped.push({ line: i + 1, reason: error.message });
    }
  }
  return { imported, skipped };
}

function detectViolations(store, trade) {
  const flags = [];
  if (!trade.premarketPlanExists) flags.push("无盘前计划");
  else if (!trade.planFollowed) flags.push("偏离盘前计划");
  if (trade.executionStatus === "delayed") flags.push("触发后延迟执行");
  if (!trade.reason) flags.push("未记录交易理由");
  if (/怕踏空|赶紧买|追回|后悔|回本/.test(`${trade.reason} ${trade.emotion}`)) {
    flags.push("疑似情绪交易/FOMO");
  }
  const sameDay = store.trades.filter(t => t.date === trade.date);
  if (sameDay.length >= 3) flags.push("当日交易次数偏多");
  const opposite = [...sameDay].reverse().find(t => t.code === trade.code && t.side !== trade.side);
  if (opposite) {
    const gapPct = Math.abs(trade.price - opposite.price) / opposite.price * 100;
    if (gapPct < 2) flags.push(`同日反向交易价差仅${gapPct.toFixed(2)}%`);
  }
  if (trade.side === "BUY") {
    const holding = store.holdings.find(h => h.code === trade.code);
    if (holding && trade.price < holding.cost && /补仓|摊低/.test(trade.reason)) {
      flags.push("亏损补仓");
    }
  }
  return flags;
}

function evaluateDiscipline(store, trade, plan, rule) {
  const events = [];
  const add = (code, severity, title, evidence, plannedValue = null, actualValue = null) => events.push({
    id: `discipline-${Date.now()}-${events.length}-${Math.random().toString(16).slice(2)}`,
    tradeId: trade.id,
    date: trade.date,
    assetCode: trade.code,
    planId: plan?.id || null,
    planVersion: plan?.version || null,
    code,
    severity,
    title,
    evidence,
    plannedValue,
    actualValue,
    createdAt: new Date().toISOString()
  });

  if (!plan || !rule) {
    add("NO_CONFIRMED_PLAN", "critical", "无计划新增风险", "成交发生时不存在覆盖该标的的已确认生效计划", "已确认计划", "无");
  } else {
    const allowed = cleanText(rule.allowedActions || `${rule.sell || ""} ${rule.stop || ""}`);
    const permitted = trade.side === "BUY" ? /买|建仓|加仓|BUY/i.test(allowed) : /卖|减仓|退出|止损|SELL/i.test(allowed);
    if (!permitted) add("ACTION_NOT_ALLOWED", "critical", "动作不在允许范围", `计划允许动作：${allowed || "未填写"}`, allowed || "未填写", trade.side);
    if (trade.executionStatus === "unplanned" || !trade.planFollowed) {
      add("PLAN_DEVIATION", "warning", "用户标记为偏离计划", cleanText(trade.adjustmentReason || trade.reason) || "未填写偏离理由");
    }
    if (!cleanText(trade.ruleTrigger)) add("TRIGGER_NOT_RECORDED", "warning", "未记录具体触发条件", "成交未绑定计划中的具体触发条件");

    if (trade.side === "BUY" && Number(rule.maxPositionPct) > 0) {
      const account = accountSummary(store);
      const holding = store.holdings.find(item => item.code === trade.code);
      const projectedValue = (Number(holding?.quantity || 0) + trade.quantity) * trade.price;
      const projectedPct = account.totalAssets > 0 ? projectedValue / account.totalAssets * 100 : 100;
      if (projectedPct > Number(rule.maxPositionPct) + 0.01) {
        add("MAX_POSITION_EXCEEDED", "critical", "超过最大仓位", `预计仓位 ${projectedPct.toFixed(2)}%，计划上限 ${Number(rule.maxPositionPct).toFixed(2)}%`, `${rule.maxPositionPct}%`, `${projectedPct.toFixed(2)}%`);
      }
      if (Number(rule.stopPrice) > 0 && Number(rule.maxRiskPct) > 0 && account.totalAssets > 0) {
        const riskPct = Math.max(0, trade.price - Number(rule.stopPrice)) * trade.quantity / account.totalAssets * 100;
        if (riskPct > Number(rule.maxRiskPct) + 0.001) {
          add("MAX_RISK_EXCEEDED", "critical", "超过单笔最大风险", `按止损价估算风险 ${riskPct.toFixed(2)}%，计划上限 ${Number(rule.maxRiskPct).toFixed(2)}%`, `${rule.maxRiskPct}%`, `${riskPct.toFixed(2)}%`);
        }
      }
    }
    if (trade.executionStatus === "delayed") add("DELAYED_EXECUTION", "warning", "触发后延迟执行", cleanText(trade.adjustmentReason || trade.reason) || "用户标记为延迟");
  }

  if (/怕踏空|赶紧买|追回|后悔|回本/.test(`${trade.reason} ${trade.emotion}`)) {
    add("EMOTIONAL_TRADE", "warning", "疑似情绪驱动交易", `${trade.reason} ${trade.emotion}`.trim());
  }
  return events;
}

function validateTradeForPosting(store, trade) {
  if (trade.side === "SELL") {
    const holding = store.holdings.find(item => item.code === trade.code);
    if (!holding || Number(holding.quantity) < Number(trade.quantity)) throw new Error("卖出数量不能超过当前持仓数量");
    return;
  }
  const fee = Number(trade.fee || 0);
  const requiredCash = Number(trade.price) * Number(trade.quantity) + fee;
  if (requiredCash > Number(store.account.availableCash || 0) + 0.005) throw new Error("可用现金不足，不能记录这笔买入");
  const isNewPosition = !store.holdings.some(item => item.code === trade.code);
  if (isNewPosition && store.holdings.length >= Number(store.account.maxPositions || Infinity)) throw new Error("已达到最大持仓数量，不能新增仓位");
  if (trade.date === localDateKey() && Number(store.account.todayPnl) < 0) {
    const summary = accountSummary(store);
    const lossLimit = summary.totalAssets * Number(store.account.maxDailyLossPct || 0) / 100;
    if (lossLimit > 0 && Math.abs(Number(store.account.todayPnl)) >= lossLimit) throw new Error("已达到当日亏损上限，停止新增风险");
  }
}

function applyTradeToHolding(store, trade, updateAccount = false) {
  let holding = store.holdings.find(h => h.code === trade.code);
  const fee = Number(trade.fee || 0);
  if (trade.side === "BUY") {
    if (updateAccount) {
      const cashEffect = -(trade.price * trade.quantity + fee);
      store.account.availableCash = +(Number(store.account.availableCash || 0) + cashEffect).toFixed(2);
      trade.cashEffect = +cashEffect.toFixed(2);
    }
    if (!holding) {
      holding = {
        id: trade.code,
        code: trade.code,
        name: trade.name || trade.code,
        market: trade.code.startsWith("6") ? "SH" : "SZ",
        quantity: 0,
        cost: 0,
        lastPrice: trade.price,
        stopPrice: 0,
        targetPrice: 0,
        thesis: ""
      };
      store.holdings.push(holding);
    }
    const oldAmount = holding.cost * holding.quantity;
    holding.quantity += trade.quantity;
    holding.cost = (oldAmount + trade.price * trade.quantity + trade.fee) / holding.quantity;
    holding.lastPrice = trade.price;
    holding.brokerPnl = null;
  } else if (holding) {
    if (updateAccount) {
      const cashEffect = trade.price * trade.quantity - fee;
      const realizedPnlEstimate = (trade.price - holding.cost) * trade.quantity - fee;
      store.account.availableCash = +(Number(store.account.availableCash || 0) + cashEffect).toFixed(2);
      store.account.realizedPnl = +(Number(store.account.realizedPnl || 0) + realizedPnlEstimate).toFixed(2);
      trade.cashEffect = +cashEffect.toFixed(2);
      trade.realizedPnlEstimate = +realizedPnlEstimate.toFixed(2);
      trade.feePending = trade.fee == null;
    }
    holding.quantity = Math.max(0, holding.quantity - trade.quantity);
    holding.lastPrice = trade.price;
    holding.brokerPnl = null;
    if (holding.quantity === 0) {
      store.holdings = store.holdings.filter(h => h.code !== trade.code);
    }
  }
}

function updateTradeFee(store, trade, nextFee) {
  if (!Number.isFinite(nextFee) || nextFee < 0) throw new Error("费用必须是大于或等于0的数字");
  const previousFee = trade.fee == null ? 0 : Number(trade.fee);
  const delta = +(nextFee - previousFee).toFixed(2);
  trade.fee = +nextFee.toFixed(2);
  trade.feePending = false;
  trade.feeUpdatedAt = new Date().toISOString();

  // 未知费用在首次记账时按0暂计；补录时只冲减费用差额。
  if (delta !== 0 && Number.isFinite(Number(trade.cashEffect))) {
    store.account.availableCash = +(Number(store.account.availableCash || 0) - delta).toFixed(2);
    if (Number(store.account.pendingSettlementAdjustment || 0) < 0 && delta > 0) {
      const absorbed = Math.min(delta, Math.abs(Number(store.account.pendingSettlementAdjustment)));
      store.account.pendingSettlementAdjustment = +(Number(store.account.pendingSettlementAdjustment) + absorbed).toFixed(2);
    }
    trade.cashEffect = +(Number(trade.cashEffect) - delta).toFixed(2);
    if (trade.side === "SELL") {
      store.account.realizedPnl = +(Number(store.account.realizedPnl || 0) - delta).toFixed(2);
      if (Number.isFinite(Number(trade.realizedPnlEstimate))) {
        trade.realizedPnlEstimate = +(Number(trade.realizedPnlEstimate) - delta).toFixed(2);
      }
    }
  }
  return trade;
}

function accountSummary(store) {
  const marketValue = +store.holdings.reduce((sum, holding) =>
    sum + Number(holding.quantity || 0) * Number(holding.lastPrice || 0), 0).toFixed(2);
  const availableCash = +Number(store.account.availableCash || 0).toFixed(2);
  const pendingSettlementAdjustment = +Number(store.account.pendingSettlementAdjustment || 0).toFixed(2);
  const totalAssets = +(availableCash + marketValue + pendingSettlementAdjustment).toFixed(2);
  const netContributions = +Number(store.account.netContributions ?? store.account.initialCapital ?? 0).toFixed(2);
  const cumulativePnl = +(totalAssets - netContributions).toFixed(2);
  const pendingFees = store.trades.filter(trade => trade.fee == null).map(trade => trade.id);
  const latestTrade = [...store.trades].sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))[0] || null;
  const latestCloseDate = Object.keys(store.marketCloses || {}).sort().pop() || null;
  return {
    asOf: new Date().toISOString(),
    availableCash,
    marketValue,
    totalAssets,
    grossTotalAssets: +(availableCash + marketValue).toFixed(2),
    pendingSettlementAdjustment,
    netContributions,
    cumulativePnl,
    cumulativeReturnPct: netContributions ? +(cumulativePnl / netContributions * 100).toFixed(2) : null,
    positionPct: totalAssets ? +(marketValue / totalAssets * 100).toFixed(2) : 0,
    brokerTotalAssets: store.account.brokerTotalAssets ?? null,
    brokerSnapshotAt: store.account.snapshotUpdatedAt || null,
    latestTradeAt: latestTrade ? `${latestTrade.date}T${latestTrade.time || "00:00"}:00+08:00` : null,
    latestCloseDate,
    pendingFees
  };
}

function dataHealth(store) {
  const issues = [];
  const summary = accountSummary(store);
  if (summary.pendingFees.length) issues.push({ type: "pending-fee", level: "warning", count: summary.pendingFees.length, message: `${summary.pendingFees.length}笔成交费用待补录` });
  if (summary.pendingSettlementAdjustment) issues.push({ type: "pending-settlement", level: "info", count: 1, message: `${Math.abs(summary.pendingSettlementAdjustment).toFixed(2)}元结算差额待分配到具体费用` });
  const staleQuotes = store.holdings.filter(holding => !holding.quoteUpdatedAt || Date.now() - new Date(holding.quoteUpdatedAt).getTime() > 36 * 60 * 60 * 1000);
  if (staleQuotes.length) issues.push({ type: "stale-quote", level: "warning", count: staleQuotes.length, message: `${staleQuotes.length}只持仓行情需要更新` });
  if (summary.brokerSnapshotAt && summary.latestTradeAt && new Date(summary.brokerSnapshotAt) < new Date(summary.latestTradeAt)) {
    issues.push({ type: "stale-broker-snapshot", level: "info", count: 1, message: "券商账户快照早于最新成交，暂不可对账" });
  }
  if (Number(store.account.availableCash || 0) < 0) issues.push({ type: "negative-cash", level: "error", count: 1, message: "可用现金为负数，请立即核对" });
  const summaryTotal = Number(summary.totalAssets || 0);
  const dailyLossLimit = summaryTotal * Number(store.account.maxDailyLossPct || 0) / 100;
  if (dailyLossLimit > 0 && Number(store.account.todayPnl) < 0 && Math.abs(Number(store.account.todayPnl)) >= dailyLossLimit) {
    issues.push({ type: "daily-loss-limit", level: "error", count: 1, message: "已达到当日亏损上限，停止新增风险" });
  }
  if (!store.ledger?.events) issues.push({ type: "ledger-missing", level: "error", count: 1, message: "可信账本尚未建立" });
  return { score: Math.max(0, 100 - issues.reduce((sum, issue) => sum + (issue.level === "error" ? 30 : issue.level === "warning" ? 10 : 3), 0)), issues };
}

function disciplineSummary(store, days = 7) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - Math.max(1, Number(days)) + 1);
  const cutoffDate = localDateKey(cutoff);
  const trades = store.trades.filter(trade => trade.date >= cutoffDate);
  const planned = trades.filter(trade => trade.premarketPlanExists === true);
  const unplanned = trades.filter(trade => trade.executionStatus === "unplanned" || trade.premarketPlanExists === false);
  const delayed = trades.filter(trade => trade.executionStatus === "delayed");
  const fees = trades.reduce((sum, trade) => sum + Number(trade.fee || 0), 0);
  let sameDayReversals = 0;
  const seen = new Set();
  for (const trade of [...trades].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))) {
    const key = `${trade.date}:${trade.code}`;
    if (seen.has(`${key}:${trade.side === "BUY" ? "SELL" : "BUY"}`)) sameDayReversals += 1;
    seen.add(`${key}:${trade.side}`);
  }
  return {
    days: Number(days),
    fromDate: cutoffDate,
    tradeCount: trades.length,
    plannedCount: planned.length,
    planFollowRate: planned.length ? +(planned.filter(trade => trade.planFollowed).length / planned.length * 100).toFixed(1) : null,
    unplannedCount: unplanned.length,
    delayedCount: delayed.length,
    sameDayReversals,
    fees: +fees.toFixed(2)
  };
}

function selectedPlan(store, requestedDate) {
  const plans = [...store.plans].sort((a, b) => `${b.planForDate} ${b.updatedAt || b.createdAt}`.localeCompare(`${a.planForDate} ${a.updatedAt || a.createdAt}`));
  if (requestedDate) return plans.find(plan => plan.planForDate === requestedDate) || null;
  const today = localDateKey();
  const todayPlan = plans.find(plan => plan.planForDate === today && ["active", "confirmed", "pending_confirmation", "draft"].includes(plan.status));
  if (todayPlan) return todayPlan;
  const future = plans.filter(plan => plan.planForDate > today && plan.status !== "archived").sort((a, b) => a.planForDate.localeCompare(b.planForDate))[0];
  return future || plans[0] || null;
}

function upsertPlan(store, input) {
  const planForDate = String(input.planForDate || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(planForDate)) throw new Error("计划必须指定适用交易日");
  let plan = input.forceNew
    ? null
    : input.id
      ? store.plans.find(item => item.id === input.id)
      : store.plans.find(item => item.planForDate === planForDate && item.status !== "archived");
  const now = new Date().toISOString();
  const previous = plan ? JSON.parse(JSON.stringify(plan)) : null;
  if (!plan) {
    plan = { id: `plan-${planForDate}-${Date.now()}`, planForDate, version: 1, createdAt: now };
    store.plans.push(plan);
  } else {
    plan.version = Number(plan.version || 0) + 1;
  }
  let requestedStatus = cleanText(input.status || plan.status || "draft");
  if (!PLAN_STATUSES.has(requestedStatus)) throw new Error("计划状态不合法");
  if (previous && ["active", "confirmed"].includes(previous.status)) requestedStatus = "pending_confirmation";
  const normalizedRules = (Array.isArray(input.rules) ? input.rules : []).map(rule => ({
    code: cleanText(rule.code),
    name: cleanText(rule.name),
    direction: cleanText(rule.direction),
    triggerCondition: cleanText(rule.triggerCondition || rule.wait),
    allowedActions: cleanText(rule.allowedActions),
    maxPositionPct: rule.maxPositionPct === "" || rule.maxPositionPct == null ? null : Number(rule.maxPositionPct),
    maxRiskPct: rule.maxRiskPct === "" || rule.maxRiskPct == null ? null : Number(rule.maxRiskPct),
    stopPrice: rule.stopPrice === "" || rule.stopPrice == null ? null : Number(rule.stopPrice),
    reduceCondition: cleanText(rule.reduceCondition || rule.sell),
    exitCondition: cleanText(rule.exitCondition || rule.stop),
    forbidden: cleanText(rule.forbidden),
    invalidationCondition: cleanText(rule.invalidationCondition),
    defaultAction: cleanText(rule.defaultAction),
    flexibleRange: cleanText(rule.flexibleRange),
    baseScenario: cleanText(rule.baseScenario),
    bullScenario: cleanText(rule.bullScenario),
    bearScenario: cleanText(rule.bearScenario),
    wait: cleanText(rule.triggerCondition || rule.wait),
    sell: cleanText(rule.reduceCondition || rule.sell),
    stop: cleanText(rule.exitCondition || rule.stop)
  }));
  Object.assign(plan, {
    planForDate,
    sourceReviewDate: input.sourceReviewDate || plan.sourceReviewDate || null,
    planFormat: cleanText(input.planFormat || plan.planFormat || "legacy"),
    status: requestedStatus,
    validFrom: cleanText(input.validFrom || plan.validFrom || `${planForDate}T09:15`),
    validUntil: cleanText(input.validUntil || plan.validUntil || `${planForDate}T15:30`),
    expectedReturn: cleanText(input.expectedReturn),
    userMarketView: cleanText(input.userMarketView),
    systemMarketView: cleanText(input.systemMarketView),
    previousAdvice: cleanText(input.previousAdvice),
    marketObservation: cleanText(input.marketObservation),
    accountRules: cleanText(input.accountRules),
    trainingFocus: cleanText(input.trainingFocus),
    changeReason: cleanText(input.changeReason),
    evidenceIds: Array.isArray(input.evidenceIds) ? [...new Set(input.evidenceIds.map(cleanText).filter(Boolean))] : [],
    rules: normalizedRules,
    generatedFromResearchId: input.generatedFromResearchId || plan.generatedFromResearchId || null,
    generationBasis: input.generationBasis || plan.generationBasis || null,
    confirmedAt: requestedStatus === "active" && !previous ? now : plan.confirmedAt || null,
    updatedAt: now
  });
  plan.diffSummary = previous ? summarizePlanDiff(previous, plan) : ["新建计划"];
  if (previous && plan.planFormat === "v0.3" && !cleanText(input.changeReason)) throw new Error("修改计划必须填写修改原因");
  if (previous && !plan.changeReason) plan.changeReason = "旧版计划未要求填写修改原因";
  if (previous && ["active", "confirmed"].includes(previous.status)) {
    plan.previousConfirmationId = previous.confirmationId || null;
    plan.confirmedAt = null;
    plan.confirmationId = null;
  }
  plan.contentHash = contentHash(planContent(plan));
  if (plan.planFormat === "v0.3" && requestedStatus === "active") validatePlanForConfirmation(plan);
  store.planVersions ||= [];
  const snapshotKey = `${plan.id}:v${plan.version}`;
  store.planVersions.push({
    ...JSON.parse(JSON.stringify(plan)),
    snapshotKey,
    snapshotId: `plan-version-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    savedAt: now
  });
  return plan;
}

function confirmPlan(store, id, input) {
  const plan = store.plans.find(item => item.id === id);
  if (!plan) throw new Error("未找到待确认计划");
  if (!["draft", "pending_confirmation", "confirmed"].includes(plan.status)) throw new Error("当前计划状态不能确认");
  validatePlanForConfirmation(plan);
  const reason = cleanText(input.reason);
  if (!reason) throw new Error("确认计划必须填写确认说明");
  const now = new Date().toISOString();
  plan.contentHash = contentHash(planContent(plan));
  const confirmation = {
    id: `confirmation-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    planId: plan.id,
    planVersion: plan.version,
    planHash: plan.contentHash,
    confirmedBy: "local-user",
    method: "explicit-local-confirmation",
    reason,
    confirmedAt: now
  };
  store.planConfirmations.push(confirmation);
  plan.status = "active";
  plan.confirmedAt = now;
  plan.confirmationId = confirmation.id;
  plan.updatedAt = now;
  return { plan, confirmation };
}

function invalidatePlan(store, id, input) {
  const plan = store.plans.find(item => item.id === id);
  if (!plan) throw new Error("未找到计划");
  const reason = cleanText(input.reason);
  if (!reason) throw new Error("计划失效必须填写原因");
  const now = new Date().toISOString();
  plan.status = "invalidated";
  plan.invalidationReason = reason;
  plan.invalidatedAt = now;
  plan.updatedAt = now;
  return plan;
}

function onboardingSummary(store) {
  const activeV03Plan = store.plans.find(plan => plan.planFormat === "v0.3" && plan.status === "active" && store.planConfirmations.some(item => item.planId === plan.id && Number(item.planVersion) === Number(plan.version)));
  const legacyPlans = store.plans.filter(plan => plan.planFormat !== "v0.3" && !["completed", "archived", "invalidated"].includes(plan.status));
  const upgradeSourcePlan = legacyPlans.sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))[0] || null;
  const candidateAssets = store.plannedAssets.filter(item => item.status !== "archived");
  const completed = Boolean(store.onboarding?.completedAt);
  return {
    version: "0.3.2",
    completed,
    dismissed: Boolean(store.onboarding?.dismissedAt),
    shouldOpen: !completed && !store.onboarding?.dismissedAt,
    counts: {
      holdings: store.holdings.length,
      trades: store.trades.length,
      legacyPlans: legacyPlans.length,
      candidateAssets: candidateAssets.length,
      evidence: store.evidenceRecords.length,
      confirmations: store.planConfirmations.length
    },
    steps: [
      { id: "data", label: "确认现有数据", completed: Boolean(store.holdings.length || store.trades.length || store.onboarding?.dataConfirmedAt), page: "overview" },
      { id: "assets", label: "整理交易标的", completed: Boolean(store.holdings.length || candidateAssets.length), page: "assets" },
      { id: "evidence", label: "建立事实与判断", completed: store.evidenceRecords.length > 0, page: "assets" },
      { id: "plan", label: "确认新版交易计划", completed: Boolean(activeV03Plan), page: "plan" }
    ],
    activeV03Plan: activeV03Plan ? { id: activeV03Plan.id, planForDate: activeV03Plan.planForDate, version: activeV03Plan.version } : null,
    upgradeSource: upgradeSourcePlan ? { id: upgradeSourcePlan.id, planForDate: upgradeSourcePlan.planForDate, version: upgradeSourcePlan.version, status: upgradeSourcePlan.status } : null
  };
}

function dailyWorkflow(store) {
  const today = localDateKey();
  const nextDate = nextTradingDate(new Date());
  const todayTrades = store.trades.filter(item => item.date === today);
  const review = store.dailySessions?.[today]?.postmarket;
  const plan = store.plans.find(item => [today, nextDate].includes(item.planForDate) && item.status === "active" && item.planFormat === "v0.3");
  const recentEvidence = store.evidenceRecords.filter(item => String(item.createdAt || "").slice(0, 10) === today);
  const tasks = [
    { id: "assets", label: "确认持仓与候选标的", detail: `${store.holdings.length} 个持仓 · ${store.plannedAssets.filter(item => item.status !== "archived").length} 个候选`, completed: store.holdings.length > 0, page: "assets" },
    { id: "evidence", label: "补充影响计划的新事实", detail: recentEvidence.length ? `今天已新增 ${recentEvidence.length} 条` : `资料库共 ${store.evidenceRecords.length} 条，今天尚未新增`, completed: recentEvidence.length > 0, page: "assets" },
    { id: "plan", label: "检查并确认交易计划", detail: plan ? `${plan.planForDate} · V${plan.version} 已生效` : "没有已确认的 v0.3 计划", completed: Boolean(plan), page: "plan" },
    { id: "execution", label: "盘中成交后立即记录", detail: todayTrades.length ? `今天已记录 ${todayTrades.length} 笔` : "今天暂无成交记录", completed: todayTrades.length > 0, page: "intraday", optional: true },
    { id: "review", label: "收盘后完成纪律复盘", detail: review?.completedAt ? "今日复盘已保存" : "今日复盘尚未完成", completed: Boolean(review?.completedAt), page: "postmarket" }
  ];
  return { date: today, nextTradingDate: nextDate, tasks, completedCount: tasks.filter(item => item.completed).length };
}

function upgradeLegacyPlan(store, input = {}) {
  const onboarding = onboardingSummary(store);
  const legacy = input.planId
    ? store.plans.find(item => item.id === input.planId)
    : store.plans.find(item => item.id === onboarding.upgradeSource?.id);
  if (!legacy) throw new Error("没有可升级的旧版计划");
  const today = localDateKey();
  const planForDate = /^\d{4}-\d{2}-\d{2}$/.test(cleanText(input.planForDate))
    ? cleanText(input.planForDate)
    : legacy.planForDate >= today ? legacy.planForDate : nextTradingDate(new Date());
  const account = accountSummary(store);
  const legacyRules = Array.isArray(legacy.rules) && legacy.rules.length ? legacy.rules : store.holdings;
  const rules = legacyRules.map(source => {
    const holding = store.holdings.find(item => String(item.code) === String(source.code));
    const currentPct = account.totalAssets > 0 && holding
      ? holding.quantity * holding.lastPrice / account.totalAssets * 100
      : 10;
    return {
      code: String(source.code),
      name: source.name || holding?.name || String(source.code),
      direction: holding ? "long" : "observe",
      triggerCondition: source.triggerCondition || source.wait || "等待补充明确、可验证的触发条件",
      allowedActions: holding ? "持有、减仓、退出" : "观察，不新增风险",
      maxPositionPct: Math.min(100, Math.max(1, +currentPct.toFixed(2))),
      maxRiskPct: Number(store.account.maxRiskPerTradePct || 0.8),
      stopPrice: source.stopPrice || null,
      reduceCondition: source.reduceCondition || source.sell || "等待补充减仓条件",
      exitCondition: source.exitCondition || source.stop || "等待补充退出条件",
      forbidden: source.forbidden || "不做计划外加仓；不因盘中急涨追买",
      invalidationCondition: source.invalidationCondition || "出现未纳入计划的重大新事实，或关键数据失真",
      defaultAction: source.defaultAction || "不新增风险，等待重新确认",
      flexibleRange: source.flexibleRange || "仅允许不扩大风险的微调；扩大风险必须重新确认",
      baseScenario: source.baseScenario || source.wait || "维持原计划，等待触发条件",
      bullScenario: source.bullScenario || "不追涨；只有原计划条件满足时才执行",
      bearScenario: source.bearScenario || source.stop || "不新增风险，优先执行退出和风险控制"
    };
  });
  const plan = upsertPlan(store, {
    forceNew: true,
    planFormat: "v0.3",
    planForDate,
    sourceReviewDate: legacy.sourceReviewDate || null,
    status: "pending_confirmation",
    validFrom: `${planForDate}T09:15`,
    validUntil: `${planForDate}T15:30`,
    expectedReturn: legacy.expectedReturn || "不设置确定收益承诺；只执行风险收益条件",
    userMarketView: legacy.userMarketView || "待用户补充",
    systemMarketView: legacy.systemMarketView || legacy.marketObservation || "沿用旧计划环境记录，确认前需重新核验",
    previousAdvice: legacy.previousAdvice || "沿用旧计划提醒",
    accountRules: legacy.accountRules || "不新增计划外风险；达到当日风险上限后停止新增风险",
    trainingFocus: legacy.trainingFocus || "只执行已确认条件",
    marketObservation: legacy.marketObservation || "待盘前重新核验",
    changeReason: "从 v0.2 计划安全升级为 v0.3.2 待确认草稿",
    rules
  });
  return { plan, sourcePlanId: legacy.id };
}

function listBackups() {
  return fs.readdirSync(BACKUP_DIR).filter(name => name.endsWith(".json")).map(name => {
    const file = path.join(BACKUP_DIR, name);
    const stat = fs.statSync(file);
    let summary = null;
    try { summary = accountSummary(migrateStore(JSON.parse(fs.readFileSync(file, "utf8")))); } catch {}
    return { name, size: stat.size, createdAt: new Date(Math.max(stat.mtimeMs, stat.birthtimeMs)).toISOString(), summary };
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function refreshHistoricalClose(holding, date) {
  const secid = `${holding.market === "SH" ? "1" : "0"}.${holding.code}`;
  const compact = date.replace(/-/g, "");
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&klt=101&fqt=0&beg=${compact}&end=${compact}&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56`;
  const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`历史行情HTTP ${response.status}`);
  const payload = await response.json();
  const row = payload?.data?.klines?.[0]?.split(",");
  if (!row || row[0] !== date) throw new Error("未获取到指定交易日收盘价");
  return { price: Number(row[2]), name: payload.data.name || holding.name, previousClose: null, changePct: null };
}

async function fetchTechnicalSnapshot(asset) {
  const secid = asset.secid || `${asset.market === "SH" ? "1" : "0"}.${asset.code}`;
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&klt=101&fqt=1&lmt=100&end=20500101&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59`;
  const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`日线行情HTTP ${response.status}`);
  const payload = await response.json();
  const rows = (payload?.data?.klines || []).map(line => {
    const fields = line.split(",");
    return { date: fields[0], open: Number(fields[1]), close: Number(fields[2]), high: Number(fields[3]), low: Number(fields[4]), volume: Number(fields[5]), amount: Number(fields[6]), changePct: Number(fields[8]) };
  }).filter(row => Number.isFinite(row.close));
  if (rows.length < 60) throw new Error("日线数量不足60个交易日");
  const latest = rows.at(-1);
  const average = days => +(rows.slice(-days).reduce((sum, row) => sum + row.close, 0) / days).toFixed(3);
  const ma5 = average(5), ma10 = average(10), ma30 = average(30), ma60 = average(60);
  const recent = rows.slice(-5);
  return {
    code: asset.code,
    name: payload.data.name || asset.name,
    date: latest.date,
    open: latest.open,
    close: latest.close,
    high: latest.high,
    low: latest.low,
    changePct: latest.changePct,
    ma5, ma10, ma30, ma60,
    high5: +Math.max(...recent.map(row => row.high)).toFixed(3),
    low5: +Math.min(...recent.map(row => row.low)).toFixed(3),
    structure: latest.close > ma5 && latest.close > ma10 ? "短线位于5日、10日线之上" : latest.close < ma5 && latest.close < ma10 ? "短线位于5日、10日线之下" : "短线处于5日、10日线之间",
    source: "eastmoney-adjusted-daily",
    fetchedAt: new Date().toISOString()
  };
}

function researchForDate(store, date) {
  return [...(store.researchSnapshots || [])].filter(item => item.reviewDate === date).sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))[0] || null;
}

function upsertResearchExternalFactor(store, date, input) {
  let research = researchForDate(store, date);
  if (!research) {
    research = { id: `research-${date}-${Date.now()}`, reviewDate: date, createdAt: new Date().toISOString(), externalFactors: [], status: "external-only" };
    store.researchSnapshots.push(research);
  }
  research.externalFactors ||= [];
  const title = String(input.title || "").trim();
  const impact = String(input.impact || "").trim();
  const source = String(input.source || "").trim();
  const sourceUrl = String(input.url || "").trim();
  if (!title || !impact || !source) throw new Error("外部研究必须填写标题、影响判断和来源");
  if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) throw new Error("研究来源链接必须使用http或https");
  let factor = input.id ? research.externalFactors.find(item => item.id === input.id) : null;
  if (!factor) {
    factor = { id: `factor-${Date.now()}-${Math.random().toString(16).slice(2)}` };
    research.externalFactors.push(factor);
  }
  Object.assign(factor, {
    category: String(input.category || "其他").trim(),
    title,
    impact,
    source,
    url: sourceUrl,
    publishedAt: String(input.publishedAt || date),
    updatedAt: new Date().toISOString()
  });
  research.updatedAt = factor.updatedAt;
  research.status = research.marketTechnical && research.holdingsTechnical?.length ? "ready" : "external-only";
  return { research, factor };
}

async function refreshResearchTechnicals(store, date = localDateKey()) {
  let research = researchForDate(store, date);
  if (!research) {
    research = { id: `research-${date}-${Date.now()}`, reviewDate: date, createdAt: new Date().toISOString(), externalFactors: [], status: "technical-only" };
    store.researchSnapshots.push(research);
  }
  const [market, ...holdings] = await Promise.all([
    fetchTechnicalSnapshot({ code: "000001", name: "上证指数", secid: "1.000001" }),
    ...store.holdings.map(fetchTechnicalSnapshot)
  ]);
  research.marketTechnical = market;
  research.holdingsTechnical = holdings;
  research.updatedAt = new Date().toISOString();
  research.technicalSource = "东方财富前复权日线；均线由本地程序计算";
  if (research.externalFactors?.length) research.status = "ready";
  return research;
}

function generatePlanFromResearch(store, reviewDate = localDateKey()) {
  const research = researchForDate(store, reviewDate);
  if (!research?.marketTechnical || !research?.holdingsTechnical?.length) throw new Error("请先刷新市场与持仓技术数据");
  if (!research.externalFactors?.length) throw new Error("外部政策与资讯研究尚未完成，不能生成研究计划");
  const review = store.dailySessions?.[reviewDate]?.postmarket || {};
  const planForDate = nextTradingDate(new Date(`${reviewDate}T12:00:00+08:00`));
  const market = research.marketTechnical;
  const rules = store.holdings.map(holding => {
    const technical = research.holdingsTechnical.find(item => item.code === holding.code);
    if (!technical) return { code: holding.code, name: holding.name, wait: "技术数据缺失，不执行计划外操作", sell: "等待数据补齐", stop: "按券商风险底线处理", forbidden: "不加仓、不做T" };
    const pressureLow = Math.min(technical.ma5, technical.ma10).toFixed(2);
    const pressureHigh = Math.max(technical.ma5, technical.ma10).toFixed(2);
    const support = technical.low5.toFixed(2);
    return {
      code: holding.code,
      name: holding.name,
      wait: `9:30—10:00不因低开或急拉临时下单；观察${support}附近是否止跌，以及能否重新站上${pressureLow}。`,
      sell: `若反弹进入${pressureLow}—${pressureHigh}（MA5/MA10压力区）但10分钟内不能站稳，允许卖出${holding.quantity}股退出；若放量站稳${pressureHigh}，继续观察，不追涨做T。`,
      stop: `10:00后若有效跌破近5日低点${support}且10分钟不能收回，卖出${holding.quantity}股控制风险；跳空或跌停导致无法成交时只记录风险，不反向加仓。`,
      forbidden: "不补仓摊低成本；不因盘中翻红追买；卖出后当天不追回。"
    };
  });
  const externalSummary = research.externalFactors.map(item => `${item.category}：${item.impact}`).join("\n");
  const plan = upsertPlan(store, {
    planForDate,
    sourceReviewDate: reviewDate,
    status: "draft",
    previousAdvice: review.correctionRule || review.tomorrowFocus || "只执行预先写明的情景规则",
    trainingFocus: "开盘前30分钟不因低开恐慌卖出，也不因急拉追涨；只在情景条件完成后执行。",
    accountRules: "不新开仓、不补仓、不做T；最多两次卖出执行。任何反弹都先视为风险窗口，除非价格重新站稳关键均线，不能把一次翻红当成趋势反转。",
    marketObservation: `上证${market.close.toFixed(2)}，MA5/10/30/60分别为${market.ma5.toFixed(2)}/${market.ma10.toFixed(2)}/${market.ma30.toFixed(2)}/${market.ma60.toFixed(2)}，${market.structure}。\n${externalSummary}`,
    rules,
    generatedFromResearchId: research.id,
    generationBasis: "系统事实快照＋东方财富日线均线＋已留档的政策/国际/公司资讯"
  });
  research.generatedPlanId = plan.id;
  research.generatedAt = new Date().toISOString();
  return { plan, research };
}

async function runClosingRefresh(date = localDateKey(), trigger = "automatic") {
  const store = loadStore();
  store.marketCloses[date] ||= { date, status: "running", attempts: 0, quotes: [], trigger };
  const snapshot = store.marketCloses[date];
  snapshot.status = "running";
  snapshot.trigger = trigger;
  snapshot.attempts = Number(snapshot.attempts || 0) + 1;
  snapshot.lastAttemptAt = new Date().toISOString();
  const results = await Promise.allSettled(store.holdings.map(holding => date === localDateKey() ? refreshQuoteWithFallback(holding) : refreshHistoricalClose(holding, date)));
  snapshot.quotes = [];
  snapshot.errors = [];
  results.forEach((result, index) => {
    const holding = store.holdings[index];
    if (result.status === "fulfilled") {
      const quote = { code: holding.code, name: result.value.name, close: result.value.price, previousClose: result.value.previousClose, changePct: result.value.changePct, source: result.value.source || "eastmoney", fetchedAt: new Date().toISOString() };
      snapshot.quotes.push(quote);
      holding.lastPrice = quote.close;
      holding.name = quote.name;
      holding.changePct = quote.changePct;
      holding.quoteUpdatedAt = quote.fetchedAt;
    } else snapshot.errors.push({ code: holding.code, message: result.reason.message });
  });
  snapshot.status = snapshot.errors.length ? (snapshot.quotes.length ? "partial" : "failed") : "completed";
  snapshot.completedAt = new Date().toISOString();
  snapshot.accountSummary = accountSummary(store);
  store.auditLog.push({ id: `audit-${Date.now()}`, type: "market-close-refresh", date, trigger, status: snapshot.status, createdAt: snapshot.completedAt });
  saveStore(store, "market-close");
  return { snapshot, store };
}

function buildReviewPacket(store) {
  const holdings = store.holdings.map(h => ({
    ...h,
    marketValue: +(h.quantity * h.lastPrice).toFixed(2),
    calculatedPnl: +(((h.lastPrice - h.cost) * h.quantity) + Number(h.pnlAdjustment || 0)).toFixed(2),
    holdingPnl: h.brokerPnl == null
      ? +(((h.lastPrice - h.cost) * h.quantity) + Number(h.pnlAdjustment || 0)).toFixed(2)
      : Number(h.brokerPnl),
    unrealizedPct: +((h.lastPrice / h.cost - 1) * 100).toFixed(2)
  }));
  const marketValue = +holdings.reduce((sum, h) => sum + h.marketValue, 0).toFixed(2);
  const totalAssets = +(Number(store.account.availableCash || 0) + marketValue + Number(store.account.pendingSettlementAdjustment || 0)).toFixed(2);
  const recentTrades = [...store.trades].sort((a, b) =>
    `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`)
  ).slice(0, 50);
  const recentOrders = [...(store.orders || [])].sort((a, b) =>
    `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`)
  ).slice(0, 50);
  const today = localDateKey();
  const latestTradeAt = recentTrades.length
    ? new Date(`${recentTrades[0].date}T${recentTrades[0].time || "00:00"}:00+08:00`)
    : null;
  const brokerSnapshotAt = store.account.snapshotUpdatedAt ? new Date(store.account.snapshotUpdatedAt) : null;
  const brokerSnapshotStale = Boolean(latestTradeAt && brokerSnapshotAt && latestTradeAt > brokerSnapshotAt);
  const staleQuotes = holdings.filter(h => {
    if (!h.quoteUpdatedAt) return true;
    return Date.now() - new Date(h.quoteUpdatedAt).getTime() > 12 * 60 * 60 * 1000;
  }).map(h => ({ code: h.code, name: h.name, quoteUpdatedAt: h.quoteUpdatedAt || null }));
  return {
    snapshotId: `review-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    generatedAt: new Date().toISOString(),
    storeRevision: store.__revision ?? null,
    account: store.account,
    accountSnapshot: {
      totalAssets,
      marketValue,
      availableCash: Number(store.account.availableCash || 0),
      positionPct: totalAssets ? +(marketValue / totalAssets * 100).toFixed(2) : 0,
      todayPnl: store.account.todayPnl,
      holdingPnl: +holdings.reduce((sum, h) => sum + h.holdingPnl, 0).toFixed(2)
    },
    dataQuality: {
      encoding: "UTF-8",
      mojibakeDetected: false,
      brokerSnapshotAt: store.account.snapshotUpdatedAt || null,
      latestTradeAt: latestTradeAt?.toISOString() || null,
      brokerSnapshotStale,
      brokerTotalAssetsComparable: !brokerSnapshotStale,
      staleQuotes,
      pendingFeeTradeIds: recentTrades.filter(t => t.fee == null).map(t => t.id),
      notes: [
        brokerSnapshotStale ? "券商总资产快照早于最新成交，不应直接与成交后的程序总资产比较。" : "券商快照与最新成交时间可比较。",
        staleQuotes.length ? "部分持仓行情超过12小时未更新，风险暴露只能按静态价格估算。" : "持仓行情未超过12小时。",
        "文本已按UTF-8读取；除非字段实际包含替换字符，否则不要报告乱码。"
      ]
    },
    holdings,
    recentTrades,
    recentOrders,
    plannedAssets: (store.plannedAssets || []).filter(item => item.status !== "archived"),
    recentEvidence: [...(store.evidenceRecords || [])].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 100),
    recentDisciplineEvents: [...(store.disciplineEvents || [])].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 100),
    planConfirmations: [...(store.planConfirmations || [])].sort((a, b) => String(b.confirmedAt).localeCompare(String(a.confirmedAt))).slice(0, 30),
    latestStockPnlSnapshot: [...(store.stockPnlSnapshots || [])].sort((a, b) => String(b.asOfDate).localeCompare(String(a.asOfDate)))[0] || null,
    latestResearchSnapshot: [...(store.researchSnapshots || [])].sort((a, b) => String(b.reviewDate).localeCompare(String(a.reviewDate)))[0] || null,
    dailySession: store.dailySessions?.[today] || null,
    activePlan: selectedPlan(store),
    marketClose: store.marketCloses?.[today] || null,
    accountSummary: accountSummary(store),
    dataHealth: dataHealth(store),
    ledger: {
      version: store.ledger?.version || null,
      establishedAt: store.ledger?.establishedAt || null,
      eventCount: store.ledger?.events?.length || 0
    },
    discipline: disciplineSummary(store, 7),
    requestedAnalysis: [
      "识别追高、怕踏空、亏损补仓、卖出后追回、过度交易等行为",
      "区分交易结果与决策质量，不因赚钱就判定操作正确",
      "计算交易频率、单笔风险、盈亏比和费用侵蚀",
      "给出下一交易日可执行的纪律建议，不预测必然涨跌",
      "重点保护本金，避免鼓励翻本交易或承诺收益"
    ]
  };
}

async function refreshQuote(holding) {
  const secid = `${holding.market === "SH" ? "1" : "0"}.${holding.code}`;
  const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f43,f57,f58,f60,f169,f170`;
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(6000)
  });
  if (!response.ok) throw new Error(`行情接口HTTP ${response.status}`);
  const payload = await response.json();
  if (!payload.data || payload.data.f43 == null) throw new Error("行情接口无数据");
  return {
    price: payload.data.f43 / 100,
    name: payload.data.f58 || holding.name,
    previousClose: payload.data.f60 / 100,
    changePct: payload.data.f170 / 100,
    source: "eastmoney"
  };
}

async function refreshTencentQuote(holding) {
  const symbol = `${holding.market === "SH" ? "sh" : "sz"}${holding.code}`;
  const response = await fetch(`https://qt.gtimg.cn/q=${symbol}`, {
    headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://gu.qq.com/" },
    signal: AbortSignal.timeout(6000)
  });
  if (!response.ok) throw new Error(`腾讯行情HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const text = new TextDecoder("gb18030").decode(bytes);
  const match = text.match(/="([^"]+)"/);
  const fields = match?.[1]?.split("~") || [];
  if (!Number(fields[3])) throw new Error("腾讯行情无有效价格");
  return { price: Number(fields[3]), name: fields[1] || holding.name, previousClose: Number(fields[4]) || null, changePct: Number(fields[32]) || null, source: "tencent" };
}

async function refreshQuoteWithFallback(holding) {
  try { return await refreshQuote(holding); }
  catch (primaryError) {
    try { return await refreshTencentQuote(holding); }
    catch (fallbackError) {
      const primaryMessage = primaryError.message === "fetch failed" ? "网络连接失败" : primaryError.message;
      const fallbackMessage = fallbackError.message === "fetch failed" ? "网络连接失败" : fallbackError.message;
      throw new Error(`东方财富：${primaryMessage}；腾讯：${fallbackMessage}。请确认本地服务允许联网`);
    }
  }
}

function runCodexAnalysis(store) {
  const packet = buildReviewPacket(store);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const packetPath = path.join(REPORT_DIR, `review-${stamp}.json`);
  const outputPath = path.join(REPORT_DIR, `analysis-${stamp}.md`);
  fs.writeFileSync(packetPath, JSON.stringify(packet, null, 2), "utf8");

  const prompt = [
    "你是一名严格、谨慎的A股交易纪律复盘助手。",
    `请读取文件：${packetPath}`,
    "只根据文件中的账户、持仓和交易记录进行复盘。",
    "必须读取latestResearchSnapshot，区分已经核实的外部事实、技术指标和仍需核实的信息。",
    "输出中文Markdown报告，包含：账户摘要、逐笔决策质量、纪律违规、费用与频率、风险暴露、下一步训练任务。",
    "报告控制在2500至4000个中文字符；最近两个交易日逐笔分析，其余历史成交只汇总典型模式，不要逐笔复述46笔流水。",
    "下一交易日建议必须写成低开下杀、反弹受阻、重新站稳关键均线等条件情景，不得把反弹或下跌当成必然。",
    "不要承诺收益，不要把结果好坏等同于决策好坏，不要给出确定性涨跌预测。",
    "如果数据不足，明确列出缺失字段。"
    ,"必须读取dataQuality：券商快照早于最新成交时，不得把券商总资产与成交后程序总资产的差额判定为账户错误。",
    "文件使用UTF-8且已标记mojibakeDetected=false；除非实际看到替换字符，不得声称中文乱码。",
    "费用为null表示券商费用待补录；应列为待补项，但不要因此否定其他可计算字段。"
  ].join("\n");

  const child = spawn(CODEX_COMMAND, [
    "exec",
    "--skip-git-repo-check",
    "--sandbox", "read-only",
    "-C", ROOT,
    "-o", outputPath,
    prompt
  ], {
    cwd: ROOT,
    windowsHide: true,
    shell: CODEX_COMMAND.toLowerCase().endsWith(".cmd"),
    stdio: ["ignore", "pipe", "pipe"]
  });

  const analysis = {
    id: stamp,
    status: "running",
    packetPath,
    outputPath,
    startedAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    pid: child.pid,
    progress: "Codex进程已启动，正在读取复盘数据",
    progressPercent: 16,
    logTail: "",
    error: ""
  };
  store.analyses.unshift(analysis);
  saveStore(store);

  let stdout = "";
  let stderr = "";
  let lastSavedAt = 0;
  const updateProgress = (text, stream) => {
    if (stream === "stderr") stderr += text;
    else stdout += text;
    const combined = `${stdout}\n${stderr}`.trim();
    analysis.logTail = combined.slice(-3000);
    analysis.lastActivityAt = new Date().toISOString();
    const networkRetry = /reconnect|retry|request timed out|transport channel closed/i.test(text);
    const reportStarted = /# |## |账户摘要|纪律违规|下一交易日/i.test(combined);
    analysis.progress = networkRetry ? "网络连接不稳定，Codex正在重试" : reportStarted ? "分析完成主体内容，正在整理Markdown报告" : "Codex正在分析复盘数据";
    analysis.progressPercent = networkRetry ? Math.max(18, Number(analysis.progressPercent || 0)) : Math.min(88, 22 + Math.floor(combined.length / 1800) * 4);
    const now = Date.now();
    if (now - lastSavedAt > 1000) {
      const latest = loadStore();
      const item = latest.analyses.find(a => a.id === stamp);
      if (item) Object.assign(item, {
        lastActivityAt: analysis.lastActivityAt,
        progress: analysis.progress,
        progressPercent: analysis.progressPercent,
        logTail: analysis.logTail
      });
      saveStore(latest);
      lastSavedAt = now;
    }
  };
  child.stdout.on("data", chunk => {
    const text = chunk.toString();
    process.stdout.write(`[Codex ${stamp}] ${text}`);
    updateProgress(text, "stdout");
  });
  child.stderr.on("data", chunk => {
    const text = chunk.toString();
    process.stderr.write(`[Codex ${stamp}] ${text}`);
    updateProgress(text, "stderr");
  });
  const timeout = setTimeout(() => {
    analysis.timedOut = true;
    const latest = loadStore();
    const item = latest.analyses.find(a => a.id === stamp);
    if (item && item.status === "running") {
      const combinedLog = `${stdout}\n${stderr}`.trim();
      const networkIssue = /reconnect|request timed out|transport channel closed|http request failed/i.test(combinedLog);
      const recentlyActive = Date.now() - new Date(item.lastActivityAt || item.startedAt).getTime() < 45_000;
      item.status = "failed";
      item.finishedAt = new Date().toISOString();
      item.progress = "分析超时，任务已终止";
      item.progressPercent = 100;
      item.errorCode = networkIssue ? "network-timeout" : recentlyActive ? "generation-too-long" : "no-activity-timeout";
      item.error = networkIssue ? "Codex网络连接持续异常，超过10分钟后任务已终止" : recentlyActive ? "报告内容仍在持续生成，但超过10分钟硬上限，任务已终止；这通常不是网络失败" : "Codex超过10分钟未完成且长时间没有新输出，任务已终止";
      item.logTail = combinedLog.slice(-3000);
      saveStore(latest);
    }
    child.kill();
  }, 600_000);
  child.on("error", error => {
    clearTimeout(timeout);
    const latest = loadStore();
    const item = latest.analyses.find(a => a.id === stamp);
    if (!item) return;
    item.status = "failed";
    item.finishedAt = new Date().toISOString();
    item.progress = "Codex进程启动失败";
    item.error = error.message;
    saveStore(latest);
  });
  child.on("exit", code => {
    clearTimeout(timeout);
    const latest = loadStore();
    const item = latest.analyses.find(a => a.id === stamp);
    if (!item) return;
    const hasOutput = fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0;
    item.status = code === 0 && hasOutput ? "completed" : "failed";
    item.finishedAt = new Date().toISOString();
    item.progress = item.status === "completed" ? "复盘报告已生成" : "复盘生成失败";
    item.progressPercent = 100;
    item.logTail = `${stdout}\n${stderr}`.trim().slice(-3000);
    item.error = item.status === "completed"
      ? ""
      : (analysis.timedOut ? "Codex分析超过3分钟，任务已自动终止" : (stderr.trim() || `Codex退出码：${code}`));
    saveStore(latest);
    console.log(`[Codex ${stamp}] ${item.status}，退出码 ${code}`);
  });
  return analysis;
}

function getCodexStatus() {
  return new Promise(resolve => {
    if (process.platform === "win32" && !fs.existsSync(CODEX_COMMAND)) {
      return resolve({
        installed: false,
        loggedIn: false,
        command: CODEX_COMMAND,
        message: "未找到Codex CLI命令"
      });
    }
    const child = spawn(CODEX_COMMAND, ["login", "status"], {
      cwd: ROOT,
      windowsHide: true,
      shell: CODEX_COMMAND.toLowerCase().endsWith(".cmd")
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), 10000);
    child.stdout.on("data", chunk => { stdout += chunk.toString(); });
    child.stderr.on("data", chunk => { stderr += chunk.toString(); });
    child.on("error", error => {
      clearTimeout(timer);
      resolve({
        installed: true,
        loggedIn: false,
        command: CODEX_COMMAND,
        message: error.message
      });
    });
    child.on("exit", code => {
      clearTimeout(timer);
      const output = `${stdout}\n${stderr}`.trim();
      resolve({
        installed: true,
        loggedIn: code === 0 && /logged in/i.test(output) && !/not logged in/i.test(output),
        ready: true,
        command: CODEX_COMMAND,
        message: output || `Codex退出码：${code}`
      });
    });
  });
}

function serveStatic(req, res) {
  const requestPath = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const safePath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = VENDOR_FILES[requestPath] || path.join(PUBLIC_DIR, safePath);
  const isAllowed = Boolean(VENDOR_FILES[requestPath]) || filePath.startsWith(PUBLIC_DIR);
  if (!isAllowed || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    return res.end("Not found");
  }
  const ext = path.extname(filePath);
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8"
  };
  res.writeHead(200, {
    "Content-Type": types[ext] || "application/octet-stream",
    "Cache-Control": "no-store"
  });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/api/store" && req.method === "GET") {
      return json(res, 200, loadStore());
    }
    if (url.pathname === "/api/dashboard" && req.method === "GET") {
      const store = loadStore();
      return json(res, 200, {
        account: accountSummary(store),
        health: dataHealth(store),
        discipline: disciplineSummary(store, 7),
        v03: {
          plannedAssetCount: (store.plannedAssets || []).filter(item => item.status !== "archived").length,
          evidenceCount: (store.evidenceRecords || []).length,
          disciplineEventCount: (store.disciplineEvents || []).length
        },
        onboarding: onboardingSummary(store),
        dailyWorkflow: dailyWorkflow(store),
        ledger: { version: store.ledger?.version || null, establishedAt: store.ledger?.establishedAt || null, eventCount: store.ledger?.events?.length || 0, revision: store.__revision },
        plan: selectedPlan(store, url.searchParams.get("date")),
        nextTradingDate: nextTradingDate(new Date()),
        latestMarketClose: Object.values(store.marketCloses || {}).sort((a, b) => b.date.localeCompare(a.date))[0] || null
      });
    }
    if (url.pathname === "/api/plans" && req.method === "GET") {
      const store = loadStore();
      const selected = selectedPlan(store, url.searchParams.get("date"));
      const versions = selected
        ? [...store.planVersions].filter(item => item.id === selected.id).sort((a, b) => Number(b.version) - Number(a.version))
        : [];
      return json(res, 200, { plans: [...store.plans].sort((a, b) => b.planForDate.localeCompare(a.planForDate)), selected, versions });
    }
    if (url.pathname === "/api/plans" && req.method === "PUT") {
      const body = await readBody(req);
      const store = loadStore();
      const plan = upsertPlan(store, body);
      store.auditLog.push({ id: `audit-${Date.now()}`, type: "plan-saved", planId: plan.id, planForDate: plan.planForDate, version: plan.version, createdAt: new Date().toISOString() });
      saveStore(store, "plan");
      return json(res, 200, { plan, store });
    }
    const confirmPlanRoute = url.pathname.match(/^\/api\/plans\/([^/]+)\/confirm$/);
    if (confirmPlanRoute && req.method === "POST") {
      const body = await readBody(req);
      const store = loadStore();
      const result = confirmPlan(store, decodeURIComponent(confirmPlanRoute[1]), body);
      store.auditLog.push({ id: `audit-${Date.now()}`, type: "plan-confirmed", planId: result.plan.id, version: result.plan.version, confirmationId: result.confirmation.id, createdAt: result.confirmation.confirmedAt });
      saveStore(store, "plan-confirmed");
      return json(res, 200, { ...result, store });
    }
    const invalidatePlanRoute = url.pathname.match(/^\/api\/plans\/([^/]+)\/invalidate$/);
    if (invalidatePlanRoute && req.method === "POST") {
      const body = await readBody(req);
      const store = loadStore();
      const plan = invalidatePlan(store, decodeURIComponent(invalidatePlanRoute[1]), body);
      store.auditLog.push({ id: `audit-${Date.now()}`, type: "plan-invalidated", planId: plan.id, version: plan.version, reason: plan.invalidationReason, createdAt: plan.invalidatedAt });
      saveStore(store, "plan-invalidated");
      return json(res, 200, { plan, store });
    }
    if (url.pathname === "/api/planned-assets" && req.method === "GET") {
      const store = loadStore();
      return json(res, 200, { assets: [...store.plannedAssets].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))) });
    }
    if (url.pathname === "/api/planned-assets" && req.method === "PUT") {
      const body = await readBody(req);
      const store = loadStore();
      const existing = body.id ? store.plannedAssets.find(item => item.id === body.id) : store.plannedAssets.find(item => item.code === cleanText(body.code) && item.status !== "archived");
      const asset = normalizePlannedAsset(body, existing || {});
      if (existing) Object.assign(existing, asset);
      else store.plannedAssets.push(asset);
      store.auditLog.push({ id: `audit-${Date.now()}`, type: "planned-asset-saved", assetId: asset.id, code: asset.code, createdAt: asset.updatedAt });
      saveStore(store, "planned-asset");
      return json(res, 200, { asset, store });
    }
    const plannedAssetRoute = url.pathname.match(/^\/api\/planned-assets\/([^/]+)$/);
    if (plannedAssetRoute && req.method === "DELETE") {
      const store = loadStore();
      const asset = store.plannedAssets.find(item => item.id === decodeURIComponent(plannedAssetRoute[1]));
      if (!asset) return json(res, 404, { error: "未找到计划标的" });
      asset.status = "archived";
      asset.archivedAt = new Date().toISOString();
      asset.updatedAt = asset.archivedAt;
      store.auditLog.push({ id: `audit-${Date.now()}`, type: "planned-asset-archived", assetId: asset.id, createdAt: asset.archivedAt });
      saveStore(store, "planned-asset-archived");
      return json(res, 200, { asset, store });
    }
    if (url.pathname === "/api/evidence" && req.method === "GET") {
      const store = loadStore();
      const assetCode = cleanText(url.searchParams.get("assetCode"));
      const records = assetCode ? store.evidenceRecords.filter(item => item.assetCode === assetCode) : store.evidenceRecords;
      return json(res, 200, { records: [...records].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))) });
    }
    if (url.pathname === "/api/evidence" && req.method === "POST") {
      const body = await readBody(req);
      const store = loadStore();
      const record = normalizeEvidence(body, store);
      store.evidenceRecords.push(record);
      store.auditLog.push({ id: `audit-${Date.now()}`, type: "evidence-created", evidenceId: record.id, kind: record.kind, createdAt: record.createdAt });
      saveStore(store, "evidence");
      return json(res, 201, { record, store });
    }
    if (url.pathname === "/api/onboarding" && req.method === "GET") {
      const store = loadStore();
      return json(res, 200, onboardingSummary(store));
    }
    if (url.pathname === "/api/onboarding/upgrade-plan" && req.method === "POST") {
      const body = await readBody(req);
      const store = loadStore();
      const result = upgradeLegacyPlan(store, body);
      store.onboarding.dismissedAt = null;
      store.auditLog.push({ id: `audit-${Date.now()}`, type: "legacy-plan-upgraded", sourcePlanId: result.sourcePlanId, planId: result.plan.id, createdAt: new Date().toISOString() });
      saveStore(store, "onboarding-plan-upgrade");
      return json(res, 200, { ...result, onboarding: onboardingSummary(store), store });
    }
    if (url.pathname === "/api/onboarding/complete" && req.method === "POST") {
      const store = loadStore();
      const summary = onboardingSummary(store);
      if (!summary.steps.every(step => step.completed)) throw new Error("首次设置尚未完成，请先完成标的、证据和新版计划确认");
      store.onboarding.completedAt = new Date().toISOString();
      store.onboarding.dismissedAt = null;
      saveStore(store, "onboarding-completed");
      return json(res, 200, { onboarding: onboardingSummary(store), store });
    }
    if (url.pathname === "/api/onboarding/confirm-data" && req.method === "POST") {
      const store = loadStore();
      store.onboarding.dataConfirmedAt = new Date().toISOString();
      store.onboarding.dismissedAt = null;
      saveStore(store, "onboarding-data-confirmed");
      return json(res, 200, { onboarding: onboardingSummary(store), store });
    }
    if (url.pathname === "/api/onboarding/dismiss" && req.method === "POST") {
      const store = loadStore();
      store.onboarding.dismissedAt = new Date().toISOString();
      saveStore(store, "onboarding-dismissed");
      return json(res, 200, { onboarding: onboardingSummary(store), store });
    }
    if (url.pathname === "/api/backups" && req.method === "GET") {
      return json(res, 200, { backups: listBackups() });
    }
    if (url.pathname === "/api/backups/restore" && req.method === "POST") {
      const body = await readBody(req);
      const name = path.basename(String(body.name || ""));
      const file = path.join(BACKUP_DIR, name);
      if (!name.endsWith(".json") || !fs.existsSync(file)) return json(res, 404, { error: "备份版本不存在" });
      const restored = migrateStore(JSON.parse(fs.readFileSync(file, "utf8")));
      restored.auditLog.push({ id: `audit-${Date.now()}`, type: "backup-restored", source: name, createdAt: new Date().toISOString() });
      saveStore(attachRevision(restored, loadStore().__revision), "backup-restore");
      return json(res, 200, { store: restored, restoredFrom: name });
    }
    if (url.pathname === "/api/market-close/refresh" && req.method === "POST") {
      const body = await readBody(req);
      const result = await runClosingRefresh(String(body.date || localDateKey()), "manual");
      return json(res, 200, result);
    }
    if (url.pathname === "/api/codex/status" && req.method === "GET") {
      return json(res, 200, await getCodexStatus());
    }
    if (url.pathname === "/api/stocks/search" && req.method === "GET") {
      const store = loadStore();
      const stocks = await searchStocks(store, url.searchParams.get("q"));
      return json(res, 200, { stocks });
    }
    if (url.pathname === "/api/holdings" && req.method === "PUT") {
      const body = await readBody(req);
      const store = loadStore();
      if (!Array.isArray(body.holdings)) throw new Error("持仓格式错误");
      appendPositionReconciliationEvent(store, body.holdings, body.note || "手工持仓校正");
      store.auditLog.push({ id: `audit-${Date.now()}`, type: "positions-reconciled", createdAt: new Date().toISOString() });
      saveStore(store, "holdings");
      return json(res, 200, store);
    }
    if (url.pathname === "/api/account" && req.method === "PUT") {
      const body = await readBody(req);
      const store = loadStore();
      const availableCash = Number(body.availableCash);
      if (!Number.isFinite(availableCash) || availableCash < 0) throw new Error("可用现金必须是大于或等于0的数字");
      if (Math.abs(availableCash - Number(store.account.availableCash || 0)) > 0.005) {
        appendCashReconciliationEvent(store, availableCash, "券商账户快照现金校正");
      }
      store.account.todayPnl = body.todayPnl === "" || body.todayPnl == null
        ? null
        : Number(body.todayPnl);
      store.account.brokerTotalAssets = body.brokerTotalAssets === "" || body.brokerTotalAssets == null
        ? null
        : Number(body.brokerTotalAssets);
      if (store.account.brokerTotalAssets != null) {
        const marketValue = store.holdings.reduce((sum, holding) => sum + Number(holding.quantity || 0) * Number(holding.lastPrice || 0), 0);
        store.account.pendingSettlementAdjustment = +(store.account.brokerTotalAssets - Number(store.account.availableCash || 0) - marketValue).toFixed(2);
      }
      store.account.snapshotUpdatedAt = new Date().toISOString();
      if (Array.isArray(body.holdingPnl)) {
        for (const item of body.holdingPnl) {
          const holding = store.holdings.find(h => h.code === String(item.code));
          if (holding) {
            holding.brokerPnl = item.value === "" || item.value == null ? null : Number(item.value);
          }
        }
      }
      const snapshotSummary = accountSummary(store);
      store.accountSnapshots ||= [];
      store.accountSnapshots.push({
        id: `snapshot-${Date.now()}`,
        date: localDateKey(),
        capturedAt: store.account.snapshotUpdatedAt,
        netContributions: snapshotSummary.netContributions,
        brokerTotalAssets: store.account.brokerTotalAssets,
        grossAvailableCash: snapshotSummary.availableCash,
        pendingSettlementAdjustment: snapshotSummary.pendingSettlementAdjustment,
        adjustedAvailableCash: +(snapshotSummary.availableCash + snapshotSummary.pendingSettlementAdjustment).toFixed(2),
        marketValue: snapshotSummary.marketValue,
        cumulativePnl: snapshotSummary.cumulativePnl,
        cumulativeReturnPct: snapshotSummary.cumulativeReturnPct,
        source: "manual-broker-snapshot"
      });
      store.auditLog.push({ id: `audit-${Date.now()}`, type: "account-snapshot", createdAt: store.account.snapshotUpdatedAt });
      saveStore(store, "account-snapshot");
      return json(res, 200, store);
    }
    if (url.pathname === "/api/daily-session" && req.method === "PUT") {
      const body = await readBody(req);
      const store = loadStore();
      store.dailySessions ||= {};
      const date = String(body.date || localDateKey());
      store.dailySessions[date] = {
        ...(store.dailySessions[date] || {}),
        ...(body.session || {}),
        updatedAt: new Date().toISOString()
      };
      if (body.session?.postmarket) {
        store.plans.filter(plan => plan.planForDate === date && plan.status === "active").forEach(plan => {
          plan.status = "completed";
          plan.completedAt = new Date().toISOString();
          plan.updatedAt = plan.completedAt;
        });
      }
      saveStore(store, "daily-session");
      return json(res, 200, { date, session: store.dailySessions[date], nextPlan: null, store });
    }
    if (url.pathname === "/api/research/technicals" && req.method === "POST") {
      const body = await readBody(req);
      const store = loadStore();
      const research = await refreshResearchTechnicals(store, String(body.date || localDateKey()));
      store.auditLog.push({ id: `audit-${Date.now()}`, type: "research-technicals-refresh", researchId: research.id, createdAt: new Date().toISOString() });
      saveStore(store, "research-technicals");
      return json(res, 200, { research, store });
    }
    if (url.pathname === "/api/research/external-factors" && req.method === "PUT") {
      const body = await readBody(req);
      const store = loadStore();
      const result = upsertResearchExternalFactor(store, String(body.date || localDateKey()), body.factor || {});
      store.auditLog.push({ id: `audit-${Date.now()}`, type: "research-external-factor-saved", researchId: result.research.id, factorId: result.factor.id, createdAt: new Date().toISOString() });
      saveStore(store, "research-external-factor");
      return json(res, 200, { ...result, store });
    }
    if (url.pathname === "/api/plans/generate-from-review" && req.method === "POST") {
      const body = await readBody(req);
      const store = loadStore();
      const result = generatePlanFromResearch(store, String(body.date || localDateKey()));
      store.auditLog.push({ id: `audit-${Date.now()}`, type: "research-plan-generated", researchId: result.research.id, planId: result.plan.id, createdAt: new Date().toISOString() });
      saveStore(store, "research-plan");
      return json(res, 200, { ...result, store });
    }
    if (url.pathname === "/api/trades" && req.method === "POST") {
      const body = await readBody(req);
      const store = loadStore();
      const tradeDate = String(body.date || localDateKey());
      const applicablePlan = store.plans.find(plan => plan.planForDate === tradeDate && plan.status === "active");
      const plannedRules = applicablePlan?.rules || [];
      const matchedRule = plannedRules.find(rule => String(rule.code) === String(body.code));
      body.premarketPlanExists = Boolean(applicablePlan && matchedRule);
      body.planId = applicablePlan?.id || null;
      body.planVersion = applicablePlan?.version || null;
      body.planSnapshotKey = applicablePlan ? `${applicablePlan.id}:v${applicablePlan.version}` : null;
      body.planHash = applicablePlan?.contentHash || null;
      body.matchedRuleCode = matchedRule?.code || null;
      const trade = normalizeTrade(body);
      validateTradeForPosting(store, trade);
      const disciplineEvents = evaluateDiscipline(store, trade, applicablePlan, matchedRule);
      trade.disciplineEventIds = disciplineEvents.map(item => item.id);
      trade.violations = [...new Set([...detectViolations(store, trade), ...disciplineEvents.map(item => item.title)])];
      trade.accountApplied = true;
      store.trades.push(trade);
      store.disciplineEvents.push(...disciplineEvents);
      appendTradeEvent(store, trade);
      store.auditLog.push({ id: `audit-${Date.now()}`, type: "trade-created", tradeId: trade.id, date: trade.date, planId: trade.planId, planVersion: trade.planVersion, disciplineEventIds: trade.disciplineEventIds, createdAt: new Date().toISOString() });
      saveStore(store, "trade");
      return json(res, 201, { trade, disciplineEvents, store });
    }
    const feeRoute = url.pathname.match(/^\/api\/trades\/([^/]+)\/fee$/);
    if (feeRoute && req.method === "PUT") {
      const body = await readBody(req);
      const store = loadStore();
      const trade = store.trades.find(item => item.id === decodeURIComponent(feeRoute[1]));
      if (!trade) return json(res, 404, { error: "未找到这笔成交" });
      const nextFee = Number(body.fee);
      if (!Number.isFinite(nextFee) || nextFee < 0) throw new Error("费用必须是大于或等于0的数字");
      const isLedgerApplied = store.ledger.events.some(event => event.type === "TRADE_RECORDED" && String(event.tradeId) === String(trade.id))
        || (trade.accountApplied !== false && Number.isFinite(Number(trade.cashEffect)));
      const feeDelta = isLedgerApplied ? appendFeeAdjustmentEvent(store, trade, nextFee) : 0;
      if (!isLedgerApplied) {
        trade.fee = +nextFee.toFixed(2);
        trade.feePending = false;
        trade.feeUpdatedAt = new Date().toISOString();
      }
      const pendingSettlement = Number(store.account.pendingSettlementAdjustment || 0);
      if (pendingSettlement < 0 && feeDelta > 0) {
        store.account.pendingSettlementAdjustment = +(pendingSettlement + Math.min(feeDelta, Math.abs(pendingSettlement))).toFixed(2);
      } else if (pendingSettlement > 0 && feeDelta < 0) {
        store.account.pendingSettlementAdjustment = +(pendingSettlement - Math.min(Math.abs(feeDelta), pendingSettlement)).toFixed(2);
      }
      store.auditLog.push({ id: `audit-${Date.now()}`, type: "trade-fee-updated", tradeId: trade.id, fee: trade.fee, createdAt: new Date().toISOString() });
      saveStore(store, "trade-fee");
      return json(res, 200, { trade, store });
    }
    if (url.pathname === "/api/trades/import/preview" && req.method === "POST") {
      const body = await readBody(req);
      const source = loadStore();
      const previewStore = attachRevision(JSON.parse(JSON.stringify(source)), source.__revision);
      const result = importCsv(previewStore, body.csv, Boolean(body.updateHoldings));
      return json(res, 200, {
        imported: result.imported,
        skipped: result.skipped,
        summary: accountSummary(previewStore),
        blockingErrors: result.skipped.filter(item => item.reason !== "疑似重复记录")
      });
    }
    if (url.pathname === "/api/trades/import" && req.method === "POST") {
      const body = await readBody(req);
      const store = loadStore();
      const working = attachRevision(JSON.parse(JSON.stringify(store)), store.__revision);
      const result = importCsv(working, body.csv, Boolean(body.updateHoldings));
      const blockingErrors = result.skipped.filter(item => item.reason !== "疑似重复记录");
      if (body.atomic !== false && blockingErrors.length) {
        throw new Error(`CSV存在${blockingErrors.length}行错误，已取消整批导入`);
      }
      working.auditLog.push({ id: `audit-${Date.now()}`, type: "trade-import", imported: result.imported.length, skipped: result.skipped.length, createdAt: new Date().toISOString() });
      saveStore(working, "trade-import");
      return json(res, 200, { ...result, store: working });
    }
    if (url.pathname === "/api/quotes/refresh" && req.method === "POST") {
      const store = loadStore();
      const results = await Promise.allSettled(store.holdings.map(refreshQuoteWithFallback));
      const errors = [];
      results.forEach((result, index) => {
        if (result.status === "fulfilled") {
          store.holdings[index].lastPrice = result.value.price;
          store.holdings[index].name = result.value.name;
          store.holdings[index].changePct = result.value.changePct;
          store.holdings[index].quoteUpdatedAt = new Date().toISOString();
        } else {
          errors.push(`${store.holdings[index].name}: ${result.reason.message}`);
        }
      });
      saveStore(store, "quote-refresh");
      return json(res, 200, { holdings: store.holdings, errors });
    }
    if (url.pathname === "/api/review/export" && req.method === "POST") {
      const store = loadStore();
      const packet = buildReviewPacket(store);
      const file = path.join(REPORT_DIR, `review-latest.json`);
      fs.writeFileSync(file, JSON.stringify(packet, null, 2), "utf8");
      return json(res, 200, { file, packet });
    }
    if (url.pathname === "/api/analysis" && req.method === "POST") {
      const store = loadStore();
      const running = store.analyses.find(a => a.status === "running");
      if (running) return json(res, 409, { error: "已有分析任务正在运行", analysis: running });
      return json(res, 202, runCodexAnalysis(store));
    }
    if (url.pathname === "/api/analyses" && req.method === "GET") {
      const store = loadStore();
      const latestResearchAt = [...(store.researchSnapshots || [])].sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))[0]?.updatedAt;
      const analyses = store.analyses.map(analysis => {
        let content = "";
        if (analysis.status === "completed" && analysis.outputPath && fs.existsSync(analysis.outputPath)) content = fs.readFileSync(analysis.outputPath, "utf8");
        const staleAgainst = [store.account.snapshotUpdatedAt, latestResearchAt].filter(Boolean).sort().pop();
        const stale = Boolean(staleAgainst && analysis.startedAt && new Date(analysis.startedAt) < new Date(staleAgainst));
        return { ...analysis, content, reportExists: Boolean(content), stale, errorSummary: analysis.status === "failed" ? String(analysis.error || analysis.progress || "分析失败").split("\n")[0].slice(0, 240) : "" };
      });
      return json(res, 200, { analyses });
    }
    if (url.pathname.startsWith("/api/analysis/") && req.method === "GET") {
      const id = decodeURIComponent(url.pathname.split("/").pop());
      const store = loadStore();
      const analysis = store.analyses.find(a => a.id === id);
      if (!analysis) return json(res, 404, { error: "未找到分析任务" });
      let content = "";
      if (analysis.status === "completed" && fs.existsSync(analysis.outputPath)) {
        content = fs.readFileSync(analysis.outputPath, "utf8");
      }
      return json(res, 200, { ...analysis, content });
    }
    return serveStatic(req, res);
  } catch (error) {
    const message = String(error.message || "");
    if (/数据已被其他操作更新/.test(message)) return json(res, 409, { error: message });
    const isClientError = /必须|不能|超过|未找到|不存在|格式|数量|价格|费用|计划|CSV|取消整批|现金不足|达到.*上限/.test(message);
    return json(res, isClientError ? 400 : 500, { error: message });
  }
});

let closeRefreshRunning = false;
function missedCloseDate(store, now = new Date()) {
  const completedDates = Object.values(store.marketCloses || {})
    .filter(item => item.status === "completed")
    .map(item => item.date)
    .sort();
  const latestCompleted = completedDates.at(-1);
  if (!latestCompleted) return null;
  const cursor = new Date(`${latestCompleted}T12:00:00+08:00`);
  const today = localDateKey(now);
  for (let step = 0; step < 14; step += 1) {
    cursor.setDate(cursor.getDate() + 1);
    const date = localDateKey(cursor);
    if (date >= today) break;
    if ([0, 6].includes(cursor.getDay())) continue;
    if (store.marketCloses?.[date]?.status !== "completed") return date;
  }
  return null;
}

async function closingRefreshTick() {
  if (closeRefreshRunning) return;
  const now = new Date();
  const store = loadStore();
  if (store.settings?.autoCloseRefresh === false) return;
  const missedDate = missedCloseDate(store, now);
  if (missedDate) {
    closeRefreshRunning = true;
    try { await runClosingRefresh(missedDate, "automatic-backfill"); }
    catch (error) { console.error("遗漏收盘行情补跑失败：", error.message); }
    finally { closeRefreshRunning = false; }
    return;
  }
  if ([0, 6].includes(now.getDay())) return;
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (minutes < 15 * 60 + 35) return;
  const date = localDateKey(now);
  const snapshot = store.marketCloses?.[date];
  if (snapshot?.status === "completed") return;
  const attempts = Number(snapshot?.attempts || 0);
  if (attempts >= 3) return;
  if (snapshot?.lastAttemptAt) {
    const waitMinutes = attempts <= 1 ? 5 : 25;
    if (Date.now() - new Date(snapshot.lastAttemptAt).getTime() < waitMinutes * 60 * 1000) return;
  }
  closeRefreshRunning = true;
  try { await runClosingRefresh(date, attempts ? "automatic-retry" : "automatic"); }
  catch (error) { console.error("自动收盘行情失败：", error.message); }
  finally { closeRefreshRunning = false; }
}

server.listen(PORT, "127.0.0.1", () => {
  console.log(`交易纪律助手已启动：http://127.0.0.1:${PORT}`);
  setTimeout(closingRefreshTick, 2000);
  setInterval(closingRefreshTick, 60 * 1000);
});
