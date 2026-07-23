"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = relative => fs.readFileSync(path.join(ROOT, relative), "utf8");

test("asset center opens candidate create and edit flows in dialogs and opens asset details from cards", () => {
  const page = read("src/pages/AssetsPage.vue");
  assert.match(page, /const assetDialogOpen = ref\(false\)/);
  assert.match(page, /const evidenceDialogOpen = ref\(false\)/);
  assert.match(page, /const aiDialogOpen = ref\(false\)/);
  assert.match(page, /<Dialog :open="assetDialogOpen" @update:open="setAssetDialogOpen">/);
  assert.match(page, /id="candidate-dialog-form"/);
  assert.match(page, /assetForm\.id \? '编辑候选标的' : '新增候选标的'/);
  assert.match(page, /assetForm\.id \? '保存修改' : '保存候选标的'/);
  assert.match(page, /<Dialog :open="evidenceDialogOpen" @update:open="setEvidenceDialogOpen">/);
  assert.match(page, /id="evidence-dialog-form"/);
  assert.match(page, /evidenceDialogOpen\.value = false; resetEvidence\(\); emit\('refresh'\)/);
  assert.match(page, /@click="openAssetDetail\(asset\)"/);
  assert.match(page, /<AssetDetailView v-if="selectedAsset"/);
  assert.match(page, /新增公司传导关系/);
  assert.match(page, /\/api\/company-relations/);
  assert.match(page, /支持或反证必须引用事实卡/);
  assert.match(page, /<Dialog v-model:open="aiDialogOpen">/);
  assert.match(page, /line-clamp-3/);
  assert.match(page, /asset\.aiResearchSummary \|\| '暂无 AI 简介/);
});

test("asset details distinguish publication time from capture time and expose source metadata", () => {
  const detail = read("src/pages/AssetDetailView.vue");
  assert.match(detail, /item\.externalRef/);
  assert.match(detail, /item\.sourceLevel/);
  assert.match(detail, /item\.sourceUrl/);
  assert.match(detail, /发布时间：.*item\.publishedAt/);
  assert.match(detail, /录入时间：.*item\.createdAt/);
  assert.match(detail, /我的收益要求/);
  assert.match(detail, /逻辑失效条件/);
  assert.match(detail, /split\(\/\\n\+\|\[；;\]\+\//);
  assert.match(detail, /产业链与外部关联/);
  assert.match(detail, /上游输入/);
  assert.match(detail, /下游需求/);
  assert.match(detail, /severityVariant/);
  assert.match(detail, /公司传导关系图/);
  assert.match(detail, /行业概念不能替代公司资格/);
  assert.match(detail, /supportedRelationCount/);
});

test("global workspace keeps the header outside scrolling content and offers back to top", () => {
  const app = read("src/App.vue");
  assert.match(app, /SidebarProvider[^>]+class="h-svh overflow-hidden"/);
  assert.match(app, /<header class="[^"]*shrink-0[^"]*border-b/);
  assert.match(app, /data-workspace-scroll class="[^"]*flex-1[^"]*overflow-y-auto/);
  assert.match(app, /showBackToTop/);
  assert.match(app, /class="absolute bottom-24 right-6" size="icon"/);
  assert.match(app, /aria-label="返回顶部"[^>]*><ArrowUp class="size-4" \/><\/Button>/);
});
