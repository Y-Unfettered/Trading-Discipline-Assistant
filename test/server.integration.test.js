"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");

async function waitForServer(baseUrl, child) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode != null) throw new Error(`server exited with ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/api/dashboard`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("server did not become ready");
}

async function request(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const payload = await response.json();
  return { response, payload };
}

test("v0.2 API keeps plans, ledger, imports and latest review in one transaction boundary", async t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "trade-discipline-test-"));
  const dataDir = path.join(tempRoot, "data");
  const reportDir = path.join(tempRoot, "reports");
  const port = 39000 + Math.floor(Math.random() * 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(ROOT, "server.js")], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), TRADE_DATA_DIR: dataDir, TRADE_REPORT_DIR: reportDir },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk.toString(); });
  t.after(async () => {
    child.kill();
    await new Promise(resolve => child.once("exit", resolve));
    const resolved = path.resolve(tempRoot);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir())) && path.basename(resolved).startsWith("trade-discipline-test-"));
    fs.rmSync(resolved, { recursive: true, force: true });
  });

  await waitForServer(baseUrl, child);
  const today = new Date().toISOString().slice(0, 10);

  let result = await request(baseUrl, "/api/account", { method: "PUT", body: JSON.stringify({ availableCash: 10000, brokerTotalAssets: "", todayPnl: "" }) });
  assert.equal(result.response.status, 200, stderr);

  result = await request(baseUrl, "/api/plans", { method: "PUT", body: JSON.stringify({
    planForDate: today,
    status: "active",
    trainingFocus: "只按条件执行",
    rules: [{ code: "000001", name: "测试股票", wait: "等待", sell: "减仓", stop: "止损", forbidden: "不追涨" }]
  }) });
  assert.equal(result.response.status, 200, stderr);
  assert.equal(result.payload.plan.version, 1);
  const planId = result.payload.plan.id;

  result = await request(baseUrl, "/api/trades", { method: "POST", body: JSON.stringify({
    date: today, time: "10:00", code: "000001", name: "测试股票", side: "BUY", quantity: 100, price: 10, fee: 5,
    reason: "计划条件已经触发", planFollowed: true, executionStatus: "followed"
  }) });
  assert.equal(result.response.status, 201, stderr);
  assert.equal(result.payload.trade.premarketPlanExists, true);
  assert.ok(!result.payload.trade.violations.includes("无盘前计划"));
  const tradeId = result.payload.trade.id;

  result = await request(baseUrl, "/api/account", { method: "PUT", body: JSON.stringify({ availableCash: 8995, brokerTotalAssets: 9993, todayPnl: "" }) });
  assert.equal(result.response.status, 200, stderr);
  assert.equal(result.payload.account.pendingSettlementAdjustment, -2);

  result = await request(baseUrl, `/api/trades/${encodeURIComponent(tradeId)}/fee`, { method: "PUT", body: JSON.stringify({ fee: 7 }) });
  assert.equal(result.response.status, 200, stderr);
  assert.equal(result.payload.store.account.availableCash, 8993);
  assert.equal(result.payload.store.account.pendingSettlementAdjustment, 0);

  result = await request(baseUrl, "/api/plans", { method: "PUT", body: JSON.stringify({
    id: planId,
    planForDate: today,
    status: "active",
    trainingFocus: "修改后仍只按条件执行",
    rules: [{ code: "000001", name: "测试股票", wait: "等待", sell: "减仓", stop: "止损", forbidden: "不追涨" }]
  }) });
  assert.equal(result.response.status, 200, stderr);
  assert.equal(result.payload.plan.version, 2);

  result = await request(baseUrl, "/api/research/external-factors", { method: "PUT", body: JSON.stringify({
    date: today,
    factor: { category: "公司公告", title: "测试公告", source: "测试交易所", impact: "只在条件满足时调整风险", url: "https://example.com/source", publishedAt: today }
  }) });
  assert.equal(result.response.status, 200, stderr);
  assert.equal(result.payload.factor.source, "测试交易所");

  const beforeImport = await request(baseUrl, "/api/store");
  const csv = `成交日期,成交时间,证券代码,证券名称,买卖标志,成交数量,成交价格,费用合计\n${today.replaceAll("-", "")},10:02:00,000002,测试二号,买入,100,5,5\n${today.replaceAll("-", "")},10:03:00,000003,测试三号,未知,100,5,5`;
  result = await request(baseUrl, "/api/trades/import/preview", { method: "POST", body: JSON.stringify({ csv, updateHoldings: true }) });
  assert.equal(result.response.status, 200, stderr);
  assert.equal(result.payload.blockingErrors.length, 1);

  result = await request(baseUrl, "/api/trades/import", { method: "POST", body: JSON.stringify({ csv, updateHoldings: true, atomic: true }) });
  assert.equal(result.response.status, 400, stderr);
  const afterImport = await request(baseUrl, "/api/store");
  assert.equal(afterImport.payload.trades.length, beforeImport.payload.trades.length);
  assert.ok(afterImport.payload.ledger.events.length >= 3);
  assert.equal(afterImport.payload.planVersions.length, 2);
  assert.deepEqual(afterImport.payload.planVersions.map(item => item.version), [1, 2]);
  assert.equal(afterImport.payload.researchSnapshots[0].externalFactors.length, 1);

  assert.ok(fs.existsSync(path.join(dataDir, "trade-discipline.sqlite")));
  assert.ok(fs.existsSync(path.join(reportDir, "review-latest.json")));
});
