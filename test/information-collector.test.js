"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { DEFAULT_NEWSNOW_BASE_URL, NEWSNOW_RECOMMENDED_SOURCES, normalizeInformationSource, nextRandomRunAt, collectInformationSource } = require("../lib/information-collector");

test("information source uses bounded random collection windows", () => {
  const source = normalizeInformationSource({ name: "测试 JSON Feed", adapter: "json_feed", config: { url: "https://example.com/feed.json" }, enabled: true });
  assert.equal(source.minIntervalMinutes, 50);
  assert.equal(source.maxIntervalMinutes, 75);
  assert.equal(nextRandomRunAt(source, new Date("2026-07-22T08:00:00Z"), () => 0), "2026-07-22T08:50:00.000Z");
  assert.equal(nextRandomRunAt(source, new Date("2026-07-22T08:00:00Z"), () => 0.999), "2026-07-22T09:15:00.000Z");
});

test("JSON Feed adapter emits traceable normalized items", async () => {
  const source = normalizeInformationSource({ name: "官方测试源", adapter: "json_feed", sourceType: "regulator_or_government", config: { url: "https://example.gov.cn/feed.json" }, enabled: true });
  const fetchImpl = async () => ({ ok: true, json: async () => ({ items: [{ id: "policy-1", title: "政策原文", content_text: "明确预算与执行时点", url: "https://example.gov.cn/policy/1", date_published: "2026-07-22T09:00:00+08:00" }] }) });
  const result = await collectInformationSource(source, { fetchImpl });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].externalId, "policy-1");
  assert.equal(result.items[0].collectorSourceId, source.id);
  assert.match(result.items[0].rawFingerprint, /^[a-f0-9]{64}$/);
});

