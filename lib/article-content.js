"use strict";

const crypto = require("crypto");
const dns = require("node:dns").promises;
const net = require("node:net");
const { load } = require("cheerio");

const ARTICLE_CONTENT_SCHEMA_VERSION = "information-content/v1.1.0";
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_CONTENT_CHARS = 120_000;

function clean(value) {
  return String(value ?? "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function isPrivateAddress(address) {
  const normalized = String(address || "").toLowerCase().split("%")[0];
  if (!net.isIP(normalized)) return false;
  if (normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return true;
  if (normalized.startsWith("::ffff:")) return isPrivateAddress(normalized.slice(7));
  if (net.isIPv4(normalized)) {
    const [a, b] = normalized.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  return false;
}

async function assertPublicUrl(value, lookupImpl = dns.lookup) {
  let url;
  try { url = new URL(value); } catch { throw new Error("原文地址不是有效 URL"); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("原文地址只允许 http(s)");
  const hostname = url.hostname.toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) throw new Error("原文地址不能指向本机或内网");
  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new Error("原文地址不能指向本机或内网");
    return url;
  }
  const resolved = await lookupImpl(hostname, { all: true });
  const addresses = Array.isArray(resolved) ? resolved : [resolved];
  if (!addresses.length || addresses.some(item => isPrivateAddress(item.address || item))) throw new Error("原文地址解析到了本机或内网");
  return url;
}

function jsonLdArticles($) {
  const found = [];
  $('script[type="application/ld+json"]').each((_, element) => {
    try {
      const parsed = JSON.parse($(element).text());
      const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
      while (queue.length) {
        const item = queue.shift();
        if (!item || typeof item !== "object") continue;
        if (Array.isArray(item['@graph'])) queue.push(...item['@graph']);
        const types = Array.isArray(item['@type']) ? item['@type'] : [item['@type']];
        if (types.some(type => ["Article", "NewsArticle", "ReportageNewsArticle", "BlogPosting"].includes(type))) found.push(item);
      }
    } catch {}
  });
  return found;
}

function safeParagraphHtml(lines) {
  return lines.map(line => `<p>${String(line).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")}</p>`).join("\n");
}

function plainContent(value) {
  const source = String(value || "");
  if (!/<[a-z][\s\S]*>/i.test(source)) return clean(source);
  const $ = load(`<body>${source}</body>`);
  const lines = [];
  $("body").find("p,h1,h2,h3,li,blockquote").each((_, element) => {
    const line = clean($(element).text());
    if (line && !lines.includes(line)) lines.push(line);
  });
  return clean(lines.length ? lines.join("\n\n") : $("body").text());
}

function contentResult(input = {}) {
  const contentText = clean(input.contentText).slice(0, MAX_CONTENT_CHARS);
  const lines = contentText.split(/\n+/).map(clean).filter(Boolean);
  return {
    schemaVersion: ARTICLE_CONTENT_SCHEMA_VERSION,
    sourceUrl: input.sourceUrl || "",
    title: clean(input.title),
    author: clean(input.author) || null,
    publishedAt: clean(input.publishedAt) || null,
    contentText,
    contentHtml: safeParagraphHtml(lines),
    excerpt: clean(input.excerpt) || contentText.slice(0, 300),
    contentHash: contentText ? crypto.createHash("sha256").update(contentText).digest("hex") : null,
    contentOrigin: input.contentOrigin || "source_page",
    contentKind: input.contentKind || (contentText.length >= 100 ? "article" : "substantial_summary"),
    status: input.status || (contentText.length >= 100 ? "complete" : contentText ? "summary_only" : "failed")
  };
}

function nextDataContent($, sourceUrl) {
  const raw = $("#__NEXT_DATA__").first().text();
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    const host = new URL(sourceUrl || "https://invalid.example").hostname.toLowerCase();
    if (host === "www.cls.cn" || host.endsWith(".cls.cn")) {
      const article = data?.props?.pageProps?.articleDetail;
      if (!article) return null;
      const authorValue = article.author;
      const author = typeof authorValue === "string" ? authorValue : authorValue?.name;
      return {
        title: article.title,
        author,
        publishedAt: Number(article.ctime) ? new Date(Number(article.ctime) * 1000).toISOString() : null,
        contentText: plainContent(article.content || article.brief),
        excerpt: plainContent(article.brief),
        contentKind: "brief"
      };
    }
  } catch {}
  return null;
}

function inlinePageContent($, sourceUrl) {
  let hostname = "";
  try { hostname = new URL(sourceUrl).hostname.toLowerCase(); } catch {}
  if (hostname !== "ckxxapp.ckxx.net" && !hostname.endsWith(".ckxx.net")) return null;
  let encoded = "";
  $("script").each((_, element) => {
    if (encoded) return;
    const match = $(element).text().match(/var\s+contentTxt\s*=\s*"((?:\\.|[^"\\])*)"\s*;/);
    if (match) encoded = match[1];
  });
  if (!encoded) return null;
  try {
    const contentText = plainContent(JSON.parse(`"${encoded}"`));
    return contentText ? { contentText, contentKind: "article" } : null;
  } catch {
    return null;
  }
}

