/* ============================================================
 * analysis.js — 数据诊断 + 策略评价 + 改进建议
 * 依据回测结果与数据特征动态生成可解释文本（HTML）
 * ============================================================ */
(function (global) {
  'use strict';

  function pct(v, d) { d = d == null ? 2 : d; return (v >= 0 ? '+' : '') + (v * 100).toFixed(d) + '%'; }
  function signCls(v) { return v > 0 ? 'pos' : (v < 0 ? 'neg' : ''); }

  // 平均信号间隔（交易日）
  function avgSignalGap(dates, sig) {
    const idxs = [];
    for (let i = 0; i < sig.length; i++) if (sig[i] !== 0) idxs.push(i);
    if (idxs.length < 2) return null;
    let sum = 0;
    for (let i = 1; i < idxs.length; i++) sum += idxs[i] - idxs[i - 1];
    return sum / (idxs.length - 1);
  }

  // 最近一次信号日期与类型
  function lastSignal(dates, sig) {
    for (let i = sig.length - 1; i >= 0; i--) {
      if (sig[i] === 1) return { date: dates[i], type: '金叉(买入)' };
      if (sig[i] === -1) return { date: dates[i], type: '死叉(卖出)' };
    }
    return null;
  }

  function buildDiagnosis(ctx) {
    const { dates, closes, sig, position, metrics, params } = ctx;
    const n = dates.length;
    const first = closes[0], last = closes[n - 1];
    let trend = 'flat', label = '震荡';
    if (last > first * 1.10) { trend = 'up'; label = '上涨'; }
    else if (last < first * 0.90) { trend = 'down'; label = '下跌'; }
    const badge = trend === 'up' ? 'badge-up' : trend === 'down' ? 'badge-down' : 'badge-flat';
    const gap = avgSignalGap(dates, sig);
    const ls = lastSignal(dates, sig);
    const vol = metrics.priceVol;
    const volLabel = vol > 0.4 ? '高波动' : vol > 0.25 ? '中高波动' : '中低波动';

    const li = [];
    li.push(`回测区间覆盖 <b>${n}</b> 个交易日（${dates[0]} ~ ${dates[n - 1]}），数据完整度 100%。`);
    li.push(`区间行情整体呈 <span class="badge ${badge}">${label}</span> 趋势，区间涨跌 ${pct(last / first - 1)}，年化波动率约 <b>${(vol * 100).toFixed(1)}%</b>（${volLabel}）。`);
    li.push(`共识别金叉 <b>${metrics.buySig}</b> 次、死叉 <b>${metrics.sellSig}</b> 次${gap ? `，平均信号间隔约 <b>${gap.toFixed(0)}</b> 个交易日` : ''}。`);
    li.push(`最后一日（${dates[n - 1]}）持仓状态：<b>${metrics.lastPos}</b>${ls ? `；最近一次信号为 <b>${ls.type}</b>（${ls.date}）` : ''}。`);
    return `<div class="analysis-card"><h4>数据诊断</h4><ul>${li.map(t => `<li>${t}</li>`).join('')}</ul></div>`;
  }

  function buildEvaluation(ctx) {
    const { metrics } = ctx;
    const excess = metrics.excess;
    const sharpeText = metrics.sharpe >= 1 ? '优秀' : metrics.sharpe >= 0.5 ? '良好' : metrics.sharpe >= 0 ? '一般' : '较差';
    const mddText = metrics.mdd <= -0.2 ? '较大（>20%）' : metrics.mdd <= -0.1 ? '中等' : '较小';
    const excessText = excess >= 0 ? '跑赢' : '跑输';
    const li = [];
    li.push(`年化收益率 <b class="${signCls(metrics.annRet)}">${pct(metrics.annRet)}</b>，${excessText}买入持有基准 <b class="${signCls(excess)}">${pct(excess)}</b>。`);
    li.push(`夏普比率 <b>${metrics.sharpe.toFixed(2)}</b>（${sharpeText}），年化波动率 <b>${(metrics.vol * 100).toFixed(1)}%</b>，单位风险收益${metrics.sharpe >= 1 ? '较好' : '一般'}。`);
    li.push(`最大回撤 <b class="neg">${pct(metrics.mdd)}</b>，风险水平${mddText}。`);
    li.push(`胜率 <b>${(metrics.winRate * 100).toFixed(1)}%</b>，完成 <b>${metrics.rounds}</b> 笔完整买卖循环，平均持仓 <b>${metrics.avgHold ? metrics.avgHold.toFixed(1) : '-'}</b> 天。`);
    li.push(`交易成本侵蚀约 <b>${metrics.costErosionPct.toFixed(2)}</b> 个百分点${metrics.costErosionPct > 1 ? '（成本影响较明显）' : ''}。`);
    return `<div class="analysis-card"><h4>策略评价</h4><ul>${li.map(t => `<li>${t}</li>`).join('')}</ul></div>`;
  }

  function buildRecommendations(ctx) {
    const { dates, closes, sig, metrics, params } = ctx;
    const n = dates.length;
    const last = closes[n - 1], first = closes[0];
    let trend = 'flat';
    if (last > first * 1.10) trend = 'up'; else if (last < first * 0.90) trend = 'down';

    const recs = [];
    if (metrics.excess < 0) {
      recs.push(`策略累计回报跑输买入持有基准 ${pct(Math.abs(metrics.excess))}，说明当前均线周期（${params.shortP}/${params.longP}）在该区间<b>滞后或频繁误判</b>。建议尝试缩短长周期、或改用 EMA 提升趋势响应速度。`);
    }
    if (metrics.sharpe < 1) {
      recs.push(`夏普比率仅 <b>${metrics.sharpe.toFixed(2)}</b>（<1），单位风险收益一般。建议结合 RSI / MACD 过滤震荡市假信号，或加入成交量确认。`);
    }
    if (metrics.mdd <= -0.2) {
      recs.push(`最大回撤达 <b>${pct(metrics.mdd)}</b>（>20%）。建议加入固定止损 / 移动止盈，或降低仓位（半仓轮动）以控制下行风险。`);
    }
    if (metrics.rounds < 5) {
      recs.push(`完整买卖循环仅 <b>${metrics.rounds}</b> 笔，统计样本不足、结论偶然性大。建议延长回测区间或缩小均线周期以获取更多样本。`);
    }
    if (metrics.avgHold > 0 && metrics.avgHold < 10) {
      recs.push(`平均持仓仅 <b>${metrics.avgHold.toFixed(1)}</b> 天，换手偏快，交易成本侵蚀（${metrics.costErosionPct.toFixed(2)}pp）不可忽略。建议确认手续费/滑点设置，或拉长周期减少交易次数。`);
    }
    if (trend === 'flat') {
      recs.push(`区间行情偏<b>震荡</b>，双均线策略易反复发出假信号（"打脸"）。建议仅在趋势明显阶段使用，或叠加趋势强度过滤（如 ADX）。`);
    }
    if (metrics.excess >= 0 && metrics.sharpe >= 1 && metrics.mdd > -0.2) {
      recs.push(`该区间策略表现良好（跑赢基准、夏普≥1、回撤可控），<b>${params.shortP}/${params.longP}</b> 参数组合可作为候选。仍建议在不同行情阶段交叉验证。`);
    }
    recs.push(`<b>风险提示：</b>历史回测不代表未来收益；本报告仅为学习用策略评估，不构成任何投资建议。`);

    return `<div class="analysis-card"><h4>改进建议</h4><ul>${recs.map(r => `<li>${r}</li>`).join('')}</ul></div>`;
  }

  function renderAnalysis(containerId, ctx) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (ctx.error) { el.innerHTML = `<div class="analysis-card" style="grid-column:1/-1;"><h4>无法生成分析</h4><ul><li>${ctx.error}</li></ul></div>`; return; }
    el.innerHTML = buildDiagnosis(ctx) + buildEvaluation(ctx) + buildRecommendations(ctx);
  }

  const api = { buildDiagnosis, buildEvaluation, buildRecommendations, renderAnalysis, pct };
  global.Analysis = api;
})(window);
