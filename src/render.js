/*
 * Echo Chamber / 回声室
 *
 * src/render.js — Canvas 主渲染
 *
 * 两块 canvas:背景层 + 舞台层。
 * 背景层画一次性的星空渐变;舞台层每帧重画点、halo、连线。
 */

import { hexToRgba } from "./util.js";

// 画布尺寸管理
export function makeCanvasManager(bgCanvas, stageCanvas) {
  const bgCtx = bgCanvas.getContext("2d");
  const stageCtx = stageCanvas.getContext("2d");
  const dim = { W: 0, H: 0, DPR: 1 };

  function resize() {
    dim.DPR = Math.min(window.devicePixelRatio || 1, 2);
    dim.W = window.innerWidth;
    dim.H = window.innerHeight;

    for (const c of [bgCanvas, stageCanvas]) {
      c.width = dim.W * dim.DPR;
      c.height = dim.H * dim.DPR;
      c.style.width = dim.W + "px";
      c.style.height = dim.H + "px";
    }
    bgCtx.setTransform(dim.DPR, 0, 0, dim.DPR, 0, 0);
    stageCtx.setTransform(dim.DPR, 0, 0, dim.DPR, 0, 0);

    drawBackground(bgCtx, dim.W, dim.H);
  }

  return { bgCtx: bgCtx, stageCtx: stageCtx, dim: dim, resize: resize };
}

// 一次性背景:深色径向 + 星尘
export function drawBackground(ctx, W, H) {
  ctx.fillStyle = "#08080c";
  ctx.fillRect(0, 0, W, H);

  const grad = ctx.createRadialGradient(
    W * 0.5, H * 0.5, 0,
    W * 0.5, H * 0.5, Math.max(W, H) * 0.6
  );
  grad.addColorStop(0, "rgba(244, 233, 212, 0.04)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "rgba(244, 233, 212, 0.18)";
  const count = Math.floor((W * H) / 18000);
  for (let i = 0; i < count; i++) {
    const x = (i * 137.5 + 23) % W;
    const y = (i * 219.7 + 47) % H;
    const a = 0.05 + ((i * 17) % 7) * 0.015;
    ctx.fillStyle = "rgba(244, 233, 212, " + a + ")";
    ctx.fillRect(x, y, 1, 1);
  }
}

// 单个星点 + 淡淡光晕
function drawStar(ctx, x, y, color, alpha, haloR) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.arc(x, y, 1.6, 0, Math.PI * 2);
  ctx.fill();
  if (haloR > 0) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, haloR);
    g.addColorStop(0, color);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.globalAlpha = alpha * 0.35;
    ctx.beginPath();
    ctx.arc(x, y, haloR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// 触点光环,带衰减
function drawHalo(ctx, x, y, color, r, alpha) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(0.4, hexToRgba(color, 0.5));
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.globalAlpha = alpha;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.globalAlpha = 1;
}

// 点之间的连线
function drawLine(ctx, a, b, alpha) {
  ctx.strokeStyle = a.color;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = 0.8;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

// 移除过期 halo
function pruneHalos(halos, dt) {
  for (let i = halos.length - 1; i >= 0; i--) {
    halos[i].age += dt;
    if (halos[i].age >= halos[i].maxAge) halos.splice(i, 1);
  }
}

// 帧渲染入口:根据当前 mode 走不同分支
export function renderFrame(ctx, state, now, lastTime) {
  const dt = now - lastTime;
  const W = state.W;
  const H = state.H;

  if (state.mode === "compose" || state.mode === "perform") {
    // 拖尾残影:浅色覆盖而不是 clearRect,留下痕迹
    ctx.fillStyle = "rgba(8, 8, 12, 0.22)";
    ctx.fillRect(0, 0, W, H);

    // 静态点 + 微闪烁
    for (const tap of state.taps) {
      const flicker = 0.6 + 0.4 * Math.sin(now / 580 + tap.x * 0.013);
      drawStar(ctx, tap.x, tap.y, tap.color, 2.2 * flicker, 5 * flicker);
    }

    // halo
    pruneHalos(state.halos, dt);
    for (const h of state.halos) {
      const t = h.age / h.maxAge;
      const r = 110 * h.scale * Math.pow(t, 0.65);
      const a = Math.pow(1 - t, 1.6) * 0.8;
      drawHalo(ctx, h.x, h.y, h.color, r, a);
    }

    // perform 阶段:已播过的点连起来
    if (state.mode === "perform" && state.optimized) {
      const playIdx = Math.floor((now - state.performStart) / 350);
      const n = Math.min(playIdx, state.taps.length - 1);
      for (let i = 0; i < n; i++) {
        drawLine(ctx, state.taps[i], state.taps[i + 1], 0.32);
      }
    }
  } else if (state.mode === "result") {
    // 结果页:全部点连起来 + 闪烁星
    ctx.fillStyle = "rgba(8, 8, 12, 0.5)";
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < state.taps.length - 1; i++) {
      drawLine(ctx, state.taps[i], state.taps[i + 1], 0.22);
    }
    for (const tap of state.taps) {
      const flicker = 0.7 + 0.3 * Math.sin(now / 700 + tap.x * 0.02);
      drawStar(ctx, tap.x, tap.y, tap.color, 2.5 * flicker, 7 * flicker);
    }
  } else {
    // cover 屏:几粒飘动的光
    ctx.clearRect(0, 0, W, H);
    const t = now / 1000;
    const cx = W / 2;
    const cy = H / 2;
    for (let i = 0; i < 6; i++) {
      const phase = i * 1.7 + t * 0.18;
      const x = cx + Math.cos(phase * 0.9 + i) * W * 0.18;
      const y = cy + Math.sin(phase * 0.7 + i * 0.5) * H * 0.22;
      const r = 2 + (Math.sin(phase * 1.3 + i) * 0.5 + 0.5) * 2.5;
      const alpha = 0.25 + 0.25 * (Math.sin(phase + i) * 0.5 + 0.5);
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r * 6);
      grad.addColorStop(0, "rgba(244, 233, 212, " + alpha + ")");
      grad.addColorStop(0.4, "rgba(244, 233, 212, " + (alpha * 0.3) + ")");
      grad.addColorStop(1, "rgba(244, 233, 212, 0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, r * 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}