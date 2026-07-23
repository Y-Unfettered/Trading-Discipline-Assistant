"use strict";

const RULEBOOK_VERSION = "discipline/v2.0.0";

const DIMENSIONS = [
  { key: "plan", label: "计划与前置条件", weight: 15 },
  { key: "evidence", label: "依据与情景质量", weight: 15 },
  { key: "execution", label: "触发与执行一致性", weight: 20 },
  { key: "risk", label: "仓位与风险控制", weight: 25 },
  { key: "adjustment", label: "调整与情绪控制", weight: 15 },
  { key: "record", label: "记录与复盘完整性", weight: 10 }
];

const CRITERIA = [
  ["plan", "activePlan", "存在覆盖标的的已确认生效计划", 7, "plan.active"],
  ["plan", "triggerDefined", "计划写明可验证触发条件", 3, "plan.triggerDefined"],
  ["plan", "riskExitDefined", "计划写明风险退出和失效条件", 5, "plan.riskExitDefined"],

  ["evidence", "reasonRecorded", "操作理由在成交时点已记录", 3, "evidence.reasonRecorded"],
  ["evidence", "factsLinked", "理由关联可核验事实", 4, "evidence.factsLinked"],
  ["evidence", "thesisStated", "长期逻辑状态明确", 3, "evidence.thesisStated"],
  ["evidence", "scenarioDefined", "基准/有利/不利情景及推翻条件完整", 5, "evidence.scenarioDefined"],

  ["execution", "actionAllowed", "动作在计划允许范围内", 7, "execution.actionAllowed"],
  ["execution", "triggerSatisfied", "成交前触发条件已经满足", 7, "execution.triggerSatisfied"],
  ["execution", "withinTolerance", "价格和数量处于计划容差内", 3, "execution.withinTolerance"],
  ["execution", "timely", "触发后在计划时间容差内执行", 3, "execution.timely"],

  ["risk", "positionWithinLimit", "成交后仓位未超过上限", 7, "risk.positionWithinLimit"],
  ["risk", "tradeRiskWithinLimit", "单笔实际风险未超过上限", 7, "risk.tradeRiskWithinLimit"],
  ["risk", "stopNotLoosened", "未为继续持仓而放宽退出条件", 5, "risk.stopNotLoosened"],
  ["risk", "dailyLimitRespected", "达到日损失上限后未新增风险", 3, "risk.dailyLimitRespected"],
  ["risk", "loserRiskNotExpanded", "亏损状态下未无计划扩大风险", 3, "risk.loserRiskNotExpanded"],

  ["adjustment", "deviationVerified", "计划外调整具有新事实和确认", 5, "adjustment.deviationVerified"],
  ["adjustment", "emotionControlled", "无追涨、恐慌、回本或后悔驱动", 5, "adjustment.emotionControlled"],
  ["adjustment", "noRevengeSequence", "无亏损后的报复性连续交易", 3, "adjustment.noRevengeSequence"],
  ["adjustment", "frequencyWithinRule", "交易频率未超过个人规则", 2, "adjustment.frequencyWithinRule"],

  ["record", "tradeComplete", "成交事实字段完整", 3, "record.tradeComplete"],
  ["record", "rationaleComplete", "当时理由和触发依据完整", 2, "record.rationaleComplete"],
  ["record", "emotionComplete", "情绪与紧迫感已如实记录", 1, "record.emotionComplete"],
  ["record", "reviewComplete", "盘后完成逐笔复盘", 4, "record.reviewComplete"]
];

function valueAt(input, path) {
  return path.split(".").reduce((value, key) => value?.[key], input);
}

function normalizeBoolean(value) {
  if (value === true || value === false) return value;
  return null;
}

function addEvent(events, code, severity, title, evidence, scoreCap = null) {
  events.push({ code, severity, title, evidence, scoreCap });
}

