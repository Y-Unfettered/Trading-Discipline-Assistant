"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  accountValuation,
  appendCashReconciliationEvent,
  appendFeeAdjustmentEvent,
  appendPositionReconciliationEvent,
  appendTradeEvent,
  ensureLedger,
  holdingValuation,
  rebuildLedgerProjection
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

test("full-history mode derives cash, positions and costs from the unified annual ledger", () => {
  const store = {
    account: {},
    holdings: [],
    fundingLedger: [{ id: "deposit-1", date: "2026-01-01", time: "09:00:00", type: "DEPOSIT", amount: 2000 }],
    trades: [
      { id: "buy-1", date: "2026-01-02", time: "10:00:00", code: "000001", name: "测试股票", market: "SZ", side: "BUY", quantity: 100, price: 10, fee: 5 },
      { id: "sell-1", date: "2026-01-03", time: "10:00:00", code: "000001", name: "测试股票", market: "SZ", side: "SELL", quantity: 40, price: 12, fee: 3 }
    ],
    ledger: { version: 1, mode: "full-history", baseline: { availableCash: 0, realizedPnl: 0, holdings: [] }, events: [] }
  };
  rebuildLedgerProjection(store);
  assert.equal(store.account.availableCash, 1472);
  assert.equal(store.account.netContributions, 2000);
  assert.equal(store.holdings[0].quantity, 60);
  assert.equal(store.holdings[0].cost, 10.05);
  assert.equal(store.trades[1].realizedPnlEstimate, 75);

  store.trades[0].fee = 7;
  rebuildLedgerProjection(store);
  assert.equal(store.account.availableCash, 1470);
  assert.equal(store.holdings[0].cost, 10.07);
  assert.equal(store.trades[1].realizedPnlEstimate, 74.2);
});

test("market value and unrealized PnL use latest prices while cost only affects PnL", () => {
  const holdings = [
    { code: "002185", name: "华天科技", quantity: 100, cost: 18.0502, lastPrice: 16.85 },
    { code: "002475", name: "立讯精密", quantity: 100, cost: 58.5506, lastPrice: 56.8 },
    { code: "601818", name: "光大银行", quantity: 1700, cost: 3.162971, lastPrice: 3.18 }
  ];
  assert.deepEqual(holdings.map(item => holdingValuation(item).unrealizedPnl), [-120.02, -175.06, 28.95]);
  const valuation = accountValuation({ account: { availableCash: 77.9 }, holdings });
  assert.equal(valuation.marketValue, 12771);
  assert.equal(valuation.totalAssets, 12848.9);
  assert.equal(valuation.unrealizedPnl, -266.13);
});
