/* ============================================================
 * strategy.js — 双均线策略引擎（纯函数，无 DOM 依赖）
 * 提供：SMA 计算、金叉/死叉检测、全仓模拟回测、指标计算、统一编排 runStrategy
 * 可在浏览器与 Node（单元测试）中复用。
 * ============================================================ */
(function (global) {
  'use strict';

  // 简单移动平均；前 n-1 项为 null
  function sma(arr, n) {
    const out = new Array(arr.length).fill(null);
    if (n <= 0) return out;
    let sum = 0;
    for (let i = 0; i < arr.length; i++) {
      sum += arr[i];
      if (i >= n) sum -= arr[i - n];
      if (i >= n - 1) out[i] = sum / n;
    }
    return out;
  }

  // 检测金叉(买入=1)/死叉(卖出=-1)，相邻信号交替，且首个信号必为金叉
  function detectSignals(sS, sL) {
    const n = sS.length;
    const sig = new Array(n).fill(0);
    let last = 0;
    for (let i = 1; i < n; i++) {
      if (sS[i] == null || sL[i] == null || sS[i - 1] == null || sL[i - 1] == null) continue;
      const raw = (sS[i] > sL[i] && sS[i - 1] <= sL[i - 1]) ? 1
                : (sS[i] < sL[i] && sS[i - 1] >= sL[i - 1]) ? -1 : 0;
      if (raw === 1 && last !== 1) { sig[i] = 1; last = 1; }
      else if (raw === -1 && last !== -1) { sig[i] = -1; last = -1; }
    }
    return sig;
  }

  function daysBetween(a, b) {
    return Math.round((new Date(b) - new Date(a)) / 86400000);
  }

  // 全仓买卖模拟：金叉次日开盘买入，死叉次日开盘卖出；扣除手续费与滑点
  function runBacktest(dates, closes, sig, opts) {
    const { capital, commRate = 0, slipRate = 0 } = opts;
    const n = closes.length;
    let cash = capital, shares = 0, pos = 0, totalComm = 0;
    const equity = new Array(n).fill(0);
    const position = new Array(n).fill(0);
    const trades = [];
    let buyDate = null, buyPrice = 0, buyShares = 0, buyNet = 0;

    for (let i = 0; i < n; i++) {
      if (i > 0) {
        const s = sig[i - 1];
        if (s === 1 && pos === 0) {
          const px = closes[i] * (1 + slipRate);           // 买入滑点
          const comm = cash * commRate; totalComm += comm;
          const invest = cash - comm;
          shares = Math.floor(invest / px / 100) * 100;     // 取整到 100 股
          const cost = shares * px;
          cash = cash - cost - comm;
          pos = 1; buyDate = dates[i]; buyPrice = px; buyShares = shares;
          buyNet = cost + comm;                            // 建仓净成本
          trades.push({ type: 'buy', date: dates[i], price: px, shares, cashAfter: cash });
        } else if (s === -1 && pos === 1) {
          const px = closes[i] * (1 - slipRate);           // 卖出滑点
          const proceeds = shares * px;
          const comm = proceeds * commRate; totalComm += comm;
          cash = cash + proceeds - comm; pos = 0;
          const sellNet = proceeds - comm;
          trades.push({
            type: 'sell', date: dates[i], price: px, shares,
            buyDate, buyPrice, buyShares,
            buyNet, sellNet,
            holdDays: daysBetween(buyDate, dates[i]),
            roundRet: buyNet > 0 ? sellNet / buyNet - 1 : 0
          });
          shares = 0; buyDate = null; buyPrice = 0; buyShares = 0; buyNet = 0;
        }
      }
      equity[i] = cash + shares * closes[i];
      position[i] = pos;
    }
    return { equity, position, trades, totalComm };
  }

  // 指标计算：年化收益、MDD、Sharpe、胜率、超额、波动率、成本侵蚀等
  function calcMetrics(ctx) {
    const { dates, closes, equity, trades, capital, commRate, slipRate, shortP, longP, cumRetNoCost } = ctx;
    const n = closes.length;
    const cumRet = equity[n - 1] / capital - 1;
    const bench = closes[n - 1] / closes[0] - 1;
    const excess = cumRet - bench;

    let peak = -Infinity, mdd = 0;
    for (let i = 0; i < n; i++) {
      peak = Math.max(peak, equity[i]);
      mdd = Math.min(mdd, (equity[i] - peak) / peak);
    }

    const rets = [];
    for (let i = 1; i < n; i++) rets.push((equity[i] - equity[i - 1]) / equity[i - 1]);
    const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
    const variance = rets.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (rets.length || 1);
    const sd = Math.sqrt(variance);
    const sharpe = sd > 0 ? (mean / sd) * Math.sqrt(252) : 0;
    const annRet = n > 0 ? Math.pow(1 + cumRet, 252 / n) - 1 : 0;
    const vol = sd * Math.sqrt(252);

    const rounds = trades.filter(t => t.type === 'sell');
    let wins = 0, holdSum = 0;
    rounds.forEach(t => { if (t.roundRet > 0) wins++; holdSum += t.holdDays; });
    const winRate = rounds.length ? wins / rounds.length : 0;
    const avgHold = rounds.length ? holdSum / rounds.length : 0;

    const costErosionPct = (cumRetNoCost - cumRet) * 100; // 成本带来的收益损失（百分点）

    // 年化波动率（行情层面）
    const crets = [];
    for (let i = 1; i < n; i++) crets.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    const cmean = crets.reduce((a, b) => a + b, 0) / (crets.length || 1);
    const cvar = crets.reduce((a, b) => a + (b - cmean) * (b - cmean), 0) / (crets.length || 1);
    const priceVol = Math.sqrt(cvar) * Math.sqrt(252);

    return {
      n, cumRet, bench, excess, mdd, sharpe, annRet, vol, priceVol,
      winRate, rounds: rounds.length, wins, avgHold, totalComm: trades.length ? undefined : 0,
      costErosionPct, shortP, longP,
      buySig: 0, sellSig: 0 // 由调用方填充
    };
  }

  // 统一编排：切片 → 均线 → 信号 → 回测(含无成本) → 指标
  function runStrategy(bars, params) {
    const { startDate, endDate, shortP, longP, capital, commRate = 0, slipRate = 0 } = params;
    const sliced = bars
      .filter(b => b.date >= startDate && b.date <= endDate)
      .slice()
      .sort((a, b) => a.date < b.date ? -1 : 1);

    if (sliced.length < Math.max(shortP, longP)) {
      return { error: '数据不足：回测区间交易日数少于长均线周期，无法计算。', sliced: [] };
    }

    const dates = sliced.map(b => b.date);
    const closes = sliced.map(b => b.close);
    const n = closes.length;

    const sS = sma(closes, shortP);
    const sL = sma(closes, longP);
    const sig = detectSignals(sS, sL);

    const bt = runBacktest(dates, closes, sig, { capital, commRate, slipRate });
    const btNo = runBacktest(dates, closes, sig, { capital, commRate: 0, slipRate: 0 });

    const metrics = calcMetrics({
      dates, closes, equity: bt.equity, trades: bt.trades,
      capital, commRate, slipRate, shortP, longP,
      cumRetNoCost: btNo.equity[n - 1] / capital - 1
    });
    metrics.buySig = sig.filter(s => s === 1).length;
    metrics.sellSig = sig.filter(s => s === -1).length;
    metrics.lastPos = bt.position[n - 1] ? '持多' : '空仓';

    return {
      dates, closes,
      sS, sL, sig,
      position: bt.position,
      equity: bt.equity,
      trades: bt.trades,
      metrics,
      error: null
    };
  }

  const api = { sma, detectSignals, runBacktest, calcMetrics, runStrategy, daysBetween };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.Strategy = api;
})(typeof window !== 'undefined' ? window : globalThis);
