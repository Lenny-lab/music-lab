/*
 * Echo Chamber / 回声室
 *
 * src/svg.js — SVG 渲染
 *
 * 两类 SVG:五线谱(notes → staff notation)和轨迹连线(taps → bezier path)。
 * 都返回字符串,可直接 Blob 导出或在浏览器内 innerHTML 注入。
 */

import { freqToMidi, escapeHtml } from "./util.js";

// ============ 五线谱 ============

// 高音谱号 SVG path(手绘简版,装饰用)
function trebleClef(cx, staveTop, lineGap) {
  const oy = staveTop + 3 * lineGap;
  // 控制点序列,每 3 个一组构成一段 cubic bezier
  const p = [
    [cx, oy - 28],
    [cx - 5, oy - 18], [cx - 10, oy - 8], [cx - 10, oy + 4],
    [cx - 10, oy + 16], [cx, oy + 22], [cx + 4, oy + 22],
    [cx + 14, oy + 22], [cx + 18, oy + 14], [cx + 16, oy + 6],
    [cx + 14, oy - 4], [cx + 8, oy - 8], [cx + 4, oy - 8],
    [cx - 2, oy - 8], [cx - 4, oy - 4], [cx - 4, oy],
    [cx - 4, oy + 8], [cx + 2, oy + 12], [cx + 6, oy + 16],
    [cx + 12, oy + 22], [cx + 16, oy + 28], [cx + 16, oy + 38],
  ];
  let d = "M " + p[0][0] + " " + p[0][1];
  for (let i = 1; i < p.length; i += 3) {
    d += " C " + p[i][0] + " " + p[i][1] +
         ", " + p[i + 1][0] + " " + p[i + 1][1] +
         ", " + p[i + 2][0] + " " + p[i + 2][1];
  }
  return (
    '<path d="' + d + '" fill="none" stroke="rgba(20,18,12,0.92)" stroke-width="2.6" stroke-linecap="round"/>' +
    '<circle cx="' + cx + '" cy="' + (oy + 38) + '" r="3.5" fill="rgba(20,18,12,0.92)"/>'
  );
}

// 需要画升号的 pitch class(C# / D# / F# / G# / A#)
const SHARP_PITCH_CLASSES = [1, 3, 6, 8, 10];
function isSharp(midi) {
  return SHARP_PITCH_CLASSES.indexOf(((midi % 12) + 12) % 12) >= 0;
}