function candidateScore($, element) {
  const node = $(element);
  const text = clean(node.text());
  if (!text) return -1;
  const linkLength = clean(node.find("a").text()).length;
  const paragraphCount = node.find("p").length;
  return text.length + paragraphCount * 80 - linkLength * 1.5;
}

function extractArticleContent(html, sourceUrl = "") {
  const $ = load(String(html || ""));
  let hostname = "";
  try { hostname = new URL(sourceUrl).hostname.toLowerCase(); } catch {}
  const structured = jsonLdArticles($).sort((a, b) => clean(b.articleBody).length - clean(a.articleBody).length)[0] || {};
  const embedded = nextDataContent($, sourceUrl) || inlinePageContent($, sourceUrl) || {};
  const title = clean(
    embedded.title
      || structured.headline
      || $('meta[property="og:title"]').attr("content")
      || $('meta[name="twitter:title"]').attr("content")
      || $("h1").first().text()
      || $("title").text()
  );
  const authorValue = embedded.author || structured.author;
  const author = clean(
    (Array.isArray(authorValue) ? authorValue : [authorValue]).filter(Boolean).map(item => typeof item === "string" ? item : item.name).filter(Boolean).join("、")
      || $('meta[name="author"]').attr("content")
      || $('[rel="author"]').first().text()
  );
  const publishedAt = clean(
    embedded.publishedAt
      || structured.datePublished
      || $('meta[property="article:published_time"]').attr("content")
      || $('meta[name="publishdate"]').attr("content")
      || $("time[datetime]").first().attr("datetime")
  );
  const description = clean(embedded.excerpt || structured.description || $('meta[name="description"]').attr("content") || $('meta[property="og:description"]').attr("content"));
  const domainBriefText = hostname === "flash.jin10.com" ? clean($(".content-title").first().text() || $(".detail-content").first().text()) : "";
  let contentText = clean(embedded.contentText || domainBriefText || structured.articleBody);

  $("script,style,noscript,svg,canvas,form,button,input,select,textarea,nav,header,footer,aside,iframe").remove();
  if (!embedded.contentText && !domainBriefText && contentText.length < 200) {
    const selectors = [
      "article", "main", "[itemprop='articleBody']", ".article-content", ".article_content", ".article-body",
      ".post-content", ".entry-content", ".news-content", ".detail-content", ".flash-detail",
      ".main-news", ".article-with-html", ".news-detail-container", "#article-content", "#content"
    ];
    const candidates = [];
    for (const selector of selectors) $(selector).each((_, element) => candidates.push(element));
    if (!candidates.length && $("body").length) candidates.push($("body")[0]);
    const best = candidates.sort((a, b) => candidateScore($, b) - candidateScore($, a))[0];
    if (best) {
      const lines = [];
      $(best).find("p,h2,h3,li,blockquote").each((_, element) => {
        const line = clean($(element).text());
        if (line.length >= 8 && !lines.includes(line)) lines.push(line);
      });
      contentText = clean(lines.length ? lines.join("\n\n") : $(best).text());
    }
  }
  if (!embedded.contentText && !domainBriefText && contentText.length < 80 && description) contentText = description;
  const isBriefPage = embedded.contentKind === "brief" || hostname === "flash.jin10.com";
  return contentResult({
    sourceUrl,
    title,
    author: author || null,
    publishedAt: publishedAt || null,
    contentText,
    excerpt: description || contentText.slice(0, 300),
    contentOrigin: "source_page",
    contentKind: isBriefPage ? "brief" : (contentText.length >= 100 ? "article" : "substantial_summary"),
    status: isBriefPage ? (contentText ? "complete" : "failed") : undefined
  });
}

