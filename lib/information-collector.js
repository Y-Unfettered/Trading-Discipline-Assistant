"use strict";

const crypto = require("crypto");

const DEFAULT_NEWSNOW_BASE_URL = String(process.env.TRADE_NEWSNOW_URL || "http://127.0.0.1:4444").trim().replace(/\/+$/, "");
const LEGACY_PUBLIC_NEWSNOW_BASE_URLS = new Set([
  "https://newsnow.busiyi.world",
  "https://newsnow-omega-one.vercel.app"
]);

const SOURCE_SCHEMA_VERSION = "information-source/v1.3.0";
const SUPPORTED_ADAPTERS = new Set([
  "rss_atom",
  "json_feed",
  "newsnow",
  "sec_edgar_submissions",
  "federal_register",
  "x_recent_search"
]);
const PAID_ADAPTERS = new Set(["x_recent_search"]);
const NEWSNOW_RECOMMENDED_SOURCES = [
  { key: "cls-telegraph", name: "财联社电报", sourceType: "established_media", contentMode: "source_page", minIntervalMinutes: 5, maxIntervalMinutes: 10 },
  { key: "cls-hot", name: "财联社热门", sourceType: "established_media", contentMode: "source_page", minIntervalMinutes: 10, maxIntervalMinutes: 15 },
  { key: "cls-depth", name: "财联社深度", sourceType: "established_media", contentMode: "source_page", minIntervalMinutes: 15, maxIntervalMinutes: 25 },
  { key: "wallstreetcn-quick", name: "华尔街见闻快讯", sourceType: "established_media", contentMode: "source_api", minIntervalMinutes: 5, maxIntervalMinutes: 10 },
  { key: "wallstreetcn-news", name: "华尔街见闻最新", sourceType: "established_media", contentMode: "source_page", minIntervalMinutes: 10, maxIntervalMinutes: 15 },
  { key: "wallstreetcn-hot", name: "华尔街见闻最热", sourceType: "established_media", contentMode: "source_page", minIntervalMinutes: 15, maxIntervalMinutes: 25 },
  { key: "jin10", name: "金十数据", sourceType: "established_media", contentMode: "summary_then_page", minIntervalMinutes: 10, maxIntervalMinutes: 15 },
  { key: "gelonghui", name: "格隆汇事件", sourceType: "industry_media", contentMode: "source_page", minIntervalMinutes: 5, maxIntervalMinutes: 10 },
  { key: "cankaoxiaoxi", name: "参考消息", sourceType: "established_media", contentMode: "source_page", minIntervalMinutes: 20, maxIntervalMinutes: 30 },
  { key: "sputniknewscn", name: "卫星通讯社", sourceType: "established_media", contentMode: "source_page", minIntervalMinutes: 20, maxIntervalMinutes: 30 },
  { key: "xueqiu-hotstock", name: "雪球热门股票", sourceType: "industry_media", contentMode: "headline_only", minIntervalMinutes: 5, maxIntervalMinutes: 10 },
  { key: "thepaper", name: "澎湃新闻热榜", sourceType: "established_media", contentMode: "source_page", minIntervalMinutes: 20, maxIntervalMinutes: 30 },
  { key: "weibo", name: "微博实时热搜", sourceType: "social_unverified", contentMode: "headline_only", minIntervalMinutes: 10, maxIntervalMinutes: 15 },
  { key: "zhihu", name: "知乎热榜", sourceType: "social_unverified", contentMode: "summary_then_page", minIntervalMinutes: 15, maxIntervalMinutes: 25 }
];

function clean(value) {
  return String(value ?? "").trim();
}

