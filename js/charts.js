/* ============================================================
 * charts.js — 纯 SVG 图表渲染（无 CDN 依赖，离线可用）
 * 提供：净值图 / 回撤图 / 价格+均线+买卖点图
 * 统一含十字光标 + 浮层 tooltip 交互（鼠标映射到数据索引）
 * 配色遵循中国股市惯例：涨红跌绿
 * ============================================================ */
(function (global) {
  'use strict';

  const SVGNS = 'http://www.w3.org/2000/svg';

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  // 折线 path（跳过 null，断点重起）
  function linePath(values, xFn, yFn) {
    let d = '', started = false;
    for (let i = 0; i < values.length; i++) {
      if (values[i] == null) { started = false; continue; }
      const x = xFn(i).toFixed(1), y = yFn(values[i]).toFixed(1);
      d += (started ? 'L' : 'M') + x + ',' + y + ' ';
      started = true;
    }
    return d;
  }

  // 区域 path（用于回撤面积）
  function areaPath(values, xFn, yFn, yBase) {
    let d = '', started = false, firstX = 0, lastX = 0;
    for (let i = 0; i < values.length; i++) {
      if (values[i] == null) continue;
      const x = xFn(i), y = yFn(values[i]);
      if (!started) { firstX = x; d = 'M' + x.toFixed(1) + ',' + y.toFixed(1) + ' '; started = true; }
      else d += 'L' + x.toFixed(1) + ',' + y.toFixed(1) + ' ';
      lastX = x;
    }
    if (started) d += 'L' + lastX.toFixed(1) + ',' + yBase.toFixed(1) + ' L' + firstX.toFixed(1) + ',' + yBase.toFixed(1) + ' Z';
    return d;
  }

  function fmtDateSlice(d) { return d ? d.slice(5) : ''; }

  /**
   * 通用折线图渲染 + 十字光标 tooltip
   * cfg: { containerId, dates, series:[{name,color,values,dashed,width}],
   *        bands:[{values,color,fillOpacity}], markers:[{i,type,color}],
   *        baseline, yFormat(v), yTicks, xTicks, viewW, viewH, tooltipFmt(idx)->html }
   */
  function renderLineChart(cfg) {
    const container = document.getElementById(cfg.containerId);
    if (!container) return;
    const dates = cfg.dates, n = dates.length;
    const viewW = cfg.viewW || 1000, viewH = cfg.viewH || 360;
    const ml = 56, mr = 18, mt = 16, mb = 30;
    const pw = viewW - ml - mr, ph = viewH - mt - mb;

    // y 范围
    let lo = Infinity, hi = -Infinity;
    (cfg.series || []).forEach(s => s.values.forEach(v => { if (v != null) { if (v < lo) lo = v; if (v > hi) hi = v; } }));
    (cfg.bands || []).forEach(b => b.values.forEach(v => { if (v != null) { if (v < lo) lo = v; if (v > hi) hi = v; } }));
    if (cfg.baseline != null) { lo = Math.min(lo, cfg.baseline); hi = Math.max(hi, cfg.baseline); }
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    if (lo === hi) { lo -= 1; hi += 1; }
    const yPad = (hi - lo) * 0.08; lo -= yPad; hi += yPad;
    const xFn = i => ml + (n <= 1 ? pw / 2 : i / (n - 1) * pw);
    const yFn = v => mt + (1 - (v - lo) / (hi - lo)) * ph;

    const yFmt = cfg.yFormat || (v => v.toFixed(2));
    const yTicks = cfg.yTicks || 4, xTicks = cfg.xTicks || 6;

    let grid = '', ylab = '';
    for (let k = 0; k <= yTicks; k++) {
      const v = lo + (hi - lo) * k / yTicks, y = yFn(v);
      grid += `<line x1="${ml}" y1="${y.toFixed(1)}" x2="${ml + pw}" y2="${y.toFixed(1)}" stroke="#eef1f5"/>`;
      ylab += `<text x="${ml - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" fill="#97a3b0" font-size="11">${esc(yFmt(v))}</text>`;
    }
    let xlab = '';
    for (let k = 0; k < xTicks; k++) {
      const i = n <= 1 ? 0 : Math.round(k / (xTicks - 1) * (n - 1));
      xlab += `<text x="${xFn(i).toFixed(1)}" y="${viewH - 10}" text-anchor="middle" fill="#97a3b0" font-size="11">${fmtDateSlice(dates[i])}</text>`;
    }

    let body = '';
    // 面积带
    (cfg.bands || []).forEach(b => {
      body += `<path d="${areaPath(b.values, xFn, yFn, yFn(0))}" fill="${b.color}" opacity="${b.fillOpacity != null ? b.fillOpacity : 0.8}" stroke="none"/>`;
    });
    // 基准线
    if (cfg.baseline != null) {
      body += `<line x1="${ml}" y1="${yFn(cfg.baseline).toFixed(1)}" x2="${ml + pw}" y2="${yFn(cfg.baseline).toFixed(1)}" stroke="#cbd3dc" stroke-dasharray="4 4"/>`;
    }
    // 折线
    (cfg.series || []).forEach(s => {
      body += `<path d="${linePath(s.values, xFn, yFn)}" fill="none" stroke="${s.color}" stroke-width="${s.width || 1.8}" ${s.dashed ? 'stroke-dasharray="6 4"' : ''}/>`;
    });
    // 买卖标记
    (cfg.markers || []).forEach(m => {
      const x = xFn(m.i), y = yFn(m.y);
      if (m.type === 'up') {
        body += `<path d="M${x.toFixed(1)},${(y - 13).toFixed(1)} L${(x - 5).toFixed(1)},${(y - 3).toFixed(1)} L${(x + 5).toFixed(1)},${(y - 3).toFixed(1)} Z" fill="${m.color}"/>`;
      } else {
        body += `<path d="M${x.toFixed(1)},${(y + 13).toFixed(1)} L${(x - 5).toFixed(1)},${(y + 3).toFixed(1)} L${(x + 5).toFixed(1)},${(y + 3).toFixed(1)} Z" fill="${m.color}"/>`;
      }
    });

    const svg = `<svg id="${cfg.containerId}-svg" viewBox="0 0 ${viewW} ${viewH}" width="100%" height="${viewH}" preserveAspectRatio="xMidYMid meet" style="display:block;">${grid}${ylab}${xlab}${body}
      <g id="${cfg.containerId}-cross" style="display:none;">
        <line id="${cfg.containerId}-vline" y1="${mt}" y2="${mt + ph}" stroke="#b8c2cc" stroke-width="1" stroke-dasharray="3 3"/>
        <g id="${cfg.containerId}-dots"></g>
      </g>
    </svg>`;
    container.innerHTML = svg;

    // tooltip div
    let tip = container.querySelector('.chart-tip');
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'chart-tip';
      container.appendChild(tip);
    }
    tip.style.display = 'none';

    const svgEl = container.querySelector('svg');
    const cross = container.querySelector(`#${cfg.containerId}-cross`);
    const vline = container.querySelector(`#${cfg.containerId}-vline`);
    const dotsG = container.querySelector(`#${cfg.containerId}-dots`);

    function onMove(e) {
      if (n === 0) return;
      const pt = svgEl.createSVGPoint();
      const touch = e.touches ? e.touches[0] : e;
      pt.x = touch.clientX; pt.y = touch.clientY;
      const m = svgEl.getScreenCTM();
      if (!m) return;
      const loc = pt.matrixTransform(m.inverse());
      let idx = Math.round((loc.x - ml) / pw * (n - 1));
      idx = Math.max(0, Math.min(n - 1, idx));
      const cx = xFn(idx);
      cross.style.display = '';
      vline.setAttribute('x1', cx.toFixed(1));
      vline.setAttribute('x2', cx.toFixed(1));
      let dots = '';
      (cfg.series || []).forEach(s => {
        if (s.values[idx] != null) {
          dots += `<circle cx="${cx.toFixed(1)}" cy="${yFn(s.values[idx]).toFixed(1)}" r="3.5" fill="${s.color}" stroke="#fff" stroke-width="1.2"/>`;
        }
      });
      dotsG.innerHTML = dots;
      // tooltip 内容
      if (cfg.tooltipFmt) tip.innerHTML = cfg.tooltipFmt(idx);
      const rect = container.getBoundingClientRect();
      let tx = touch.clientX - rect.left + 14;
      let ty = touch.clientY - rect.top + 14;
      tip.style.display = 'block';
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      if (tx + tw > rect.width) tx = touch.clientX - rect.left - tw - 14;
      if (ty + th > rect.height) ty = rect.height - th - 6;
      if (ty < 0) ty = 6;
      tip.style.left = tx + 'px';
      tip.style.top = ty + 'px';
    }
    function onLeave() { cross.style.display = 'none'; tip.style.display = 'none'; }

    svgEl.addEventListener('mousemove', onMove);
    svgEl.addEventListener('mouseleave', onLeave);
    svgEl.addEventListener('touchmove', onMove, { passive: true });
    svgEl.addEventListener('touchend', onLeave);
  }

  // 净值图：策略 vs 买入持有基准（基准线 = 1.0）
  function renderEquityChart(containerId, dates, equity, closes, capital) {
    const strat = equity.map(e => e / capital);
    const bench = closes.map(c => c / closes[0]);
    renderLineChart({
      containerId, dates,
      series: [
        { name: '策略净值', color: '#e74c3c', values: strat, width: 2 },
        { name: '买入持有', color: '#95a5a6', values: bench, dashed: true, width: 1.5 }
      ],
      baseline: 1,
      yFormat: v => v.toFixed(2),
      viewW: 1000, viewH: 360,
      tooltipFmt: idx => `<b>${esc(dates[idx])}</b><br>
        <span style="color:#e74c3c">●</span> 策略净值 ${(strat[idx] * 100).toFixed(1)}%<br>
        <span style="color:#95a5a6">●</span> 买入持有 ${(bench[idx] * 100).toFixed(1)}%<br>
        <span style="color:#5b6b7b">收盘价 ${closes[idx].toFixed(2)}</span>`
    });
  }

  // 回撤图：面积带（0 为基线）
  function renderDrawdownChart(containerId, dates, equity) {
    let peak = equity[0];
    const dd = equity.map(e => { peak = Math.max(peak, e); return (e - peak) / peak * 100; });
    renderLineChart({
      containerId, dates,
      bands: [{ values: dd, color: '#fadbd8', fillOpacity: 0.85 }],
      series: [{ name: '回撤', color: '#e74c3c', values: dd, width: 1.5 }],
      yFormat: v => v.toFixed(1) + '%',
      viewW: 480, viewH: 300,
      tooltipFmt: idx => `<b>${esc(dates[idx])}</b><br>
        <span style="color:#e74c3c">回撤 ${dd[idx].toFixed(2)}%</span>`
    });
  }

  // 价格图：收盘价 + 双均线 + 买卖标记
  function renderPriceChart(containerId, dates, closes, sS, sL, sig) {
    const markers = [];
    for (let i = 0; i < dates.length; i++) {
      if (sig[i] === 1) markers.push({ i, type: 'up', color: '#e74c3c', y: closes[i] });
      else if (sig[i] === -1) markers.push({ i, type: 'down', color: '#27ae60', y: closes[i] });
    }
    renderLineChart({
      containerId, dates,
      series: [
        { name: '收盘价', color: '#2c3e50', values: closes, width: 1.2 },
        { name: 'SMA短', color: '#e74c3c', values: sS, width: 1.8 },
        { name: 'SMA长', color: '#3498db', values: sL, width: 1.8 }
      ],
      markers,
      yFormat: v => v.toFixed(2),
      viewW: 480, viewH: 300,
      tooltipFmt: idx => {
        let h = `<b>${esc(dates[idx])}</b><br>
          <span style="color:#2c3e50">●</span> 收盘 ${closes[idx].toFixed(2)}`;
        if (sS[idx] != null) h += `<br><span style="color:#e74c3c">●</span> SMA短 ${sS[idx].toFixed(2)}`;
        if (sL[idx] != null) h += `<br><span style="color:#3498db">●</span> SMA长 ${sL[idx].toFixed(2)}`;
        if (sig[idx] === 1) h += `<br><b style="color:#e74c3c">▲ 金叉·买入信号</b>`;
        else if (sig[idx] === -1) h += `<br><b style="color:#27ae60">▼ 死叉·卖出信号</b>`;
        return h;
      }
    });
  }

  const api = { renderLineChart, renderEquityChart, renderDrawdownChart, renderPriceChart };
  global.Charts = api;
})(window);
