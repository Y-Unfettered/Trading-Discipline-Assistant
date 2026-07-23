"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const app = fs.readFileSync(path.join(__dirname, "../src/App.vue"), "utf8");
const page = fs.readFileSync(path.join(__dirname, "../src/pages/ProbabilityPage.vue"), "utf8");

test("probability reports freeze definitions, evidence, calibration, and resolution", () => {
  assert.match(app, /page: 'probability'/);
  assert.match(app, /ProbabilityPage/);
  assert.match(page, /概率研报/);
  assert.match(page, /没有足够历史样本时只展示相对证据权重/);
  assert.match(page, /每个信号都必须绑定证据编号/);
  assert.match(page, /至少 30 个已结算同口径样本/);
  assert.match(page, /冻结并保存/);
  assert.match(page, /到期结算/);
  assert.match(page, /\/api\/probability-reports/);
});
