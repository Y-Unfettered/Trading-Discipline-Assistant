"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  appendCashReconciliationEvent,
  appendFeeAdjustmentEvent,
  appendPositionReconciliationEvent,
  appendTradeEvent,
  ensureLedger
} = require("../lib/ledger");

function emptyStore() {
  return {
    account: { availableCash: 10000, realizedPnl: 0 },
    holdings: [],
    trades: []
  };
}

test("ledger replays trades and later fee adjustments without changing history", () => {
  const store = emptyStore();
  ensureLedger(store, "2026-01-01T00:00:00.000Z");

  const buy = { id: "buy-1", date: "2026-01-02", time: "10:00", code: "000001", name: "测试股票", market: "SZ", side: "BUY", quantity: 100, price: 10, fee: 5 };
  store.trades.push(buy);
  appendTradeEvent(store, buy, "2026-01-02T02:00:00.000Z");
  assert.equal(store.account.availableCash, 8995);
  assert.equal(store.holdings[0].quantity, 100);
  assert.equal(store.holdings[0].cost, 10.05);

  const sell = { id: "sell-1", date: "2026-01-03", time: "10:00", code: "000001", name: "测试股票", market: "SZ", side: "SELL", quantity: 40, price: 12, fee: null };
  store.trades.push(sell);
  appendTradeEvent(store, sell, "2026-01-03T02:00:00.000Z");
  assert.equal(store.account.availableCash, 9475);
  assert.equal(store.account.realizedPnl, 78);
  assert.equal(store.holdings[0].quantity, 60);

  appendFeeAdjustmentEvent(store, sell, 3, "2026-01-03T09:00:00.000Z");
  assert.equal(store.account.availableCash, 9472);
  assert.equal(store.account.realizedPnl, 75);

  appendFeeAdjustmentEvent(store, buy, 7, "2026-01-03T09:05:00.000Z");
  assert.equal(store.account.availableCash, 9470);
  assert.equal(store.account.realizedPnl, 74.2);
  assert.equal(store.holdings[0].cost, 10.07);
  assert.equal(store.ledger.events.length, 4);
});
test("cash and position reconciliations are immutable ledger events", () => {
  const store = emptyStore();
  ensureLedger(store);
  appendCashReconciliationEvent(store, 9000, "券商现金校正");
  appendPositionReconciliationEvent(store, [{ code: "600000", name: "测试持仓", market: "SH", quantity: 200, cost: 8.5 }]);
  assert.equal(store.account.availableCash, 9000);
  assert.equal(store.holdings[0].quantity, 200);
  assert.equal(store.holdings[0].cost, 8.5);
  assert.deepEqual(store.ledger.events.map(event => event.type), ["CASH_RECONCILED", "POSITIONS_RECONCILED"]);
});
