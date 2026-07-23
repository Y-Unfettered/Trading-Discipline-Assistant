"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const page = fs.readFileSync(path.join(__dirname, "../src/pages/PostmarketPage.vue"), "utf8");

test("postmarket actions use Sonner instead of an inline operation-result alert", () => {
  assert.match(page, /import \{ toast \} from 'vue-sonner'/);
  assert.match(page, /toast\.success\(success\)/);
  assert.match(page, /toast\.error\('操作失败'/);
  assert.doesNotMatch(page, /<Alert v-if="message"/);
  assert.doesNotMatch(page, /<AlertTitle>操作结果<\/AlertTitle>/);
});

test("behavior evidence is summarized on the page and edited in a dialog", () => {
  assert.match(page, /const reviewDialogOpen = ref\(false\)/);
  assert.match(page, /<Badge variant="outline">\{\{ reviewSavedAt \? dateTime\(reviewSavedAt\) : '尚未保存' \}\}<\/Badge>/);
  assert.match(page, /填写 \/ 查看行为证据/);
  assert.match(page, /<Dialog v-model:open="reviewDialogOpen">/);
  assert.match(page, /正文在弹窗中查看和编辑/);
  assert.doesNotMatch(page, /<CardContent><form class="space-y-4" @submit\.prevent="saveReview">/);
});

test("postmarket review finalizes each trade and separates process from outcome", () => {
  assert.match(page, /逐笔纪律评估/);
  assert.match(page, /过程结论/);
  assert.match(page, /结果记录/);
  assert.match(page, /不进入纪律分/);
  assert.match(page, /\/discipline-preview/);
  assert.match(page, /\/api\/discipline-assessments/);
  assert.match(page, /确认并保存正式评分/);
});
