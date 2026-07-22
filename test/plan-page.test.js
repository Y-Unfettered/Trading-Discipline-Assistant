"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const page = fs.readFileSync(path.join(ROOT, "src/pages/PlanPage.vue"), "utf8");

test("next-day plan uses a four-step dialog with a persistent save action", () => {
  assert.match(page, /const activeStep = ref\(1\)/);
  assert.match(page, /<Dialog v-model:open="planDialogOpen">/);
  assert.match(page, /<Stepper v-model="activeStep"/);
  assert.match(page, /<StepperItem v-for="step in steps"/);
  assert.match(page, /<ScrollArea class="h-\[55vh\] pr-4">/);
  assert.match(page, /@submit\.prevent="requestSave"/);
  assert.match(page, /type="submit"[^>]*>.*保存计划版本/);
});

test("plan actions use direct multi-select choices", () => {
  assert.match(page, /const actionOptions = \[/);
  assert.match(page, /function toggleAllowedAction/);
  assert.match(page, /<Checkbox :model-value="isActionSelected\(rule, action\)"/);
  assert.match(page, /@update:model-value="value => toggleAllowedAction\(rule, action, value === true\)"/);
  assert.match(page, /最大持仓占比 · 我填写/);
});

test("save confirm and invalidate each collect their own reason in a dialog", () => {
  assert.match(page, /const saveReasonDialogOpen = ref\(false\)/);
  assert.match(page, /const confirmDialogOpen = ref\(false\)/);
  assert.match(page, /const invalidateDialogOpen = ref\(false\)/);
  assert.match(page, /<Dialog v-model:open="saveReasonDialogOpen">/);
  assert.match(page, /<Dialog v-model:open="confirmDialogOpen">/);
  assert.match(page, /<Dialog v-model:open="invalidateDialogOpen">/);
  assert.doesNotMatch(page, /<CardTitle>保存与确认<\/CardTitle>/);
  assert.match(page, /本次保存原因（选填）/);
  assert.match(page, /确认说明（选填）/);
  assert.match(page, /这一页全部选填/);
  assert.match(page, /选填项缺失不会阻止确认/);
});

test("plan loading and mutations report through Sonner", () => {
  assert.match(page, /import \{ toast \} from 'vue-sonner'/);
  assert.match(page, /toast\.success\(`已加载/);
  assert.match(page, /toast\.info\(`\$\{form\.planForDate\} 暂无计划/);
  assert.match(page, /toast\.error\('计划加载失败'/);
  assert.doesNotMatch(page, /v-if="message"/);
});

test("current plan is visible by default and history switches from a compact popover", () => {
  assert.match(page, /v-if="hasPlan" class="grid gap-3 sm:grid-cols-2"/);
  assert.match(page, /<Popover v-model:open="versionsOpen">/);
  assert.match(page, /<ScrollArea class="h-72 pr-3">/);
  assert.match(page, /@click="previewVersion\(item\)"/);
  assert.doesNotMatch(page, /<Accordion/);
});

test("Sonner messages are globally placed above dialogs at the top center", () => {
  const app = fs.readFileSync(path.join(ROOT, "src/App.vue"), "utf8");
  const entry = fs.readFileSync(path.join(ROOT, "src/main.ts"), "utf8");
  assert.match(app, /<Toaster position="top-center" rich-colors close-button :visible-toasts="4" \/>/);
  assert.match(app, /<\/SidebarProvider>\s*<Toaster position="top-center"/);
  assert.match(entry, /import 'vue-sonner\/style\.css'/);
});

test("confirmation failure stays visible in the dialog while success closes the plan editor", () => {
  assert.match(page, /const confirmError = ref\(''\)/);
  assert.match(page, /confirmError\.value = message\.replace\(\/；\/g, '；\\n'\)/);
  assert.match(page, /<Alert v-if="confirmError" variant="destructive">/);
  assert.match(page, /<AlertTitle>暂时不能确认<\/AlertTitle>/);
  assert.match(page, /计划仍为待确认，请查看确认窗口里的缺失项目。/);
  assert.match(page, /confirmDialogOpen\.value = false\s+planDialogOpen\.value = false/);
});

test("AI draft generation is explicit, reviewable, and preserves user-owned fields", () => {
  const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  const cli = fs.readFileSync(path.join(ROOT, "scripts/plan-ai-import-cli.mjs"), "utf8");
  assert.match(page, /生成 \/ 补全 AI 草稿/);
  assert.match(page, /<Dialog :open="aiDraftDialogOpen" @update:open="handleAiDraftDialogOpen">/);
  assert.match(page, /value="fill-empty">仅补全空白 AI 字段（推荐）/);
  assert.match(page, /value="replace-ai">重新生成全部 AI 字段/);
  assert.match(page, /function shouldWriteAiField/);
  assert.match(page, /api<any>\('\/api\/plans\/ai-draft'/);
  assert.match(page, /不会自动保存或生效/);
  assert.match(page, /<Progress :model-value="aiDraftProgress" \/>/);
  assert.match(page, /aiDraftJob\.steps/);
  assert.match(page, /资料整理、Codex 生成、结果校验和表单写入状态/);
  assert.match(page, /重新查询进度/);
  assert.match(page, /复制生成提示词/);
  assert.match(page, /复制写入应用提示词/);
  assert.match(page, /下载 AI 资料包/);
  assert.match(page, /刷新写入结果/);
  assert.match(page, /没有写入任何字段/);
  assert.match(page, /AI 草稿未写入/);
  assert.match(server, /url\.pathname === "\/api\/plans\/ai-draft"/);
  assert.match(server, /startAiPlanDraftJob\(store, body\)/);
  assert.match(server, /aiPlanDraftJobRoute/);
  assert.match(server, /label: "整理资料"/);
  assert.match(server, /label: "Codex 生成"/);
  assert.match(server, /label: "校验结果"/);
  assert.match(server, /label: "写入表单"/);
  assert.match(server, /stableOutputChecks/);
  assert.match(server, /生成超过 4 分钟且没有返回草稿/);
  assert.match(server, /只生成 AI 辅助字段，不得生成、修改或建议覆盖用户专属字段/);
  assert.match(server, /expectedReturn、userMarketView、direction、allowedActions、maxPositionPct/);
  assert.match(server, /url\.pathname === "\/api\/plan-ai-import\/prompts"/);
  assert.match(server, /url\.pathname === "\/api\/plan-ai-import\/preview"/);
  assert.match(server, /url\.pathname === "\/api\/plan-ai-import\/commit"/);
  assert.match(server, /url\.pathname === "\/api\/plan-ai-import\/context-download"/);
  assert.match(server, /planAiContextFileName/);
  assert.match(server, /generatePrompt\.length > 2000 \|\| writePrompt\.length > 2000/);
  assert.match(server, /PLAN_AI_SCHEMA_VERSION = "trade-plan-ai\/v1"/);
  assert.match(server, /if \(!preview\.summary\.changedCount\)/);
  assert.match(server, /AI 草稿不完整，缺少/);
  assert.match(cli, /preview <AI计划包\.json>/);
  assert.match(cli, /if \(!result\.summary\?\.changedCount\)/);
  assert.match(cli, /confirmed: true/);
});
