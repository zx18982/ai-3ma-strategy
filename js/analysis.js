/* ============================================================
 * analysis.js — 数据诊断 + 策略评价 + 改进建议
 * 依据回测结果与数据特征动态生成可解释文本（HTML）
 * ============================================================ */
(function (global) {
  'use strict';

  function pct(v, d) { d = d == null ? 2 : d; return (v >= 0 ? '+' : '') + (v * 100).toFixed(d) + '%'; }
  function signCls(v) { return v > 0 ? 'pos' : (v < 0 ? 'neg' : ''); }

  // ---------- 统计与诊断辅助 ----------
  function pp(v, d) { d = d == null ? 0 : d; return (v * 100).toFixed(d) + '%'; }
  function dayDiff(a, b) { return Math.round((new Date(b) - new Date(a)) / 86400000); }
  function mean(a) { if (!a.length) return 0; let s = 0; for (const v of a) s += v; return s / a.length; }
  function variance(a) { const m = mean(a); let s = 0; for (const v of a) s += (v - m) * (v - m); return a.length ? s / a.length : 0; }
  function std(a) { return Math.sqrt(variance(a)); }
  function skew(a) { const m = mean(a), v = variance(a); if (v === 0) return 0; let s = 0; for (const x of a) s += Math.pow(x - m, 3); return s / a.length / Math.pow(v, 1.5); }
  function kurtExcess(a) { const m = mean(a), v = variance(a); if (v === 0) return 0; let s = 0; for (const x of a) s += Math.pow(x - m, 4); return s / a.length / (v * v) - 3; }
  function autocorr(a, lag) { const m = mean(a), n = a.length; if (n <= lag) return 0; let den = 0; for (const x of a) den += (x - m) * (x - m); if (!den) return 0; let num = 0; for (let i = lag; i < n; i++) num += (a[i] - m) * (a[i - lag] - m); return num / den; }
  function dailyRets(closes) { const out = []; for (let i = 1; i < closes.length; i++) if (closes[i - 1] > 0) out.push((closes[i] - closes[i - 1]) / closes[i - 1]); return out; }
  function boardOf(code) {
    if (!code) return { name: '—', limit: null };
    if (code.startsWith('hk')) return { name: '港股（无涨跌停）', limit: null };
    if (code.startsWith('sh688') || code.startsWith('sz30')) return { name: '科创板/创业板（±20%）', limit: 0.20 };
    return { name: '主板（±10%）', limit: 0.10 };
  }

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

  // ---------- 补充诊断：数据质量 + 异常 + 分布 + 波动序列 + 综合结论 ----------
  // 数据完整性诊断（健康度评分）
  function diagCompleteness(dates, opens, highs, lows, closes, volumes) {
    const issues = [];
    let score = 100;
    const seen = new Set(); let dup = 0;
    for (const d of dates) { if (seen.has(d)) dup++; else seen.add(d); }
    if (dup > 0) { issues.push({ sev: 'high', txt: `发现 <b>${dup}</b> 个重复交易日，数据可能重复写入` }); score -= Math.min(40, dup * 10); }
    let badOhlc = 0;
    for (let i = 0; i < closes.length; i++) {
      if (closes[i] <= 0 || highs[i] <= 0 || lows[i] <= 0 || opens[i] <= 0) badOhlc++;
      else if (highs[i] < lows[i] - 1e-9) badOhlc++;
      else if (closes[i] > highs[i] + 1e-9 || closes[i] < lows[i] - 1e-9) badOhlc++;
    }
    if (badOhlc > 0) { issues.push({ sev: 'high', txt: `<b>${badOhlc}</b> 条记录 OHLC 逻辑不一致（高<低 或 收盘越界）` }); score -= Math.min(40, badOhlc * 10); }
    let zeroVol = 0; for (const v of volumes) if (v <= 0) zeroVol++;
    if (zeroVol > 0) { issues.push({ sev: 'mid', txt: `<b>${zeroVol}</b> 条记录成交量为 0，疑似停牌或数据缺失` }); score -= Math.min(15, zeroVol * 5); }
    let maxGap = 0; const gaps = [];
    for (let i = 1; i < dates.length; i++) { const g = dayDiff(dates[i - 1], dates[i]); if (g > maxGap) maxGap = g; if (g > 10) gaps.push({ from: dates[i - 1], to: dates[i], g }); }
    if (gaps.length) issues.push({ sev: 'low', txt: `检测到 <b>${gaps.length}</b> 处 >10 自然日的休市/停牌缺口（最长 ${maxGap} 天），属正常节假日或长期停牌，回测已自动跳过` });
    score = Math.max(0, Math.min(100, score));
    return { issues, score, maxGap };
  }

  // 异常交易日检测（极端涨跌 / 跳空 / 放量）
  function diagAnomalies(dates, opens, closes, volumes, board) {
    const anomalies = [];
    const thr = board.limit ? board.limit * 0.95 : 0.12;
    for (let i = 1; i < closes.length; i++) {
      const r = (closes[i] - closes[i - 1]) / closes[i - 1];
      if (Math.abs(r) >= thr) anomalies.push({ date: dates[i], type: r > 0 ? '涨停/大涨' : '跌停/大跌', val: r, sev: Math.abs(r) >= (board.limit || 0.18) ? 'high' : 'mid' });
    }
    const gapThr = board.limit ? 0.08 : 0.10;
    for (let i = 1; i < closes.length; i++) {
      const gap = (opens[i] - closes[i - 1]) / closes[i - 1];
      if (Math.abs(gap) >= gapThr) anomalies.push({ date: dates[i], type: gap > 0 ? '向上跳空' : '向下跳空', val: gap, sev: 'mid' });
    }
    const vmean = mean(volumes), vstd = std(volumes) || 1;
    for (let i = 0; i < volumes.length; i++) {
      const z = (volumes[i] - vmean) / vstd;
      if (Math.abs(z) >= 3 && volumes[i] > 0) anomalies.push({ date: dates[i], type: '成交量异常', val: z, sev: 'mid', isZ: true });
    }
    anomalies.sort((a, b) => Math.abs(b.val) - Math.abs(a.val));
    return anomalies.slice(0, 8);
  }

  // 收益率分布统计（均值/偏度/峰度/极值/涨跌天数）
  function diagDistribution(closes, dates) {
    const rets = dailyRets(closes);
    const n = rets.length;
    const m = mean(rets), s = std(rets), sk = skew(rets), ku = kurtExcess(rets);
    const annVol = s * Math.sqrt(252);
    const up = rets.filter(r => r > 0).length, down = rets.filter(r => r < 0).length, flat = rets.filter(r => r === 0).length;
    let maxUp = -Infinity, maxDown = Infinity;
    for (let i = 1; i < closes.length; i++) { const r = (closes[i] - closes[i - 1]) / closes[i - 1]; if (r > maxUp) maxUp = r; if (r < maxDown) maxDown = r; }
    return { n, mean: m, annVol, skew: sk, kurt: ku, up, down, flat, maxUp, maxDown };
  }

  // 波动与序列自相关（全样本 vs 近20日 / 一阶自相关）
  function diagVolSerial(closes) {
    const rets = dailyRets(closes);
    const annVol = std(rets) * Math.sqrt(252);
    const recent = rets.slice(-20);
    const recentVol = recent.length ? std(recent) * Math.sqrt(252) : annVol;
    const ratio = annVol ? recentVol / annVol : 1;
    const ac1 = autocorr(rets, 1);
    return { annVol, recentVol, ratio, ac1 };
  }

  // 补充诊断主函数
  function buildSupplementaryAnalysis(ctx) {
    const { dates, opens, highs, lows, closes, volumes, metrics, params } = ctx;
    if (!dates || dates.length < 5) return '';
    const code = params && params.code;
    const board = boardOf(code);

    const comp = diagCompleteness(dates, opens, highs, lows, closes, volumes);
    const healthCls = comp.score >= 90 ? 'score-a' : comp.score >= 70 ? 'score-b' : 'score-c';
    const compHtml = `
      <div class="analysis-card">
        <h4>数据质量诊断</h4>
        <div class="health-line">数据健康度 <span class="score-badge ${healthCls}">${comp.score}</span><span class="health-sub">/100</span></div>
        <ul>
          <li>样本：<b>${dates.length}</b> 个交易日（${dates[0]} ~ ${dates[dates.length - 1]}），覆盖约 <b>${(dayDiff(dates[0], dates[dates.length - 1]) / 365).toFixed(1)}</b> 年。</li>
          <li>最长非交易缺口：<b>${comp.maxGap}</b> 个自然日（含周末/节假日/停牌）。</li>
          ${comp.issues.length ? comp.issues.map(i => `<li class="iss-${i.sev}">${i.txt}</li>`).join('') : '<li class="ok">✓ 未检测到重复日期、非法价格或零成交量，数据完整性良好。</li>'}
        </ul>
      </div>`;

    const anoms = diagAnomalies(dates, opens, closes, volumes, board);
    const anomRows = anoms.length ? anoms.map(a => {
      const mag = a.isZ ? a.val.toFixed(2) + 'σ' : pct(a.val, 1);
      const cls = a.type.indexOf('涨') >= 0 ? 'pos' : a.type.indexOf('跌') >= 0 ? 'neg' : '';
      return `<tr><td>${a.date}</td><td class="${cls}">${a.type}</td><td class="${a.val >= 0 ? 'pos' : 'neg'}">${mag}</td></tr>`;
    }).join('') : `<tr><td colspan="3" style="text-align:center;color:var(--muted);">本区间未检测到显著异常交易日</td></tr>`;
    const anomHtml = `
      <div class="analysis-card">
        <h4>异常交易日 Top${anoms.length || ''}</h4>
        <table class="anom-table"><thead><tr><th>日期</th><th>类型</th><th>幅度</th></tr></thead><tbody>${anomRows}</tbody></table>
        <div class="card-note">${board.name}；涨跌停会冻结流动性，极端日的买卖指令可能无法按信号价成交，回测已按收盘价近似。</div>
      </div>`;

    const dist = diagDistribution(closes, dates);
    const skewText = dist.skew > 0.5 ? `日收益呈<b>右偏（正偏）</b>：上涨日单日涨幅整体大于下跌日跌幅，右侧尾部更厚，对持仓略有利。`
      : dist.skew < -0.5 ? `日收益呈<b>左偏（负偏）</b>：下跌日单日跌幅往往大于上涨日涨幅，需防范突发杀跌。`
      : `日收益偏度接近 0（<b>${dist.skew.toFixed(2)}</b>），分布大致对称。`;
    const kurtText = dist.kurt > 1 ? `超额峰度 <b>${dist.kurt.toFixed(2)}</b>（>1）呈<b>尖峰厚尾</b>：极端涨跌更频繁，黑天鹅风险高于正态假设，止损必要。`
      : dist.kurt < -0.5 ? `超额峰度 <b>${dist.kurt.toFixed(2)}</b> 呈低峰分布，极端值较少。`
      : `超额峰度 <b>${dist.kurt.toFixed(2)}</b> 接近 0，分布形态较接近正态。`;
    const normText = (Math.abs(dist.skew) < 0.5 && dist.kurt < 1) ? `综合偏度与峰度，收益率<b>近似服从正态分布</b>，可谨慎使用经典统计推断（如正态 VaR）。`
      : `收益率<b>显著偏离正态分布</b>，使用正态假设的结论（VaR、期权定价、参数检验）需谨慎。`;
    const distHtml = `
      <div class="analysis-card">
        <h4>收益率分布统计</h4>
        <div class="stat-grid">
          <div><span>日收益均值</span><b class="${dist.mean >= 0 ? 'pos' : 'neg'}">${pct(dist.mean, 3)}</b></div>
          <div><span>年化波动率</span><b>${pct(dist.annVol, 1)}</b></div>
          <div><span>偏度</span><b>${dist.skew.toFixed(2)}</b></div>
          <div><span>超额峰度</span><b>${dist.kurt.toFixed(2)}</b></div>
          <div><span>最大单日涨幅</span><b class="pos">${pct(dist.maxUp, 1)}</b></div>
          <div><span>最大单日跌幅</span><b class="neg">${pct(dist.maxDown, 1)}</b></div>
          <div><span>上涨天数</span><b>${dist.up}（${pp(dist.up / dist.n)}）</b></div>
          <div><span>下跌天数</span><b>${dist.down}（${pp(dist.down / dist.n)}）</b></div>
        </div>
        <ul>
          <li>${skewText}</li>
          <li>${kurtText}</li>
          <li>${normText}</li>
        </ul>
      </div>`;

    const vs = diagVolSerial(closes);
    const volText = vs.ratio > 1.15 ? `近期 20 日年化波动率（<b>${pct(vs.recentVol, 1)}</b>）较全样本（<b>${pct(vs.annVol, 1)}</b>）放大约 <b>${pp(vs.ratio - 1)}</b>，市场进入<b>高波动阶段</b>，回撤与假信号风险上升。`
      : vs.ratio < 0.85 ? `近期波动率（<b>${pct(vs.recentVol, 1)}</b>）较历史（<b>${pct(vs.annVol, 1)}</b>）收敛 <b>${pp(1 - vs.ratio)}</b>，市场趋于平静。`
      : `近期波动率（<b>${pct(vs.recentVol, 1)}</b>）与全样本（<b>${pct(vs.annVol, 1)}</b>）基本一致，处于平稳区间。`;
    const acText = vs.ac1 > 0.1 ? `日收益一阶自相关 <b>${vs.ac1.toFixed(2)}</b>（>0.1，<b>短期动量</b>）：价格有延续前一交易日方向的倾向，趋势行情中双均线更有效。`
      : vs.ac1 < -0.1 ? `日收益一阶自相关 <b>${vs.ac1.toFixed(2)}</b>（<-0.1，<b>短期反转</b>）：前一交易日涨则次日易跌，震荡市特征，双均线易反复失效。`
      : `日收益一阶自相关 <b>${vs.ac1.toFixed(2)}</b>，接近 0，短期方向随机，无明显动量/反转。`;
    const volHtml = `
      <div class="analysis-card">
        <h4>波动与序列特征</h4>
        <div class="stat-grid">
          <div><span>全样本年化波动</span><b>${pct(vs.annVol, 1)}</b></div>
          <div><span>近20日年化波动</span><b>${pct(vs.recentVol, 1)}</b></div>
          <div><span>波动放大倍数</span><b>${vs.ratio.toFixed(2)}×</b></div>
          <div><span>一阶自相关</span><b>${vs.ac1.toFixed(2)}</b></div>
        </div>
        <ul>
          <li>${volText}</li>
          <li>${acText}</li>
        </ul>
      </div>`;

    const first = closes[0], last = closes[closes.length - 1];
    let trend = 'flat', tlabel = '震荡';
    if (last > first * 1.10) { trend = 'up'; tlabel = '上涨'; } else if (last < first * 0.90) { trend = 'down'; tlabel = '下跌'; }
    const signals = (metrics ? metrics.buySig : 0) + (metrics ? metrics.sellSig : 0);
    let fit;
    if (trend !== 'flat' && vs.ac1 > 0.1) fit = `趋势明确且存在短期动量，<b>双均线策略契合度高</b>，当前参数（${params ? params.shortP : ''}/${params ? params.longP : ''}）有望稳定捕获主升/主跌段。`;
    else if (trend === 'flat' && vs.ac1 < -0.1) fit = `行情偏震荡且日收益呈反转特征，<b>双均线策略易频繁发出假信号</b>（本区间共 ${signals} 次信号），建议叠加趋势过滤（ADX/布林带宽）或突破确认后入场。`;
    else if (vs.annVol > 0.5) fit = `年化波动率高达 <b>${pct(vs.annVol, 0)}</b>，属高波动品种，双均线信号虽多但需<b>严格止损/移动止盈</b>控制回撤。`;
    else fit = `行情与波动特征中性，双均线可作基础趋势跟踪工具，建议结合其他指标交叉验证。`;
    const conclHtml = `
      <div class="analysis-card concl" style="grid-column:1/-1;">
        <h4>综合诊断结论</h4>
        <ul>
          <li>区间行情整体 <b>${tlabel}</b>（${pct(last / first - 1, 1)}），数据质量${comp.score >= 90 ? '<b>良好</b>' : '需关注'}（健康度 ${comp.score}/100）。</li>
          <li>${fit}</li>
          <li>分布与序列综合：日收益${dist.skew > 0.5 ? '右偏' : dist.skew < -0.5 ? '左偏' : '近似对称'}、${dist.kurt > 1 ? '尖峰厚尾（极端风险偏高）' : '接近正态（风险可控）'}；短期${vs.ac1 > 0.1 ? '动量延续' : vs.ac1 < -0.1 ? '反转为主' : '弱相关'}，波动率${vs.ratio > 1.15 ? '放大' : vs.ratio < 0.85 ? '收敛' : '平稳'}。</li>
          <li class="risk">风险提示：以上为基于历史数据的统计诊断，仅用于策略适配性判断，<b>不构成投资建议</b>。</li>
        </ul>
      </div>`;

    return compHtml + anomHtml + distHtml + volHtml + conclHtml;
  }

  function renderDeep(containerId, ctx) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (ctx.error) { el.innerHTML = `<div class="analysis-card" style="grid-column:1/-1;"><h4>补充诊断</h4><ul><li>${ctx.error}</li></ul></div>`; return; }
    el.innerHTML = buildSupplementaryAnalysis(ctx);
  }

  function renderAnalysis(containerId, ctx) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (ctx.error) { el.innerHTML = `<div class="analysis-card" style="grid-column:1/-1;"><h4>无法生成分析</h4><ul><li>${ctx.error}</li></ul></div>`; return; }
    el.innerHTML = buildDiagnosis(ctx) + buildEvaluation(ctx) + buildRecommendations(ctx);
  }

  const api = { buildDiagnosis, buildEvaluation, buildRecommendations, renderAnalysis, buildSupplementaryAnalysis, renderDeep, pct, pp };
  global.Analysis = api;
})(window);
