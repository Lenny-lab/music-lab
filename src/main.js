/*
 * Echo Chamber / 回声室
 *
 * src/main.js — 主入口
 *
 * 状态机、DOM 绑定、tap 输入、演奏调度、导出按钮、演示模式。
 * 演奏用 Web Audio 精确时间调度(每个 note 在它自己的 t 时刻播放),
 * 不再用固定 350ms 间隔的 setTimeout 链,这样 harmony / expansion
 * 与 melody 严格同步。
 */

import { INSTRUMENTS, playAt, playNow } from "./synth.js";
import { detectDevicePower, formatDate } from "./util.js";
import { compose, compositionEndMs } from "./composer.js";
import { makeCanvasManager, renderFrame } from "./render.js";
import { exportFile } from "./export.js";
import { renderSheetSvg, renderTrackSvg } from "./svg.js";

const TARGET_TAPS = 30;
const HISTORY_KEY = "echo.compositions.v2";

// DOM 引用
const $ = (id) => document.getElementById(id);
const bgCanvas = $("bg");
const stageCanvas = $("stage");
const coverEl = $("screenCover");
const composeEl = $("screenCompose");
const performEl = $("screenPerform");
const resultEl = $("screenResult");
const insLabel = $("insLabel");
const progressCount = $("progressCount");
const performCount = $("performCount");
const resultNum = $("resultNum");
const resultDate = $("resultDate");
const keyLabel = $("keyLabel");
const nameInput = $("nameInput");
const exportImgBtn = $("exportImg");
const exportTrackBtn = $("exportTrack");
const exportSheetBtn = $("exportSheet");
const exportMp3Btn = $("exportMp3");
const exportMidiBtn = $("exportMidi");
const restartEl = $("restart");
const toastEl = $("toast");
const instrumentsEl = $("instruments");
const deviceHint = $("deviceHint");

// 全局状态
const state = {
  mode: "cover",                  // cover | compose | perform | result
  taps: [],                       // 用户原始输入
  optimized: null,                // compose() 输出
  instrument: "piano",
  compositionNum: 1,
  halos: [],
  performStart: 0,
  performTimer: null,             // perform → result 的延时句柄
  device: null,
};

// canvas 管理
const canvasMgr = makeCanvasManager(bgCanvas, stageCanvas);
canvasMgr.resize(); // 立即计算尺寸,否则 tap 算坐标会得到 NaN
state.W = canvasMgr.dim.W;
state.H = canvasMgr.dim.H;

// 音频
let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      audioCtx = null;
    }
  }
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

// ---- 屏幕 y -> 频率(顶部高音,底部低音) ----
function yToFreq(y01) {
  const t = 1 - y01;
  const idx = Math.max(0, Math.min(TARGET_TAPS - 1, Math.floor(t * TARGET_TAPS)));
  const octave = Math.floor(idx / 5);
  const note = idx % 5;
  // 大调式 pentatonic 五声: 0, 2, 4, 7, 9
  const semi = octave * 12 + [0, 2, 4, 7, 9][note];
  return 220 * Math.pow(2, semi / 12);
}

// 根据序号取颜色,呼应 4 个音色
function colorForTap(i) {
  const phases = [
    { min: 0, color: "#f4e9d4" },
    { min: 8, color: "#a8c8e0" },
    { min: 16, color: "#e0a8c8" },
    { min: 24, color: "#ffd6a0" },
  ];
  let chosen = phases[0];
  for (const ph of phases) if (i + 1 >= ph.min) chosen = ph;
  return chosen.color;
}

// ---- Toast ----
let toastTimer = null;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function () {
    toastEl.classList.remove("show");
  }, 1800);
}

