let store = null;
let dashboard = null;
let currentPlan = null;
let activeAnalysisId = null;
let taskModalTimer = null;
let taskModalStartedAt = null;
let taskModalRunning = false;
let stockSearchTimer = null;
let stockSearchRequest = 0;
let stockSearchComposing = false;

const $ = selector => document.querySelector(selector);
const money = value => `¥${Number(value || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pnlTone = value => Number(value || 0) > 0 ? "pnl-profit" : Number(value || 0) < 0 ? "pnl-loss" : "muted";
const dateTime = value => value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "未记录";
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const localDateKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

function renderMarkdownInline(value) {
  const tokens = [];
  const stash = html => `\u0000MD${tokens.push(html) - 1}\u0000`;
  let source = String(value ?? "");
  source = source.replace(/`([^`\n]+)`/g, (_, code) => stash(`<code>${escapeHtml(code)}</code>`));
  source = source.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => stash(`<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`));
  source = escapeHtml(source)
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/~~([^~\n]+)~~/g, "<del>$1</del>")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  return source.replace(/\u0000MD(\d+)\u0000/g, (_, index) => tokens[Number(index)] || "");
}

function renderMarkdownFallback(markdown) {
  const lines = String(markdown ?? "").replace(/\r\n?/g, "\n").trim().split("\n");
  const html = [];
  let paragraph = [];
  let listType = null;
  let listItems = [];
  let codeLines = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${paragraph.map(renderMarkdownInline).join("<br>")}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!listType) return;
    html.push(`<${listType}>${listItems.map(item => `<li>${renderMarkdownInline(item)}</li>`).join("")}</${listType}>`);
    listType = null;
    listItems = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (codeLines) {
      if (/^```/.test(line)) {
        html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeLines = null;
      } else codeLines.push(line);
      continue;
    }
    if (/^```/.test(line)) {
      flushParagraph(); flushList(); codeLines = [];
      continue;
    }
    if (!line.trim()) {
      flushParagraph(); flushList();
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph(); flushList();
      const level = heading[1].length;
      html.push(`<h${level}>${renderMarkdownInline(heading[2])}</h${level}>`);
      continue;
    }
    if (/^\s*(?:---+|\*\*\*+)\s*$/.test(line)) {
      flushParagraph(); flushList(); html.push("<hr>");
      continue;
    }
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      flushParagraph(); flushList(); html.push(`<blockquote>${renderMarkdownInline(quote[1])}</blockquote>`);
      continue;
    }
    const unordered = line.match(/^\s*[-+*]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      const nextType = unordered ? "ul" : "ol";
      if (listType && listType !== nextType) flushList();
      listType = nextType;
      listItems.push((unordered || ordered)[1]);
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph(); flushList();
  if (codeLines) html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  return html.join("");
}

function renderMarkdown(markdown) {
  const source = String(markdown ?? "");
  if (globalThis.marked?.parse && globalThis.DOMPurify?.sanitize) {
    const rendered = globalThis.marked.parse(source, { gfm: true, breaks: true });
    return globalThis.DOMPurify.sanitize(rendered, { USE_PROFILES: { html: true } });
  }
  return renderMarkdownFallback(source);
}