async function fetchWallstreetLiveContent(sourceUrl, options = {}) {
  const match = new URL(sourceUrl).pathname.match(/^\/livenews\/(\d+)/);
  if (!match) return null;
  const endpoint = await assertPublicUrl(`https://api-one.wallstcn.com/apiv1/content/lives/${match[1]}`, options.lookupImpl || dns.lookup);
  const response = await (options.fetchImpl || globalThis.fetch)(endpoint, {
    redirect: "error",
    signal: options.signal || AbortSignal.timeout(Number(options.timeoutMs || 15_000)),
    headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 TradeDisciplineAssistant/0.3" }
  });
  if (!response.ok) {
    const error = new Error(`华尔街见闻快讯接口请求失败：HTTP ${response.status}`);
    error.httpStatus = response.status;
    throw error;
  }
  const raw = new Uint8Array(await response.arrayBuffer());
  if (raw.byteLength > MAX_RESPONSE_BYTES) throw new Error("华尔街见闻快讯响应超过2MB限制");
  const payload = JSON.parse(new TextDecoder("utf-8").decode(raw));
  const item = payload?.data;
  const main = plainContent(item?.content_text || item?.content);
  const more = plainContent(item?.content_more);
  const contentText = clean([main, more && !main.includes(more) ? more : ""].filter(Boolean).join("\n\n"));
  return {
    ...contentResult({
      sourceUrl,
      title: item?.title || item?.highlight_title || contentText.slice(0, 100),
      author: item?.author?.display_name,
      publishedAt: Number(item?.display_time) ? new Date(Number(item.display_time) * 1000).toISOString() : null,
      contentText,
      contentOrigin: "source_api",
      contentKind: "brief",
      status: contentText ? "complete" : "failed"
    }),
    finalUrl: sourceUrl,
    httpStatus: response.status,
    fetchedAt: new Date().toISOString(),
    error: contentText ? null : "公开快讯接口没有返回正文"
  };
}

async function fetchWallstreetArticleContent(sourceUrl, options = {}) {
  const match = new URL(sourceUrl).pathname.match(/^\/articles\/(\d+)/);
  if (!match) return null;
  const endpoint = await assertPublicUrl(`https://api-one.wallstcn.com/apiv1/content/articles/${match[1]}?extract=0`, options.lookupImpl || dns.lookup);
  const response = await (options.fetchImpl || globalThis.fetch)(endpoint, {
    redirect: "error",
    signal: options.signal || AbortSignal.timeout(Number(options.timeoutMs || 15_000)),
    headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 TradeDisciplineAssistant/0.3" }
  });
  if (!response.ok) {
    const error = new Error(`华尔街见闻文章接口请求失败：HTTP ${response.status}`);
    error.httpStatus = response.status;
    throw error;
  }
  const raw = new Uint8Array(await response.arrayBuffer());
  if (raw.byteLength > MAX_RESPONSE_BYTES) throw new Error("华尔街见闻文章响应超过2MB限制");
  const payload = JSON.parse(new TextDecoder("utf-8").decode(raw));
  const item = payload?.data;
  const contentText = plainContent(item?.content || item?.content_short);
  return {
    ...contentResult({
      sourceUrl,
      title: item?.title,
      author: item?.author?.display_name,
      publishedAt: Number(item?.display_time) ? new Date(Number(item.display_time) * 1000).toISOString() : null,
      contentText,
      excerpt: plainContent(item?.content_short),
      contentOrigin: "source_api",
      contentKind: contentText.length >= 100 ? "article" : "substantial_summary"
    }),
    finalUrl: sourceUrl,
    httpStatus: response.status,
    fetchedAt: new Date().toISOString(),
    error: contentText ? null : "公开文章接口没有返回正文"
  };
}