// ---- 模式切换 ----
function startCompose() {
  state.mode = "compose";
  state.taps = [];
  state.optimized = null;
  state.halos = [];
  coverEl.hidden = true;
  composeEl.hidden = false;
  performEl.hidden = true;
  resultEl.hidden = true;
  stageCanvas.style.pointerEvents = "auto";
  progressCount.textContent = "0";
  insLabel.textContent = INSTRUMENTS[state.instrument].name;
  showToast("开始 · " + INSTRUMENTS[state.instrument].name);
}

function showResult() {
  state.mode = "result";
  performEl.hidden = true;
  resultEl.hidden = false;
  stageCanvas.style.pointerEvents = "none";

  let history = [];
  try {
    history = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch (e) {
    history = [];
  }
  state.compositionNum = history.length + 1;
  resultNum.textContent = String(state.compositionNum);
  resultDate.textContent = formatDate();

  const opt = state.optimized;
  try {
    history.push({
      n: state.compositionNum,
      date: new Date().toISOString(),
      name: "",
      key: opt.key.name + (opt.key.mode === "minor" ? "m" : ""),
      instrument: state.instrument,
      device: opt.device.level,
    });
    while (history.length > 200) history.shift();
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch (e) {
    // localStorage 满了或被禁用,忽略历史保存
  }

  nameInput.value = "";
  nameInput.onchange = function () {
    try {
      const h = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
      if (h.length) {
        h[h.length - 1].name = nameInput.value.trim();
        localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
      }
    } catch (e) { /* ignore */ }
  };
}

function restart() {
  state.mode = "cover";
  state.taps = [];
  state.optimized = null;
  state.halos = [];
  composeEl.hidden = true;
  performEl.hidden = true;
  resultEl.hidden = true;
  coverEl.hidden = false;
  stageCanvas.style.pointerEvents = "none";
  canvasMgr.stageCtx.clearRect(0, 0, state.W, state.H);
  if (state.performTimer) {
    clearTimeout(state.performTimer);
    state.performTimer = null;
  }
}

// ---- tap 输入 ----
function onTap(clientX, clientY) {
  if (state.mode !== "compose") return;
  if (state.taps.length >= TARGET_TAPS) return;

  const y01 = clientY / state.H;
  const freq = yToFreq(y01);
  const color = colorForTap(state.taps.length);
  const t = performance.now();

  state.taps.push({ x: clientX, y: clientY, t: t, freq: freq, color: color });

  const ctx = ensureAudio();
  if (ctx) {
    // 立刻播一个 0.5s 短音反馈
    playNow(ctx, state.instrument, freq, 0, 0.5, 0.6);
  }
  state.halos.push({
    x: clientX, y: clientY, color: color,
    age: 0, maxAge: 900, scale: 1,
  });

  progressCount.textContent = String(state.taps.length);

  if (state.taps.length >= TARGET_TAPS) {
    setTimeout(optimizeAndPerform, 700);
  }
}

// ---- 优化 + 演奏 ----
function optimizeAndPerform() {
  if (state.taps.length === 0) return;

  // 1. taps 的 t 改成相对时间(从第一个 tap 起算)
  const t0 = state.taps[0].t;
  const tapsRel = state.taps.map(function (tap) {
    return {
      x: tap.x, y: tap.y,
      t: tap.t - t0,
      freq: tap.freq,
      color: tap.color,
    };
  });

  // 2. 设备算力
  const device = detectDevicePower();
  state.device = device;
  const level = device.level;

  // 3. 一站式 compose
  state.optimized = compose(tapsRel, state.instrument, level);
  // detectKey 已经给 minor 调名加 m 后缀,这里直接用 name
  keyLabel.textContent = state.optimized.key.name;

  // 4. 立即进入演奏
  startPerform();
}

function startPerform() {
  if (state.mode !== "compose" || !state.optimized) return;
  const ctx = ensureAudio();
  if (!ctx) {
    // 没有音频上下文,直接跳结果
    showResult();
    return;
  }

  state.mode = "perform";
  state.performStart = ctx.currentTime + 0.1; // 100ms 缓冲
  composeEl.hidden = true;
  performEl.hidden = false;
  state.halos = [];

  const opt = state.optimized;
  const ins = state.instrument;

  // 把每个 note 在自己的 t 时刻精确调度(melody / harmony / expansion 同时间基准)
  for (const n of opt.melody || []) {
    playAt(ctx, ins, n.freq, state.performStart + n.t / 1000, n.duration, n.velocity);
  }
  for (const n of opt.harmony || []) {
    playAt(ctx, ins, n.freq, state.performStart + n.t / 1000, n.duration, n.velocity);
  }
  for (const n of opt.expansion || []) {
    playAt(ctx, ins, n.freq, state.performStart + n.t / 1000, n.duration, n.velocity);
  }

  // 在 perform 模式下,把 melody 节奏作为视觉节拍:每 350ms 高亮下一个
  // 这个不影响音频,只影响 UI
  let beatIdx = 0;
  const beatInterval = setInterval(function () {
    if (state.mode !== "perform") {
      clearInterval(beatInterval);
      return;
    }
    if (beatIdx >= state.taps.length) {
      clearInterval(beatInterval);
      return;
    }
    const tap = state.taps[beatIdx];
    state.halos.push({
      x: tap.x, y: tap.y, color: tap.color,
      age: 0, maxAge: 1100, scale: 1.4,
    });
    performCount.textContent = String(beatIdx + 1);
    beatIdx++;
  }, 350);

  // 算表演总时长
  const allNotes = []
    .concat(opt.melody || [])
    .concat(opt.harmony || [])
    .concat(opt.expansion || []);
  const totalMs = compositionEndMs(allNotes, 1500);

  state.performTimer = setTimeout(showResult, totalMs);
}

// ---- 事件绑定 ----
coverEl.addEventListener("click", function (e) {
  if (e.target.closest(".ins-btn")) return;
  if (state.mode !== "cover") return;
  ensureAudio();
  startCompose();
});

instrumentsEl.addEventListener("click", function (e) {
  const btn = e.target.closest(".ins-btn");
  if (!btn) return;
  const ins = btn.dataset.ins;
  if (!INSTRUMENTS[ins]) return;
  state.instrument = ins;
  instrumentsEl.querySelectorAll(".ins-btn").forEach(function (b) {
    b.classList.toggle("active", b === btn);
  });
  showToast(INSTRUMENTS[ins].name);
});
// 默认激活 piano
instrumentsEl.querySelector('[data-ins="piano"]').classList.add("active");

stageCanvas.addEventListener("click", function (e) {
  onTap(e.clientX, e.clientY);
});

restartEl.addEventListener("click", function (e) {
  e.stopPropagation();
  restart();
});

exportImgBtn.addEventListener("click", function () {
  if (state.mode !== "result") return;
  const name = nameInput.value.trim();
  showToast("正在生成图片...");
  exportFile("png", state, name).then(function () { showToast("已保存图片"); })
    .catch(function (e) { console.error(e); showToast("生成失败"); });
});
exportTrackBtn.addEventListener("click", function () {
  if (state.mode !== "result") return;
  try {
    exportFile("track", state, nameInput.value.trim());
    showToast("已保存轨迹 SVG");
  } catch (e) { console.error(e); showToast("生成失败"); }
});
exportSheetBtn.addEventListener("click", function () {
  if (state.mode !== "result") return;
  try {
    exportFile("sheet", state, nameInput.value.trim());
    showToast("已保存乐谱 SVG");
  } catch (e) { console.error(e); showToast("生成失败"); }
});
exportMp3Btn.addEventListener("click", function () {
  if (state.mode !== "result") return;
  showToast("正在合成 MP3...");
  exportFile("mp3", state, nameInput.value.trim())
    .then(function () { showToast("已导出 .mp3"); })
    .catch(function (e) { console.error(e); showToast("MP3 编码失败"); });
});
exportMidiBtn.addEventListener("click", function () {
  if (state.mode !== "result") return;
  try {
    exportFile("midi", state, nameInput.value.trim());
    showToast("已导出 .mid");
  } catch (e) { console.error(e); showToast("生成失败"); }
});

// ---- 渲染循环 ----
let lastTime = performance.now();
function tick(now) {
  state.W = canvasMgr.dim.W;
  state.H = canvasMgr.dim.H;
  renderFrame(canvasMgr.stageCtx, state, now, lastTime);
  lastTime = now;
  requestAnimationFrame(tick);
}
window.addEventListener("resize", canvasMgr.resize);
requestAnimationFrame(tick);

// ---- 设备算力提示 ----
const dev = detectDevicePower();
if (dev.level === "high") {
  deviceHint.textContent = "算力 " + dev.score + "/5 · 启用全部优化";
} else if (dev.level === "mid") {
  deviceHint.textContent = "算力 " + dev.score + "/5 · 启用标准优化";
} else {
  deviceHint.textContent = "算力 " + dev.score + "/5 · 启用轻量优化";
}

// ---- 演示模式 ----
const demoMatch = location.search.match(/[?&]demo=(\d+)/);
if (demoMatch) {
  const n = Math.min(TARGET_TAPS, parseInt(demoMatch[1], 10) || 30);
  const showSheet = /[?&]sheet=1/.test(location.search);
  const showTrack = /[?&]track=1/.test(location.search);
  const fast = /[?&]fast=1/.test(location.search);

  setTimeout(function () {
    ensureAudio();
    startCompose();
    let i = 0;
    const interval = fast ? 60 : 1200;
    const itv = setInterval(function () {
      if (state.mode !== "compose") {
        clearInterval(itv);
        return;
      }
      const x = state.W * 0.25 + Math.random() * state.W * 0.5;
      const y = state.H * 0.3 + Math.random() * state.H * 0.45;
      onTap(x, y);
      i++;
      if (i >= n) clearInterval(itv);
    }, interval);

    if (showSheet || showTrack) {
      let rendered = false;
      const watch = setInterval(function () {
        if (state.mode === "result" && !rendered && state.taps.length > 0) {
          rendered = true;
          clearInterval(watch);
          setTimeout(function () {
            const opt = state.optimized;
            if (!opt) return;

            const wrap = document.createElement("div");
            wrap.id = "demo-debug-render";
            wrap.style.cssText = "position:fixed; inset:0; background:#08080c; z-index:99999; display:grid; place-items:center; padding:24px; overflow:auto;";
            document.body.appendChild(wrap);

            try {
              let svg;
              if (showTrack) {
                svg = renderTrackSvg(state.taps, opt.key, "Demo");
              } else {
                const allNotes = []
                  .concat(opt.melody || [])
                  .concat(opt.harmony || [])
                  .concat(opt.expansion || [])
                  .sort(function (a, b) { return a.t - b.t; });
                const keyName = (opt.key && opt.key.name)
                  ? opt.key.name + (opt.key.mode === "minor" ? "m" : "")
                  : "C";
                svg = renderSheetSvg(allNotes, keyName, "Demo");
              }
              wrap.innerHTML = svg;
              const svgEl = wrap.querySelector("svg");
              if (svgEl) {
                svgEl.style.maxWidth = "92vw";
                svgEl.style.maxHeight = "92vh";
                svgEl.style.boxShadow = "0 20px 60px rgba(0,0,0,0.6)";
                if (!showTrack) wrap.style.background = "#f4e9d4";
              } else {
                wrap.innerHTML = "<div style='color:#fff'>no svg</div>";
              }
            } catch (e) {
              wrap.style.background = "#222";
              wrap.innerHTML = "<div style='color:#fff;font-family:serif;padding:20px'>render error: " + e.message + "</div>";
            }
          }, 200);
        }
      }, 200);
    }
  }, 50);
}