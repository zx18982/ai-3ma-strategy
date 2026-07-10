/* ============================================================
 * app.js — 主控制器：加载数据 → 切片 → 均线 → 信号 → 回测 → 绘图 → 诊断
 * 串联 strategy / charts / analysis 三大模块
 * ============================================================ */
(function () {
  'use strict';

  const META = window.STOCK_META || [];
  const DATA = window.STOCK_DATA || {};
  const DEFAULTS = { shortP: 5, longP: 15, capital: 100000, comm: true, slip: false };

  const $ = id => document.getElementById(id);
  function pct(v, d) { d = d == null ? 2 : d; return (v >= 0 ? '+' : '') + (v * 100).toFixed(d) + '%'; }
  function signCls(v) { return v > 0 ? 'pos' : (v < 0 ? 'neg' : ''); }
  function exchangeSuffix(code) {
    if (code.startsWith('sh')) return 'SH';
    if (code.startsWith('sz')) return 'SZ';
    if (code.startsWith('hk')) return 'HK';
    return '';
  }
  function stockLabel(m) {
    const ex = exchangeSuffix(m.code);
    return `${m.name} ${m.market === 'A' ? 'A' : 'H'} (${m.code.slice(2)}.${ex})`;
  }

  // ---- 初始化股票下拉 ----
  function initStockSelector() {
    const sel = $('stockSel');
    sel.innerHTML = META.map(m => `<option value="${m.code}">${stockLabel(m)}</option>`).join('');
  }

  // ---- 切换股票：设置日期范围与信息 ----
  function onStockChange() {
    const code = $('stockSel').value;
    const bars = DATA[code] || [];
    const dates = bars.map(b => b.date).sort();
    const minD = dates[0], maxD = dates[dates.length - 1];
    const sd = $('startDate'), ed = $('endDate');
    sd.min = minD; sd.max = maxD; sd.value = minD;
    ed.min = minD; ed.max = maxD; ed.value = maxD;
    const m = META.find(x => x.code === code);
    if (m) {
      $('dataAsOf').textContent = `数据截至 ${m.last_date}`;
      $('stockInfo').innerHTML = `行业：${m.industry} ｜ 币种：${m.currency}<br>最新收盘：${m.last_close}（${m.last_date}）`;
      $('rangeHint').textContent = `可选区间：${minD} ~ ${maxD}（共 ${bars.length} 条日线）`;
    }
    render();
  }

  function enforceMA() {
    let s = +$('pShort').value, l = +$('pLong').value;
    if (l <= s) { l = s + 10; if (l > 100) { l = 100; s = 90; $('pShort').value = s; } $('pLong').value = l; }
    $('vShort').textContent = s; $('vLong').textContent = l;
    const gap = l - s;
    $('maHint').textContent = `短 ${s} / 长 ${l}，周期差 ${gap}（差值越大信号越少、越偏趋势）`;
  }

  function readParams() {
    const code = $('stockSel').value;
    let start = $('startDate').value, end = $('endDate').value;
    if (start > end) { const t = start; start = end; end = t; $('startDate').value = start; $('endDate').value = end; }
    return {
      code, startDate: start, endDate: end,
      shortP: +$('pShort').value, longP: +$('pLong').value,
      capital: Math.max(1000, +$('pCapital').value || 100000),
      commRate: $('commToggle').checked ? 0.0003 : 0,
      slipRate: $('slipToggle').checked ? 0.0001 : 0
    };
  }

  function render() {
    enforceMA();
    const p = readParams();
    const bars = (DATA[p.code] || []).slice().sort((a, b) => a.date < b.date ? -1 : 1);
    const r = window.Strategy.runStrategy(bars, p);

    if (r.error) {
      $('equityChart').innerHTML = `<div style="padding:40px;text-align:center;color:#97a3b0;">${r.error}</div>`;
      $('drawdownChart').innerHTML = ''; $('priceChart').innerHTML = '';
      $('metrics').innerHTML = '';
      $('metricsSub').innerHTML = '';
      $('tradeTable').querySelector('tbody').innerHTML = `<tr><td colspan="7" style="text-align:center;color:#97a3b0;padding:24px;">${r.error}</td></tr>`;
      $('analysis').innerHTML = `<div class="analysis-card" style="grid-column:1/-1;"><h4>无法生成分析</h4><ul><li>${r.error}</li></ul></div>`;
      $('msDays').textContent = '-'; $('msSignals').textContent = '-'; $('msPos').textContent = '-';
      return;
    }

    const m = r.metrics;
    // 1) 主图
    window.Charts.renderEquityChart('equityChart', r.dates, r.equity, r.closes, p.capital);
    window.Charts.renderDrawdownChart('drawdownChart', r.dates, r.equity);
    window.Charts.renderPriceChart('priceChart', r.dates, r.closes, r.sS, r.sL, r.sig);

    // 2) 指标卡
    const cards = [
      { k: '年化收益率', v: pct(m.annRet), c: signCls(m.annRet), s: (m.excess >= 0 ? '跑赢基准 ' : '跑输基准 ') + pct(Math.abs(m.excess)) },
      { k: '夏普比率', v: m.sharpe.toFixed(2), c: m.sharpe >= 1 ? 'pos' : '', s: m.sharpe >= 1 ? '风险收益优秀' : m.sharpe >= 0 ? '风险收益一般' : '风险收益较差' },
      { k: '最大回撤', v: pct(m.mdd), c: 'neg', s: '累计回报 ' + pct(m.cumRet) },
      { k: '胜率', v: (m.winRate * 100).toFixed(1) + '%', c: m.winRate >= 0.5 ? 'pos' : '', s: m.rounds + ' 笔完整交易' }
    ];
    $('metrics').innerHTML = cards.map(c => `<div class="metric"><div class="k">${c.k}</div><div class="v ${c.c}">${c.v}</div><div class="sub">${c.s}</div></div>`).join('');
    $('metricsSub').innerHTML = [
      `<span>累计回报 <b class="${signCls(m.cumRet)}">${pct(m.cumRet)}</b></span>`,
      `<span>买入持有 <b class="${signCls(m.bench)}">${pct(m.bench)}</b></span>`,
      `<span>超额收益 <b class="${signCls(m.excess)}">${pct(m.excess)}</b></span>`,
      `<span>年化波动率 <b>${pct(m.vol)}</b></span>`,
      `<span>信号 金叉 <b style="color:#e74c3c">${m.buySig}</b> / 死叉 <b style="color:#27ae60">${m.sellSig}</b></span>`,
      `<span>成本侵蚀 <b>${m.costErosionPct.toFixed(2)}</b> pp</span>`
    ].join('');

    // 3) 交易表
    const rounds = r.trades.filter(t => t.type === 'sell');
    const tb = $('tradeTable').querySelector('tbody');
    if (!rounds.length) {
      tb.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#97a3b0;padding:24px;">本区间无完整买卖循环（仅有信号或未平仓）</td></tr>`;
    } else {
      tb.innerHTML = rounds.map((t, i) => {
        const rc = t.roundRet >= 0 ? 'pos' : 'neg';
        return `<tr><td>${i + 1}</td>
          <td><span class="tag tag-buy">买</span> ${t.buyDate}</td>
          <td>${t.buyPrice.toFixed(2)}</td>
          <td><span class="tag tag-sell">卖</span> ${t.date}</td>
          <td>${t.price.toFixed(2)}</td>
          <td>${t.holdDays}</td>
          <td class="${rc}">${(t.roundRet >= 0 ? '+' : '') + (t.roundRet * 100).toFixed(2)}%</td></tr>`;
      }).join('');
    }

    // 4) 策略分析
    window.Analysis.renderAnalysis('analysis', { dates: r.dates, closes: r.closes, sS: r.sS, sL: r.sL, sig: r.sig, position: r.position, equity: r.equity, trades: r.trades, metrics: m, params: p });

    // 5) 速览
    $('msDays').textContent = m.n;
    $('msSignals').textContent = `${m.buySig} / ${m.sellSig}`;
    $('msPos').textContent = m.lastPos;

    clearStale();
  }

  // ---- 参数已修改提示（手动运行模式）----
  function markStale() {
    const b = $('runBtn');
    if (!b) return;
    b.classList.add('stale');
    b.textContent = '运行回测 ▶';
    const h = $('staleHint');
    if (h) h.style.display = 'block';
  }
  function clearStale() {
    const b = $('runBtn');
    if (!b) return;
    b.classList.remove('stale');
    b.textContent = '运行回测';
    const h = $('staleHint');
    if (h) h.style.display = 'none';
  }

  // 调参时只更新标签 + 标记待运行（不重算，省算力、让“运行”按钮有意义）
  function onParamInput() {
    enforceMA();
    markStale();
  }

  // 点击“运行回测”：真正重算并刷新，带加载与更新时间反馈
  function onRun() {
    const b = $('runBtn');
    if (!b || b.disabled) return;
    b.disabled = true;
    b.textContent = '计算中…';
    // 让浏览器先画出“计算中…”再执行计算
    setTimeout(() => {
      try { render(); } catch (e) { console.error('render error:', e); }
      b.disabled = false;
      const lu = $('lastUpdated');
      if (lu) lu.textContent = '最后更新：' + new Date().toLocaleTimeString('zh-CN');
    }, 30);
  }

  // ---- 导出 ----
  function currentResult() {
    const p = readParams();
    const bars = (DATA[p.code] || []).slice().sort((a, b) => a.date < b.date ? -1 : 1);
    const r = window.Strategy.runStrategy(bars, p);
    return { params: p, meta: META.find(x => x.code === p.code), result: r };
  }

  function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  function exportCsv() {
    const { params, result } = currentResult();
    if (result.error) { alert(result.error); return; }
    const rounds = result.trades.filter(t => t.type === 'sell');
    const lines = [];
    lines.push('双均线策略回测报告,代码,' + params.code + ',区间,' + params.startDate + '~' + params.endDate + ',短/长周期,' + params.shortP + '/' + params.longP);
    lines.push('参数,初始资金,' + params.capital + ',手续费,' + (params.commRate * 100) + '%,滑点,' + (params.slipRate * 100) + '%');
    lines.push('核心指标,年化收益,' + (result.metrics.annRet * 100).toFixed(2) + '%,夏普,' + result.metrics.sharpe.toFixed(2) + ',最大回撤,' + (result.metrics.mdd * 100).toFixed(2) + '%,胜率,' + (result.metrics.winRate * 100).toFixed(1) + '%');
    lines.push('');
    lines.push('序号,买入日,买入价,卖出日,卖出价,持有天数,收益率(%),买入净额,卖出净额');
    rounds.forEach((t, i) => lines.push([i + 1, t.buyDate, t.buyPrice.toFixed(2), t.date, t.price.toFixed(2), t.holdDays, (t.roundRet * 100).toFixed(2), t.buyNet.toFixed(2), t.sellNet.toFixed(2)].join(',')));
    download(`MA_${params.code}_${params.shortP}_${params.longP}.csv`, '﻿' + lines.join('\n'), 'text/csv;charset=utf-8');
  }

  function exportJson() {
    const { params, meta, result } = currentResult();
    if (result.error) { alert(result.error); return; }
    const out = {
      meta: { code: params.code, name: meta ? meta.name : '', market: meta ? meta.market : '', generatedAt: new Date().toISOString() },
      params,
      metrics: result.metrics,
      trades: result.trades.filter(t => t.type === 'sell'),
      series: { dates: result.dates, close: result.closes, smaShort: result.sS, smaLong: result.sL, signal: result.sig, equity: result.equity, position: result.position }
    };
    download(`MA_${params.code}_${params.shortP}_${params.longP}.json`, JSON.stringify(out, null, 2), 'application/json');
  }

  // ---- 绑定 ----
  function bind() {
    $('stockSel').addEventListener('change', onStockChange); // 切换标的自动重算（整组数据变化）
    $('startDate').addEventListener('change', onParamInput);
    $('endDate').addEventListener('change', onParamInput);
    $('pShort').addEventListener('input', onParamInput);
    $('pLong').addEventListener('input', onParamInput);
    $('commToggle').addEventListener('change', onParamInput);
    $('slipToggle').addEventListener('change', onParamInput);
    $('pCapital').addEventListener('change', onParamInput);
    $('runBtn').addEventListener('click', onRun);
    $('resetBtn').addEventListener('click', () => {
      $('pShort').value = DEFAULTS.shortP; $('pLong').value = DEFAULTS.longP;
      $('pCapital').value = DEFAULTS.capital;
      $('commToggle').checked = DEFAULTS.comm; $('slipToggle').checked = DEFAULTS.slip;
      onStockChange(); // 用默认参数重算
    });
    $('expCsv').addEventListener('click', exportCsv);
    $('expJson').addEventListener('click', exportJson);
  }

  // ---- 启动 ----
  initStockSelector();
  bind();
  onStockChange();
})();