// 渲染单个音符(符头 / 符杆 / 升降号 / 加线)
// midY 是 stave 中线(第二线)的 Y,用于判断 stem 朝向
function noteToSvg(x, y, midi, midY, isPad, isBass) {
  let out = "";
  const color = isPad
    ? "rgba(20,18,12,0.32)"
    : isBass
      ? "rgba(168,140,98,0.7)"
      : "rgba(20,18,12,0.92)";

  // 升号(只画在 melody / passing 上)
  if (isSharp(midi) && !isPad && !isBass) {
    out += '<text x="' + (x - 16) + '" y="' + (y + 2) +
           '" font-family="serif" font-size="22" font-weight="600" fill="rgba(20,18,12,0.92)">♯</text>';
  }

  // 符头:pad 用空心椭圆(whole note),其他用实心
  const headW = isPad ? 12 : 13;
  const headH = isPad ? 9 : 10;
  if (isPad) {
    out += '<ellipse cx="' + x + '" cy="' + y +
           '" rx="' + (headW / 2) + '" ry="' + (headH / 2) +
           '" transform="rotate(-22 ' + x + ' ' + y + ')"' +
           ' fill="none" stroke="' + color + '" stroke-width="2"/>';
  } else {
    out += '<ellipse cx="' + x + '" cy="' + y +
           '" rx="' + (headW / 2) + '" ry="' + (headH / 2) +
           '" transform="rotate(-22 ' + x + ' ' + y + ')"' +
           ' fill="' + color + '"/>';
  }

  // 加线:顶线 F5(midi 77)以上 A5(81)开始每 3 半音画一条;底线 F4(65)以下 C4(60)开始
  const LINE_GAP = 13;
  if (midi > 77) {
    for (let m = 81; m <= midi; m += 3) {
      const ly = y - (midi - m) / 3 * LINE_GAP;
      out += '<line x1="' + (x - 9) + '" y1="' + ly +
             '" x2="' + (x + 9) + '" y2="' + ly +
             '" stroke="rgba(20,18,12,0.85)" stroke-width="1"/>';
    }
  } else if (midi < 64) {
    for (let m = 60; m >= midi; m -= 3) {
      const ly = y + (m - midi) / 3 * LINE_GAP;
      out += '<line x1="' + (x - 9) + '" y1="' + ly +
             '" x2="' + (x + 9) + '" y2="' + ly +
             '" stroke="rgba(20,18,12,0.85)" stroke-width="1"/>';
    }
  }

  // 符杆:pad 不画,其他按 y 在中线上下决定方向
  if (!isPad) {
    const stemUp = y < midY;
    const stemX = stemUp ? x + headW / 2 : x - headW / 2;
    const stemY1 = stemUp ? y - 38 : y;
    const stemY2 = stemUp ? y : y + 38;
    out += '<line x1="' + stemX + '" y1="' + stemY1 +
           '" x2="' + stemX + '" y2="' + stemY2 +
           '" stroke="' + color + '" stroke-width="1.6"/>';
  }

  return out;
}

// 主入口:notes → 完整 SVG 字符串
export function renderSheetSvg(notes, keyName, name) {
  if (!notes || notes.length === 0) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 200">' +
           '<text x="400" y="100" text-anchor="middle" font-family="serif" font-size="20" fill="#999">无音符</text>' +
           '</svg>';
  }

  const W = 1080;
  const PER_LINE = 8;
  const LEFT_PAD = 100;
  const RIGHT_PAD = 40;
  const STAVE_TOP0 = 100;
  const LINE_GAP = 13;
  const STAVE_H = 130;
  const staveCount = Math.ceil(notes.length / PER_LINE);
  const staveW = W - LEFT_PAD - RIGHT_PAD;
  const H = STAVE_TOP0 + staveCount * STAVE_H + 40;

  const escName = escapeHtml(name || "无题");
  const noId = Date.now().toString(36).toUpperCase().slice(-4);

  let svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H +
            '" width="' + W + '" height="' + H + '">' +
            '<rect width="' + W + '" height="' + H + '" fill="#f4e9d4"/>';

  // 顶部标题
  svg +=
    '<text x="50" y="38" font-family="Inter,sans-serif" font-size="12" letter-spacing="3" fill="rgba(20,18,12,0.6)">ECHO CHAMBER</text>' +
    '<text x="50" y="62" font-family="Inter,sans-serif" font-size="20" font-weight="300" fill="rgba(20,18,12,0.9)">' + escName + '</text>' +
    '<text x="50" y="82" font-family="Inter,sans-serif" font-size="10" letter-spacing="2" fill="rgba(20,18,12,0.55)">' +
      escapeHtml(keyName) + ' · ' + notes.length + ' 个音 · 一首曲子</text>' +
    '<text x="' + (W - 50) + '" y="38" text-anchor="end" font-family="Inter,sans-serif" font-size="11" letter-spacing="2" fill="rgba(20,18,12,0.5)">№' + noId + '</text>';

  // 每个 stave 一行
  for (let g = 0; g < staveCount; g++) {
    const start = g * PER_LINE;
    const group = notes.slice(start, start + PER_LINE);
    const staveTop = STAVE_TOP0 + g * STAVE_H;
    const noteSpacing = staveW / (group.length + 1);

    // 五条线
    for (let i = 0; i < 5; i++) {
      const ly = staveTop + i * LINE_GAP;
      svg += '<line x1="' + (LEFT_PAD - 30) + '" y1="' + ly +
             '" x2="' + (W - RIGHT_PAD) + '" y2="' + ly +
             '" stroke="rgba(20,18,12,0.85)" stroke-width="1.1"/>';
    }

    // 谱号 + 拍号只在第一行
    if (g === 0) {
      svg += trebleClef(LEFT_PAD - 14, staveTop, LINE_GAP);
      svg += '<text x="' + (LEFT_PAD + 6) + '" y="' + (staveTop + 2 * LINE_GAP + 5) +
             '" font-family="serif" font-size="26" font-weight="500" fill="rgba(20,18,12,0.9)">4</text>';
      svg += '<text x="' + (LEFT_PAD + 6) + '" y="' + (staveTop + 4 * LINE_GAP + 2) +
             '" font-family="serif" font-size="26" font-weight="500" fill="rgba(20,18,12,0.9)">4</text>';
    }

    // 终止线
    if (g === staveCount - 1) {
      svg += '<line x1="' + (W - RIGHT_PAD - 4) + '" y1="' + (staveTop - 4) +
             '" x2="' + (W - RIGHT_PAD - 4) + '" y2="' + (staveTop + 5 * LINE_GAP + 4) +
             '" stroke="rgba(20,18,12,0.9)" stroke-width="2"/>';
    }

    // 每个 stave 的音符
    const midY = staveTop + 2 * LINE_GAP;
    for (let i = 0; i < group.length; i++) {
      const n = group[i];
      const midi = Math.round(freqToMidi(n.freq));
      const y = staveTop + (77 - midi) / 3 * LINE_GAP;
      const x = LEFT_PAD + (i + 1) * noteSpacing;
      const isPad = n.type === "pad";
      const isBass = n.type === "bass";
      svg += noteToSvg(x, y, midi, midY, isPad, isBass);
    }
  }

  svg += '</svg>';
  return svg;
}

