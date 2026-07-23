"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const page = fs.readFileSync(path.join(__dirname, "../src/pages/OverviewPage.vue"), "utf8");

test("overview exposes the discipline closure and one current training target", () => {
  assert.match(page, /disciplineV2/);
  assert.match(page, /纪律评分闭环/);
  assert.match(page, /今日正式纪律分/);
  assert.match(page, /待正式评估/);
  assert.match(page, /最近20次决策/);
  assert.match(page, /当前唯一训练目标/);
  assert.match(page, /disciplineV2\.trainingTarget/);
});
