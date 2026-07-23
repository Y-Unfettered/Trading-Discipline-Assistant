"use strict";

const crypto = require("node:crypto");

const CLUSTER_SCHEMA_VERSION = "information-cluster/v1";

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function normalizedTitle(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .replace(/^(快讯|突发|最新|独家|重磅)+/u, "");
}

function ngrams(value, size = 2) {
  const text = normalizedTitle(value);
  const result = new Set();
  if (text.length <= size) {
    if (text) result.add(text);
    return result;
  }
  for (let index = 0; index <= text.length - size; index += 1) result.add(text.slice(index, index + size));
  return result;
}

function titleSimilarity(left, right) {
  const a = normalizedTitle(left);
  const b = normalizedTitle(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const leftSet = ngrams(a);
  const rightSet = ngrams(b);
  let intersection = 0;
  for (const item of leftSet) if (rightSet.has(item)) intersection += 1;
  return leftSet.size + rightSet.size ? 2 * intersection / (leftSet.size + rightSet.size) : 0;
}

function hoursBetween(left, right) {
  const a = new Date(left || 0).getTime();
  const b = new Date(right || 0).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
  return Math.abs(a - b) / 3_600_000;
}

function eventFingerprint(event) {
  return crypto.createHash("sha256").update(JSON.stringify({
    title: normalizedTitle(event.title),
    publishedDate: clean(event.publishedAt).slice(0, 10)
  })).digest("hex");
}

function belongsToCluster(event, representative) {
  if (!representative) return false;
  if (event.contentHash && representative.contentHash && event.contentHash === representative.contentHash) return true;
  if (event.rawFingerprint && representative.rawFingerprint && event.rawFingerprint === representative.rawFingerprint) return true;
  if (hoursBetween(event.publishedAt, representative.publishedAt) > 96) return false;
  const left = normalizedTitle(event.title);
  const right = normalizedTitle(representative.title);
  if (left.length < 8 || right.length < 8) return left === right;
  return titleSimilarity(left, right) >= 0.88;
}

function assignInformationCluster(store, event, now = new Date().toISOString()) {
  store.informationEventClusters ||= [];
  if (event.clusterId) {
    const existing = store.informationEventClusters.find(item => item.id === event.clusterId);
    if (existing) return existing;
  }
  const events = store.informationEvents || [];
  let cluster = null;
  for (const candidate of store.informationEventClusters) {
    const representative = events.find(item => item.id === candidate.canonicalEventId);
    if (belongsToCluster(event, representative)) {
      cluster = candidate;
      break;
    }
  }
  if (!cluster) {
    cluster = {
      id: `information-cluster-${eventFingerprint(event).slice(0, 20)}-${Date.now()}`,
      schemaVersion: CLUSTER_SCHEMA_VERSION,
      canonicalEventId: event.id,
      eventIds: [],
      sourceIds: [],
      title: event.title,
      fingerprint: eventFingerprint(event),
      createdAt: now,
      updatedAt: now
    };
    store.informationEventClusters.push(cluster);
  }
  event.clusterId = cluster.id;
  cluster.eventIds = [...new Set([...(cluster.eventIds || []), event.id])];
  cluster.sourceIds = [...new Set([...(cluster.sourceIds || []), event.collectorSourceId].filter(Boolean))];
  cluster.sourceCount = cluster.sourceIds.length;
  cluster.updatedAt = now;
  return cluster;
}

function ensureInformationClusters(store, now = new Date().toISOString()) {
  store.informationEventClusters ||= [];
  const validIds = new Set((store.informationEvents || []).map(item => item.id));
  store.informationEventClusters = store.informationEventClusters.filter(cluster => (cluster.eventIds || []).some(id => validIds.has(id)));
  for (const cluster of store.informationEventClusters) {
    cluster.eventIds = (cluster.eventIds || []).filter(id => validIds.has(id));
    if (!validIds.has(cluster.canonicalEventId)) cluster.canonicalEventId = cluster.eventIds[0] || null;
  }
  for (const event of store.informationEvents || []) assignInformationCluster(store, event, now);
  return store.informationEventClusters;
}

module.exports = {
  CLUSTER_SCHEMA_VERSION,
  assignInformationCluster,
  belongsToCluster,
  ensureInformationClusters,
  normalizedTitle,
  titleSimilarity
};
