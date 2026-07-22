"use strict";

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function roundMoney(value) {
  return +Number(value || 0).toFixed(2);
}

function latestHoldingPrice(holding) {
  const price = Number(holding?.lastPrice);
  return Number.isFinite(price) && price >= 0 ? price : 0;
}

function holdingValuation(holding) {
  const quantity = Number(holding?.quantity || 0);
  const cost = Number(holding?.cost || 0);
  const latestPrice = latestHoldingPrice(holding);
  const marketValue = roundMoney(quantity * latestPrice);
  const costValue = roundMoney(quantity * cost);
  const unrealizedPnl = roundMoney(marketValue - costValue + Number(holding?.pnlAdjustment || 0));
  return { quantity, cost, latestPrice, marketValue, costValue, unrealizedPnl };
}

function accountValuation(store) {
  const positions = (store?.holdings || []).map(holdingValuation);
  const availableCash = roundMoney(store?.account?.availableCash);
  const marketValue = roundMoney(positions.reduce((sum, position) => sum + position.marketValue, 0));
  const unrealizedPnl = roundMoney(positions.reduce((sum, position) => sum + position.unrealizedPnl, 0));
  return {
    availableCash,
    marketValue,
    totalAssets: roundMoney(availableCash + marketValue),
    unrealizedPnl,
    positions
  };
}

function holdingCore(holding) {
  return {
    id: holding.id || holding.code,
    code: String(holding.code || ""),
    name: String(holding.name || holding.code || ""),
    market: holding.market || (String(holding.code || "").startsWith("6") ? "SH" : "SZ"),
    quantity: Number(holding.quantity || 0),
    cost: Number(holding.cost || 0)
  };
}

function ensureLedger(store, now = new Date().toISOString()) {
  if (!store.ledger || Number(store.ledger.version || 0) < 1) {
    store.ledger = {
      version: 1,
      establishedAt: now,
      baseline: {
        availableCash: roundMoney(store.account?.availableCash),
        realizedPnl: roundMoney(store.account?.realizedPnl),
        holdings: (store.holdings || []).map(holdingCore)
      },
      events: []
    };
  }
  store.ledger.events ||= [];
  rebuildLedgerProjection(store);
  return store.ledger;
}

function makePosition(holding, metadata = {}) {
  const core = holdingCore(holding);
  const amount = Number(core.cost) * Number(core.quantity);
  return {
    ...clone(metadata),
    ...core,
    lots: core.quantity > 0 ? [{
      id: `baseline:${core.code}`,
      tradeId: null,
      originalQuantity: core.quantity,
      remainingQuantity: core.quantity,
      remainingCost: amount
    }] : []
  };
}

function positionTotals(position) {
  const quantity = position.lots.reduce((sum, lot) => sum + Number(lot.remainingQuantity || 0), 0);
  const amount = position.lots.reduce((sum, lot) => sum + Number(lot.remainingCost || 0), 0);
  return { quantity, amount, cost: quantity ? amount / quantity : 0 };
}

function reducePositionAverage(position, quantity) {
  const totals = positionTotals(position);
  if (quantity > totals.quantity + 1e-9) throw new Error("卖出数量不能超过当前持仓数量");
  const ratio = totals.quantity ? (totals.quantity - quantity) / totals.quantity : 0;
  const costBasis = totals.cost * quantity;
  position.lots.forEach(lot => {
    lot.remainingQuantity = Number(lot.remainingQuantity || 0) * ratio;
    lot.remainingCost = Number(lot.remainingCost || 0) * ratio;
  });
  position.lots = position.lots.filter(lot => lot.remainingQuantity > 1e-9);
  return costBasis;
}