function reportTitle(item) {
  const heading = String(item.content || "").match(/^#\s+(.+)$/m)?.[1];
  if (heading) return heading.replace(/[*_`~]/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").trim();
  return item.status === "completed" ? "A股交易纪律复盘报告" : "纪律分析未完成";
}

function updateTaskElapsed() {
  if (!taskModalStartedAt) return;
  const seconds = Math.max(0, Math.floor((Date.now() - taskModalStartedAt) / 1000));
  $("#taskModalElapsed").textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function openTaskModal(title, steps) {
  taskModalStartedAt = Date.now();
  taskModalRunning = true;
  $("#taskModal").classList.remove("hidden");
  $("#taskStatusLauncher").classList.add("hidden");
  $("#taskModalTitle").textContent = title;
  $("#taskModalStatus").textContent = "正在准备…";
  $("#taskModalDetails").textContent = "";
  $("#taskModalProgress").className = "task-progress-fill";
  $("#taskModalProgress").style.width = "4%";
  $("#taskModalSpinner").className = "task-spinner";
  $("#taskModalClose").textContent = "隐藏窗口";
  $("#taskModalSteps").innerHTML = steps.map((step, index) => `<li data-task-step="${index}">${escapeHtml(step)}</li>`).join("");
  clearInterval(taskModalTimer);
  updateTaskElapsed();
  taskModalTimer = setInterval(updateTaskElapsed, 1000);
}

function updateTaskModal({ status, progress, step = 0, details = "" }) {
  $("#taskModalStatus").textContent = status;
  $("#taskModalProgress").style.width = `${Math.max(4, Math.min(96, Number(progress || 4)))}%`;
  $("#taskModalDetails").textContent = details;
  document.querySelectorAll("[data-task-step]").forEach((node, index) => {
    node.className = index < step ? "done" : index === step ? "active" : "";
  });
}

function finishTaskModal(success, status, details = "") {
  taskModalRunning = false;
  clearInterval(taskModalTimer);
  updateTaskElapsed();
  $("#taskModalStatus").textContent = status;
  $("#taskModalDetails").textContent = details;
  $("#taskModalProgress").style.width = "100%";
  $("#taskModalProgress").className = `task-progress-fill ${success ? "done" : "failed"}`;
  $("#taskModalSpinner").className = `task-spinner ${success ? "done" : "failed"}`;
  $("#taskModalClose").textContent = "关闭";
  $("#taskStatusLauncher").textContent = success ? "查看已完成任务" : "查看失败原因";
  if ($("#taskModal").classList.contains("hidden")) $("#taskStatusLauncher").classList.remove("hidden");
  document.querySelectorAll("[data-task-step]").forEach(node => node.className = success ? "done" : node.classList.contains("done") ? "done" : "failed");
}

async function api(url, options = {}) {
  const response = await fetch(url, { headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options });
  const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
  if (!response.ok) throw new Error(payload.error || "请求失败");
  return payload;
}

function setMessage(selector, text, kind = "positive") {
  const node = $(selector);
  if (!node) return;
  node.className = `form-message ${kind}`;
  node.textContent = text;
}

function planLabel(plan) {
  if (!plan) return "尚未创建计划";
  const status = { draft: "草稿", active: "已确认生效", completed: "已完成", archived: "已废弃" }[plan.status] || plan.status;
  return `${plan.planForDate} · ${status} · V${plan.version || 1}`;
}

function renderDashboard() {
  const account = dashboard.account;
  $("#assetMetrics").innerHTML = [
    ["程序估算总资产", money(account.totalAssets), ""],
    ["调整后现金", money(account.availableCash + account.pendingSettlementAdjustment), ""],
    ["持仓市值", money(account.marketValue), ""],
    ["数据健康", `${dashboard.health.score}分`, dashboard.health.score >= 90 ? "positive" : "warning"]
  ].map(([label, value, cls]) => `<div class="metric"><span>${label}</span><strong class="${cls}">${value}</strong></div>`).join("");

  const issues = dashboard.health.issues;
  const primary = issues.find(issue => issue.level === "error") || issues.find(issue => issue.type === "pending-fee") || issues[0];
  $("#primaryAction").innerHTML = `<div class="primary-cta"><div><p class="eyebrow">NEXT ACTION</p><h2>${primary ? escapeHtml(primary.message) : (currentPlan?.status === "draft" ? "确认下一交易日计划" : "当前数据完整，按计划执行")}</h2><p class="muted">${primary ? "先处理影响账务或复盘可信度的数据。" : planLabel(currentPlan)}</p></div><button data-jump="${primary ? "postmarket" : currentPlan?.status === "draft" ? "plan" : "intraday"}">${primary ? "去处理" : currentPlan?.status === "draft" ? "确认计划" : "打开行动卡"}</button></div>`;

  $("#activePlanSummary").innerHTML = `<div class="panel-title"><div><p class="eyebrow">ACTIVE PLAN</p><h2>当前计划</h2></div></div>${currentPlan ? `<h3>${planLabel(currentPlan)}</h3><p>${escapeHtml(currentPlan.trainingFocus || "尚未填写训练目标")}</p><p class="muted">来源复盘：${currentPlan.sourceReviewDate || "未关联"}</p>` : `<p class="warning">还没有下一交易日计划。</p>`}`;
  $("#healthPanel").innerHTML = `<div class="panel-title"><div><p class="eyebrow">DATA HEALTH</p><h2>待处理数据</h2></div><strong>${dashboard.health.score}分</strong></div><ul class="health-list">${issues.length ? issues.map(issue => `<li class="${issue.level === "error" ? "negative" : issue.level === "warning" ? "warning" : "info"}">${escapeHtml(issue.message)}</li>`).join("") : '<li class="positive">没有发现阻断复盘的问题</li>'}</ul>`;

  const brokerComparable = account.brokerSnapshotAt && (!account.latestTradeAt || new Date(account.brokerSnapshotAt) >= new Date(account.latestTradeAt));
  $("#accountEquation").innerHTML = `<div class="panel-title"><div><p class="eyebrow">ACCOUNT EQUATION</p><h2>资产口径</h2></div><span class="muted">截至 ${dateTime(account.asOf)}</span></div><div class="equation"><strong>${money(account.availableCash)}</strong><span>成交后毛现金</span><b>＋</b><strong>${money(account.marketValue)}</strong><span>持仓市值</span>${account.pendingSettlementAdjustment ? `<b>${account.pendingSettlementAdjustment >= 0 ? "＋" : "−"}</b><strong class="warning">${money(Math.abs(account.pendingSettlementAdjustment))}</strong><span>待分配结算差额</span>` : ""}<b>＝</b><strong>${money(account.totalAssets)}</strong><span>当前总资产</span></div><p class="muted">卖出净额进入现金，已实现盈利已包含其中，不重复加到总资产。待分配差额会在券商公布具体费用后转入对应成交，不会再次扣款。</p>${account.brokerTotalAssets == null ? '<p class="muted">尚未录入券商快照。</p>' : brokerComparable ? `<p>券商同一时点总资产 ${money(account.brokerTotalAssets)}，差额 <span class="${Math.abs(account.totalAssets - account.brokerTotalAssets) < .01 ? "positive" : "warning"}">${money(account.totalAssets - account.brokerTotalAssets)}</span></p>` : `<p class="warning">券商快照 ${money(account.brokerTotalAssets)} 截至 ${dateTime(account.brokerSnapshotAt)}，早于最新成交，当前不做差额报错。</p>`}`;

  $("#overviewHoldings").innerHTML = store.holdings.map(holding => {
    const marketValue = holding.quantity * holding.lastPrice;
    const pnl = holding.brokerPnl == null ? (holding.lastPrice - holding.cost) * holding.quantity + Number(holding.pnlAdjustment || 0) : Number(holding.brokerPnl);
    return `<tr><td><strong>${escapeHtml(holding.name)}</strong><br><span class="muted">${holding.code}</span></td><td>${holding.quantity}</td><td>${holding.cost.toFixed(3)}</td><td>${holding.lastPrice.toFixed(3)}</td><td>${money(marketValue)}</td><td class="${pnlTone(pnl)}">${money(pnl)}</td></tr>`;
  }).join("");
  $("#quoteTime").textContent = store.holdings.length ? `行情更新：${dateTime(store.holdings.map(h => h.quoteUpdatedAt).filter(Boolean).sort().pop())}` : "无持仓";
}

function renderPlan(plan) {
  currentPlan = plan;
  $("#planId").value = plan?.id || "";
  $("#planForDate").value = plan?.planForDate || dashboard.nextTradingDate;
  $("#sourceReviewDate").value = plan?.sourceReviewDate || "";
  $("#planStatus").value = plan?.status || "draft";
  $("#planVersion").value = plan?.version || 1;
  $("#previousAdvice").value = plan?.previousAdvice || "";
  $("#accountRules").value = plan?.accountRules || "";
  $("#trainingFocus").value = plan?.trainingFocus || "";
  $("#marketObservation").value = plan?.marketObservation || "";
  $("#planDatePicker").value = plan?.planForDate || dashboard.nextTradingDate;
  $("#planBanner").innerHTML = `<div><p class="eyebrow">PLAN STATUS</p><h2>${planLabel(plan)}</h2><p class="muted">计划必须在盘前确认生效；复盘只评价当时是否按已确认规则执行。</p></div>${plan?.status === "active" ? '<span class="quiet-badge positive">当前有效</span>' : '<span class="quiet-badge warning">尚未生效</span>'}`;
  const savedRules = plan?.rules || [];
  $("#planRules").innerHTML = store.holdings.map(holding => {
    const rule = savedRules.find(item => String(item.code) === String(holding.code)) || {};
    return `<div class="rule-editor" data-rule-code="${holding.code}"><div class="rule-title"><h3>${escapeHtml(holding.name)}</h3><span class="muted">${holding.code} · ${holding.quantity}股</span></div><div class="rule-grid"><label>等待条件<textarea data-field="wait">${escapeHtml(rule.wait || "")}</textarea></label><label>止盈/减仓条件<textarea data-field="sell">${escapeHtml(rule.sell || "")}</textarea></label><label>止损/撤退条件<textarea data-field="stop">${escapeHtml(rule.stop || "")}</textarea></label><label>禁止动作<textarea data-field="forbidden">${escapeHtml(rule.forbidden || "不做计划外加仓")}</textarea></label></div></div>`;
  }).join("");
  renderIntraday();
}

function renderIntraday() {
  $("#intradayPlanMeta").textContent = currentPlan ? `适用日期 ${currentPlan.planForDate} · 来源复盘 ${currentPlan.sourceReviewDate || "未关联"} · V${currentPlan.version || 1}` : "没有可执行计划";
  const rules = currentPlan?.rules || [];
  $("#intradayCards").innerHTML = currentPlan && currentPlan.status === "active" ? store.holdings.map(holding => {
    const rule = rules.find(item => String(item.code) === String(holding.code)) || {};
    return `<article class="action-card"><div class="rule-title"><div><p class="eyebrow">${holding.code}</p><h3>${escapeHtml(holding.name)}</h3></div><span class="quiet-badge">${holding.quantity}股</span></div><div class="action-row wait"><span>等待</span>${escapeHtml(rule.wait || "没有填写")}</div><div class="action-row sell"><span>止盈 / 减仓</span>${escapeHtml(rule.sell || "没有填写")}</div><div class="action-row stop"><span>止损 / 撤退</span>${escapeHtml(rule.stop || "没有填写")}</div><div class="action-row forbidden"><span>禁止动作</span>${escapeHtml(rule.forbidden || "不做计划外操作")}</div></article>`;
  }).join("") : `<section class="panel"><p class="warning">当前没有已确认生效的计划。请先在“下一交易日计划”中确认。</p></section>`;
  renderTradePicker();
}

function hideStockSearchResults() {
  $("#stockSearchResults").classList.add("hidden");
}

function selectTradeStock(stock) {
  $("#tradeName").value = stock.name || "";
  $("#tradeCode").value = stock.code || "";
  $("#stockSearchHint").textContent = `${stock.code} · ${stock.market === "SH" ? "沪市" : stock.market === "SZ" ? "深市" : stock.market || "A股"} · 已从本地证券库匹配`;
  hideStockSearchResults();
}

function renderTradePicker() {
  if (!store) return;
  const select = $("#tradeHoldingSelect");
  const selected = select.value;
  select.innerHTML = `<option value="">请选择要卖出的股票</option>${store.holdings.map(holding => `<option value="${escapeHtml(holding.code)}">${escapeHtml(holding.name)}（${escapeHtml(holding.code)}）· 可卖${Number(holding.quantity || 0)}股</option>`).join("")}`;
  if (store.holdings.some(item => item.code === selected)) select.value = selected;
  updateTradeMode(false);
}

function updateTradeMode(clearSecurity = true) {
  stockSearchRequest += 1;
  clearTimeout(stockSearchTimer);
  const isSell = $("#tradeSide").value === "SELL";
  $("#tradeHoldingField").classList.toggle("hidden", !isSell);
  $("#tradeName").readOnly = isSell;
  $("#tradeName").placeholder = isSell ? "从当前持仓选择后自动填写" : "输入股票名称，例如：贵州茅台";
  $("#stockSearchHint").textContent = isSell ? "卖出时请从当前持仓选择" : "输入名称或代码，将使用本地 A 股证券库匹配";
  if (clearSecurity) {
    $("#tradeHoldingSelect").value = "";
    $("#tradeName").value = "";
    $("#tradeCode").value = "";
    $("#tradeForm [name=quantity]").removeAttribute("max");
    $("#tradeForm [name=quantity]").placeholder = "";
  }
  hideStockSearchResults();
}

async function searchTradeStocks(query) {
  const requestId = ++stockSearchRequest;
  const keyword = String(query || "").trim();
  if (!keyword || $("#tradeSide").value !== "BUY") return hideStockSearchResults();
  if (keyword.length < 2) {
    $("#tradeCode").value = "";
    $("#stockSearchHint").textContent = "请至少输入2个字或2位代码，再选择匹配股票";
    return hideStockSearchResults();
  }
  $("#stockSearchHint").textContent = "正在本地 A 股证券库中匹配…";
  try {
    const { stocks } = await api(`/api/stocks/search?q=${encodeURIComponent(keyword)}`);
    if (requestId !== stockSearchRequest) return;
    const results = stocks || [];
    if (!results.length) {
      $("#tradeCode").value = "";
      $("#stockSearchHint").textContent = "本地证券库中没有找到，请检查名称或代码";
      $("#stockSearchResults").innerHTML = '<div class="stock-search-empty">没有匹配的 A 股股票</div>';
      $("#stockSearchResults").classList.remove("hidden");
      return;
    }
    $("#stockSearchResults").innerHTML = results.map(stock => `<button class="stock-search-result" type="button" data-stock-code="${escapeHtml(stock.code)}" data-stock-name="${escapeHtml(stock.name)}" data-stock-market="${escapeHtml(stock.market || "")}" role="option"><strong>${escapeHtml(stock.name)}</strong><span>${escapeHtml(stock.code)} · ${stock.market === "SH" ? "沪市" : stock.market === "SZ" ? "深市" : "A股"}</span></button>`).join("");
    $("#stockSearchResults").classList.remove("hidden");
    $("#stockSearchHint").textContent = `找到${results.length}只；输入内容不会被修改，请点击正确的股票`;
  } catch (error) {
    if (requestId !== stockSearchRequest) return;
    $("#tradeCode").value = "";
    $("#stockSearchHint").textContent = `匹配失败：${error.message}`;
    hideStockSearchResults();
  }
}

function renderPostmarket() {
  const close = dashboard.latestMarketClose;
  const closeStatus = { completed: "已完成", partial: "部分成功", failed: "失败", running: "运行中" }[close?.status] || "尚未运行";
  const closeSources = [...new Set((close?.quotes || []).map(item => item.source === "eastmoney" ? "东方财富" : item.source === "tencent" ? "腾讯行情" : item.source))].filter(Boolean);
  $("#closeStatusPanel").innerHTML = `<div class="panel-title"><div><p class="eyebrow">MARKET CLOSE</p><h2>收盘行情自动任务</h2></div><span class="quiet-badge ${close?.status === "completed" ? "positive" : "warning"}">${closeStatus}</span></div><div class="close-grid"><div class="close-cell"><span>计划执行时间</span><strong>交易日 15:35</strong></div><div class="close-cell"><span>最近快照</span><strong>${close?.date || "无"}</strong></div><div class="close-cell"><span>抓取结果</span><strong>${close ? `${close.quotes?.length || 0}成功 / ${close.errors?.length || 0}失败` : "等待执行"}</strong></div></div>${closeSources.length ? `<p class="positive">行情来源：${closeSources.join("、")} · ${dateTime(close.completedAt)}</p>` : ""}${close?.errors?.length ? `<p class="warning">${close.errors.map(item => `${item.code}: ${item.message}`).join("；")}</p>` : ""}`;
  const pendingTrades = store.trades.filter(trade => trade.fee == null);
  $("#pendingDataPanel").innerHTML = `<div class="panel-title"><div><p class="eyebrow">DATA TODO</p><h2>复盘前待处理</h2></div><span>${pendingTrades.length}项</span></div>${pendingTrades.length ? `<div class="trade-list">${pendingTrades.map(trade => `<div class="trade-item"><div><strong>${trade.date} ${trade.time}</strong><br><span class="muted">${trade.code}</span></div><div><strong>${trade.side === "BUY" ? "买入" : "卖出"} ${escapeHtml(trade.name)}</strong><br>${trade.quantity}股 @ ${trade.price}</div><form class="fee-form" data-trade-id="${trade.id}"><label>实际费用<input name="fee" type="number" min="0" step="0.01" required></label><button class="secondary">补录</button></form></div>`).join("")}</div>` : '<p class="positive">成交费用已完整。</p>'}`;
  $("#snapshotForm [name=availableCash]").value = store.account.availableCash ?? "";
  $("#snapshotForm [name=brokerTotalAssets]").value = store.account.brokerTotalAssets ?? "";
  $("#snapshotForm [name=todayPnl]").value = store.account.todayPnl ?? "";
  const today = localDateKey();
  const todayTrades = store.trades.filter(trade => trade.date === today).sort((a, b) => a.time.localeCompare(b.time));
  $("#systemFactSummary").innerHTML = `<div class="fact-grid"><div class="close-cell"><span>当日成交</span><strong>${todayTrades.length}笔</strong><p>${todayTrades.map(trade => `${trade.time} ${trade.side === "BUY" ? "买入" : "卖出"}${escapeHtml(trade.name)} ${trade.quantity}股 @ ${trade.price}`).join("<br>") || "无成交"}</p></div><div class="close-cell"><span>收盘账户</span><strong>${money(dashboard.account.totalAssets)}</strong><p>今日盈亏 <strong class="${pnlTone(store.account.todayPnl)}">${money(store.account.todayPnl)}</strong><br>持仓市值 ${money(dashboard.account.marketValue)}</p></div><div class="close-cell"><span>收盘持仓</span><strong>${store.holdings.length}只</strong><p>${store.holdings.map(item => `${escapeHtml(item.name)} ${item.quantity}股 · ${money(item.lastPrice)}`).join("<br>")}</p></div></div>`;
  const post = store.dailySessions?.[localDateKey()]?.postmarket || {};
  $("#postmarketNarrative").value = post.factsCorrection ?? post.narrative ?? "";
  $("#goodDecision").value = post.executionEvidence ?? post.goodDecision ?? "";
  $("#badDecision").value = post.deviationContext ?? post.badDecision ?? "";
  $("#tomorrowFocus").value = post.correctionRule ?? post.tomorrowFocus ?? "";
  renderResearchPanel();
}

function renderResearchPanel() {
  const research = [...(store.researchSnapshots || [])].sort((a, b) => `${b.reviewDate} ${b.updatedAt || b.createdAt}`.localeCompare(`${a.reviewDate} ${a.updatedAt || a.createdAt}`))[0];
  if (!research) return $("#researchPanel").innerHTML = '<p class="warning">尚无研究快照。先刷新均线，再补充带来源的外部研究。</p>';
  const market = research.marketTechnical;
  const technicalRows = [market, ...(research.holdingsTechnical || [])].filter(Boolean);
  const sourceRows = (research.externalFactors || []).map(item => `<article class="research-source"><div><span class="tag">${escapeHtml(item.category)}</span> <strong>${escapeHtml(item.title)}</strong></div><p>${escapeHtml(item.impact)}</p><a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.source)} · ${escapeHtml(item.publishedAt || "")}</a></article>`).join("");
  $("#researchPanel").innerHTML = `<div class="research-meta"><strong>研究日期 ${research.reviewDate}</strong><span class="quiet-badge ${research.status === "ready" ? "positive" : "warning"}">${research.status === "ready" ? "可生成计划" : "资料未完整"}</span></div><div class="table-wrap"><table><thead><tr><th>标的</th><th>收盘</th><th>当日高/低</th><th>MA5</th><th>MA10</th><th>MA30</th><th>MA60</th><th>结构</th></tr></thead><tbody>${technicalRows.map(item => `<tr><td><strong>${escapeHtml(item.name)}</strong><br><span class="muted">${item.code}</span></td><td>${Number(item.close).toFixed(2)}</td><td>${Number(item.high).toFixed(2)} / ${Number(item.low).toFixed(2)}</td><td>${Number(item.ma5).toFixed(2)}</td><td>${Number(item.ma10).toFixed(2)}</td><td>${Number(item.ma30).toFixed(2)}</td><td>${Number(item.ma60).toFixed(2)}</td><td>${escapeHtml(item.structure)}</td></tr>`).join("")}</tbody></table></div><div class="research-sources">${sourceRows || '<p class="warning">外部政策与资讯尚未留档。</p>'}</div><p class="muted">研究只用于建立条件情景，不保证收益，也不把盘中反弹自动认定为趋势反转。</p>`;
}

async function renderAnalysisHistory() {
  try {
    const { analyses } = await api("/api/analyses");
    $("#analysisHistory").innerHTML = `<div class="panel-title"><div><p class="eyebrow">ARCHIVE</p><h3>历史版本</h3></div><span class="muted">${analyses.length}次任务</span></div>${analyses.map(item => `<details class="analysis-record" ${item.status === "completed" ? "" : "data-failed"}><summary><strong>${dateTime(item.startedAt)}</strong><span class="analysis-record-title">${escapeHtml(reportTitle(item))}</span><span class="tag ${item.status === "completed" ? "positive" : "warning"}">${item.status === "completed" ? "已完成" : "失败"}</span>${item.stale ? '<span class="tag warning">旧数据口径</span>' : ""}</summary>${item.stale ? '<p class="warning">这份报告生成于本次账户校正和环境研究之前，仅供追溯，不代表当前结论。</p>' : ""}${item.content ? `<article class="analysis-record-body markdown-body">${renderMarkdown(item.content)}</article>` : `<p class="warning">${escapeHtml(item.errorSummary || "该次任务没有生成可读报告")}</p>`}</details>`).join("") || '<p class="muted">暂无历史分析。</p>'}`;
  } catch (error) { $("#analysisHistory").innerHTML = `<p class="negative">历史分析加载失败：${escapeHtml(error.message)}</p>`; }
}

function renderTrades() {
  $("#tradeList").innerHTML = [...store.trades].sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`)).slice(0, 30).map(trade => `<div class="trade-item"><div><strong>${trade.date} ${trade.time}</strong><br><span class="muted">${trade.code}</span></div><div><strong class="${trade.side === "BUY" ? "trade-buy" : "trade-sell"}">${trade.side === "BUY" ? "买入" : "卖出"} ${escapeHtml(trade.name)}</strong><br>${trade.quantity}股 @ ${trade.price} · ${escapeHtml(trade.reason || "未记录理由")}</div><div>${trade.fee == null ? '<span class="warning">费用待补</span>' : `费用 ${money(trade.fee)}`}</div></div>`).join("") || '<p class="muted">暂无成交。</p>';
}