function assertHttpUrl(value, field = "url") {
  const text = clean(value);
  if (!/^https?:\/\//i.test(text)) throw new Error(`${field} 必须是 http(s) 地址`);
  return text;
}

function defaultSourceType(adapter) {
  if (adapter === "sec_edgar_submissions") return "exchange_filing";
  if (adapter === "x_recent_search") return "social_verified_identity";
  if (adapter === "newsnow") return "established_media";
  return "regulator_or_government";
}

function normalizeInformationSource(input = {}, existing = null) {
  const adapter = clean(input.adapter || existing?.adapter);
  if (!SUPPORTED_ADAPTERS.has(adapter)) throw new Error("资讯来源适配器不受支持");
  const name = clean(input.name || existing?.name);
  if (!name) throw new Error("资讯来源必须填写名称");
  const minIntervalMinutes = Number(input.minIntervalMinutes ?? existing?.minIntervalMinutes ?? 50);
  const maxIntervalMinutes = Number(input.maxIntervalMinutes ?? existing?.maxIntervalMinutes ?? 75);
  if (!Number.isFinite(minIntervalMinutes) || !Number.isFinite(maxIntervalMinutes) || minIntervalMinutes < 5 || maxIntervalMinutes > 1440 || minIntervalMinutes > maxIntervalMinutes) {
    throw new Error("随机采集间隔必须在 5–1440 分钟内，且最小值不能大于最大值");
  }
  const config = { ...(existing?.config || {}), ...(input.config || {}) };
  delete config.token;
  delete config.bearerToken;
  delete config.apiKey;
  if (["rss_atom", "json_feed"].includes(adapter)) {
    config.url = assertHttpUrl(config.url, adapter === "rss_atom" ? "RSS/Atom 地址" : "JSON Feed 地址");
    config.maxItems = Math.max(1, Math.min(500, Number(config.maxItems || 50)));
    config.initialLookbackDays = Math.max(1, Math.min(365, Number(config.initialLookbackDays || 30)));
  }
  if (adapter === "newsnow") {
    config.baseUrl = assertHttpUrl(config.baseUrl || DEFAULT_NEWSNOW_BASE_URL, "NewsNow 服务地址").replace(/\/+$/, "");
    config.sourceId = clean(config.sourceId);
    config.maxItems = Math.max(1, Math.min(30, Number(config.maxItems || 30)));
    const recommended = NEWSNOW_RECOMMENDED_SOURCES.find(item => item.key === config.sourceId);
    config.contentMode = clean(config.contentMode || recommended?.contentMode || "source_page");
    if (!["source_page", "source_api", "summary_then_page", "headline_only"].includes(config.contentMode)) throw new Error("NewsNow 正文模式不正确");
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(config.sourceId)) throw new Error("NewsNow 来源 ID 格式不正确");
  }
  if (adapter === "sec_edgar_submissions") {
    config.cik = clean(config.cik).replace(/^CIK/i, "").padStart(10, "0");
    config.userAgent = clean(config.userAgent);
    if (!/^\d{10}$/.test(config.cik)) throw new Error("SEC EDGAR 的 CIK 必须是 1–10 位数字");
    if (!config.userAgent || !/@/.test(config.userAgent)) throw new Error("SEC EDGAR 必须填写含联系邮箱的 User-Agent，以遵守官方访问规范");
  }
  if (adapter === "federal_register") {
    config.term = clean(config.term);
    config.agency = clean(config.agency);
    config.perPage = Math.max(1, Math.min(100, Number(config.perPage || 20)));
    if (!config.term && !config.agency) throw new Error("Federal Register 至少填写关键词或机构标识");
  }
  if (adapter === "x_recent_search") {
    config.query = clean(config.query);
    config.tokenEnv = clean(config.tokenEnv || "X_BEARER_TOKEN");
    if (!config.query) throw new Error("X 近况搜索必须填写查询条件");
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(config.tokenEnv)) throw new Error("凭据环境变量名称格式不正确");
  }
  const enabled = input.enabled == null ? Boolean(existing?.enabled) : input.enabled === true;
  if (enabled && PAID_ADAPTERS.has(adapter)) throw new Error("当前为零费用模式，不能启用付费 X 来源");
  const now = new Date().toISOString();
  return {
    ...(existing || {}),
    schemaVersion: SOURCE_SCHEMA_VERSION,
    id: existing?.id || `information-source-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
    name,
    adapter,
    sourceType: clean(input.sourceType || existing?.sourceType || defaultSourceType(adapter)),
    costPolicy: PAID_ADAPTERS.has(adapter) ? "paid_blocked" : adapter === "newsnow" ? "free_aggregator" : "free_official",
    enabled,
    minIntervalMinutes,
    maxIntervalMinutes,
    config,
    lastRunAt: existing?.lastRunAt || null,
    nextRunAt: existing?.nextRunAt || null,
    lastCursor: existing?.lastCursor || null,
    lastError: existing?.lastError || null,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
}

function nextRandomRunAt(source, from = new Date(), random = Math.random) {
  const min = Number(source.minIntervalMinutes ?? 50);
  const max = Number(source.maxIntervalMinutes ?? 75);
  const minutes = min + Math.floor(random() * (max - min + 1));
  return new Date(from.getTime() + minutes * 60_000).toISOString();
}

function dateAfter(value, threshold) {
  if (!threshold || !value) return true;
  const itemTime = new Date(value).getTime();
  const thresholdTime = new Date(threshold).getTime();
  return !Number.isFinite(itemTime) || !Number.isFinite(thresholdTime) || itemTime > thresholdTime;
}

function decodeXml(value) {
  return clean(value)
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/i, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

function xmlTag(block, names) {
  for (const name of names) {
    const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
    if (match) return decodeXml(match[1]);
  }
  return "";
}

function xmlLink(block, feedUrl) {
  const atom = block.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\/?>(?:<\/link>)?/i);
  const raw = atom?.[1] || xmlTag(block, ["link"]);
  if (!raw) return "";
  try { return new URL(raw, feedUrl).toString(); } catch { return raw; }
}

function rssAtomItems(xml, source) {
  const blocks = [...String(xml).matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map(match => match[2]);
  if (!blocks.length) throw new Error("RSS/Atom 响应中没有找到 item 或 entry");
  return blocks.map(block => {
    const sourceUrl = xmlLink(block, source.config.url);
    const title = xmlTag(block, ["title"]);
    const summary = xmlTag(block, ["description", "summary", "content:encoded", "content"]);
    const publishedAt = xmlTag(block, ["pubDate", "published", "updated", "dc:date"]) || new Date().toISOString();
    return {
      externalId: xmlTag(block, ["guid", "id"]) || sourceUrl || crypto.createHash("sha256").update(`${title}|${publishedAt}`).digest("hex"),
      title: title || summary.slice(0, 80),
      summary: summary || title,
      sourceName: source.name,
      sourceUrl: sourceUrl || source.config.url,
      sourceType: source.sourceType,
      publishedAt,
      raw: block
    };
  }).filter(item => item.externalId && item.title && item.summary && /^https?:\/\//i.test(item.sourceUrl));
}

function jsonFeedItems(payload, source) {
  if (!payload || !Array.isArray(payload.items)) throw new Error("JSON Feed 响应缺少 items 数组");
  return payload.items.map(item => {
    const externalId = clean(item.id || item.url || item.external_url);
    const sourceUrl = clean(item.url || item.external_url || source.config.url);
    const summary = clean(item.summary || item.content_text || item.content_html?.replace(/<[^>]+>/g, " "));
    return {
      externalId,
      title: clean(item.title || summary.slice(0, 80)),
      summary,
      sourceName: source.name,
      sourceUrl,
      sourceType: source.sourceType,
      publishedAt: clean(item.date_published || item.date_modified || new Date().toISOString()),
      raw: item
    };
  }).filter(item => item.externalId && item.title && item.summary && /^https?:\/\//i.test(item.sourceUrl));
}

function secEdgarItems(payload, source) {
  const recent = payload?.filings?.recent;
  if (!recent || !Array.isArray(recent.accessionNumber)) throw new Error("SEC EDGAR 响应缺少 filings.recent");
  const cik = String(Number(source.config.cik));
  return recent.accessionNumber.map((accession, index) => {
    const primaryDocument = clean(recent.primaryDocument?.[index]);
    const accessionPath = clean(accession).replace(/-/g, "");
    const form = clean(recent.form?.[index]);
    const description = clean(recent.primaryDocDescription?.[index]);
    const filingDate = clean(recent.acceptanceDateTime?.[index] || recent.filingDate?.[index]);
    return {
      externalId: clean(accession),
      title: [clean(payload.name), form, description].filter(Boolean).join(" · "),
      summary: `${clean(payload.name)} 提交 ${form}${description ? `：${description}` : ""}。申报日期 ${clean(recent.filingDate?.[index])}，报告期 ${clean(recent.reportDate?.[index]) || "未注明"}。`,
      sourceName: "U.S. SEC EDGAR",
      sourceUrl: primaryDocument ? `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionPath}/${encodeURIComponent(primaryDocument)}` : `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionPath}/`,
      sourceType: "exchange_filing",
      publishedAt: filingDate || new Date().toISOString(),
      raw: Object.fromEntries(Object.entries(recent).map(([key, values]) => [key, Array.isArray(values) ? values[index] : values]))
    };
  }).filter(item => item.externalId && item.title);
}

function federalRegisterItems(payload, source) {
  if (!payload || !Array.isArray(payload.results)) throw new Error("Federal Register 响应缺少 results 数组");
  return payload.results.map(item => ({
    externalId: clean(item.document_number),
    title: clean(item.title),
    summary: clean(item.abstract || item.title),
    sourceName: (item.agencies || []).map(agency => clean(agency.name)).filter(Boolean).join("、") || source.name,
    sourceUrl: clean(item.html_url || item.raw_text_url || "https://www.federalregister.gov/"),
    sourceType: "regulator_or_government",
    publishedAt: clean(item.publication_date || new Date().toISOString()),
    raw: item
  })).filter(item => item.externalId && item.title && item.summary && /^https?:\/\//i.test(item.sourceUrl));
}

function xItems(payload, source) {
  const users = new Map((payload.includes?.users || []).map(user => [String(user.id), user]));
  return (payload.data || []).map(post => {
    const author = users.get(String(post.author_id));
    const username = clean(author?.username);
    const summary = clean(post.text);
    return {
      externalId: clean(post.id),
      title: username ? `X · @${username}` : `X · ${clean(post.id)}`,
      summary,
      sourceName: username ? `@${username}` : source.name,
      sourceUrl: username ? `https://x.com/${encodeURIComponent(username)}/status/${encodeURIComponent(post.id)}` : `https://x.com/i/web/status/${encodeURIComponent(post.id)}`,
      sourceType: author?.verified ? "social_verified_identity" : source.sourceType,
      publishedAt: clean(post.created_at || new Date().toISOString()),
      assetCodes: source.config.assetCodes || [],
      industryTags: source.config.industryTags || [],
      raw: post
    };
  }).filter(item => item.externalId && item.summary);
}