function rebuildFullHistoryProjection(store) {
  store.account ||= {};
  store.holdings ||= [];
  store.trades ||= [];
  store.fundingLedger ||= [];

  const currentMetadata = new Map(store.holdings.map(holding => [String(holding.code), clone(holding)]));
  const positions = new Map();
  let availableCash = 0;
  let realizedPnl = 0;
  let netContributions = 0;
  const rows = [
    ...store.fundingLedger.map(funding => ({ kind: "funding", date: funding.date, time: funding.time, id: funding.id, value: funding })),
    ...store.trades.map(trade => ({ kind: "trade", date: trade.date, time: trade.time, id: trade.id, value: trade }))
  ].sort((a, b) => `${a.date || ""} ${a.time || ""} ${a.kind} ${a.id}`.localeCompare(`${b.date || ""} ${b.time || ""} ${b.kind} ${b.id}`));

  for (const row of rows) {
    if (row.kind === "funding") {
      const funding = row.value;
      const amount = Number(funding.amount || 0);
      availableCash += amount;
      if (funding.type === "DEPOSIT" || funding.type === "WITHDRAWAL") netContributions += amount;
      funding.cumulativeContributions = roundMoney(netContributions);
      continue;
    }

    const trade = row.value;
    const code = String(trade.code);
    const fee = Number(trade.fee == null ? 0 : trade.fee);
    const quantity = Number(trade.quantity || 0);
    const price = Number(trade.price || 0);
    let position = positions.get(code);
    if (trade.side === "BUY") {
      if (!position) {
        const metadata = currentMetadata.get(code) || {};
        position = makePosition({ ...trade, quantity: 0, cost: 0 }, metadata);
        position.lastPrice = Number(metadata.lastPrice || trade.price);
        positions.set(code, position);
      }
      position.name = trade.name || position.name;
      position.market = trade.market || position.market;
      position.lots.push({
        id: `trade:${trade.id}`,
        tradeId: trade.id,
        originalQuantity: quantity,
        remainingQuantity: quantity,
        remainingCost: price * quantity + fee
      });
      availableCash -= price * quantity + fee;
      trade.cashEffect = roundMoney(-(price * quantity + fee));
      delete trade.realizedPnlEstimate;
    } else {
      if (!position) throw new Error(`总账重放失败：${trade.date} ${trade.name || code} 没有可卖持仓`);
      const costBasis = reducePositionAverage(position, quantity);
      const proceeds = price * quantity - fee;
      const realized = proceeds - costBasis;
      availableCash += proceeds;
      realizedPnl += realized;
      trade.cashEffect = roundMoney(proceeds);
      trade.realizedPnlEstimate = roundMoney(realized);
    }
  }

  const holdings = [];
  for (const position of positions.values()) {
    const totals = positionTotals(position);
    if (totals.quantity <= 1e-9) continue;
    const { lots, ...metadata } = position;
    holdings.push({
      ...metadata,
      id: position.id || position.code,
      code: position.code,
      name: position.name,
      market: position.market,
      quantity: +totals.quantity.toFixed(6),
      cost: +totals.cost.toFixed(6),
      lastPrice: latestHoldingPrice(position),
      brokerPnl: position.brokerPnl ?? null
    });
  }

  store.account.availableCash = roundMoney(availableCash);
  store.account.realizedPnl = roundMoney(realizedPnl);
  store.account.netContributions = roundMoney(netContributions);
  store.account.initialCapital = roundMoney(netContributions);
  store.account.pendingSettlementAdjustment = 0;
  store.holdings = holdings;
  store.ledger.projectedAt = new Date().toISOString();
  store.ledger.eventCount = store.ledger.events.length;
  store.ledger.sourceRowCount = rows.length;
  return store;
}

