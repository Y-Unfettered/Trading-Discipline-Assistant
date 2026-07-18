const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const STORE_FILE = path.join(DATA_DIR, "store.json");
const STOCK_CACHE_FILE = path.join(DATA_DIR, "stocks.json");
const A_SHARE_STOCKS_FILE = path.join(DATA_DIR, "a-share-stocks.json");
const REPORT_DIR = path.join(ROOT, "reports");
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
  store.schemaVersion ||= 2;
  store.account ||= {};
  store.holdings ||= [];
  store.trades ||= [];
  store.orders ||= [];
  store.dailySessions ||= {};
  store.analyses ||= [];
  store.plans ||= [];
  store.marketCloses ||= {};
  store.auditLog ||= [];
  store.stockPnlSnapshots ||= [];
  store.researchSnapshots ||= [];
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
  return store;
}

function loadStore() {
  if (!fs.existsSync(STORE_FILE)) {
    fs.writeFileSync(STORE_FILE, JSON.stringify(initialStore, null, 2), "utf8");
  }
  return migrateStore(JSON.parse(fs.readFileSync(STORE_FILE, "utf8")));
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
  store.schemaVersion = 2;
  store.updatedAt = new Date().toISOString();
  const tmp = `${STORE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf8");
  fs.renameSync(tmp, STORE_FILE);
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
  const aShareStocks = loadAshareStocks();
  return [...new Map(
    [...aShareStocks, ...holdings].map(stock => [stock.code, stock])
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
  if (!(quantity > 0) || !(price > 0)) throw new Error("数量和价格必须大于0");
  return {
    id: input.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    date: input.date || localDateKey(),
    time: input.time || new Date().toTimeString().slice(0, 5),
    code: String(input.code || "").trim(),
    name: String(input.name || "").trim(),
    side,
    quantity,
    price,
    fee: input.fee === "" || input.fee == null ? null : Number(input.fee),
    reason: String(input.reason || "").trim(),
    premarketPlanExists: Boolean(input.premarketPlanExists),
    planFollowed: Boolean(input.planFollowed ?? input.planBeforeTrade),
    planBeforeTrade: Boolean(input.premarketPlanExists),
    emotion: String(input.emotion || "").trim(),
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
      if (updateHoldings) {
        if (trade.side === "SELL") {
          const holding = store.holdings.find(item => item.code === trade.code);
          if (!holding || holding.quantity < trade.quantity) throw new Error("导入卖出数量超过当前持仓，未更新账本");
        }
        applyTradeToHolding(store, trade, true);
      }
      store.trades.push(trade);
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
  return { score: Math.max(0, 100 - issues.reduce((sum, issue) => sum + (issue.level === "error" ? 30 : issue.level === "warning" ? 10 : 3), 0)), issues };
}

function selectedPlan(store, requestedDate) {
  const plans = [...store.plans].sort((a, b) => `${b.planForDate} ${b.updatedAt || b.createdAt}`.localeCompare(`${a.planForDate} ${a.updatedAt || a.createdAt}`));
  if (requestedDate) return plans.find(plan => plan.planForDate === requestedDate) || null;
  const today = localDateKey();
  const todayPlan = plans.find(plan => plan.planForDate === today && ["active", "draft"].includes(plan.status));
  if (todayPlan) return todayPlan;
  const future = plans.filter(plan => plan.planForDate > today && plan.status !== "archived").sort((a, b) => a.planForDate.localeCompare(b.planForDate))[0];
  return future || plans[0] || null;
}

function upsertPlan(store, input) {
  const planForDate = String(input.planForDate || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(planForDate)) throw new Error("计划必须指定适用交易日");
  let plan = input.id ? store.plans.find(item => item.id === input.id) : store.plans.find(item => item.planForDate === planForDate && item.status !== "archived");
  const now = new Date().toISOString();
  if (!plan) {
    plan = { id: `plan-${planForDate}-${Date.now()}`, planForDate, version: 1, createdAt: now };
    store.plans.push(plan);
  } else {
    plan.version = Number(plan.version || 0) + 1;
  }
  Object.assign(plan, {
    planForDate,
    sourceReviewDate: input.sourceReviewDate || plan.sourceReviewDate || null,
    status: input.status || plan.status || "draft",
    previousAdvice: String(input.previousAdvice || ""),
    marketObservation: String(input.marketObservation || ""),
    accountRules: String(input.accountRules || ""),
    trainingFocus: String(input.trainingFocus || ""),
    rules: Array.isArray(input.rules) ? input.rules : [],
    generatedFromResearchId: input.generatedFromResearchId || plan.generatedFromResearchId || null,
    generationBasis: input.generationBasis || plan.generationBasis || null,
    confirmedAt: input.status === "active" ? now : plan.confirmedAt || null,
    updatedAt: now
  });
  return plan;
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
    generatedAt: new Date().toISOString(),
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
    latestStockPnlSnapshot: [...(store.stockPnlSnapshots || [])].sort((a, b) => String(b.asOfDate).localeCompare(String(a.asOfDate)))[0] || null,
    latestResearchSnapshot: [...(store.researchSnapshots || [])].sort((a, b) => String(b.reviewDate).localeCompare(String(a.reviewDate)))[0] || null,
    dailySession: store.dailySessions?.[today] || null,
    activePlan: selectedPlan(store),
    marketClose: store.marketCloses?.[today] || null,
    accountSummary: accountSummary(store),
    dataHealth: dataHealth(store),
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
        plan: selectedPlan(store, url.searchParams.get("date")),
        nextTradingDate: nextTradingDate(new Date()),
        latestMarketClose: Object.values(store.marketCloses || {}).sort((a, b) => b.date.localeCompare(a.date))[0] || null
      });
    }
    if (url.pathname === "/api/plans" && req.method === "GET") {
      const store = loadStore();
      return json(res, 200, { plans: [...store.plans].sort((a, b) => b.planForDate.localeCompare(a.planForDate)), selected: selectedPlan(store, url.searchParams.get("date")) });
    }
    if (url.pathname === "/api/plans" && req.method === "PUT") {
      const body = await readBody(req);
      const store = loadStore();
      const plan = upsertPlan(store, body);
      store.auditLog.push({ id: `audit-${Date.now()}`, type: "plan-saved", planId: plan.id, planForDate: plan.planForDate, version: plan.version, createdAt: new Date().toISOString() });
      saveStore(store, "plan");
      return json(res, 200, { plan, store });
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
      backupStore("before-restore");
      restored.auditLog.push({ id: `audit-${Date.now()}`, type: "backup-restored", source: name, createdAt: new Date().toISOString() });
      const tmp = `${STORE_FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(restored, null, 2), "utf8");
      fs.renameSync(tmp, STORE_FILE);
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
      store.holdings = Array.isArray(body.holdings) ? body.holdings : store.holdings;
      saveStore(store, "holdings");
      return json(res, 200, store);
    }
    if (url.pathname === "/api/account" && req.method === "PUT") {
      const body = await readBody(req);
      const store = loadStore();
      store.account.availableCash = Number(body.availableCash || 0);
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
      const plannedRules = store.dailySessions?.[String(body.date || localDateKey())]?.premarket?.rules || [];
      body.premarketPlanExists = plannedRules.some(rule => String(rule.code) === String(body.code));
      const trade = normalizeTrade(body);
      if (trade.side === "SELL") {
        const holding = store.holdings.find(h => h.code === trade.code);
        if (!holding || holding.quantity < trade.quantity) throw new Error("卖出数量不能超过当前持仓数量");
      }
      trade.violations = detectViolations(store, trade);
      applyTradeToHolding(store, trade, true);
      store.trades.push(trade);
      store.auditLog.push({ id: `audit-${Date.now()}`, type: "trade-created", tradeId: trade.id, date: trade.date, createdAt: new Date().toISOString() });
      saveStore(store, "trade");
      return json(res, 201, { trade, store });
    }
    const feeRoute = url.pathname.match(/^\/api\/trades\/([^/]+)\/fee$/);
    if (feeRoute && req.method === "PUT") {
      const body = await readBody(req);
      const store = loadStore();
      const trade = store.trades.find(item => item.id === decodeURIComponent(feeRoute[1]));
      if (!trade) return json(res, 404, { error: "未找到这笔成交" });
      updateTradeFee(store, trade, Number(body.fee));
      store.auditLog.push({ id: `audit-${Date.now()}`, type: "trade-fee-updated", tradeId: trade.id, fee: trade.fee, createdAt: new Date().toISOString() });
      saveStore(store, "trade-fee");
      return json(res, 200, { trade, store });
    }
    if (url.pathname === "/api/trades/import" && req.method === "POST") {
      const body = await readBody(req);
      const store = loadStore();
      const result = importCsv(store, body.csv, Boolean(body.updateHoldings));
      saveStore(store, "trade-import");
      return json(res, 200, { ...result, store });
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
    const isClientError = /必须|不能|超过|未找到|不存在|格式|数量|价格|费用|计划/.test(String(error.message || ""));
    return json(res, isClientError ? 400 : 500, { error: error.message });
  }
});

let closeRefreshRunning = false;
async function closingRefreshTick() {
  if (closeRefreshRunning) return;
  const now = new Date();
  if ([0, 6].includes(now.getDay())) return;
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (minutes < 15 * 60 + 35) return;
  const store = loadStore();
  if (store.settings?.autoCloseRefresh === false) return;
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