// ============ 轨迹连线 ============

// taps → 平滑曲线 + 编号 + 起手点光环
export function renderTrackSvg(taps, key, name) {
  if (!taps || taps.length === 0) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800">' +
           '<text x="400" y="400" text-anchor="middle" font-size="20">无点</text>' +
           '</svg>';
  }

  const W = 1080;
  const H = 1080;
  const PAD = 90;

  // 计算包围盒 + 居中缩放
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const t of taps) {
    if (t.x < minX) minX = t.x;
    if (t.x > maxX) maxX = t.x;
    if (t.y < minY) minY = t.y;
    if (t.y > maxY) maxY = t.y;
  }
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const drawW = W - PAD * 2;
  const drawH = H - PAD * 2;
  const scale = Math.min(drawW / spanX, drawH / spanY);
  const offsetX = PAD + (drawW - spanX * scale) / 2;
  const offsetY = PAD + (drawH - spanY * scale) / 2;

  function px(t) {
    return {
      x: offsetX + (t.x - minX) * scale,
      y: offsetY + (t.y - minY) * scale,
    };
  }

  const startColor = taps[0].color;
  const endColor = taps[taps.length - 1].color;
  const escName = escapeHtml(name || "无题");
  const noId = Date.now().toString(36).toUpperCase().slice(-4);

  let svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H +
            '" width="' + W + '" height="' + H + '">' +
            '<defs>' +
              '<linearGradient id="trackGrad" x1="0%" y1="0%" x2="100%" y2="100%">' +
                '<stop offset="0%" stop-color="' + startColor + '" stop-opacity="0.95"/>' +
                '<stop offset="100%" stop-color="' + endColor + '" stop-opacity="0.95"/>' +
              '</linearGradient>' +
            '</defs>' +
            '<rect width="' + W + '" height="' + H + '" fill="#08080c"/>';

  // 星尘背景
  for (let i = 0; i < 220; i++) {
    const x = (i * 137.5 + 23) % W;
    const y = (i * 219.7 + 47) % H;
    const a = 0.04 + ((i * 17) % 7) * 0.012;
    svg += '<rect x="' + x.toFixed(0) + '" y="' + y.toFixed(0) +
           '" width="1" height="1" fill="rgba(244,233,212,' + a + ')"/>';
  }

  // 文字层
  svg +=
    '<text x="60" y="60" font-family="Inter,sans-serif" font-size="11" letter-spacing="3" fill="rgba(244,233,212,0.5)">ECHO CHAMBER · TRACK</text>' +
    '<text x="60" y="100" font-family="Inter,sans-serif" font-size="22" font-weight="300" fill="rgba(244,233,212,0.92)">' + escName + '</text>' +
    '<text x="60" y="125" font-family="Inter,sans-serif" font-size="11" letter-spacing="2" fill="rgba(244,233,212,0.55)">' +
      escapeHtml(key ? key.name : "") + ' · ' + taps.length + ' 下 · 你的轨迹</text>' +
    '<text x="' + (W - 60) + '" y="60" text-anchor="end" font-family="Inter,sans-serif" font-size="11" letter-spacing="2" fill="rgba(244,233,212,0.5)">№' + noId + '</text>';

  // 平滑曲线:cubic bezier,每段两个控制点偏移用 tension
  if (taps.length > 1) {
    const pts = taps.map(px);
    let path = "M " + pts[0].x.toFixed(2) + " " + pts[0].y.toFixed(2);
    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[i - 1];
      const p1 = pts[i];
      const tension = 0.35;
      const dx = (p1.x - p0.x) * tension;
      const dy = (p1.y - p0.y) * tension;
      const cp1x = p0.x + dx;
      const cp1y = p0.y + dy * 0.3;
      const cp2x = p1.x - dx;
      const cp2y = p1.y - dy * 0.3;
      path += " C " + cp1x.toFixed(2) + " " + cp1y.toFixed(2) +
              ", " + cp2x.toFixed(2) + " " + cp2y.toFixed(2) +
              ", " + p1.x.toFixed(2) + " " + p1.y.toFixed(2);
    }
    svg += '<path d="' + path + '" fill="none" stroke="url(#trackGrad)" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>';
    svg += '<path d="' + path + '" fill="none" stroke="rgba(244,233,212,0.3)" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" transform="translate(0,2)"/>';
  }

  // 点 + 编号
  for (let i = 0; i < taps.length; i++) {
    const p = px(taps[i]);
    const isFirst = i === 0;
    const isLast = i === taps.length - 1;
    const showNum = isFirst || isLast || (i + 1) % 5 === 0;

    if (showNum) {
      svg += '<text x="' + p.x.toFixed(1) + '" y="' + (p.y - 24).toFixed(1) +
             '" text-anchor="middle" font-family="Inter,sans-serif" font-size="10" letter-spacing="1" fill="rgba(244,233,212,0.6)">' + (i + 1) + '</text>';
    }
    svg += '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="18" fill="' + taps[i].color + '" opacity="0.16"/>';
    const r = isFirst ? 11 : isLast ? 9 : 6.5;
    svg += '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + r +
           '" fill="' + taps[i].color + '" stroke="rgba(244,233,212,0.9)" stroke-width="' + (isFirst ? 2.4 : 1.4) + '"/>';

    if (isFirst) {
      svg += '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="22" fill="none" stroke="' + taps[i].color + '" stroke-width="1.4" opacity="0.55"/>';
      svg += '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="32" fill="none" stroke="' + taps[i].color + '" stroke-width="0.8" opacity="0.3"/>';
    }
  }

  svg += '<text x="' + (W / 2) + '" y="' + (H - 50) + '" text-anchor="middle" font-family="Inter,sans-serif" font-size="10" letter-spacing="3" fill="rgba(244,233,212,0.4)">ECHO CHAMBER · YOUR TRACK</text>';
  svg += '</svg>';
  return svg;
}