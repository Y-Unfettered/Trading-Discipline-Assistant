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