function renderFunds() {
  const account = dashboard.account;
  const pnlClass = pnlTone(account.cumulativePnl);
  $("#fundsAsOf").textContent = `截至 ${dateTime(account.brokerSnapshotAt || account.asOf)}`;
  $("#fundMetrics").innerHTML = [
    ["累计净投入", money(account.netContributions), ""],
    ["当前券商总资产", money(account.totalAssets), ""],
    ["累计盈亏", money(account.cumulativePnl), pnlClass],
    ["累计收益率", `${Number(account.cumulativeReturnPct || 0).toFixed(2)}%`, pnlClass]
  ].map(([label,value,cls]) => `<div class="metric"><span>${label}</span><strong class="${cls}">${value}</strong></div>`).join("");

  const ledger = [...(store.fundingLedger || [])].sort((a,b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  let cumulative = 0;
  $("#fundingTimeline").innerHTML = ledger.map(item => {
    if (item.type === "DEPOSIT") cumulative += Number(item.amount || 0);
    const label = item.type === "DEPOSIT" ? "资金转入" : item.type === "WITHDRAWAL" ? "资金转出" : "利息入账";
    return `<div class="funding-entry"><div><strong>${item.date}</strong><br><span class="muted">${item.time}</span></div><div>${label}${item.type === "DEPOSIT" ? `<br><span class="muted">累计投入 ${money(cumulative)}</span>` : ""}</div><div class="amount ${item.amount >= 0 ? "positive" : "negative"}">${item.amount >= 0 ? "+" : ""}${money(item.amount)}</div></div>`;
  }).join("") || '<p class="muted">尚无入出金记录。</p>';

  const maxValue = Math.max(account.netContributions, account.totalAssets, 1);
  const bars = [
    ["2026-01-22 首次投入", 2000, ""],
    ["2026-01-28 累计投入", 10000, ""],
    ["2026-07-13 累计投入", account.netContributions, ""],
    ["当前账户资产", account.totalAssets, "current"]
  ];
  $("#fundingChart").innerHTML = bars.map(([label,value,kind]) => `<div><div class="capital-bar-label"><span>${label}</span><strong>${money(value)}</strong></div><div class="capital-bar-track"><div class="capital-bar-fill ${kind}" style="width:${Math.max(2, value / maxValue * 100).toFixed(2)}%"></div></div></div>`).join("");

  const snapshots = [...(store.accountSnapshots || [])].sort((a,b) => b.capturedAt.localeCompare(a.capturedAt));
  $("#accountSnapshotHistory").innerHTML = `<table><thead><tr><th>日期</th><th>累计投入</th><th>券商总资产</th><th>累计盈亏</th><th>收益率</th><th>口径</th></tr></thead><tbody>${snapshots.map(item => `<tr><td>${item.date}<br><span class="muted">${dateTime(item.capturedAt)}</span></td><td>${money(item.netContributions)}</td><td>${money(item.brokerTotalAssets)}</td><td class="${pnlTone(item.cumulativePnl)}">${money(item.cumulativePnl)}</td><td class="${pnlTone(item.cumulativeReturnPct)}">${Number(item.cumulativeReturnPct || 0).toFixed(2)}%</td><td>${escapeHtml(item.source || "账户快照")}</td></tr>`).join("")}</tbody></table>`;

  const cashRows = [
    ...store.trades.map(trade => ({ date: trade.date, time: trade.time, name: trade.name, operation: trade.side === "BUY" ? "证券买入" : "证券卖出", quantity: trade.quantity, price: trade.price, amount: trade.price * trade.quantity, fee: trade.fee, cashEffect: trade.cashEffect })),
    ...ledger.map(item => ({ date: item.date, time: item.time, name: item.type === "DEPOSIT" ? "资金转入" : item.type === "WITHDRAWAL" ? "资金转出" : "利息入账", operation: item.type === "DEPOSIT" ? "资金转入" : item.type === "WITHDRAWAL" ? "资金转出" : "利息", quantity: 0, price: null, amount: Math.abs(item.amount), fee: 0, cashEffect: item.amount }))
  ].sort((a,b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
  $("#brokerLedgerTable").innerHTML = `<table><thead><tr><th>发生时间</th><th>名称</th><th>操作</th><th>成交价/数量</th><th>成交金额</th><th>费用</th><th>现金变化</th></tr></thead><tbody>${cashRows.map(item => `<tr><td>${item.date}<br><span class="muted">${item.time}</span></td><td>${escapeHtml(item.name)}</td><td>${item.operation}</td><td>${item.price == null ? "—" : `${Number(item.price).toFixed(4)} / ${item.quantity}`}</td><td>${money(item.amount)}</td><td>${item.fee == null ? '<span class="warning">待补录</span>' : money(item.fee)}</td><td class="${Number(item.cashEffect) >= 0 ? "positive" : "negative"}">${Number(item.cashEffect) >= 0 ? "+" : ""}${money(item.cashEffect)}</td></tr>`).join("")}</tbody></table>`;

  $("#ledgerSummary").innerHTML = `<div class="panel-title"><div><p class="eyebrow">RECONCILIATION</p><h2>当前资金核对</h2></div></div><div class="equation"><strong>${money(account.availableCash)}</strong><span>今日卖出后毛现金</span>${account.pendingSettlementAdjustment ? `<b>−</b><strong class="warning">${money(Math.abs(account.pendingSettlementAdjustment))}</strong><span>待分配费用/结算差额</span>` : ""}<b>＝</b><strong>${money(account.availableCash + account.pendingSettlementAdjustment)}</strong><span>调整后现金</span></div><div class="loss-callout"><span>从累计投入到当前资产</span><br><strong class="${pnlClass}">${money(account.netContributions)} → ${money(account.totalAssets)}，累计${account.cumulativePnl >= 0 ? "盈利" : "亏损"}${money(Math.abs(account.cumulativePnl))}</strong><p class="muted">这是账户层面的累计盈亏，包含已实现和未实现盈亏；不等同于单笔交易的已实现盈亏。</p></div>`;
}

function renderStockPnl() {
  const snapshots = [...(store.stockPnlSnapshots || [])].sort((a, b) => `${b.asOfDate} ${b.capturedAt}`.localeCompare(`${a.asOfDate} ${a.capturedAt}`));
  const latest = snapshots[0];
  if (!latest) {
    $("#stockPnlAsOf").textContent = "暂无券商快照";
    $("#stockPnlMetrics").innerHTML = "";
    $("#stockPnlReconciliation").innerHTML = '<p class="muted">尚未录入个股盈亏数据。</p>';
    $("#stockPnlExtremes").innerHTML = "";
    $("#stockPnlTable").innerHTML = "";
    $("#stockPnlSnapshotHistory").innerHTML = "";
    return;
  }

  const rows = [...latest.items].sort((a, b) => Number(b.currentPnl) - Number(a.currentPnl));
  const winners = rows.filter(item => Number(item.currentPnl) > 0);
  const losers = rows.filter(item => Number(item.currentPnl) < 0);
  const best = rows[0];
  const worst = rows.at(-1);
  const statusLabel = { holding: "当前持仓", sold_today: "今日清仓", closed: "历史已清仓" };
  $("#stockPnlAsOf").textContent = `数据截至 ${latest.asOfDate}`;
  $("#stockPnlMetrics").innerHTML = [
    ["个股盈亏合计", money(latest.totalStockPnl), pnlTone(latest.totalStockPnl)],
    ["账户累计盈亏", money(latest.accountPnlIncludingInterest), pnlTone(latest.accountPnlIncludingInterest)],
    ["盈利个股", `${winners.length}只`, "pnl-profit"],
    ["亏损个股", `${losers.length}只`, "pnl-loss"]
  ].map(([label, value, cls]) => `<div class="metric"><span>${label}</span><strong class="${cls}">${value}</strong></div>`).join("");

  $("#stockPnlReconciliation").innerHTML = `<div class="panel-title"><div><p class="eyebrow">RECONCILIATION</p><h2>账户盈亏核对</h2></div></div><div class="equation"><strong class="${pnlTone(latest.totalStockPnl)}">${money(latest.totalStockPnl)}</strong><span>16只股票合计</span><b>＋</b><strong class="${pnlTone(latest.interestIncome)}">${money(latest.interestIncome)}</strong><span>利息收入</span><b>＝</b><strong class="${pnlTone(latest.accountPnlIncludingInterest)}">${money(latest.accountPnlIncludingInterest)}</strong><span>账户累计盈亏</span></div><p class="muted">${escapeHtml(latest.note || "")}</p>`;
  $("#stockPnlExtremes").innerHTML = `<div class="panel-title"><div><p class="eyebrow">EXTREMES</p><h2>盈亏两端</h2></div></div><div class="pnl-extreme pnl-profit"><span>当前累计盈利最多</span><strong>${escapeHtml(best.name)} ${money(best.currentPnl)}</strong></div><div class="pnl-extreme pnl-loss"><span>当前累计亏损最多</span><strong>${escapeHtml(worst.name)} ${money(worst.currentPnl)}</strong></div><p class="muted">用于回看哪些标的真正贡献收益、哪些标的持续侵蚀本金；不用于鼓励“翻本交易”。</p>`;

  $("#stockPnlTable").innerHTML = `<table><thead><tr><th>排名</th><th>股票</th><th>状态</th><th>截至昨日</th><th>今日变化</th><th>当前累计</th></tr></thead><tbody>${rows.map((item, index) => `<tr><td>${index + 1}</td><td><strong>${escapeHtml(item.name)}</strong><br><span class="muted">${item.code}</span></td><td><span class="tag">${statusLabel[item.status] || item.status}</span></td><td class="${pnlTone(item.priorPnl)}">${money(item.priorPnl)}</td><td class="${pnlTone(item.todayChange)}">${Number(item.todayChange) > 0 ? "+" : ""}${money(item.todayChange)}</td><td class="${pnlTone(item.currentPnl)}"><strong>${money(item.currentPnl)}</strong></td></tr>`).join("")}</tbody></table>`;

  $("#stockPnlSnapshotHistory").innerHTML = `<table><thead><tr><th>数据日期</th><th>采集时间</th><th>个股合计</th><th>利息</th><th>账户累计盈亏</th><th>口径</th></tr></thead><tbody>${snapshots.map(item => `<tr><td>${item.asOfDate}</td><td>${dateTime(item.capturedAt)}</td><td class="${pnlTone(item.totalStockPnl)}">${money(item.totalStockPnl)}</td><td class="${pnlTone(item.interestIncome)}">${money(item.interestIncome)}</td><td class="${pnlTone(item.accountPnlIncludingInterest)}">${money(item.accountPnlIncludingInterest)}</td><td>${escapeHtml(item.basis)}</td></tr>`).join("")}</tbody></table>`;
}

async function renderBackups() {
  const { backups } = await api("/api/backups");
  $("#backupList").innerHTML = backups.slice(0, 30).map(item => `<div class="backup-item"><div><strong>${escapeHtml(item.name)}</strong><br><span class="muted">${dateTime(item.createdAt)} · ${item.summary ? `现金 ${money(item.summary.availableCash)} · 持仓 ${money(item.summary.marketValue)} · 总资产 ${money(item.summary.totalAssets)}` : "无法读取摘要"}</span></div><button class="secondary restore-backup" data-name="${escapeHtml(item.name)}">恢复到此版本</button></div>`).join("") || '<p class="muted">暂无备份。</p>';
}

function renderAll() {
  renderDashboard();
  renderPlan(currentPlan || dashboard.plan);
  renderPostmarket();
  renderTrades();
  renderFunds();
  renderStockPnl();
  document.querySelectorAll("[data-jump]").forEach(button => button.onclick = () => switchPage(button.dataset.jump));
}

async function reload() {
  [store, dashboard] = await Promise.all([api("/api/store"), api("/api/dashboard")]);
  currentPlan = dashboard.plan;
  renderAll();
  renderAnalysisHistory();
}

function switchPage(page) {
  document.querySelectorAll(".nav-button").forEach(button => button.classList.toggle("active", button.dataset.page === page));
  document.querySelectorAll("[data-page-panel]").forEach(panel => panel.classList.toggle("active", panel.dataset.pagePanel === page));
  if (page === "data") renderBackups().catch(error => setMessage("#importMessage", error.message, "negative"));
  if (page === "postmarket") renderAnalysisHistory();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelectorAll(".nav-button").forEach(button => button.addEventListener("click", () => switchPage(button.dataset.page)));
function hideTaskModal() {
  $("#taskModal").classList.add("hidden");
  $("#taskStatusLauncher").textContent = taskModalRunning ? "查看任务进度" : "查看任务结果";
  $("#taskStatusLauncher").classList.remove("hidden");
}
$("#taskModalClose").addEventListener("click", hideTaskModal);
$("#taskModal").addEventListener("click", event => { if (event.target === event.currentTarget) hideTaskModal(); });
$("#taskStatusLauncher").addEventListener("click", () => {
  $("#taskModal").classList.remove("hidden");
  $("#taskStatusLauncher").classList.add("hidden");
});

$("#planDatePicker").addEventListener("change", async event => {
  const result = await api(`/api/plans?date=${encodeURIComponent(event.target.value)}`);
  renderPlan(result.selected || { planForDate: event.target.value, status: "draft", version: 1, rules: [] });
});

$("#planForm").addEventListener("submit", async event => {
  event.preventDefault();
  const rules = [...document.querySelectorAll(".rule-editor")].map(editor => ({
    code: editor.dataset.ruleCode,
    name: store.holdings.find(h => h.code === editor.dataset.ruleCode)?.name || editor.dataset.ruleCode,
    ...Object.fromEntries([...editor.querySelectorAll("[data-field]")].map(input => [input.dataset.field, input.value.trim()]))
  }));
  try {
    const result = await api("/api/plans", { method: "PUT", body: JSON.stringify({ id: $("#planId").value || undefined, planForDate: $("#planForDate").value, sourceReviewDate: $("#sourceReviewDate").value || null, status: $("#planStatus").value, previousAdvice: $("#previousAdvice").value.trim(), accountRules: $("#accountRules").value.trim(), trainingFocus: $("#trainingFocus").value.trim(), marketObservation: $("#marketObservation").value.trim(), rules }) });
    store = result.store; currentPlan = result.plan; dashboard = await api("/api/dashboard"); renderAll(); setMessage("#planMessage", "计划已保存并留下版本记录");
  } catch (error) { setMessage("#planMessage", error.message, "negative"); }
});

$("#tradeForm").addEventListener("submit", async event => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement); const code = form.get("code"); const holding = store.holdings.find(h => h.code === code);
  const executionStatus = form.get("executionStatus");
  try {
    const result = await api("/api/trades", { method: "POST", body: JSON.stringify({ date: form.get("date"), time: form.get("time"), code, name: form.get("name") || holding?.name || code, side: form.get("side"), quantity: Number(form.get("quantity")), price: Number(form.get("price")), fee: form.get("fee") === "" ? null : Number(form.get("fee")), reason: form.get("reason"), emotion: form.get("emotion"), planFollowed: executionStatus === "followed", executionStatus }) });
    store = result.store; dashboard = await api("/api/dashboard"); renderAll(); formElement.reset(); initTradeTime(); updateTradeMode(); setMessage("#tradeMessage", `成交已保存${result.trade.violations?.length ? `；触发：${result.trade.violations.join("、")}` : ""}`);
  } catch (error) { setMessage("#tradeMessage", error.message, "negative"); }
});

$("#pendingDataPanel").addEventListener("submit", async event => {
  const form = event.target.closest(".fee-form"); if (!form) return; event.preventDefault();
  try { const result = await api(`/api/trades/${encodeURIComponent(form.dataset.tradeId)}/fee`, { method: "PUT", body: JSON.stringify({ fee: Number(new FormData(form).get("fee")) }) }); store = result.store; dashboard = await api("/api/dashboard"); renderAll(); }
  catch (error) { alert(error.message); }
});

$("#refreshClose").addEventListener("click", async event => {
  const button = event.currentTarget;
  button.disabled = true; button.textContent = "正在获取收盘行情…";
  try { const result = await api("/api/market-close/refresh", { method: "POST", body: JSON.stringify({ date: localDateKey() }) }); store = result.store; dashboard = await api("/api/dashboard"); renderAll(); }
  catch (error) { alert(error.message); }
  finally { button.disabled = false; button.textContent = "立即补跑收盘行情"; }
});

$("#snapshotForm").addEventListener("submit", async event => {
  event.preventDefault(); const form = new FormData(event.currentTarget);
  try { store = await api("/api/account", { method: "PUT", body: JSON.stringify({ availableCash: form.get("availableCash"), brokerTotalAssets: form.get("brokerTotalAssets"), todayPnl: form.get("todayPnl") }) }); dashboard = await api("/api/dashboard"); renderAll(); setMessage("#snapshotMessage", "券商快照已保存，当前可进行同一时点对账"); }
  catch (error) { setMessage("#snapshotMessage", error.message, "negative"); }
});

$("#postmarketForm").addEventListener("submit", async event => {
  event.preventDefault();
  try { const result = await api("/api/daily-session", { method: "PUT", body: JSON.stringify({ date: localDateKey(), session: { postmarket: { factsCorrection: $("#postmarketNarrative").value.trim(), executionEvidence: $("#goodDecision").value.trim(), deviationContext: $("#badDecision").value.trim(), correctionRule: $("#tomorrowFocus").value.trim(), completedAt: new Date().toISOString() } } }) }); store = result.store; dashboard = await api("/api/dashboard"); renderAll(); setMessage("#postmarketMessage", "复盘事实已保存；尚未生成计划，请先完成环境与持仓研究"); }
  catch (error) { setMessage("#postmarketMessage", error.message, "negative"); }
});

$("#refreshResearchTechnicals").addEventListener("click", async event => {
  const button = event.currentTarget;
  button.disabled = true;
  openTaskModal("刷新市场与持仓均线", ["连接行情源", "获取上证与持仓日线", "计算MA5/10/30/60", "保存研究快照"]);
  updateTaskModal({ status: "正在连接东方财富日线接口…", progress: 12, step: 0, details: "请求上证指数及当前全部持仓最近100个交易日日线。" });
  try {
    const result = await api("/api/research/technicals", { method: "POST", body: JSON.stringify({ date: localDateKey() }) });
    updateTaskModal({ status: "行情已返回，正在更新页面…", progress: 86, step: 3, details: `${result.research.marketTechnical.name}：${result.research.marketTechnical.date}\n持仓：${result.research.holdingsTechnical.map(item => `${item.name} ${item.date}`).join("、")}` });
    store = result.store; renderResearchPanel(); setMessage("#researchMessage", "市场与持仓均线已刷新");
    finishTaskModal(true, "均线刷新成功", `数据日期：${result.research.marketTechnical.date}\n已更新：上证指数、${result.research.holdingsTechnical.map(item => item.name).join("、")}\n来源：${result.research.technicalSource}`);
  }
  catch (error) { setMessage("#researchMessage", error.message, "negative"); finishTaskModal(false, "均线刷新失败", error.message); }
  finally { button.disabled = false; }
});

$("#generateResearchPlan").addEventListener("click", async event => {
  const button = event.currentTarget;
  button.disabled = true;
  openTaskModal("生成下一交易日计划草稿", ["读取研究快照", "生成持仓情景规则", "保存计划版本"]);
  updateTaskModal({ status: "正在读取最新研究与持仓…", progress: 18, step: 0, details: "计划只使用已完成的行情、环境和持仓研究快照。" });
  try {
    const result = await api("/api/plans/generate-from-review", { method: "POST", body: JSON.stringify({ date: localDateKey() }) });
    updateTaskModal({ status: "计划已生成，正在保存版本…", progress: 88, step: 2, details: `${result.plan.planForDate} · 草稿 V${result.plan.version}` });
    store = result.store; currentPlan = result.plan; dashboard = await api("/api/dashboard"); renderAll(); setMessage("#researchMessage", `已基于研究生成 ${result.plan.planForDate} 计划草稿 V${result.plan.version}`);
    finishTaskModal(true, "计划草稿生成成功", `交易日：${result.plan.planForDate}\n版本：V${result.plan.version}\n可前往“下一交易日计划”确认或修改。`);
  }
  catch (error) { setMessage("#researchMessage", error.message, "negative"); finishTaskModal(false, "计划草稿生成失败", error.message); }
  finally { button.disabled = false; }
});

$("#exportReview").addEventListener("click", async () => { try { const result = await api("/api/review/export", { method: "POST", body: "{}" }); $("#analysisBox").textContent = `复盘包已生成：${result.file}`; } catch (error) { $("#analysisBox").textContent = error.message; } });
$("#runAnalysis").addEventListener("click", async event => {
  const button = event.currentTarget;
  button.disabled = true;
  openTaskModal("生成纪律分析报告", ["锁定复盘数据快照", "启动Codex分析", "分析近期交易与纪律偏差", "写入Markdown报告", "加入历史版本"]);
  updateTaskModal({ status: "正在生成复盘数据包…", progress: 8, step: 0, details: "将账户、成交、研究快照和计划版本锁定到同一份分析输入。" });
  try {
    const result = await api("/api/analysis", { method: "POST", body: "{}" });
    activeAnalysisId = result.id;
    updateTaskModal({ status: "Codex已启动，正在读取数据…", progress: 16, step: 1, details: `任务编号：${result.id}\n最长运行时间：10分钟` });
    pollAnalysis();
  } catch (error) {
    $("#analysisBox").textContent = error.message;
    button.disabled = false;
    finishTaskModal(false, "纪律分析启动失败", error.message);
  }
});
async function pollAnalysis() {
  if (!activeAnalysisId) return;
  try {
    const result = await api(`/api/analysis/${encodeURIComponent(activeAnalysisId)}`);
    $("#analysisBox").innerHTML = result.status === "completed" ? `<article class="markdown-body">${renderMarkdown(result.content)}</article>` : `<p>${escapeHtml(result.progress || "正在分析…")}</p>`;
    if (result.status === "running") {
      const elapsed = Math.max(0, Date.now() - new Date(result.startedAt).getTime());
      const timeProgress = Math.min(72, 18 + elapsed / 600000 * 70);
      const progress = Math.max(timeProgress, Number(result.progressPercent || 0));
      const step = progress >= 78 ? 3 : progress >= 28 ? 2 : 1;
      updateTaskModal({ status: result.progress || "正在生成复盘报告…", progress, step, details: `任务编号：${result.id}\n最后活动：${dateTime(result.lastActivityAt)}\n报告会保留为新的历史版本。` });
    }
    if (["completed", "failed"].includes(result.status)) {
      const runButton = $("#runAnalysis"); if (runButton) runButton.disabled = false;
      if (result.status === "completed") finishTaskModal(true, "纪律分析已完成", `报告已写入：${result.outputPath}\n可在下方“历史版本”展开查看。`);
      else finishTaskModal(false, "纪律分析失败", result.error || result.progress || "任务没有生成报告");
      activeAnalysisId = null;
      await renderAnalysisHistory();
      return;
    }
    setTimeout(pollAnalysis, 2500);
  } catch (error) {
    $("#analysisBox").textContent = error.message;
    const runButton = $("#runAnalysis"); if (runButton) runButton.disabled = false;
    finishTaskModal(false, "无法获取分析进度", error.message);
  }
}

$("#importCsv").addEventListener("click", async () => { const file = $("#csvFile").files[0]; if (!file) return setMessage("#importMessage", "请先选择CSV文件", "warning"); try { const result = await api("/api/trades/import", { method: "POST", body: JSON.stringify({ csv: await file.text(), updateHoldings: $("#updateHoldingsOnImport").checked }) }); store = result.store; dashboard = await api("/api/dashboard"); renderAll(); setMessage("#importMessage", `导入${result.imported.length}笔，跳过${result.skipped.length}笔`); } catch (error) { setMessage("#importMessage", error.message, "negative"); } });
$("#reloadBackups").addEventListener("click", () => renderBackups());
$("#backupList").addEventListener("click", async event => { const button = event.target.closest(".restore-backup"); if (!button) return; if (!confirm(`将恢复到版本：${button.dataset.name}\n当前数据会先自动备份。继续吗？`)) return; button.disabled = true; try { await api("/api/backups/restore", { method: "POST", body: JSON.stringify({ name: button.dataset.name }) }); await reload(); await renderBackups(); alert("恢复完成，原当前版本已保留为备份。"); } catch (error) { alert(error.message); button.disabled = false; } });

function initTradeTime() { const now = new Date(); $("#tradeForm [name=date]").value = localDateKey(now); $("#tradeForm [name=time]").value = now.toTimeString().slice(0, 5); }
$("#tradeSide").addEventListener("change", () => updateTradeMode());
$("#tradeHoldingSelect").addEventListener("change", event => {
  const holding = store?.holdings.find(item => item.code === event.target.value);
  if (!holding) return updateTradeMode();
  selectTradeStock(holding);
  $("#stockSearchHint").textContent = `当前持仓：${holding.name}（${holding.code}）· 可卖${holding.quantity}股`;
  const quantity = $("#tradeForm [name=quantity]");
  quantity.max = String(holding.quantity || "");
  quantity.placeholder = `最多${holding.quantity}股`;
});
$("#tradeName").addEventListener("input", event => {
  if ($("#tradeSide").value !== "BUY") return;
  if (event.isComposing || stockSearchComposing) return;
  $("#tradeCode").value = "";
  clearTimeout(stockSearchTimer);
  stockSearchTimer = setTimeout(() => searchTradeStocks(event.target.value), 300);
});
$("#tradeName").addEventListener("compositionstart", () => {
  stockSearchComposing = true;
  stockSearchRequest += 1;
  clearTimeout(stockSearchTimer);
  hideStockSearchResults();
});
$("#tradeName").addEventListener("compositionend", event => {
  stockSearchComposing = false;
  $("#tradeCode").value = "";
  clearTimeout(stockSearchTimer);
  stockSearchTimer = setTimeout(() => searchTradeStocks(event.target.value), 300);
});
$("#stockSearchResults").addEventListener("click", event => {
  const option = event.target.closest(".stock-search-result");
  if (!option) return;
  selectTradeStock({ code: option.dataset.stockCode, name: option.dataset.stockName, market: option.dataset.stockMarket });
});
document.addEventListener("click", event => {
  if (!event.target.closest(".stock-picker")) hideStockSearchResults();
});
function updateClock() { $("#clock").textContent = new Date().toLocaleString("zh-CN", { hour12: false }); }

function updateAppHeaderOffset() {
  const header = $(".app-header");
  if (header) document.documentElement.style.setProperty("--app-header-height", `${Math.ceil(header.getBoundingClientRect().height)}px`);
}

function updateScrollTopVisibility() {
  $("#scrollTopButton").classList.toggle("hidden", window.scrollY < 320);
}

$("#scrollTopButton").addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
window.addEventListener("scroll", updateScrollTopVisibility, { passive: true });
window.addEventListener("resize", updateAppHeaderOffset, { passive: true });

initTradeTime(); updateClock(); updateAppHeaderOffset(); updateScrollTopVisibility(); setInterval(updateClock, 1000);
requestAnimationFrame(updateAppHeaderOffset);
reload().catch(error => { document.body.innerHTML = `<main><section class="panel"><h2>应用加载失败</h2><p class="negative">${escapeHtml(error.message)}</p></section></main>`; });