function rebuildLedgerProjection(store) {
  if (!store.ledger?.baseline) return store;
  if (store.ledger.mode === "full-history") return rebuildFullHistoryProjection(store);
  store.account ||= {};
  store.holdings ||= [];
  store.trades ||= [];

  const currentMetadata = new Map(store.holdings.map(holding => [String(holding.code), clone(holding)]));
  const positions = new Map();
  for (const holding of store.ledger.baseline.holdings || []) {
    positions.set(String(holding.code), makePosition(holding, currentMetadata.get(String(holding.code))));
  }

  let availableCash = Number(store.ledger.baseline.availableCash || 0);
  let realizedPnl = Number(store.ledger.baseline.realizedPnl || 0);
  const tradeById = new Map(store.trades.map(trade => [String(trade.id), trade]));
  const correctedTrades = new Map();
  const deletedTrades = new Set();
  const correctedFunding = new Map();
  const deletedFunding = new Set();

  for (const event of store.ledger.events || []) {
    if (event.type === "TRADE_CORRECTED") correctedTrades.set(String(event.tradeId), clone(event.trade));
    else if (event.type === "TRADE_DELETED") deletedTrades.add(String(event.tradeId));
    else if (event.type === "FUNDING_CORRECTED") correctedFunding.set(String(event.fundingId), clone(event.funding));
    else if (event.type === "FUNDING_DELETED") deletedFunding.add(String(event.fundingId));
  }

  for (const event of store.ledger.events || []) {
    if (event.type === "TRADE_RECORDED") {
      if (deletedTrades.has(String(event.tradeId))) continue;
      const trade = correctedTrades.get(String(event.tradeId)) || event.trade;
      const code = String(trade.code);
      const fee = Number(trade.fee == null ? 0 : trade.fee);
      let position = positions.get(code);
      if (trade.side === "BUY") {
        if (!position) {
          const metadata = currentMetadata.get(code) || {};
          position = makePosition({ ...trade, quantity: 0, cost: 0 }, metadata);
          position.lastPrice = Number(trade.price);
          positions.set(code, position);
        }
        position.name = trade.name || position.name;
        position.market = trade.market || position.market;
        position.lots.push({
          id: `trade:${trade.id}`,
          tradeId: trade.id,
          originalQuantity: Number(trade.quantity),
          remainingQuantity: Number(trade.quantity),
          remainingCost: Number(trade.price) * Number(trade.quantity) + fee
        });
        availableCash -= Number(trade.price) * Number(trade.quantity) + fee;
        const storedTrade = tradeById.get(String(trade.id));
        if (storedTrade) storedTrade.cashEffect = roundMoney(-(Number(trade.price) * Number(trade.quantity) + fee));
      } else {
        if (!position) throw new Error(`账本重放失败：${code}没有可卖持仓`);
        const costBasis = reducePositionAverage(position, Number(trade.quantity));
        const proceeds = Number(trade.price) * Number(trade.quantity) - fee;
        const realized = proceeds - costBasis;
        availableCash += proceeds;
        realizedPnl += realized;
        const storedTrade = tradeById.get(String(trade.id));
        if (storedTrade) {
          storedTrade.cashEffect = roundMoney(proceeds);
          storedTrade.realizedPnlEstimate = roundMoney(realized);
        }
      }
    } else if (event.type === "TRADE_FEE_ADJUSTED") {
      if (deletedTrades.has(String(event.tradeId)) || correctedTrades.has(String(event.tradeId))) continue;
      const delta = Number(event.delta || 0);
      const trade = tradeById.get(String(event.tradeId));
      availableCash -= delta;
      if (trade?.side === "SELL") {
        realizedPnl -= delta;
        if (Number.isFinite(Number(trade.realizedPnlEstimate))) trade.realizedPnlEstimate = roundMoney(Number(trade.realizedPnlEstimate) - delta);
        if (Number.isFinite(Number(trade.cashEffect))) trade.cashEffect = roundMoney(Number(trade.cashEffect) - delta);
      } else if (trade?.side === "BUY") {
        const position = positions.get(String(trade.code));
        const lot = position?.lots.find(item => String(item.tradeId) === String(trade.id));
        if (lot) {
          const remainingRatio = Number(lot.originalQuantity) ? Number(lot.remainingQuantity) / Number(lot.originalQuantity) : 0;
          lot.remainingCost += delta * remainingRatio;
          realizedPnl -= delta * (1 - remainingRatio);
        } else if (position?.lots?.length) {
          position.lots[0].remainingCost += delta;
        } else {
          realizedPnl -= delta;
        }
        if (Number.isFinite(Number(trade.cashEffect))) trade.cashEffect = roundMoney(Number(trade.cashEffect) - delta);
      }
    } else if (event.type === "FUNDING_RECORDED") {
      if (deletedFunding.has(String(event.fundingId))) continue;
      const funding = correctedFunding.get(String(event.fundingId)) || event.funding;
      availableCash += Number(funding.amount || 0);
    } else if (event.type === "CASH_RECONCILED") {
      availableCash = Number(event.availableCash || 0);
    } else if (event.type === "POSITIONS_RECONCILED") {
      positions.clear();
      for (const holding of event.holdings || []) {
        positions.set(String(holding.code), makePosition(holding, currentMetadata.get(String(holding.code))));
      }
    }
  }

  const holdings = [];
  for (const position of positions.values()) {
    const totals = positionTotals(position);
    if (totals.quantity <= 1e-9) continue;
    const { lots, ...metadata } = position;
    holdings.push({
      ...metadata,
      id: position.id || position.code,
      code: position.code,
      name: position.name,
      market: position.market,
      quantity: +totals.quantity.toFixed(6),
      cost: +totals.cost.toFixed(6),
      lastPrice: latestHoldingPrice(position),
      brokerPnl: position.brokerPnl ?? null
    });
  }

  store.account.availableCash = roundMoney(availableCash);
  store.account.realizedPnl = roundMoney(realizedPnl);
  store.holdings = holdings;
  store.ledger.projectedAt = new Date().toISOString();
  store.ledger.eventCount = store.ledger.events.length;
  return store;
}

