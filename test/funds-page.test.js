"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const page = fs.readFileSync(path.join(__dirname, "../src/pages/FundsPage.vue"), "utf8");
const dataTable = fs.readFileSync(path.join(__dirname, "../src/components/app/LedgerDataTable.vue"), "utf8");

test("annual funds table is the editable account ledger", () => {
  assert.match(page, /年度资金明细 · 账户总账/);
  assert.match(page, /点击任意一行可修改/);
  assert.match(page, /<LedgerDataTable :data="cashRows" @edit="openEdit" @delete="requestDelete"/);
  assert.match(dataTable, /useVueTable/);
  assert.match(dataTable, /getSortedRowModel/);
  assert.match(dataTable, /搜索年度资金明细/);
  assert.match(dataTable, /table\.getRowModel\(\)\.rows/);
  assert.match(dataTable, /table\.previousPage\(\)/);
  assert.match(dataTable, /emit\('edit', row\.original\)/);
  assert.match(page, /\/api\/trades\/\$\{encodeURIComponent\(editForm\.id\)\}/);
  assert.match(page, /\/api\/funding/);
  assert.match(page, /保存并重算账户/);
  assert.match(page, /确认删除并重算/);
  assert.match(page, /若导致卖出数量超过持仓，删除会被拒绝/);
});
