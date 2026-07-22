"use strict";

const SCHEMA_VERSION = "trade-research/v1";
const ASSET_STATUSES = new Set(["watching", "researching", "planning", "planned", "paused"]);
const CONFIDENCE_LEVELS = new Set(["high", "medium", "low"]);

function text(value) {
  return value == null ? "" : String(value).trim();
}

function required(value, label) {
  const result = text(value);
  if (!result) throw new Error(`${label}必须填写`);
  return result;
}

function uniqueTextArray(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(text).filter(Boolean))];
}

function normalizeEvidence(item, index) {
  if (!item || typeof item !== "object") throw new Error(`第${index + 1}张证据卡格式错误`);
  const kind = text(item.kind);
  if (!new Set(["fact", "analysis"]).has(kind)) throw new Error(`证据卡${item.ref || index + 1}类型必须是fact或analysis`);
  const ref = required(item.ref, `第${index + 1}张证据卡ref`);
  const normalized = {
    ref,
    kind,
    title: required(item.title, `证据卡${ref}标题`),
    content: required(item.content, `证据卡${ref}内容`),
    confidence: CONFIDENCE_LEVELS.has(text(item.confidence)) ? text(item.confidence) : "medium",
    source: text(item.source),
    sourceLevel: text(item.sourceLevel),
    sourceUrl: text(item.sourceUrl),
    publishedAt: text(item.publishedAt),
    evidenceRefs: uniqueTextArray(item.evidenceRefs),
    basis: text(item.basis)
  };
  if (kind === "fact" && (!normalized.source || !normalized.publishedAt)) {
    throw new Error(`事实卡${ref}必须填写来源和发布时间`);
  }
  if (kind === "fact" && !/^https?:\/\//i.test(normalized.sourceUrl)) {
    throw new Error(`事实卡${ref}必须填写http或https原始链接`);
  }
  return normalized;
}