function hardRuleEvents(input) {
  const events = [];
  const riskIncrease = input.riskEffect === "increase";
  const emergencyReduce = input.riskEffect === "reduce" && input.emergencyDeRisk === true;

  if (emergencyReduce) {
    addEvent(events, "EMERGENCY_DE_RISK", "info", "紧急降低风险", "该动作只降低风险；允许先执行后补充记录，不按普通计划外交易处罚");
  }
  if (riskIncrease && input.plan?.active === false) {
    addEvent(events, "NO_ACTIVE_PLAN", "critical", "无有效计划新增风险", "新增风险时不存在覆盖标的的已确认生效计划", 39);
  }
  if (riskIncrease && input.plan?.invalidated === true) {
    addEvent(events, "PLAN_INVALIDATED_RISK_INCREASE", "critical", "计划失效后新增风险", "计划已经触发失效条件", 19);
  }
  if (riskIncrease && input.execution?.actionAllowed === false) {
    addEvent(events, "ACTION_NOT_ALLOWED", "critical", "新增风险动作越界", "实际动作不在计划允许范围", 29);
  }
  if (input.risk?.positionWithinLimit === false) {
    addEvent(events, "POSITION_LIMIT_EXCEEDED", "critical", "超过最大仓位", "成交后仓位超过确认计划上限", 24);
  }
  if (input.risk?.tradeRiskWithinLimit === false) {
    addEvent(events, "TRADE_RISK_LIMIT_EXCEEDED", "critical", "超过单笔风险上限", "实际风险超过确认计划上限", 24);
  }
  if (riskIncrease && input.risk?.stopNotLoosened === false) {
    addEvent(events, "STOP_LOOSENED_WITH_RISK", "critical", "放宽退出条件并继续承担风险", "止损或失效条件向扩大损失方向移动", 19);
  }
  if (riskIncrease && input.risk?.dailyLimitRespected === false) {
    addEvent(events, "DAILY_LOSS_LIMIT_BREACH", "critical", "达到日损失上限后仍新增风险", "当日风险预算已经耗尽", 19);
  }
  if (riskIncrease && input.evidence?.thesisStatus === "invalidated") {
    addEvent(events, "INVALIDATED_THESIS_RISK_INCREASE", "critical", "核心逻辑失效后新增风险", "事前定义的核心逻辑失效条件已经成立", 19);
  }
  if (input.adjustment?.emotionControlled === false) {
    addEvent(events, "EMOTION_DRIVEN", "warning", "疑似情绪驱动", "记录显示追涨、恐慌、回本或后悔驱动");
  }
  if (input.adjustment?.noRevengeSequence === false) {
    addEvent(events, "REVENGE_SEQUENCE", "warning", "疑似报复性交易", "亏损后短时间连续反向或扩大风险");
  }
  return events;
}

function requiredPaths(input) {
  const base = ["riskEffect", "record.tradeComplete", "record.rationaleComplete"];
  if (input.riskEffect === "increase") {
    base.push(
      "plan.active",
      "plan.triggerDefined",
      "plan.riskExitDefined",
      "execution.actionAllowed",
      "execution.triggerSatisfied",
      "risk.positionWithinLimit",
      "risk.tradeRiskWithinLimit",
      "risk.stopNotLoosened",
      "risk.dailyLimitRespected"
    );
  }
  return base;
}

function classify(score, events) {
  if (events.some(event => event.severity === "critical")) return "critical_violation";
  if (score >= 85) return "compliant";
  if (score >= 70) return "acceptable_with_gaps";
  if (score >= 50) return "needs_correction";
  return "violation";
}

function correctionFor(events, criteria) {
  const critical = events.find(event => event.severity === "critical");
  if (critical) return `下一次新增风险前先消除“${critical.title}”，未满足时默认不新增风险。`;
  const failed = [...criteria].filter(item => item.value === false).sort((a, b) => b.points - a.points)[0];
  if (failed) return `下一次操作重点：${failed.label}。在记录中附上可核验依据。`;
  const missing = criteria.find(item => item.value === null);
  if (missing) return `先补齐“${missing.label}”，再形成正式纪律分。`;
  return "继续按当前流程执行；不要因为单笔盈利而放宽规则。";
}