function appendTradeCorrectionEvent(store, trade, previousTrade, note = "成交记录校正", createdAt = new Date().toISOString()) {
  ensureLedger(store, createdAt);
  store.ledger.events.push({
    id: `ledger-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type: "TRADE_CORRECTED",
    tradeId: trade.id,
    trade: clone(trade),
    previousTrade: clone(previousTrade),
    note: String(note || ""),
    createdAt
  });
  rebuildLedgerProjection(store);
}

function appendTradeDeletionEvent(store, trade, note = "删除错误成交记录", createdAt = new Date().toISOString()) {
  ensureLedger(store, createdAt);
  store.ledger.events.push({
    id: `ledger-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type: "TRADE_DELETED",
    tradeId: trade.id,
    trade: clone(trade),
    note: String(note || ""),
    createdAt
  });
  rebuildLedgerProjection(store);
}

function appendFundingEvent(store, funding, createdAt = new Date().toISOString()) {
  ensureLedger(store, createdAt);
  store.ledger.events.push({
    id: `ledger-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type: "FUNDING_RECORDED",
    fundingId: funding.id,
    funding: clone(funding),
    createdAt
  });
  rebuildLedgerProjection(store);
}

function appendFundingCorrectionEvent(store, funding, previousFunding, note = "资金流水校正", createdAt = new Date().toISOString()) {
  ensureLedger(store, createdAt);
  store.ledger.events.push({
    id: `ledger-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type: "FUNDING_CORRECTED",
    fundingId: funding.id,
    funding: clone(funding),
    previousFunding: clone(previousFunding),
    note: String(note || ""),
    createdAt
  });
  rebuildLedgerProjection(store);
}

function appendFundingDeletionEvent(store, funding, note = "删除错误资金流水", createdAt = new Date().toISOString()) {
  ensureLedger(store, createdAt);
  store.ledger.events.push({
    id: `ledger-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type: "FUNDING_DELETED",
    fundingId: funding.id,
    funding: clone(funding),
    note: String(note || ""),
    createdAt
  });
  rebuildLedgerProjection(store);
}

function appendTradeEvent(store, trade, createdAt = new Date().toISOString()) {
  ensureLedger(store, createdAt);
  store.ledger.events.push({
    id: `ledger-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type: "TRADE_RECORDED",
    tradeId: trade.id,
    trade: clone(trade),
    createdAt
  });
  rebuildLedgerProjection(store);
}

function appendFeeAdjustmentEvent(store, trade, nextFee, createdAt = new Date().toISOString()) {
  ensureLedger(store, createdAt);
  const previousFee = trade.fee == null ? 0 : Number(trade.fee);
  const delta = roundMoney(Number(nextFee) - previousFee);
  store.ledger.events.push({
    id: `ledger-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type: "TRADE_FEE_ADJUSTED",
    tradeId: trade.id,
    previousFee: roundMoney(previousFee),
    nextFee: roundMoney(nextFee),
    delta,
    createdAt
  });
  trade.fee = roundMoney(nextFee);
  trade.feePending = false;
  trade.feeUpdatedAt = createdAt;
  rebuildLedgerProjection(store);
  return delta;
}

function appendCashReconciliationEvent(store, availableCash, note = "券商现金快照", createdAt = new Date().toISOString()) {
  ensureLedger(store, createdAt);
  store.ledger.events.push({
    id: `ledger-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type: "CASH_RECONCILED",
    availableCash: roundMoney(availableCash),
    note: String(note || ""),
    createdAt
  });
  rebuildLedgerProjection(store);
}

function appendPositionReconciliationEvent(store, holdings, note = "持仓快照校正", createdAt = new Date().toISOString()) {
  ensureLedger(store, createdAt);
  store.ledger.events.push({
    id: `ledger-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type: "POSITIONS_RECONCILED",
    holdings: (holdings || []).map(holdingCore),
    note: String(note || ""),
    createdAt
  });
  rebuildLedgerProjection(store);
}

module.exports = {
  accountValuation,
  appendCashReconciliationEvent,
  appendFeeAdjustmentEvent,
  appendFundingCorrectionEvent,
  appendFundingDeletionEvent,
  appendFundingEvent,
  appendPositionReconciliationEvent,
  appendTradeCorrectionEvent,
  appendTradeDeletionEvent,
  appendTradeEvent,
  ensureLedger,
  holdingValuation,
  latestHoldingPrice,
  rebuildLedgerProjection,
  roundMoney
};