test("RSS and Atom adapter emits official source items without credentials", async () => {
  const rssSource = normalizeInformationSource({ name: "工信部文件发布", adapter: "rss_atom", sourceType: "regulator_or_government", config: { url: "https://example.gov.cn/policy.xml" }, enabled: true });
  const rss = `<?xml version="1.0"?><rss><channel><item><guid>policy-2</guid><title><![CDATA[算力网络政策]]></title><description>明确建设目标与执行期限</description><link>/policy/2</link><pubDate>Wed, 22 Jul 2026 01:00:00 GMT</pubDate></item></channel></rss>`;
  const rssResult = await collectInformationSource(rssSource, { fetchImpl: async () => ({ ok: true, text: async () => rss }) });
  assert.equal(rssResult.items[0].externalId, "policy-2");
  assert.equal(rssResult.items[0].sourceUrl, "https://example.gov.cn/policy/2");
  assert.equal(rssResult.items[0].summary, "明确建设目标与执行期限");

  const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>notice-1</id><title>官方通知</title><summary>公开征求意见</summary><link href="https://example.gov.cn/notice/1"/><updated>2026-07-22T02:00:00Z</updated></entry></feed>`;
  const atomResult = await collectInformationSource(rssSource, { fetchImpl: async () => ({ ok: true, text: async () => atom }) });
  assert.equal(atomResult.items[0].externalId, "notice-1");
  assert.equal(atomResult.items[0].sourceUrl, "https://example.gov.cn/notice/1");
});

test("NewsNow adapter imports ranked public hot news without credentials", async () => {
  const source = normalizeInformationSource({ name: "财联社电报", adapter: "newsnow", sourceType: "established_media", config: { baseUrl: "https://newsnow.example", sourceId: "cls-telegraph", maxItems: 30 }, enabled: true });
  let requestUrl;
  const fetchImpl = async url => {
    requestUrl = String(url);
    return {
      ok: true,
      json: async () => ({ status: "cache", id: "cls-telegraph", updatedTime: 1784723132720, items: [{ id: 2434257, title: "英国国债收益率升至两个月高点", pubDate: 1784722791000, url: "https://www.cls.cn/detail/2434257", extra: { info: "快讯" } }] })
    };
  };
  const result = await collectInformationSource(source, { fetchImpl });
  assert.equal(source.costPolicy, "free_aggregator");
  assert.equal(NEWSNOW_RECOMMENDED_SOURCES.length, 14);
  assert.ok(NEWSNOW_RECOMMENDED_SOURCES.some(source => source.key === "cls-hot"));
  assert.ok(NEWSNOW_RECOMMENDED_SOURCES.some(source => source.key === "cls-depth"));
  assert.ok(NEWSNOW_RECOMMENDED_SOURCES.some(source => source.key === "wallstreetcn-news"));
  assert.ok(NEWSNOW_RECOMMENDED_SOURCES.some(source => source.key === "wallstreetcn-hot"));
  assert.ok(NEWSNOW_RECOMMENDED_SOURCES.some(source => source.key === "cankaoxiaoxi"));
  assert.ok(NEWSNOW_RECOMMENDED_SOURCES.some(source => source.key === "sputniknewscn"));
  assert.match(requestUrl, /\/api\/s\?id=cls-telegraph/);
  assert.equal(result.items[0].rank, 1);
  assert.equal(result.items[0].hotValue, "快讯");
  assert.equal(result.items[0].sourceUrl, "https://www.cls.cn/detail/2434257");
  assert.equal(result.items[0].summary, "英国国债收益率升至两个月高点");
});

test("NewsNow defaults to the self-hosted loopback service", () => {
  const source = normalizeInformationSource({ name: "本地聚合源", adapter: "newsnow", config: { sourceId: "cls-hot" }, enabled: true });
  assert.equal(DEFAULT_NEWSNOW_BASE_URL, "http://127.0.0.1:4444");
  assert.equal(source.config.baseUrl, DEFAULT_NEWSNOW_BASE_URL);
});

test("SEC EDGAR adapter uses official keyless API and compliant user agent", async () => {
  const source = normalizeInformationSource({ name: "NVIDIA SEC filings", adapter: "sec_edgar_submissions", config: { cik: "1045810", userAgent: "TradeDiscipline contact@example.com" }, enabled: true });
  let request;
  const fetchImpl = async (url, options) => {
    request = { url: String(url), options };
    return { ok: true, json: async () => ({ name: "NVIDIA CORP", filings: { recent: { accessionNumber: ["0001045810-26-000001"], filingDate: ["2026-07-21"], reportDate: ["2026-06-30"], acceptanceDateTime: ["2026-07-21T21:30:00.000Z"], form: ["8-K"], primaryDocument: ["nvda-20260721.htm"], primaryDocDescription: ["Current report"] } } }) };
  };
  const result = await collectInformationSource(source, { fetchImpl });
  assert.equal(request.url, "https://data.sec.gov/submissions/CIK0001045810.json");
  assert.equal(request.options.headers["User-Agent"], "TradeDiscipline contact@example.com");
  assert.equal(result.items[0].sourceType, "exchange_filing");
  assert.match(result.items[0].sourceUrl, /sec\.gov\/Archives\/edgar\/data\/1045810/);
});

test("Federal Register adapter builds a free official search", async () => {
  const source = normalizeInformationSource({ name: "美国 AI 政策", adapter: "federal_register", config: { term: "artificial intelligence", perPage: 10 }, enabled: true });
  let requestUrl;
  const fetchImpl = async url => {
    requestUrl = String(url);
    return { ok: true, json: async () => ({ results: [{ document_number: "2026-10001", title: "AI infrastructure rule", abstract: "Proposed requirements.", html_url: "https://www.federalregister.gov/d/2026-10001", publication_date: "2026-07-22", agencies: [{ name: "Department of Commerce" }] }] }) };
  };
  const result = await collectInformationSource(source, { fetchImpl });
  assert.match(requestUrl, /conditions%5Bterm%5D=artificial\+intelligence/);
  assert.equal(result.items[0].sourceName, "Department of Commerce");
});

test("zero-cost mode blocks paid X sources", async () => {
  assert.throws(() => normalizeInformationSource({ name: "X", adapter: "x_recent_search", config: { query: "AI" }, enabled: true }), /零费用模式/);
  const source = normalizeInformationSource({ name: "X", adapter: "x_recent_search", config: { query: "AI" }, enabled: false });
  await assert.rejects(() => collectInformationSource(source, { fetchImpl: async () => ({ ok: true }) }), /付费 X 来源已被阻止/);
});

test("X adapter remains available only through an explicit paid-source override", async () => {
  const source = normalizeInformationSource({ name: "X 产业线索", adapter: "x_recent_search", config: { query: "AI lang:zh -is:retweet", tokenEnv: "TEST_X_TOKEN" }, enabled: false });
  let request;
  const fetchImpl = async (url, options) => {
    request = { url: String(url), options };
    return { ok: true, json: async () => ({ data: [{ id: "123", text: "产业动态", author_id: "u1", created_at: "2026-07-22T09:00:00Z" }], includes: { users: [{ id: "u1", username: "official", verified: true }] }, meta: { newest_id: "123" } }) };
  };
  const result = await collectInformationSource(source, { fetchImpl, env: { TEST_X_TOKEN: "secret" }, allowPaidSources: true });
  assert.match(request.url, /tweets\/search\/recent/);
  assert.equal(request.options.headers.Authorization, "Bearer secret");
  assert.equal(JSON.stringify(source).includes("secret"), false);
  assert.equal(result.items[0].sourceType, "social_verified_identity");
});
