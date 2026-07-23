"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { assignInformationCluster, titleSimilarity } = require("../lib/information-clustering");

test("same event from different sources shares one cluster without deleting source records", () => {
  const first = { id: "e1", title: "重磅：国家发布人工智能基础设施建设方案", publishedAt: "2026-07-23T08:00:00Z", collectorSourceId: "s1" };
  const second = { id: "e2", title: "国家发布人工智能基础设施建设方案", publishedAt: "2026-07-23T08:15:00Z", collectorSourceId: "s2" };
  const store = { informationEvents: [first, second], informationEventClusters: [] };
  const a = assignInformationCluster(store, first, "2026-07-23T08:00:00Z");
  const b = assignInformationCluster(store, second, "2026-07-23T08:15:00Z");
  assert.equal(a.id, b.id);
  assert.deepEqual(a.eventIds, ["e1", "e2"]);
  assert.deepEqual(a.sourceIds, ["s1", "s2"]);
  assert.equal(store.informationEvents.length, 2);
});

test("similar words in materially different headlines do not get merged", () => {
  const first = { id: "e1", title: "石油价格上涨推动能源板块走强", publishedAt: "2026-07-23T08:00:00Z" };
  const second = { id: "e2", title: "石油价格下跌拖累能源板块表现", publishedAt: "2026-07-23T08:10:00Z" };
  const store = { informationEvents: [first, second], informationEventClusters: [] };
  assert.ok(titleSimilarity(first.title, second.title) < 0.88);
  assert.notEqual(assignInformationCluster(store, first).id, assignInformationCluster(store, second).id);
});
