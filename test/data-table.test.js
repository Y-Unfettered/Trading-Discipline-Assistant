"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");

test("business tables use searchable sortable paginated Data Tables", () => {
  const dataTable = read("src/components/app/DataTable.vue");
  assert.match(dataTable, /useVueTable/);
  assert.match(dataTable, /getSortedRowModel/);
  assert.match(dataTable, /getPaginationRowModel/);
  assert.match(dataTable, /table\.previousPage\(\)/);
  assert.match(dataTable, /table\.nextPage\(\)/);
  for (const page of ["OverviewPage.vue", "DataPage.vue", "PostmarketPage.vue", "StockPnlPage.vue"]) {
    assert.match(read(`src/pages/${page}`), /<DataTable/);
  }
  assert.doesNotMatch(read("src/pages/DataPage.vue"), /<Table/);
});

test("broker account snapshot UI is retired without deleting stored history", () => {
  const funds = read("src/pages/FundsPage.vue");
  const postmarket = read("src/pages/PostmarketPage.vue");
  const stockPnl = read("src/pages/StockPnlPage.vue");
  assert.doesNotMatch(funds, /账户快照历史|accountSnapshots/);
  assert.doesNotMatch(postmarket, /券商账户快照|saveSnapshot|brokerTotalAssets/);
  assert.match(stockPnl, /不依赖券商快照/);
  assert.match(stockPnl, /realizedPnlEstimate/);
  assert.match(stockPnl, /holdingPnl\(holding\)/);
});