function normalizeResearchPacket(input) {
  const packet = input && typeof input === "object" ? input : null;
  if (!packet) throw new Error("研究包必须是JSON对象");
  if (text(packet.schemaVersion) !== SCHEMA_VERSION) throw new Error(`研究包schemaVersion必须是${SCHEMA_VERSION}`);
  if (!packet.asset || typeof packet.asset !== "object") throw new Error("研究包必须包含asset对象");

  const code = required(packet.asset.code, "证券代码");
  if (!/^\d{6}$/.test(code)) throw new Error("证券代码必须是6位数字");
  const status = ASSET_STATUSES.has(text(packet.asset.status)) ? text(packet.asset.status) : "researching";
  const evidence = (Array.isArray(packet.evidence) ? packet.evidence : []).map(normalizeEvidence);
  const refs = evidence.map(item => item.ref);
  if (new Set(refs).size !== refs.length) throw new Error("证据卡ref不能重复");
  const facts = new Set(evidence.filter(item => item.kind === "fact").map(item => item.ref));

  for (const item of evidence.filter(row => row.kind === "analysis")) {
    if (!item.evidenceRefs.length && item.basis !== "user_judgment") throw new Error(`分析卡${item.ref}必须引用至少一张事实卡`);
    const unknown = item.evidenceRefs.filter(ref => !facts.has(ref));
    if (unknown.length) throw new Error(`分析卡${item.ref}引用了不存在的事实卡：${unknown.join("、")}`);
  }

  const normalizeLinkedItems = (items, label) => (Array.isArray(items) ? items : []).map((item, index) => ({
    title: required(item?.title || item?.condition, `${label}${index + 1}标题`),
    mechanism: text(item?.mechanism),
    observableSignal: text(item?.observableSignal),
    expectedWindow: text(item?.expectedWindow),
    severity: text(item?.severity),
    evidenceRefs: uniqueTextArray(item?.evidenceRefs)
  }));

  const risks = normalizeLinkedItems(packet.risks, "风险");
  const catalysts = normalizeLinkedItems(packet.catalysts, "催化因素");
  const invalidationConditions = normalizeLinkedItems(packet.invalidationConditions, "失效条件");
  for (const [label, items] of [["风险", risks], ["催化因素", catalysts], ["失效条件", invalidationConditions]]) {
    for (const item of items) {
      const unknown = item.evidenceRefs.filter(ref => !facts.has(ref));
      if (unknown.length) throw new Error(`${label}“${item.title}”引用了不存在的事实卡：${unknown.join("、")}`);
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: text(packet.generatedAt),
    researchAsOf: text(packet.researchAsOf),
    asset: {
      code,
      name: required(packet.asset.name, "证券名称"),
      market: text(packet.asset.market) || (code.startsWith("6") ? "SH" : "SZ"),
      status,
      industry: text(packet.asset.industry),
      fundamentalView: text(packet.asset.fundamentalView),
      technicalView: text(packet.asset.technicalView),
      volumePriceView: text(packet.asset.volumePriceView),
      trendView: text(packet.asset.trendView),
      upstream: text(packet.asset.upstream),
      downstream: text(packet.asset.downstream),
      linkedIndicators: Array.isArray(packet.asset.linkedIndicators)
        ? packet.asset.linkedIndicators.map(text).filter(Boolean).join("；")
        : text(packet.asset.linkedIndicators),
      aiResearchSummary: text(packet.asset.aiResearchSummary)
    },
    risks,
    catalysts,
    invalidationConditions,
    evidence,
    unknowns: uniqueTextArray(packet.unknowns),
    warnings: uniqueTextArray(packet.warnings)
  };
}

const schemaExample = {
  schemaVersion: SCHEMA_VERSION,
  generatedAt: "ISO 8601时间",
  researchAsOf: "YYYY-MM-DD",
  asset: {
    code: "6位证券代码",
    name: "证券名称",
    market: "SH或SZ",
    status: "researching",
    industry: "行业",
    fundamentalView: "基本面摘要",
    technicalView: "技术面摘要",
    volumePriceView: "量价结构摘要",
    trendView: "趋势摘要",
    upstream: "上游关系",
    downstream: "下游关系",
    linkedIndicators: "指数、商品、汇率、政策与事件",
    aiResearchSummary: "不超过300字的中性总结",
    expectedReturn: null,
    userMarketView: null
  },
  risks: [{ title: "风险", mechanism: "影响路径", observableSignal: "验证信号", severity: "high", evidenceRefs: ["F1"] }],
  catalysts: [{ title: "催化因素", expectedWindow: null, observableSignal: "验证信号", evidenceRefs: ["F1"] }],
  invalidationConditions: [{ condition: "研究逻辑失效条件", evidenceRefs: ["F1"] }],
  evidence: [
    { ref: "F1", kind: "fact", title: "事实标题", content: "可验证事实", source: "来源", sourceLevel: "L1", sourceUrl: "https://...", publishedAt: "YYYY-MM-DD", confidence: "high" },
    { ref: "A1", kind: "analysis", title: "分析标题", content: "影响路径与不确定性", evidenceRefs: ["F1"], basis: null, confidence: "medium" }
  ],
  unknowns: [],
  warnings: []
};

function buildResearchPrompt(target = "【请替换为股票名称或6位代码】") {
  return `你是一名严谨的证券研究资料整理助手。请调查“${text(target) || "【请替换为股票名称或6位代码】"}”，生成可导入交易纪律助手的研究包。\n\n要求：\n1. 核对证券代码、名称、市场和行业。\n2. 整理基本面、技术面、量价结构、趋势、上下游、关联指数/商品/汇率/政策、风险、催化因素和逻辑失效条件。\n3. fact只能写可验证事实，必须填写来源、原始链接和发布时间；analysis必须通过evidenceRefs引用fact。\n4. 优先使用交易所、监管机构、法定披露平台和公司公告。低质量来源只能作为线索。\n5. 无法确认的信息放入unknowns，禁止猜测；没有实时行情能力时必须明确说明。\n6. 不得给出保证性收益或确定性买卖结论。\n7. expectedReturn和userMarketView是用户专属字段，必须保持null，不得替用户填写。\n8. 只输出合法JSON，不要输出Markdown、代码围栏或解释文字。\n\nJSON结构如下：\n${JSON.stringify(schemaExample, null, 2)}`;
}

function buildWritePrompt() {
  return `请把本次生成的trade-research/v1研究包写入本机“交易纪律助手”。\n\n应用目录：D:\\交易\n本地服务：http://127.0.0.1:3768\n\n操作规则：\n1. 将完整JSON保存为UTF-8文件。\n2. 在应用目录运行：node scripts/research-import-cli.mjs preview <JSON文件路径>\n3. 如果预览存在错误，修正研究包后重新预览，不得绕过校验。\n4. 预览通过后运行：node scripts/research-import-cli.mjs import <JSON文件路径> --confirm\n5. 不得调用资金、成交或交易计划接口。\n6. 不得写入或覆盖expectedReturn和userMarketView；这两个字段由用户本人维护。\n7. 完成后报告新增/更新的标的、事实卡数量、分析卡数量和警告。\n8. 如果你不能访问本机文件或执行命令，请明确说明，并只返回研究包JSON，不要声称已经写入。`;
}

module.exports = {
  SCHEMA_VERSION,
  schemaExample,
  normalizeResearchPacket,
  buildResearchPrompt,
  buildWritePrompt
};