function newsNowDate(value, fallback) {
  if (value == null || value === "") return new Date(fallback || Date.now()).toISOString();
  const numeric = Number(value);
  const date = Number.isFinite(numeric) ? new Date(numeric > 10_000_000_000 ? numeric : numeric * 1000) : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(fallback || Date.now()).toISOString();
}

function newsNowItems(payload, source) {
  if (!payload || !Array.isArray(payload.items)) throw new Error("NewsNow 响应缺少 items 数组");
  return payload.items.slice(0, source.config.maxItems).map((item, index) => {
    const title = clean(item.title);
    const sourceUrl = clean(item.url || item.mobileUrl);
    const info = typeof item.extra?.info === "string" ? clean(item.extra.info) : "";
    const hover = typeof item.extra?.hover === "string" ? clean(item.extra.hover) : "";
    const summary = hover || title;
    return {
      externalId: clean(item.id || sourceUrl || crypto.createHash("sha256").update(`${title}|${index}`).digest("hex")),
      title,
      summary,
      sourceName: source.name,
      sourceUrl,
      sourceType: source.sourceType,
      publishedAt: newsNowDate(item.pubDate || item.extra?.date, payload.updatedTime),
      rank: index + 1,
      hotValue: info || null,
      contentMode: source.config.contentMode || "source_page",
      raw: item
    };
  }).filter(item => item.externalId && item.title && item.summary && /^https?:\/\//i.test(item.sourceUrl));
}

async function collectInformationSource(sourceInput, options = {}) {
  const allowPaidSources = options.allowPaidSources === true;
  const normalizedInput = allowPaidSources && sourceInput.adapter === "x_recent_search" ? { ...sourceInput, enabled: false } : sourceInput;
  const source = normalizeInformationSource(normalizedInput, normalizedInput);
  if (PAID_ADAPTERS.has(source.adapter) && !allowPaidSources) throw new Error("当前为零费用模式，付费 X 来源已被阻止");
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const env = options.env || process.env;
  if (typeof fetchImpl !== "function") throw new Error("当前运行环境不支持 fetch");
  let response;
  let items;
  let cursor = source.lastCursor;
  const initialThreshold = new Date(Date.now() - Number(source.config.initialLookbackDays || 30) * 24 * 60 * 60 * 1000).toISOString();
  const feedThreshold = source.lastRunAt || initialThreshold;
  if (source.adapter === "rss_atom") {
    response = await fetchImpl(source.config.url, { headers: { Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" } });
    if (!response.ok) throw new Error(`RSS/Atom 请求失败：HTTP ${response.status}`);
    items = rssAtomItems(await response.text(), source)
      .filter(item => dateAfter(item.publishedAt, feedThreshold))
      .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)))
      .slice(0, source.config.maxItems);
    cursor = items.map(item => item.publishedAt).sort().at(-1) || cursor;
  } else if (source.adapter === "json_feed") {
    response = await fetchImpl(source.config.url, { headers: { Accept: "application/feed+json, application/json" } });
    if (!response.ok) throw new Error(`JSON Feed 请求失败：HTTP ${response.status}`);
    items = jsonFeedItems(await response.json(), source)
      .filter(item => dateAfter(item.publishedAt, feedThreshold))
      .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)))
      .slice(0, source.config.maxItems);
    cursor = items.map(item => item.publishedAt).sort().at(-1) || cursor;
  } else if (source.adapter === "newsnow") {
    const url = new URL("/api/s", `${source.config.baseUrl}/`);
    url.searchParams.set("id", source.config.sourceId);
    response = await fetchImpl(url, { headers: {
      Accept: "application/json",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.5",
      Referer: `${source.config.baseUrl}/`,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36"
    } });
    if (!response.ok) throw new Error(`NewsNow 请求失败：HTTP ${response.status}`);
    const payload = await response.json();
    items = newsNowItems(payload, source);
    cursor = clean(payload.updatedTime || items[0]?.publishedAt || cursor);
  } else if (source.adapter === "sec_edgar_submissions") {
    const url = `https://data.sec.gov/submissions/CIK${source.config.cik}.json`;
    response = await fetchImpl(url, { headers: { Accept: "application/json", "User-Agent": source.config.userAgent } });
    if (!response.ok) throw new Error(`SEC EDGAR 请求失败：HTTP ${response.status}`);
    items = secEdgarItems(await response.json(), source).filter(item => dateAfter(item.publishedAt, source.lastRunAt));
    cursor = items.map(item => item.publishedAt).sort().at(-1) || cursor;
  } else if (source.adapter === "federal_register") {
    const url = new URL("https://www.federalregister.gov/api/v1/documents.json");
    url.searchParams.set("per_page", String(source.config.perPage));
    url.searchParams.set("order", "newest");
    if (source.config.term) url.searchParams.set("conditions[term]", source.config.term);
    if (source.config.agency) url.searchParams.set("conditions[agencies][]", source.config.agency);
    response = await fetchImpl(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Federal Register 请求失败：HTTP ${response.status}`);
    items = federalRegisterItems(await response.json(), source).filter(item => dateAfter(item.publishedAt, source.lastRunAt));
    cursor = items.map(item => item.publishedAt).sort().at(-1) || cursor;
  } else if (source.adapter === "x_recent_search") {
    const token = clean(env[source.config.tokenEnv]);
    if (!token) throw new Error(`缺少 X API 凭据环境变量：${source.config.tokenEnv}`);
    const url = new URL("https://api.x.com/2/tweets/search/recent");
    url.searchParams.set("query", source.config.query);
    url.searchParams.set("max_results", String(Math.max(10, Math.min(100, Number(source.config.maxResults || 50)))));
    url.searchParams.set("tweet.fields", "created_at,author_id");
    url.searchParams.set("expansions", "author_id");
    url.searchParams.set("user.fields", "username,verified");
    if (source.lastRunAt) url.searchParams.set("start_time", new Date(source.lastRunAt).toISOString());
    response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`X 近况搜索请求失败：HTTP ${response.status}`);
    const payload = await response.json();
    items = xItems(payload, source);
    cursor = payload.meta?.newest_id || cursor;
  }
  return {
    sourceId: source.id,
    adapter: source.adapter,
    collectedAt: new Date().toISOString(),
    cursor,
    items: items.map(item => ({ ...item, collectorSourceId: source.id, rawFingerprint: crypto.createHash("sha256").update(JSON.stringify(item.raw)).digest("hex") }))
  };
}

module.exports = {
  SOURCE_SCHEMA_VERSION,
  SUPPORTED_ADAPTERS,
  PAID_ADAPTERS,
  DEFAULT_NEWSNOW_BASE_URL,
  LEGACY_PUBLIC_NEWSNOW_BASE_URLS,
  NEWSNOW_RECOMMENDED_SOURCES,
  normalizeInformationSource,
  nextRandomRunAt,
  collectInformationSource,
  newsNowItems
};
