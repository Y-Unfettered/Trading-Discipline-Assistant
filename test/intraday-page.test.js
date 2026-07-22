"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const page = fs.readFileSync(path.join(__dirname, "../src/pages/IntradayPage.vue"), "utf8");
const stockPicker = fs.readFileSync(path.join(__dirname, "../src/components/app/StockPicker.vue"), "utf8");

test("intraday action cards are compact, plan-driven, and expandable", () => {
  assert.match(page, /const actionCards = computed/);
  assert.match(page, /md:grid-cols-2 xl:grid-cols-3/);
  assert.match(page, /关键执行条件/);
  assert.match(page, /信息不足时/);
  assert.match(page, /完整盘中计划/);
  assert.match(page, /日期总原则/);
  assert.match(page, /动作与风险/);
  assert.match(page, /三种情景/);
  assert.match(page, /执行边界/);
  assert.match(page, /@click="openRuleDetail\(card\)"/);
});

test("actual trade entry opens from the heading or a selected action card", () => {
  assert.match(page, /<template #meta><Badge variant="outline">默认不显示实时行情<\/Badge><\/template>/);
  assert.match(page, /<template #actions><Button type="button" @click="openTradeDialog\(\)"/);
  assert.match(page, /@click\.stop="openTradeDialog\(card\)"/);
  assert.match(page, /<Dialog v-model:open="tradeDialogOpen">/);
  assert.match(page, /form\.ruleTrigger = card\.rule\?\.triggerCondition/);
  assert.match(page, /已带入 \{\{ selectedTradeAsset\.name \}\}/);
  assert.doesNotMatch(page, /<CardTitle>记录一笔实际成交<\/CardTitle>/);
});

test("buy entry restores searchable stock matching and never asks for a manual code", () => {
  assert.match(page, /<StockPicker v-model="selectedStock"/);
  assert.match(page, /<Input v-model="form\.code" readonly required/);
  assert.match(page, /请先从股票匹配下拉列表中选择正确的证券/);
  assert.match(stockPicker, /\/api\/stocks\/search\?q=/);
  assert.match(stockPicker, /setTimeout\(\(\) => searchStocks\(keyword\), 300\)/);
  assert.match(stockPicker, /role="combobox"/);
  assert.match(stockPicker, /role="listbox"/);
  assert.match(stockPicker, /@compositionstart="onCompositionStart"/);
  assert.match(stockPicker, /@compositionend="onCompositionEnd"/);
  assert.match(stockPicker, /choose\(stock\)/);
});