function decodeResponse(buffer, contentType, htmlPrefix = "") {
  const headerCharset = String(contentType || "").match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1];
  const metaCharset = String(htmlPrefix || "").match(/<meta[^>]+charset=["']?([^"'\s/>]+)/i)?.[1]
    || String(htmlPrefix || "").match(/<meta[^>]+content=["'][^"']*charset=([^;"'\s]+)/i)?.[1];
  for (const charset of [headerCharset, metaCharset, "utf-8"].filter(Boolean)) {
    try { return new TextDecoder(charset).decode(buffer); } catch {}
  }
  return new TextDecoder("utf-8").decode(buffer);
}

async function fetchArticleContent(sourceUrl, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const lookupImpl = options.lookupImpl || dns.lookup;
  if (typeof fetchImpl !== "function") throw new Error("当前运行环境不支持 fetch");
  let current = await assertPublicUrl(sourceUrl, lookupImpl);
  if (current.hostname === "wallstreetcn.com" || current.hostname.endsWith(".wallstreetcn.com")) {
    const live = await fetchWallstreetLiveContent(current.toString(), { ...options, fetchImpl, lookupImpl });
    if (live) return live;
    const article = await fetchWallstreetArticleContent(current.toString(), { ...options, fetchImpl, lookupImpl });
    if (article) return article;
  }
  let response;
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    response = await fetchImpl(current, {
      redirect: "manual",
      signal: options.signal || AbortSignal.timeout(Number(options.timeoutMs || 15_000)),
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.8,*/*;q=0.1",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.5",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 TradeDisciplineAssistant/0.3"
      }
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("location");
    if (!location) throw new Error("原文重定向缺少目标地址");
    current = await assertPublicUrl(new URL(location, current).toString(), lookupImpl);
    if (redirects === 5) throw new Error("原文重定向次数过多");
  }
  if (!response.ok) {
    const error = new Error(`原文请求失败：HTTP ${response.status}`);
    error.httpStatus = response.status;
    throw error;
  }
  const contentType = response.headers.get("content-type") || "";
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MAX_RESPONSE_BYTES) throw new Error("原文页面超过2MB限制");
  const raw = new Uint8Array(await response.arrayBuffer());
  if (raw.byteLength > MAX_RESPONSE_BYTES) throw new Error("原文页面超过2MB限制");
  const prefix = new TextDecoder("ascii").decode(raw.slice(0, 4096));
  const looksLikeText = /^\s*(?:<!doctype\s+html|<html|<head|<body|<article|<main|[^<])/i.test(prefix);
  if (!/text\/html|application\/xhtml\+xml|text\/plain/i.test(contentType) && !looksLikeText) throw new Error(`原文不是可解析网页：${contentType || "未知类型"}`);
  const html = decodeResponse(raw, contentType, prefix);
  const extracted = extractArticleContent(html, current.toString());
  return {
    ...extracted,
    finalUrl: current.toString(),
    httpStatus: response.status,
    fetchedAt: new Date().toISOString(),
    error: extracted.status === "failed" ? "页面可访问，但没有提取到正文" : null
  };
}

module.exports = {
  ARTICLE_CONTENT_SCHEMA_VERSION,
  MAX_RESPONSE_BYTES,
  isPrivateAddress,
  assertPublicUrl,
  extractArticleContent,
  fetchWallstreetLiveContent,
  fetchWallstreetArticleContent,
  fetchArticleContent
};
