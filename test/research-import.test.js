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

test("AI research packets preview and import without overwriting user-owned fields", async t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "trade-research-import-"));
  const port = 41000 + Math.floor(Math.random() * 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(ROOT, "server.js")], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      TRADE_DATA_DIR: path.join(tempRoot, "data"),
      TRADE_REPORT_DIR: path.join(tempRoot, "reports")
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk.toString(); });
  t.after(async () => {
    child.kill();
    await new Promise(resolve => child.once("exit", resolve));
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  await waitForServer(baseUrl, child);
  let result = await request(baseUrl, "/api/research-import/prompts?target=600519");
  assert.equal(result.response.status, 200, stderr);
  assert.match(result.payload.researchPrompt, /600519/);
  assert.match(result.payload.writePrompt, /research-import-cli/);

  result = await request(baseUrl, "/api/planned-assets", {
    method: "PUT",
    body: JSON.stringify({
      code: "600519",
      name: "贵州茅台",
      status: "researching",
      expectedReturn: "风险收益比至少1:2",
      userMarketView: "只在估值与趋势条件同时满足时考虑"
    })
  });
  assert.equal(result.response.status, 200, stderr);

  const packet = {
    schemaVersion: "trade-research/v1",
    generatedAt: "2026-07-19T12:00:00+08:00",
    researchAsOf: "2026-07-18",
    asset: {
      code: "600519",
      name: "贵州茅台",
      market: "SH",
      status: "researching",
      industry: "白酒",
      fundamentalView: "基本面研究摘要",
      technicalView: "技术面数据截至研究日",
      volumePriceView: "量价研究摘要",
      trendView: "趋势研究摘要",
      upstream: "上游研究摘要",
      downstream: "下游研究摘要",
      linkedIndicators: "消费指数",
      aiResearchSummary: "中性研究摘要",
      expectedReturn: "AI试图覆盖",
      userMarketView: "AI试图冒充用户"
    },
    risks: [{ title: "需求风险", mechanism: "影响收入", observableSignal: "渠道数据", severity: "medium", evidenceRefs: ["F1"] }],
    catalysts: [],
    invalidationConditions: [{ condition: "核心事实发生反转", evidenceRefs: ["F1"] }],
    evidence: [
      { ref: "F1", kind: "fact", title: "公司公告", content: "公告中的可验证内容", source: "公司官网", sourceLevel: "L2", sourceUrl: "https://example.com/f1", publishedAt: "2026-07-18", confidence: "high" },
      { ref: "A1", kind: "analysis", title: "条件式分析", content: "该事实可能影响需求，仍需持续验证", evidenceRefs: ["F1"], confidence: "medium" }
    ],
    unknowns: ["最新渠道数据"],
    warnings: []
  };

  const beforePreview = await request(baseUrl, "/api/store");
  result = await request(baseUrl, "/api/research-import/preview", { method: "POST", body: JSON.stringify({ packet }) });
  assert.equal(result.response.status, 200, stderr);
  assert.equal(result.payload.valid, true);
  assert.equal(result.payload.summary.assetAction, "updated");
  assert.equal(result.payload.summary.factsCreated, 1);
  assert.ok(result.payload.summary.warnings.some(item => item.includes("已被忽略")));
  const afterPreview = await request(baseUrl, "/api/store");
  assert.equal(afterPreview.payload.evidenceRecords.length, beforePreview.payload.evidenceRecords.length);

  result = await request(baseUrl, "/api/research-import/commit", { method: "POST", body: JSON.stringify({ packet }) });
  assert.equal(result.response.status, 400, stderr);

  result = await request(baseUrl, "/api/research-import/commit", { method: "POST", body: JSON.stringify({ packet, confirmed: true }) });
  assert.equal(result.response.status, 200, stderr);
  assert.equal(result.payload.asset.expectedReturn, "风险收益比至少1:2");
  assert.equal(result.payload.asset.userMarketView, "只在估值与趋势条件同时满足时考虑");
  assert.equal(result.payload.asset.aiResearchSummary, "中性研究摘要");
  assert.equal(result.payload.summary.factsCreated, 1);
  assert.equal(result.payload.summary.analysesCreated, 1);
  const fact = result.payload.store.evidenceRecords.find(item => item.externalRef === "F1");
  const analysis = result.payload.store.evidenceRecords.find(item => item.externalRef === "A1");
  assert.deepEqual(analysis.evidenceIds, [fact.id]);

  result = await request(baseUrl, "/api/research-import/commit", { method: "POST", body: JSON.stringify({ packet, confirmed: true }) });
  assert.equal(result.response.status, 200, stderr);
  assert.equal(result.payload.summary.evidenceSkipped, 2);
  assert.equal(result.payload.store.evidenceRecords.length, 2);
});
