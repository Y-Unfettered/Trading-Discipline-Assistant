"use strict";

const DEFAULT_RECENT_WINDOW_MS = 6 * 60 * 60 * 1000;

function eventTime(event) {
  const value = new Date(event.collectedAt || event.publishedAt || event.createdAt || 0).getTime();
  return Number.isFinite(value) ? value : 0;
}

function contentHostKey(event) {
  try {
    return new URL(event.sourceUrl).hostname.toLowerCase() || "unknown";
  } catch {
    return `unknown:${event.collectorSourceId || "source"}`;
  }
}

function selectInformationContentBatch(events, options = {}) {
  const maxItems = Math.max(1, Math.min(20, Number(options.limit || 4)));
  const perHostLimit = Math.max(1, Math.min(maxItems, Number(options.perHostLimit || 2)));
  const now = Number(options.now || Date.now());
  const recentWindowMs = Math.max(60_000, Number(options.recentWindowMs || DEFAULT_RECENT_WINDOW_MS));
  const explicitIds = Array.isArray(options.explicitIds) && options.explicitIds.length
    ? new Set(options.explicitIds)
    : null;

  if (explicitIds) {
    const byId = new Map(events.map(event => [event.id, event]));
    return options.explicitIds.map(id => byId.get(id)).filter(Boolean).slice(0, maxItems);
  }

  const recentFirstAttempts = [];
  const backlog = [];
  for (const event of events) {
    const isRecentPending = event.contentStatus === "pending"
      && Number(event.contentAttemptCount || 0) === 0
      && eventTime(event) >= now - recentWindowMs;
    (isRecentPending ? recentFirstAttempts : backlog).push(event);
  }
  recentFirstAttempts.sort((a, b) => eventTime(b) - eventTime(a));
  backlog.sort((a, b) => eventTime(a) - eventTime(b));

  const selected = [];
  const selectedIds = new Set();
  const hostCounts = new Map();
  const addFrom = (queue, targetCount, hostLimit = perHostLimit) => {
    for (const event of queue) {
      if (selected.length >= targetCount) break;
      if (selectedIds.has(event.id)) continue;
      const host = contentHostKey(event);
      if ((hostCounts.get(host) || 0) >= hostLimit) continue;
      selected.push(event);
      selectedIds.add(event.id);
      hostCounts.set(host, (hostCounts.get(host) || 0) + 1);
    }
  };

  // 新入库正文优先，但若存在历史积压，始终给积压保留一个温和处理名额。
  const recentTarget = backlog.length ? Math.max(1, maxItems - 1) : maxItems;
  addFrom(recentFirstAttempts, recentTarget);
  addFrom(backlog, maxItems);
  addFrom(recentFirstAttempts, maxItems);

  // 如果候选项全部来自同一网站，宁可本轮少抓，也不突破网站级限速。
  return selected;
}

module.exports = {
  DEFAULT_RECENT_WINDOW_MS,
  contentHostKey,
  selectInformationContentBatch
};
