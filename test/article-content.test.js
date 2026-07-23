"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { assertPublicUrl, extractArticleContent, fetchArticleContent, isPrivateAddress } = require("../lib/article-content");

const articleHtml = `<!doctype html><html><head>
  <title>页面标题</title>
  <meta property="og:title" content="算力网络建设方案正式发布">
  <meta name="author" content="测试作者">
  <meta property="article:published_time" content="2026-07-22T10:00:00+08:00">
  <meta name="description" content="方案明确了建设范围、实施时间和责任主体。">
</head><body><nav>导航内容</nav><article>
  <h1>算力网络建设方案正式发布</h1>
  <p>有关部门正式发布算力网络建设方案，明确全国范围内的建设任务和责任主体。</p>
  <p>方案要求在规定时间内完成重点节点建设，并建立持续监督和验收机制。</p>
  <p>相关建设内容覆盖网络设备、光通信设施、数据中心互联和运行保障体系。</p>
</article><footer>页脚</footer></body></html>`;

test("article extractor keeps readable body and removes navigation noise", () => {
  const result = extractArticleContent(articleHtml, "https://example.com/article/1");
  assert.equal(result.status, "complete");
  assert.equal(result.title, "算力网络建设方案正式发布");
  assert.equal(result.author, "测试作者");
  assert.match(result.contentText, /光通信设施/);
  assert.doesNotMatch(result.contentText, /导航内容|页脚/);
  assert.match(result.contentHash, /^[a-f0-9]{64}$/);
});

test("article fetch validates public destinations and returns locally storable content", async () => {
  const lookupImpl = async () => [{ address: "93.184.216.34", family: 4 }];
  const fetchImpl = async () => new Response(articleHtml, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  const result = await fetchArticleContent("https://example.com/article/1", { fetchImpl, lookupImpl });
  assert.equal(result.status, "complete");
  assert.equal(result.httpStatus, 200);
  assert.match(result.contentHtml, /<p>/);
});

test("CLS Next data is treated as the complete telegraph body even without a content-type header", async () => {
  const html = `<!doctype html><html><head><title>电报标题</title></head><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { articleDetail: { title: "电报标题", brief: "电报摘要", content: "财联社电报完整内容，明确披露了事项、时间、对象以及对应的数据变化。", ctime: 1784721704 } } } })}</script></body></html>`;
  const result = await fetchArticleContent("https://www.cls.cn/detail/123", {
    lookupImpl: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async () => new Response(html, { status: 200 })
  });
  assert.equal(result.status, "complete");
  assert.equal(result.contentKind, "brief");
  assert.match(result.contentText, /完整内容/);
});

test("reference news inline contentTxt is extracted as the full article", () => {
  const html = `<html><head><meta property="og:title" content="参考消息测试"></head><body><div id="articleContent"></div><script>var contentTxt = "<p>第一段包含足够长的参考消息正文内容，用于确认不会只保存页面分享摘要，并且保留事件主体、发生时间、涉及地区和明确数字。<\\/p><p>第二段继续提供可以分析的事实材料和背景信息，说明相关国家、行业、商品流向以及可能需要继续核验的后续变化。<\\/p><p>第三段补充来源引用和历史背景，使正文长度足以作为完整文章进入后续人工阅读与人工智能整理流程。<\\/p>";</script></body></html>`;
  const result = extractArticleContent(html, "https://ckxxapp.ckxx.net/pages/2026/07/22/example.html");
  assert.equal(result.status, "complete");
  assert.equal(result.contentKind, "article");
  assert.match(result.contentText, /第一段包含足够长/);
  assert.match(result.contentText, /第二段继续提供/);
});

test("WallstreetCN live public detail payload is saved as a complete brief", async () => {
  const result = await fetchArticleContent("https://wallstreetcn.com/livenews/3138234", {
    lookupImpl: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async () => new Response(JSON.stringify({ data: { id: 3138234, content_text: "波罗的海干散货指数上涨，当前报2715点。", display_time: 1784721670, author: { display_name: "编辑" } } }), { status: 200, headers: { "content-type": "application/json" } })
  });
  assert.equal(result.status, "complete");
  assert.equal(result.contentOrigin, "source_api");
  assert.equal(result.contentKind, "brief");
});

test("Jin10 detail extraction keeps the complete brief without page navigation", () => {
  const html = `<!doctype html><html><head><title>金十快讯</title></head><body><div class="flash-detail">首页 快讯详情 分享<div class="detail-content"><div class="content-title">公司公告披露本次回购金额、实施期限和股份用途。</div></div></div></body></html>`;
  const result = extractArticleContent(html, "https://flash.jin10.com/detail/1");
  assert.equal(result.status, "complete");
  assert.equal(result.contentKind, "brief");
  assert.equal(result.contentText, "公司公告披露本次回购金额、实施期限和股份用途。");
  assert.doesNotMatch(result.contentText, /首页|分享/);
});

test("article fetch blocks localhost and private network targets", async () => {
  assert.equal(isPrivateAddress("127.0.0.1"), true);
  assert.equal(isPrivateAddress("192.168.1.10"), true);
  assert.equal(isPrivateAddress("93.184.216.34"), false);
  await assert.rejects(() => assertPublicUrl("http://127.0.0.1/private"), /本机或内网/);
  await assert.rejects(() => assertPublicUrl("https://internal.example", async () => [{ address: "10.0.0.8", family: 4 }]), /本机或内网/);
});
