/* ============================================================
   Echo Chamber · 回声室 (主入口)
   ============================================================ */
(() => {
  "use strict";

  const EM = window.EchoMusic;
  const TARGET_TAPS = 30;
  const STORAGE_KEY = "echo.compositions.v2";

  // ----- DOM -----
  const $ = (id) => document.getElementById(id);
  const bgCanvas = $("bg");
  const bgCtx = bgCanvas.getContext("2d");
  const stageCanvas = $("stage");
  const stageCtx = stageCanvas.getContext("2d");
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
  const toast = $("toast");
  const instrumentsEl = $("instruments");
  const deviceHint = $("deviceHint");

  // ----- 状态 -----
  const state = {
    mode: "cover",
    taps: [],
    optimized: null, // { melody, harmony, key, instrument, device, phrases }
    instrument: "piano",
    compositionNum: 1,
    halos: [],
    performStart: 0,
    device: null,
  };

  // ----- 画布 -----
  let W = 0, H = 0, DPR = 1;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    bgCanvas.width = W * DPR;
    bgCanvas.height = H * DPR;
    stageCanvas.width = W * DPR;
    stageCanvas.height = H * DPR;
    bgCanvas.style.width = W + "px";
    bgCanvas.style.height = H + "px";
    stageCanvas.style.width = W + "px";
    stageCanvas.style.height = H + "px";
    bgCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
    stageCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawBg();
  }

  // ----- 音频 -----
  let audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {}
    }
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  // 通用音色合成: 根据 instrument + note 渲染
  function playNote(instrumentName, freq, when, dur, vel) {
    const ctx = audioCtx;
    if (!ctx) return;
    const ins = EM.INSTRUMENTS[instrumentName];
    if (!ins) return;

    const t0 = ctx.currentTime + when;
    const peakV = (vel || 0.8) * (ins.peak || 0.15);
    const durS = dur || ins.duration;

    const filter = ctx.createBiquadFilter();
    filter.type = ins.filter.type;
    filter.Q.value = ins.filter.q;
    filter.frequency.setValueAtTime(ins.filter.open, t0);
    filter.frequency.exponentialRampToValueAtTime(Math.max(ins.filter.close, 80), t0 + durS * 0.6);

    const main = ctx.createGain();
    main.gain.setValueAtTime(0, t0);
    main.gain.linearRampToValueAtTime(peakV, t0 + ins.env.a);
    main.gain.exponentialRampToValueAtTime(peakV * ins.env.s, t0 + ins.env.a + 0.1);
    main.gain.exponentialRampToValueAtTime(0.001, t0 + durS);

    ins.voices.forEach(v => {
      const osc = ctx.createOscillator();
      osc.type = v.type;
      osc.frequency.value = freq * v.mult;
      if (v.detune) osc.detune.value = v.detune;
      const g = ctx.createGain();
      g.gain.value = v.gain;
      osc.connect(g).connect(filter);
      osc.start(t0);
      osc.stop(t0 + durS + 0.05);
    });

    filter.connect(main).connect(ctx.destination);
  }

  // 单独调用一个 note(在 OfflineAudioContext 中也用)
  function scheduleNote(ctx, instrumentName, freq, t0, dur, vel) {
    const ins = EM.INSTRUMENTS[instrumentName];
    if (!ins) return;
    const peakV = (vel || 0.8) * (ins.peak || 0.15);
    const durS = dur || ins.duration;

    const filter = ctx.createBiquadFilter();
    filter.type = ins.filter.type;
    filter.Q.value = ins.filter.q;
    filter.frequency.setValueAtTime(ins.filter.open, t0);
    filter.frequency.exponentialRampToValueAtTime(Math.max(ins.filter.close, 80), t0 + durS * 0.6);

    const main = ctx.createGain();
    main.gain.setValueAtTime(0, t0);
    main.gain.linearRampToValueAtTime(peakV, t0 + ins.env.a);
    main.gain.exponentialRampToValueAtTime(peakV * ins.env.s, t0 + ins.env.a + 0.1);
    main.gain.exponentialRampToValueAtTime(0.001, t0 + durS);

    ins.voices.forEach(v => {
      const osc = ctx.createOscillator();
      osc.type = v.type;
      osc.frequency.value = freq * v.mult;
      if (v.detune) osc.detune.value = v.detune;
      const g = ctx.createGain();
      g.gain.value = v.gain;
      osc.connect(g).connect(filter);
      osc.start(t0);
      osc.stop(t0 + durS + 0.05);
    });

    filter.connect(main).connect(ctx.destination);
  }

  // ----- 生命周期 -----
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
    insLabel.textContent = EM.INSTRUMENTS[state.instrument].name;
    showToast("开始 · " + EM.INSTRUMENTS[state.instrument].name);
  }

  function onTap(clientX, clientY) {
    if (state.mode !== "compose") return;
    if (state.taps.length >= TARGET_TAPS) return;

    const x = clientX;
    const y = clientY;
    const y01 = y / H;
    const freq = yToFreq(y01);
    const color = colorForTap(state.taps.length);
    const t = performance.now();

    state.taps.push({ x, y, t, freq, color });

    ensureAudio();
    // 创作时即时反馈: 用当前音色播一个短音(0.5s)
    playNote(state.instrument, freq, 0, 0.5, 0.6);
    state.halos.push({ x, y, color, age: 0, maxAge: 900, scale: 1 });

    progressCount.textContent = String(state.taps.length);

    if (state.taps.length >= TARGET_TAPS) {
      setTimeout(optimizeAndPerform, 700);
    }
  }

  function yToFreq(y01) {
    const t = 1 - y01;
    const idx = Math.max(0, Math.min(TARGET_TAPS - 1, Math.floor(t * TARGET_TAPS)));
    const octave = Math.floor(idx / 5);
    const note = idx % 5;
    const semi = octave * 12 + [0, 2, 4, 7, 9][note];
    return 220 * Math.pow(2, semi / 12);
  }

  function colorForTap(i) {
    const phases = [
      { min: 0,  color: "#f4e9d4" },
      { min: 8,  color: "#a8c8e0" },
      { min: 16, color: "#e0a8c8" },
      { min: 24, color: "#ffd6a0" },
    ];
    let p = phases[0];
    for (const ph of phases) if (i + 1 >= ph.min) p = ph;
    return p.color;
  }

  // ----- 优化 + 演奏 -----
  function optimizeAndPerform() {
    // 1. 把 taps 的相对时间算出来(从第一个 tap 起)
    const t0 = state.taps[0].t;
    const tapsRel = state.taps.map(tap => ({
      x: tap.x, y: tap.y,
      t: tap.t - t0,
      freq: tap.freq,
      color: tap.color,
    }));

    // 2. 设备检测 + 选择优化级别
    const device = EM.detectDevicePower();
    state.device = device;
    const level = device.level;

    // 3. Humanize
    const melody = EM.humanize(tapsRel, level);

    // 4. 调性检测
    const key = EM.detectKey(melody.map(m => m.freq));

    // 5. 智能和声
    const harmony = EM.generateHarmony(melody, key, level);

    // 6. 算法扩展
    const expansion = EM.expandComposition(melody, key, level);

    // 7. 结构化分句 + 动态
    EM.structure(melody);

    state.optimized = {
      melody,
      harmony,
      expansion,
      key,
      device,
      phrases: [],
    };

    keyLabel.textContent = key.name + (key.mode === "minor" ? "" : "");

    // 8. 进入演奏
    startPerform();
  }

  function startPerform() {
    if (state.mode !== "compose") return;
    state.mode = "perform";
    state.performStart = performance.now();
    composeEl.hidden = true;
    performEl.hidden = true; // 顶部 HUD 隐藏,只在主旋律时显示
    state.halos = [];

    const opt = state.optimized;
    const melody = opt.melody;

    // 用 melody 顺序演奏
    const allNotes = [...melody];
    let counter = 0;

    // 先播 melody(每个 350ms 间隔)
    melody.forEach((note, i) => {
      const delay = i * 350;
      setTimeout(() => {
        ensureAudio();
        playNote(state.instrument, note.freq, 0, note.duration, note.velocity);
        state.halos.push({ x: state.taps[i].x, y: state.taps[i].y, color: note.color, age: 0, maxAge: 1100, scale: 1.4 });
        performCount.textContent = String(i + 1);
      }, delay);
    });

    // harmony 在每个 melody 音之后 +50ms 触发(略延迟,有"层次")
    opt.harmony.forEach(h => {
      const inMelodyIdx = melody.findIndex(m => Math.abs(m.t - h.t) < 100);
      const delay = inMelodyIdx >= 0 ? inMelodyIdx * 350 + 60 : h.t + 200;
      setTimeout(() => {
        ensureAudio();
        playNote(state.instrument, h.freq, 0, h.duration, h.velocity);
      }, delay);
    });

    // expansion 在最后 melody 之后 +150ms
    const melodyTotalMs = melody.length * 350 + 1500;
    opt.expansion.forEach((note, i) => {
      setTimeout(() => {
        ensureAudio();
        playNote(state.instrument, note.freq, 0, note.duration, note.velocity);
      }, melodyTotalMs + i * 380);
    });

    // 计算演奏总时长
    const totalMs = melody.length * 350 + 1500 +
      (opt.expansion.length > 0 ? opt.expansion.length * 380 + 1600 : 800);

    performEl.hidden = false;
    setTimeout(showResult, totalMs);
  }

  function showResult() {
    state.mode = "result";
    performEl.hidden = true;
    resultEl.hidden = false;
    stageCanvas.style.pointerEvents = "none";

    let history = [];
    try { history = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch (e) {}
    state.compositionNum = history.length + 1;
    resultNum.textContent = state.compositionNum;
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
        melody: opt.melody,
        harmony: opt.harmony,
        expansion: opt.expansion,
      });
      while (history.length > 200) history.shift();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    } catch (e) {}

    nameInput.value = "";
    nameInput.onchange = () => {
      try {
        const h = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
        if (h.length) {
          h[h.length - 1].name = nameInput.value.trim();
          localStorage.setItem(STORAGE_KEY, JSON.stringify(h));
        }
      } catch (e) {}
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
    stageCtx.clearRect(0, 0, W, H);
  }

  function formatDate(d = new Date()) {
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
  }

  // ----- 事件 -----
  coverEl.addEventListener("click", (e) => {
    if (e.target.closest(".ins-btn")) return; // 音色按钮单独处理
    if (state.mode !== "cover") return;
    ensureAudio();
    startCompose();
  });

  instrumentsEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".ins-btn");
    if (!btn) return;
    const ins = btn.dataset.ins;
    if (!EM.INSTRUMENTS[ins]) return;
    state.instrument = ins;
    instrumentsEl.querySelectorAll(".ins-btn").forEach(b => b.classList.toggle("active", b === btn));
    showToast(EM.INSTRUMENTS[ins].name);
  });

  // 初始化第一个为 active
  instrumentsEl.querySelector('[data-ins="piano"]').classList.add("active");

  stageCanvas.addEventListener("click", (e) => {
    onTap(e.clientX, e.clientY);
  });

  restartEl.addEventListener("click", (e) => {
    e.stopPropagation();
    restart();
  });

  exportImgBtn.addEventListener("click", exportImage);
  exportTrackBtn.addEventListener("click", exportTrack);
  exportSheetBtn.addEventListener("click", exportSheet);
  exportMp3Btn.addEventListener("click", exportMp3);
  exportMidiBtn.addEventListener("click", exportMidi);

  // ----- 渲染循环 -----
  let lastTime = performance.now();
  function render(now) {
    const dt = now - lastTime;
    lastTime = now;

    if (state.mode === "compose" || state.mode === "perform") {
      stageCtx.fillStyle = "rgba(8, 8, 12, 0.22)";
      stageCtx.fillRect(0, 0, W, H);

      for (const tap of state.taps) {
        const flicker = 0.6 + 0.4 * Math.sin(now / 580 + tap.x * 0.013);
        drawStar(stageCtx, tap.x, tap.y, tap.color, 2.2 * flicker, 5 * flicker);
      }

      for (let i = state.halos.length - 1; i >= 0; i--) {
        const h = state.halos[i];
        h.age += dt;
        if (h.age >= h.maxAge) { state.halos.splice(i, 1); continue; }
        const t = h.age / h.maxAge;
        const r = 110 * h.scale * Math.pow(t, 0.65);
        const alpha = Math.pow(1 - t, 1.6) * 0.8;
        drawHalo(stageCtx, h.x, h.y, h.color, r, alpha);
      }

      if (state.mode === "perform" && state.optimized) {
        const playIdx = Math.floor((now - state.performStart) / 350);
        for (let i = 0; i < Math.min(playIdx, state.taps.length - 1); i++) {
          drawLine(stageCtx, state.taps[i], state.taps[i + 1], 0.32);
        }
      }
    } else if (state.mode === "result") {
      stageCtx.fillStyle = "rgba(8, 8, 12, 0.5)";
      stageCtx.fillRect(0, 0, W, H);
      for (let i = 0; i < state.taps.length - 1; i++) {
        drawLine(stageCtx, state.taps[i], state.taps[i + 1], 0.22);
      }
      for (const tap of state.taps) {
        const flicker = 0.7 + 0.3 * Math.sin(now / 700 + tap.x * 0.02);
        drawStar(stageCtx, tap.x, tap.y, tap.color, 2.5 * flicker, 7 * flicker);
      }
    } else {
      stageCtx.clearRect(0, 0, W, H);
      const t = now / 1000;
      const cx = W / 2, cy = H / 2;
      for (let i = 0; i < 6; i++) {
        const phase = i * 1.7 + t * 0.18;
        const x = cx + Math.cos(phase * 0.9 + i) * W * 0.18;
        const y = cy + Math.sin(phase * 0.7 + i * 0.5) * H * 0.22;
        const r = 2 + (Math.sin(phase * 1.3 + i) * 0.5 + 0.5) * 2.5;
        const alpha = 0.25 + 0.25 * (Math.sin(phase + i) * 0.5 + 0.5);
        const grad = stageCtx.createRadialGradient(x, y, 0, x, y, r * 6);
        grad.addColorStop(0, "rgba(244, 233, 212, " + alpha + ")");
        grad.addColorStop(0.4, "rgba(244, 233, 212, " + (alpha * 0.3) + ")");
        grad.addColorStop(1, "rgba(244, 233, 212, 0)");
        stageCtx.fillStyle = grad;
        stageCtx.beginPath();
        stageCtx.arc(x, y, r * 6, 0, Math.PI * 2);
        stageCtx.fill();
      }
    }

    requestAnimationFrame(render);
  }

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

  function drawHalo(ctx, x, y, color, r, alpha) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(0.4, hexWithAlpha(color, 0.5));
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.globalAlpha = alpha;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.globalAlpha = 1;
  }

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

  function hexWithAlpha(hex, a) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  }

  function drawBg() {
    bgCtx.fillStyle = "#08080c";
    bgCtx.fillRect(0, 0, W, H);
    const grad = bgCtx.createRadialGradient(W * 0.5, H * 0.5, 0, W * 0.5, H * 0.5, Math.max(W, H) * 0.6);
    grad.addColorStop(0, "rgba(244, 233, 212, 0.04)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    bgCtx.fillStyle = grad;
    bgCtx.fillRect(0, 0, W, H);
    bgCtx.fillStyle = "rgba(244, 233, 212, 0.18)";
    const count = Math.floor((W * H) / 18000);
    for (let i = 0; i < count; i++) {
      const x = (i * 137.5 + 23) % W;
      const y = (i * 219.7 + 47) % H;
      const a = 0.05 + ((i * 17) % 7) * 0.015;
      bgCtx.fillStyle = `rgba(244, 233, 212, ${a})`;
      bgCtx.fillRect(x, y, 1, 1);
    }
  }

  // ----- Toast -----
  let toastTimer;
  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 1800);
  }

  // ----- 导出图片 -----
  function exportImage() {
    const SIZE = 1080;
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d");

    const grad = ctx.createRadialGradient(SIZE / 2, SIZE / 2, 0, SIZE / 2, SIZE / 2, SIZE * 0.7);
    grad.addColorStop(0, "#16161f");
    grad.addColorStop(1, "#08080c");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, SIZE, SIZE);

    ctx.fillStyle = "rgba(244, 233, 212, 0.08)";
    for (let i = 0; i < 220; i++) {
      const x = (i * 137.5 + 23) % SIZE;
      const y = (i * 219.7 + 47) % SIZE;
      const a = 0.05 + ((i * 17) % 7) * 0.02;
      ctx.fillStyle = `rgba(244, 233, 212, ${a})`;
      ctx.fillRect(x, y, 1, 1);
    }

    const sx = SIZE / W, sy = SIZE / H;
    const tapXY = (tap) => ({ x: tap.x * sx, y: tap.y * sy });

    if (state.taps.length > 1) {
      ctx.lineWidth = 1.2;
      ctx.lineCap = "round";
      for (let i = 0; i < state.taps.length - 1; i++) {
        const a = tapXY(state.taps[i]);
        const b = tapXY(state.taps[i + 1]);
        ctx.strokeStyle = state.taps[i].color;
        ctx.globalAlpha = 0.28;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    state.taps.forEach((tap) => {
      const p = tapXY(tap);
      const r = 18;
      const g2 = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      g2.addColorStop(0, tap.color);
      g2.addColorStop(0.5, hexWithAlpha(tap.color, 0.5));
      g2.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g2;
      ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
      ctx.fillStyle = tap.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    });

    const opt = state.optimized;
    ctx.fillStyle = "rgba(244, 233, 212, 0.45)";
    ctx.font = "500 22px Inter, 'Helvetica Neue', sans-serif";
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.fillText("ECHO CHAMBER", 60, 60);

    ctx.fillStyle = "rgba(244, 233, 212, 0.4)";
    ctx.font = "300 18px Inter, sans-serif";
    ctx.fillText(formatDate() + " · " + opt.key.name + " · " + EM.INSTRUMENTS[state.instrument].name, 60, 100);

    ctx.textAlign = "right";
    ctx.fillStyle = "#ffd6a0";
    ctx.font = "400 22px Inter, sans-serif";
    ctx.fillText(`#${state.compositionNum}`, SIZE - 60, 60);

    const name = nameInput.value.trim() || "无题";
    ctx.fillStyle = "#f4e9d4";
    ctx.font = "300 38px 'Songti SC', 'Source Han Serif SC', 'STSong', serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(name, SIZE / 2, SIZE - 120);

    ctx.fillStyle = "rgba(244, 233, 212, 0.4)";
    ctx.font = "italic 18px Inter, sans-serif";
    ctx.fillText("30 下 · 一首曲子", SIZE / 2, SIZE - 70);

    canvas.toBlob((blob) => {
      if (!blob) { showToast("生成失败"); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `echo-${state.compositionNum}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "image/png");
    showToast("已保存图片");
  }

  // ----- 导出轨迹连线 (SVG) -----
  function exportTrack() {
    const opt = state.optimized;
    if (!opt) return;
    const name = nameInput.value.trim();
    const svg = EM.renderTrackSvg(state.taps, opt.key, name);
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safeName = (name || "untitled").replace(/[\/\\:*?"<>|]/g, "_");
    a.download = `echo-${state.compositionNum}-${safeName}-track.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("已保存轨迹 SVG");
  }

  // ----- 导出乐谱 (VexFlow SVG) -----
  function exportSheet() {
    const opt = state.optimized;
    if (!opt) return;
    const name = nameInput.value.trim();
    const allNotes = (opt.melody || []).concat(opt.harmony || []).concat(opt.expansion || []).sort((a, b) => a.t - b.t);
    let svg;
    try {
      const keyName = (opt.key && opt.key.name) ? opt.key.name + (opt.key.mode === "minor" ? "m" : "") : "C";
      svg = EM.renderSheetSvg(allNotes, keyName, name);
    } catch (e) {
      console.error(e);
      showToast("乐谱渲染失败");
      return;
    }
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safeName = (name || "untitled").replace(/[\/\\:*?"<>|]/g, "_");
    a.download = `echo-${state.compositionNum}-${safeName}-sheet.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("已保存乐谱 SVG");
  }

  // ----- 导出 MP3 (lamejs lazy) -----
  async function exportMp3() {
    showToast("正在合成 MP3...");
    const opt = state.optimized;
    if (!opt) return;

    const lastMelody = opt.melody[opt.melody.length - 1];
    const lastExpansion = opt.expansion[opt.expansion.length - 1];
    const lastHarmony = opt.harmony[opt.harmony.length - 1];
    const melodyEndMs = lastMelody ? lastMelody.t + (lastMelody.duration || 1.6) * 1000 : 0;
    const expansionEndMs = lastExpansion ? lastExpansion.t + (lastExpansion.duration || 1.4) * 1000 : 0;
    const harmonyEndMs = lastHarmony ? lastHarmony.t + (lastHarmony.duration || 3) * 1000 : 0;
    const totalMs = Math.max(melodyEndMs, expansionEndMs, harmonyEndMs) + 1500;

    let offline;
    try {
      offline = new OfflineAudioContext(2, Math.ceil(44100 * totalMs / 1000), 44100);
    } catch (e) {
      showToast("浏览器不支持音频导出");
      return;
    }

    opt.melody.forEach(note => scheduleNote(offline, state.instrument, note.freq, note.t / 1000, note.duration, note.velocity));
    opt.harmony.forEach(note => scheduleNote(offline, state.instrument, note.freq, note.t / 1000, note.duration, note.velocity));
    opt.expansion.forEach(note => scheduleNote(offline, state.instrument, note.freq, note.t / 1000, note.duration, note.velocity));

    let buf;
    try { buf = await offline.startRendering(); }
    catch (e) { showToast("渲染失败"); return; }

    let blob;
    try {
      blob = await EM.encodeMp3(buf);
    } catch (e) {
      console.error(e);
      showToast("MP3 编码失败");
      return;
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safeName = (nameInput.value.trim() || "untitled").replace(/[\/\\:*?"<>|]/g, "_");
    a.download = `echo-${state.compositionNum}-${safeName}.mp3`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("已导出 .mp3");
  }

  // ----- 导出 MIDI -----
  function exportMidi() {
    const opt = state.optimized;
    if (!opt) return;
    const bytes = EM.exportMidi(opt.melody, opt.harmony.concat(opt.expansion), opt.key, 96);
    if (bytes.length === 0) { showToast("生成失败"); return; }
    const blob = new Blob([bytes], { type: "audio/midi" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safeName = (nameInput.value.trim() || "untitled").replace(/[\/\\:*?"<>|]/g, "_");
    a.download = `echo-${state.compositionNum}-${safeName}.mid`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("已导出 .mid (可在 GarageBand / Logic 打开)");
  }

  function audioBufferToWav(buffer) {
    const numCh = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1;
    const bitDepth = 16;
    const interleaved = interleave(buffer);
    const dataLen = interleaved.length * 2;
    const totalLen = 44 + dataLen;
    const ab = new ArrayBuffer(totalLen);
    const view = new DataView(ab);

    writeStr(view, 0, "RIFF");
    view.setUint32(4, totalLen - 8, true);
    writeStr(view, 8, "WAVE");
    writeStr(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numCh, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numCh * bitDepth / 8, true);
    view.setUint16(32, numCh * bitDepth / 8, true);
    view.setUint16(34, bitDepth, true);
    writeStr(view, 36, "data");
    view.setUint32(40, dataLen, true);

    let off = 44;
    for (let i = 0; i < interleaved.length; i++) {
      const s = Math.max(-1, Math.min(1, interleaved[i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
    return ab;
  }

  function interleave(buffer) {
    const len = buffer.length;
    const numCh = buffer.numberOfChannels;
    const out = new Float32Array(len * numCh);
    const channels = [];
    for (let i = 0; i < numCh; i++) channels.push(buffer.getChannelData(i));
    let idx = 0;
    for (let i = 0; i < len; i++) {
      for (let c = 0; c < numCh; c++) out[idx++] = channels[c][i];
    }
    return out;
  }

  function writeStr(view, off, s) {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  }

  // ----- 启动 -----
  window.addEventListener("resize", resize);
  resize();
  requestAnimationFrame(render);

  // 设备能力检测提示
  const dev = EM.detectDevicePower();
  if (dev.level === "high") {
    deviceHint.textContent = `算力 ${dev.score}/5 · 启用全部优化`;
  } else if (dev.level === "mid") {
    deviceHint.textContent = `算力 ${dev.score}/5 · 启用标准优化`;
  } else {
    deviceHint.textContent = `算力 ${dev.score}/5 · 启用轻量优化`;
  }

  // demo 模式: ?demo=N 自动 tap
  const demoMatch = location.search.match(/[?&]demo=(\d+)/);
  if (demoMatch) {
    const n = Math.min(TARGET_TAPS, parseInt(demoMatch[1], 10) || 30);
    const showSheet = /[?&]sheet=1/.test(location.search);
    const showTrack = /[?&]track=1/.test(location.search);
    setTimeout(() => {
      ensureAudio();
      startCompose();
      let i = 0;
      const tapInterval = /[?&]fast=1/.test(location.search) ? 60 : 1200;
      const itv = setInterval(() => {
        if (state.mode !== "compose") { clearInterval(itv); return; }
        const x = W * 0.25 + Math.random() * W * 0.5;
        const y = H * 0.3 + Math.random() * H * 0.45;
        onTap(x, y);
        i++;
        if (i >= n) clearInterval(itv);
      }, tapInterval);

      // 等到 result 后渲染乐谱
      if (showSheet || showTrack) {
        let rendered = false;
        const watch = setInterval(() => {
          if (state.mode === "result" && !rendered && state.taps.length > 0) {
            rendered = true;
            clearInterval(watch);
            setTimeout(() => {
              const opt = state.optimized;
              if (!opt) return;

              const wrap = document.createElement("div");
              wrap.id = "demo-debug-render";
              wrap.style.cssText = "position:fixed; inset:0; background:#08080c; z-index:99999; display:grid; place-items:center; padding:24px; overflow:auto;";
              document.body.appendChild(wrap);

              if (showTrack) {
                try {
                  const svg = EM.renderTrackSvg(state.taps, opt.key, "Demo");
                  wrap.innerHTML = svg;
                  const svgEl = wrap.querySelector("svg");
                  if (svgEl) {
                    svgEl.style.maxWidth = "92vw";
                    svgEl.style.maxHeight = "92vh";
                    svgEl.style.boxShadow = "0 20px 60px rgba(0,0,0,0.6)";
                  } else {
                    wrap.innerHTML = "<div style='color:#fff'>no svg</div>";
                  }
                } catch (e) {
                  wrap.innerHTML = `<div style="color:#fff;font-family:serif;padding:20px">Track render error: ${e.message}</div>`;
                }
              } else {
                try {
                  const allNotes = (opt.melody || []).concat(opt.harmony || []).concat(opt.expansion || []).sort((a, b) => a.t - b.t);
                  const keyName = (opt.key && opt.key.name) ? opt.key.name + (opt.key.mode === "minor" ? "m" : "") : "C";
                  const svg = EM.renderSheetSvg(allNotes, keyName, "Demo");
                  wrap.style.background = "#f4e9d4";
                  wrap.innerHTML = svg;
                  const svgEl = wrap.querySelector("svg");
                  if (svgEl) {
                    svgEl.style.maxWidth = "92vw";
                    svgEl.style.maxHeight = "92vh";
                    svgEl.style.boxShadow = "0 20px 60px rgba(0,0,0,0.4)";
                  } else {
                    wrap.innerHTML = "<div>no svg</div>";
                  }
                } catch (e) {
                  wrap.style.background = "#222";
                  wrap.innerHTML = `<div style="color:#fff;font-family:serif;padding:20px">Sheet error: ${e.message}</div>`;
                }
              }
            }, 200);
          }
        }, 200);
      }
    }, 50);
  }
})();