function evaluateDiscipline(input = {}) {
  const events = hardRuleEvents(input);
  const criteria = CRITERIA.map(([dimension, key, label, points, path]) => {
    let value = normalizeBoolean(valueAt(input, path));
    if (input.emergencyDeRisk === true && input.riskEffect === "reduce" && ["activePlan", "actionAllowed", "triggerSatisfied", "deviationVerified"].includes(key)) {
      value = true;
    }
    return { dimension, key, label, points, value, earned: value === true ? points : 0 };
  });

  const dimensions = DIMENSIONS.map(dimension => {
    const rows = criteria.filter(item => item.dimension === dimension.key);
    const observedMax = rows.filter(item => item.value !== null).reduce((sum, item) => sum + item.points, 0);
    const observedEarned = rows.reduce((sum, item) => sum + item.earned, 0);
    return {
      ...dimension,
      score: observedMax ? Math.round(observedEarned / observedMax * dimension.weight * 10) / 10 : null,
      completeness: Math.round(observedMax / dimension.weight * 100),
      criteria: rows
    };
  });

  const observedMax = criteria.filter(item => item.value !== null).reduce((sum, item) => sum + item.points, 0);
  const observedEarned = criteria.reduce((sum, item) => sum + item.earned, 0);
  const rawObservedScore = observedMax ? Math.round(observedEarned / observedMax * 100) : null;
  const scoreCap = events.reduce((cap, event) => event.scoreCap == null ? cap : Math.min(cap, event.scoreCap), 100);
  const requiredMissing = requiredPaths(input).filter(path => valueAt(input, path) == null);
  if (input.record?.reviewComplete !== true) requiredMissing.push("record.reviewComplete");
  const completeness = Math.round(observedMax);
  const finalizable = requiredMissing.length === 0 && completeness >= 80;
  const score = finalizable && rawObservedScore != null ? Math.min(rawObservedScore, scoreCap) : null;

  return {
    schemaVersion: RULEBOOK_VERSION,
    assessmentStatus: finalizable ? "final" : "incomplete",
    score,
    observedScore: rawObservedScore,
    scoreCap: scoreCap === 100 ? null : scoreCap,
    completeness,
    classification: finalizable ? classify(score, events) : "insufficient_record",
    outcome: input.outcome || null,
    outcomeAffectsDisciplineScore: false,
    dimensions,
    events,
    missingRequired: requiredMissing,
    correction: correctionFor(events, criteria)
  };
}

function summarizeDiscipline(assessments = []) {
  const final = assessments.filter(item => Number.isFinite(item?.score));
  const riskWeights = final.map(item => Math.max(1, Number(item.riskUnits || 1)));
  const weightTotal = riskWeights.reduce((sum, value) => sum + value, 0);
  const weightedMean = weightTotal
    ? final.reduce((sum, item, index) => sum + item.score * riskWeights[index], 0) / weightTotal
    : null;
  const worst = final.length ? Math.min(...final.map(item => item.score)) : null;
  const reviewCompleteness = assessments.length
    ? assessments.reduce((sum, item) => sum + Number(item.completeness || 0), 0) / assessments.length
    : 0;
  // The daily index must not be improved merely by splitting one idea into
  // several trades or by completing forms after a severe breach. Individual
  // assessments already include record/review quality, so the roll-up combines
  // a risk-weighted mean with the worst decision of the period.
  const score = weightedMean == null ? null : Math.round(weightedMean * 0.75 + worst * 0.25);
  const eventCounts = {};
  for (const assessment of assessments) {
    for (const event of assessment.events || []) eventCounts[event.code] = (eventCounts[event.code] || 0) + 1;
  }
  const repeated = Object.entries(eventCounts)
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([code, count]) => ({ code, count }));
  return {
    schemaVersion: RULEBOOK_VERSION,
    score,
    finalAssessmentCount: final.length,
    incompleteAssessmentCount: assessments.length - final.length,
    weightedMean: weightedMean == null ? null : Math.round(weightedMean),
    worstScore: worst,
    reviewCompleteness: Math.round(reviewCompleteness),
    repeatedEvents: repeated
  };
}

module.exports = {
  RULEBOOK_VERSION,
  DIMENSIONS,
  evaluateDiscipline,
  summarizeDiscipline
};
