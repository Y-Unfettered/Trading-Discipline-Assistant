"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { selectInformationContentBatch } = require("../lib/information-content-scheduler");

function event(id, host, minutesAgo, input = {}) {
  return {
    id,
    sourceUrl: `https://${host}/${id}`,
    collectedAt: new Date(Date.UTC(2026, 6, 22, 12, 0) - minutesAgo * 60_000).toISOString(),
    contentStatus: "pending",
    contentAttemptCount: 0,
    ...input
  };
}

test("content scheduler favors recent first attempts while reserving one backlog slot", () => {
  const now = Date.UTC(2026, 6, 22, 12, 0);
  const events = [
    event("old", "old.example.com", 600),
    event("new-a", "a.example.com", 1),
    event("new-b", "b.example.com", 2),
    event("new-c", "c.example.com", 3),
    event("new-d", "d.example.com", 4)
  ];
  const selected = selectInformationContentBatch(events, { limit: 4, now });
  assert.deepEqual(selected.map(item => item.id), ["new-a", "new-b", "new-c", "old"]);
});

test("content scheduler limits automatic requests to two items per website", () => {
  const now = Date.UTC(2026, 6, 22, 12, 0);
  const events = [
    event("same-1", "news.example.com", 1),
    event("same-2", "news.example.com", 2),
    event("same-3", "news.example.com", 3),
    event("other", "other.example.com", 4)
  ];
  const selected = selectInformationContentBatch(events, { limit: 4, perHostLimit: 2, now });
  assert.deepEqual(selected.map(item => item.id), ["same-1", "same-2", "other"]);
});

test("explicit manual fetch keeps the requested order and bypasses automatic host batching", () => {
  const events = [event("a", "news.example.com", 1), event("b", "news.example.com", 2)];
  const selected = selectInformationContentBatch(events, { limit: 2, explicitIds: ["b", "a"] });
  assert.deepEqual(selected.map(item => item.id), ["b", "a"]);
});
