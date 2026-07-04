/* ============================================================
   Echo Chamber · 音乐理论与优化模块
   - 调性检测 / Humanization / 智能和声 / 算法扩展
   - 多音色 / MIDI 导出 / 五线谱 SVG 渲染
   全程本地运行,不联网。
   ============================================================ */
(() => {
  "use strict";

  const A4 = 440;
  const TICKS_PER_BEAT = 480;

  // ===== 频率 ↔ MIDI =====
  function freqToMidi(f) {
    return 69 + 12 * Math.log2(f / A4);
  }
  function midiToFreq(m) {
    return A4 * Math.pow(2, (m - 69) / 12);
  }

  // ===== 调性检测 (Krumhansl-Schmuckler 简化版) =====
  const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  // 12 个调名
  const KEY_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

  function detectKey(freqs) {
    const hist = new Array(12).fill(0);
    freqs.forEach(f => {
      const m = Math.round(freqToMidi(f));
      const pc = ((m % 12) + 12) % 12;
      hist[pc] += 1;
    });

    let best = -Infinity;
    let result = { tonic: 0, mode: "major", name: "C" };

    for (let tonic = 0; tonic < 12; tonic++) {
      let scoreM = 0, scorem = 0;
      for (let i = 0; i < 12; i++) {
        scoreM += hist[(tonic + i) % 12] * MAJOR_PROFILE[i];
        scorem += hist[(tonic + i) % 12] * MINOR_PROFILE[i];
      }
      if (scoreM > best) {
        best = scoreM;
        result = { tonic, mode: "major", name: KEY_NAMES[tonic] };
      }
      if (scorem > best) {
        best = scorem;
        result = { tonic, mode: "minor", name: KEY_NAMES[tonic] + "m" };
      }
    }
    return result;
  }

  // 调内和弦: 返回相对 tonic 的半音偏移
  const CHORD_TEMPLATES = {
    I:   [0, 4, 7],
    ii:  [2, 5, 9],
    iii: [4, 7, 11],
    IV:  [5, 9, 12],
    V:   [7, 11, 14],
    vi:  [9, 12, 16],
    vii: [11, 14, 17],
  };

  function chordMidi(rootMidi, templateName) {
    const offs = CHORD_TEMPLATES[templateName] || CHORD_TEMPLATES.I;
    return offs.map(o => rootMidi + o);
  }

  // ===== 设备算力检测 =====
  function detectDevicePower() {
    const cores = navigator.hardwareConcurrency || 4;
    const mem = navigator.deviceMemory || 4;
    let score = 0;
    if (cores >= 8) score += 2; else if (cores >= 4) score += 1;
    if (mem >= 8) score += 2; else if (mem >= 4) score += 1;
    // 弱机:1 分以下;中:2-3;强:4-5
    const level = score >= 4 ? "high" : score >= 2 ? "mid" : "low";
    return { level, score, cores, memory: mem };
  }

  // ===== Humanization =====
  // 给每个 tap 加入微 timing/velocity/duration 变化,让它"被弹"而不是"被播"
  function humanize(taps, level) {
    // level: low / mid / high
    const timingAmp = level === "high" ? 28 : level === "mid" ? 22 : 12; // ms
    const velMin = 0.62, velRange = 0.32;

    return taps.map((tap, i) => {
      // micro-timing offset
      const tOffset = (Math.random() - 0.5) * 2 * timingAmp;
      // velocity 变化,首音重,末音轻,中间浮动
      let velocity = velMin + Math.random() * velRange;
      if (i === 0) velocity = 0.92;
      else if (i === taps.length - 1) velocity = 0.55;
      else if (i === Math.floor(taps.length / 2)) velocity = 0.95; // 顶点稍重

      // duration: 基于前后音的间距 + 随机
      const prev = i > 0 ? taps[i].t : tap.t - 280;
      const next = i < taps.length - 1 ? taps[i + 1].t : tap.t + 700;
      const gap = (next - prev) / 1000;
      let duration = Math.min(1.8, Math.max(0.35, gap * 0.85));
      duration *= 0.88 + Math.random() * 0.24;

      return Object.assign({}, tap, {
        t: tap.t + tOffset,
        velocity,
        duration,
      });
    });
  }

  // ===== 智能和声 =====
  // 在用户音之上加 pad(长音)和偶尔 bass walking
  function generateHarmony(taps, key, level) {
    if (level === "low") return [];
    const out = [];

    // 每隔 1-2 个 tap 加 pad,跟着用户的和声走
    let lastChordTemplate = "I";
    const chordOrder = ["I", "vi", "IV", "V", "I"];
    let chordIdx = 0;

    for (let i = 0; i < taps.length; i++) {
      // 每 4-5 个音换一次和弦
      if (i > 0 && i % 4 === 0) chordIdx = (chordIdx + 1) % chordOrder.length;
      lastChordTemplate = chordOrder[chordIdx];

      const tap = taps[i];
      const tapMidi = Math.round(freqToMidi(tap.freq));
      // 找最接近的调内音(让 pad 听起来在调里)
      const inScale = snapToScale(tapMidi, key);
      const chordRoot = inScale;

      // Pad: 三和弦 root + 3rd + 5th,长音
      if (i % 1 === 0) { // 每个音都加 pad
        const dur = i < taps.length - 1
          ? (taps[i + 1].t - tap.t) / 1000 + 0.3
          : 1.8;
        out.push({
          type: "pad",
          voice: "pad",
          t: tap.t,
          freq: midiToFreq(chordRoot - 12), // 低八度
          duration: Math.min(3.5, Math.max(0.8, dur)),
          velocity: 0.085,
          color: tap.color,
        });
      }

      // Bass: 每 5 个音加一次 walking bass
      if (i > 0 && i % 5 === 0 && level === "high") {
        // bass 走一个 step: 从上一个 bass 音向下走半音/全音
        const prevBass = out.filter(x => x.type === "bass").slice(-1)[0];
        const prevFreq = prevBass ? prevBass.freq : midiToFreq(chordRoot - 24);
        const prevMidi = freqToMidi(prevFreq);
        const stepMidi = Math.round(prevMidi) - (Math.random() < 0.5 ? 1 : 2);
        out.push({
          type: "bass",
          voice: "bass",
          t: tap.t - 30,
          freq: midiToFreq(stepMidi),
          duration: 0.6,
          velocity: 0.18,
          color: tap.color,
        });
      }
    }

    return out;
  }

  function snapToScale(midi, key) {
    const isMinor = key.mode === "minor";
    const intervals = isMinor
      ? [0, 2, 3, 5, 7, 8, 10]
      : [0, 2, 4, 5, 7, 9, 11];
    const pc = ((midi % 12) + 12) % 12;
    const oct = Math.floor(midi / 12) * 12;
    let best = intervals[0], bestD = 99;
    intervals.forEach(s => {
      const d = Math.min(Math.abs(s - pc), 12 - Math.abs(s - pc));
      if (d < bestD) { bestD = d; best = s; }
    });
    return oct + ((key.tonic + best) % 12) + (key.tonic + best >= 12 ? 12 : 0);
  }

  // ===== 算法扩展: 末句收尾 + 邻音填充 =====
  function expandComposition(taps, key, level) {
    if (level === "low" || taps.length < 4) return [];
    const out = [];

    // 1. 邻音填充: 在间隔大于 500ms 的音之间加一个 passing tone
    for (let i = 0; i < taps.length - 1; i++) {
      const gap = taps[i + 1].t - taps[i].t;
      if (gap > 600) {
        const m1 = Math.round(freqToMidi(taps[i].freq));
        const m2 = Math.round(freqToMidi(taps[i + 1].freq));
        if (Math.abs(m2 - m1) > 3) {
          const mid = Math.round((m1 + m2) / 2);
          out.push({
            type: "passing",
            voice: "melody",
            t: taps[i].t + gap / 2,
            freq: midiToFreq(snapToScale(mid, key)),
            duration: 0.35,
            velocity: 0.55,
            color: taps[i].color,
          });
        }
      }
    }

    // 2. 末句收尾: 加 4 个音级进到主音(高设备才做)
    if (level === "high" && taps.length >= 6) {
      const last = taps[taps.length - 1];
      const lastMidi = Math.round(freqToMidi(last.freq));
      const tonicMidi = snapToScale(60 + key.tonic, key); // 主音在 C5 附近

      // 走 4 步,每步半音左右
      let cur = lastMidi;
      const total = 4;
      const stepT = 320;
      for (let i = 1; i <= total; i++) {
        const diff = tonicMidi - cur;
        const dir = Math.sign(diff);
        const step = Math.max(1, Math.round(Math.abs(diff) / (total - i + 1)));
        cur = cur + dir * step;
        const snapped = snapToScale(cur, key);
        out.push({
          type: "tail",
          voice: "melody",
          t: last.t + i * stepT,
          freq: midiToFreq(snapped),
          duration: i === total ? 1.4 : 0.5,
          velocity: i === total ? 0.7 : 0.5,
          color: last.color,
        });
      }
    }

    return out;
  }

  // ===== 结构化分句 + 动态起伏 =====
  function structure(taps) {
    // 按时间间隔分句
    const phrases = [[]];
    const GAP = 550; // ms

    taps.forEach(tap => {
      const lastPhrase = phrases[phrases.length - 1];
      if (lastPhrase.length > 0) {
        const last = lastPhrase[lastPhrase.length - 1];
        if (tap.t - last.t > GAP) phrases.push([]);
      }
      phrases[phrases.length - 1].push(tap);
    });

    // 给每个 phrase 加动态(每句内 velocity 浮动)
    phrases.forEach((phrase, pIdx) => {
      const total = phrases.length;
      const dynamicScale = pIdx === total - 1 ? 0.85 : 1.0; // 末句稍弱
      phrase.forEach((tap, i) => {
        const localT = i / Math.max(1, phrase.length - 1);
        const arc = Math.sin(localT * Math.PI); // 0→1→0
        tap.velocity = (tap.velocity || 0.8) * (0.85 + arc * 0.2) * dynamicScale;
      });
    });

    return phrases;
  }

  // ===== 音色库 =====
  const INSTRUMENTS = {
    piano: {
      name: "钢琴",
      voices: [
        { type: "triangle", mult: 1, gain: 0.85 },
        { type: "sine", mult: 2, gain: 0.22 },
        { type: "sine", mult: 3, gain: 0.07 },
        { type: "sine", mult: 0.5, gain: 0.4 },
      ],
      filter: { type: "lowpass", q: 1.1, open: 3600, close: 800 },
      env: { a: 0.008, s: 0.32, r: 0.55 },
      peak: 0.16,
      duration: 1.6,
    },
    musicbox: {
      name: "八音盒",
      voices: [
        { type: "sine", mult: 1, gain: 1 },
        { type: "triangle", mult: 4, gain: 0.25 },
        { type: "sine", mult: 6, gain: 0.12 },
      ],
      filter: { type: "lowpass", q: 0.7, open: 8500, close: 1800 },
      env: { a: 0.004, s: 0.18, r: 1.4 },
      peak: 0.18,
      duration: 2.4,
    },
    pad: {
      name: "Pad",
      voices: [
        { type: "sawtooth", mult: 1, gain: 0.4 },
        { type: "sawtooth", mult: 1, gain: 0.4, detune: 7 },
        { type: "sine", mult: 0.5, gain: 0.3 },
        { type: "sine", mult: 2, gain: 0.12 },
      ],
      filter: { type: "lowpass", q: 1.8, open: 2200, close: 700 },
      env: { a: 0.12, s: 0.75, r: 1.8 },
      peak: 0.12,
      duration: 3.0,
    },
    strings: {
      name: "弦乐",
      voices: [
        { type: "sawtooth", mult: 1, gain: 0.35 },
        { type: "sawtooth", mult: 1, gain: 0.35, detune: -3 },
        { type: "sawtooth", mult: 1, gain: 0.28, detune: 5 },
        { type: "sine", mult: 0.5, gain: 0.35 },
      ],
      filter: { type: "lowpass", q: 1.4, open: 2500, close: 850 },
      env: { a: 0.18, s: 0.78, r: 1.5 },
      peak: 0.12,
      duration: 2.8,
    },
  };

  // ===== MIDI 导出 =====
  function exportMidi(taps, harmonyNotes, key, bpm = 96) {
    const allNotes = taps.concat(harmonyNotes);
    if (allNotes.length === 0) return new Uint8Array();

    // 排序按时间
    allNotes.sort((a, b) => a.t - b.t);

    const usPerBeat = Math.round(60_000_000 / bpm);
    const events = [];

    // Track name
    events.push(makeMetaEvent(0, [0xFF, 0x03, 0x05, 0x45, 0x63, 0x68, 0x6F, 0x21]));
    // Tempo
    events.push(makeMetaEvent(0, [0xFF, 0x51, 0x03,
      (usPerBeat >> 16) & 0xFF, (usPerBeat >> 8) & 0xFF, usPerBeat & 0xFF]));
    // Time signature 4/4
    events.push(makeMetaEvent(0, [0xFF, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08]));
    // Key signature
    const sf = keySignatureByte(key);
    events.push(makeMetaEvent(0, [0xFF, 0x59, 0x02, sf, key.mode === "minor" ? 1 : 0]));

    // 排他分组: 同一时间同音色的放一起
    const lastTickByNote = new Map();
    let cursorTick = 0;

    allNotes.forEach(n => {
      const startTick = Math.round((n.t / 1000) * (TICKS_PER_BEAT * bpm / 60));
      const durTick = Math.max(20, Math.round(((n.duration || 1) * bpm / 60) * TICKS_PER_BEAT));
      const midi = Math.max(0, Math.min(127, Math.round(freqToMidi(n.freq))));
      const vel = Math.max(1, Math.min(127, Math.round((n.velocity || 0.8) * 127)));
      const ch = n.type === "pad" ? 1 : n.type === "bass" ? 2 : 0;

      const delta = startTick - cursorTick;
      cursorTick = startTick;

      // Note On
      events.push(makeTrackEvent(delta, [0x90 | ch, midi, vel]));
      // Note Off
      events.push(makeTrackEvent(durTick, [0x80 | ch, midi, 0]));
    });

    // End of track
    events.push(makeMetaEvent(0, [0xFF, 0x2F, 0x00]));

    // Encode to bytes
    const trackBytes = encodeTrack(events);
    const headerBytes = encodeHeader(1, TICKS_PER_BEAT, trackBytes.length);

    const total = new Uint8Array(headerBytes.length + trackBytes.length);
    total.set(headerBytes, 0);
    total.set(trackBytes, headerBytes.length);
    return total;
  }

  function keySignatureByte(key) {
    // SF: -7 (7 flats) to +7 (7 sharps)
    const map = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, "F#": 6, "C#": 7,
                  F: -1, "Bb": -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7 };
    return map[key.name] || 0;
  }

  function makeMetaEvent(delta, data) {
    return { delta, status: 0xFF, data };
  }
  function makeTrackEvent(delta, data) {
    return { delta, status: data[0], data };
  }

  function encodeVLQ(n) {
    // Variable Length Quantity (MIDI)
    const bytes = [];
    bytes.push(n & 0x7F);
    n >>= 7;
    while (n > 0) {
      bytes.push((n & 0x7F) | 0x80);
      n >>= 7;
    }
    bytes.reverse();
    return bytes;
  }

  function encodeTrack(events) {
    const out = [];
    out.push(0x4D, 0x54, 0x72, 0x6B); // "MTrk"
    const lenPos = out.length;
    out.push(0, 0, 0, 0); // placeholder for length

    let len = 0;
    events.forEach(ev => {
      const dbytes = encodeVLQ(ev.delta);
      dbytes.forEach(b => { out.push(b); len++; });
      if (ev.status === 0xFF) {
        out.push(0xFF); len++;
        out.push(ev.data[1]); len++;
        const dataLen = ev.data.length - 2;
        encodeVLQ(dataLen).forEach(b => { out.push(b); len++; });
        for (let i = 2; i < ev.data.length; i++) { out.push(ev.data[i]); len++; }
      } else {
        ev.data.forEach(b => { out.push(b); len++; });
      }
    });

    // 写回长度
    out[lenPos] = (len >> 24) & 0xFF;
    out[lenPos + 1] = (len >> 16) & 0xFF;
    out[lenPos + 2] = (len >> 8) & 0xFF;
    out[lenPos + 3] = len & 0xFF;

    return out;
  }

  function encodeHeader(numTracks, ticksPerBeat, trackLen) {
    const out = [];
    out.push(0x4D, 0x54, 0x68, 0x64); // "MThd"
    out.push(0, 0, 0, 6); // header length
    out.push(0, 0); // format 0
    out.push(0, numTracks); // track count
    out.push((ticksPerBeat >> 8) & 0xFF, ticksPerBeat & 0xFF);
    return out;
  }

  // ===== 五线谱 SVG 渲染 (手写纯净版) =====
  function renderSheetSvg(notes, keyName, name) {
    if (!notes || notes.length === 0) {
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 200"><text x="400" y="100" text-anchor="middle" font-family="serif" font-size="20" fill="#999">无音符</text></svg>`;
    }

    const W = 1080;
    const PER_LINE = 8; // 每行 8 个音
    const staveCount = Math.ceil(notes.length / PER_LINE);
    const LEFT_PAD = 100;
    const RIGHT_PAD = 40;
    const staveW = W - LEFT_PAD - RIGHT_PAD;
    const STAVE_TOP0 = 100;
    const LINE_GAP = 13;
    const staveH = 130;
    const H = STAVE_TOP0 + staveCount * staveH + 40;

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<rect width="${W}" height="${H}" fill="#f4e9d4"/>`;

    // === 顶部文字 ===
    svg += `
<text x="50" y="38" font-family="Inter,sans-serif" font-size="12" letter-spacing="3" fill="rgba(20,18,12,0.6)">ECHO CHAMBER</text>
<text x="50" y="62" font-family="Inter,sans-serif" font-size="20" font-weight="300" fill="rgba(20,18,12,0.9)">${escape(name || "无题")}</text>
<text x="50" y="82" font-family="Inter,sans-serif" font-size="10" letter-spacing="2" fill="rgba(20,18,12,0.55)">${keyName} · ${notes.length} 个音 · 一首曲子</text>
<text x="${W - 50}" y="38" text-anchor="end" font-family="Inter,sans-serif" font-size="11" letter-spacing="2" fill="rgba(20,18,12,0.5)">№${Date.now().toString(36).toUpperCase().slice(-4)}</text>`;

    // === 多个 stave ===
    for (let g = 0; g < staveCount; g++) {
      const start = g * PER_LINE;
      const group = notes.slice(start, start + PER_LINE);
      const staveTop = STAVE_TOP0 + g * staveH;
      const startX = LEFT_PAD;
      const noteSpacing = staveW / (group.length + 1);

      // 五条线
      for (let i = 0; i < 5; i++) {
        const ly = staveTop + i * LINE_GAP;
        svg += `<line x1="${LEFT_PAD - 30}" y1="${ly}" x2="${W - RIGHT_PAD}" y2="${ly}" stroke="rgba(20,18,12,0.85)" stroke-width="1.1"/>`;
      }

      // 谱号(只第一个 stave 画)
      if (g === 0) {
        svg += trebleClef(LEFT_PAD - 14, staveTop);
      }

      // 拍号(只第一个 stave 画)
      if (g === 0) {
        svg += `<text x="${LEFT_PAD + 6}" y="${staveTop + 2 * LINE_GAP + 5}" font-family="serif" font-size="26" font-weight="500" fill="rgba(20,18,12,0.9)">4</text>`;
        svg += `<text x="${LEFT_PAD + 6}" y="${staveTop + 4 * LINE_GAP + 2}" font-family="serif" font-size="26" font-weight="500" fill="rgba(20,18,12,0.9)">4</text>`;
      }

      // 终止线 (在最后一行末尾)
      if (g === staveCount - 1) {
        svg += `<line x1="${W - RIGHT_PAD - 4}" y1="${staveTop - 4}" x2="${W - RIGHT_PAD - 4}" y2="${staveTop + 5 * LINE_GAP + 4}" stroke="rgba(20,18,12,0.9)" stroke-width="2"/>`;
      }

      // === 音符 ===
      // midi → Y: 顶线 F5 (midi 77), 每 line gap = 3 semitones
      function midiToY(midi) {
        return staveTop + (77 - midi) / 3 * LINE_GAP;
      }

      // 升号还原
      const sharp = (midi) => [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);

      group.forEach((n, i) => {
        const midi = Math.round(freqToMidi(n.freq));
        const y = midiToY(midi);
        const x = startX + (i + 1) * noteSpacing;
        const isPad = n.type === "pad";
        const isBass = n.type === "bass";
        const color = isPad ? "rgba(20,18,12,0.32)" : isBass ? "rgba(168,140,98,0.7)" : "rgba(20,18,12,0.92)";

        // 升号
        if (sharp(midi) && !isPad && !isBass) {
          const sx = x - 16;
          const sy = y - 6;
          svg += `<text x="${sx}" y="${sy + 8}" font-family="serif" font-size="22" font-weight="600" fill="rgba(20,18,12,0.92)">♯</text>`;
        }

        // 符头(实心椭圆,标准乐谱用)
        let headW, headH;
        if (!isPad) {
          headW = 13; headH = 10;
          svg += `<ellipse cx="${x}" cy="${y}" rx="${headW / 2}" ry="${headH / 2}" transform="rotate(-22 ${x} ${y})" fill="${color}"/>`;
        } else {
          // pad 用空心椭圆(whole note)
          headW = 12; headH = 9;
          svg += `<ellipse cx="${x}" cy="${y}" rx="${headW / 2}" ry="${headH / 2}" transform="rotate(-22 ${x} ${y})" fill="none" stroke="${color}" stroke-width="2"/>`;
        }

        // Ledger lines (上加/下加线)
        if (midi > 77) {
          // 从 A5 (midi 81) 开始
          for (let m = 81; m <= midi; m += 3) {
            const ly = midiToY(m);
            svg += `<line x1="${x - 9}" y1="${ly}" x2="${x + 9}" y2="${ly}" stroke="rgba(20,18,12,0.85)" stroke-width="1"/>`;
          }
        } else if (midi < 64) {
          // 从 C4 (midi 60) 开始
          for (let m = 60; m >= midi; m -= 3) {
            const ly = midiToY(m);
            svg += `<line x1="${x - 9}" y1="${ly}" x2="${x + 9}" y2="${ly}" stroke="rgba(20,18,12,0.85)" stroke-width="1"/>`;
          }
        }

        // 符杆(只 melody / bass)
        if (!isPad) {
          const midY = staveTop + 2 * LINE_GAP;
          const stemUp = y < midY;
          const stemX = stemUp ? x + headW / 2 : x - headW / 2;
          const stemY1 = stemUp ? y - 38 : y;
          const stemY2 = stemUp ? y : y + 38;
          svg += `<line x1="${stemX}" y1="${stemY1}" x2="${stemX}" y2="${stemY2}" stroke="${color}" stroke-width="1.6"/>`;
        }
      });
    }

    svg += `</svg>`;
    return svg;
  }

  // 高音谱号 - 简化版 SVG path
  function trebleClef(cx, staveTop) {
    const oy = staveTop + 3 * 13;
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
    let d = `M ${p[0][0]} ${p[0][1]}`;
    for (let i = 1; i < p.length; i += 3) {
      d += ` C ${p[i][0]} ${p[i][1]}, ${p[i+1][0]} ${p[i+1][1]}, ${p[i+2][0]} ${p[i+2][1]}`;
    }
    return (
      '<path d="' + d + '" fill="none" stroke="rgba(20,18,12,0.92)" stroke-width="2.6" stroke-linecap="round"/>' +
      '<circle cx="' + cx + '" cy="' + (oy + 38) + '" r="3.5" fill="rgba(20,18,12,0.92)"/>'
    );
  }

  function escape(s) {
    return String(s).replace(/[<>&'"]/g, c =>
      ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c])
    );
  }

  // ===== Script 加载 helper (lazy load 第三方 JS) =====
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (window.__scriptCache && window.__scriptCache[src]) return resolve();
      const s = document.createElement("script");
      s.src = src;
      s.async = false;
      s.onload = () => {
        if (!window.__scriptCache) window.__scriptCache = {};
        window.__scriptCache[src] = true;
        resolve();
      };
      s.onerror = () => reject(new Error("Failed to load " + src));
      document.head.appendChild(s);
    });
  }

  // ===== 点的轨迹连线 SVG =====
  // 用户点的 N 个位置,按顺序连成一条平滑曲线
  function renderTrackSvg(taps, key, name) {
    if (!taps || taps.length === 0) {
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800"><text x="400" y="400" text-anchor="middle" font-size="20">无点</text></svg>`;
    }

    const W = 1080;
    const H = 1080;
    const PAD = 90;

    // 包围盒 + 缩放
    const xs = taps.map(t => t.x);
    const ys = taps.map(t => t.y);
    const minX = Math.min.apply(null, xs);
    const maxX = Math.max.apply(null, xs);
    const minY = Math.min.apply(null, ys);
    const maxY = Math.max.apply(null, ys);
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

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<defs>
  <linearGradient id="trackGrad" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="${startColor}" stop-opacity="0.95"/>
    <stop offset="100%" stop-color="${endColor}" stop-opacity="0.95"/>
  </linearGradient>
</defs>
<rect width="${W}" height="${H}" fill="#08080c"/>`;

    // 星尘背景
    for (let i = 0; i < 220; i++) {
      const x = (i * 137.5 + 23) % W;
      const y = (i * 219.7 + 47) % H;
      const a = 0.04 + ((i * 17) % 7) * 0.012;
      svg += `<rect x="${x.toFixed(0)}" y="${y.toFixed(0)}" width="1" height="1" fill="rgba(244,233,212,${a})"/>`;
    }

    // 文字层
    svg += `
<text x="60" y="60" font-family="Inter,sans-serif" font-size="11" letter-spacing="3" fill="rgba(244,233,212,0.5)">ECHO CHAMBER · TRACK</text>
<text x="60" y="100" font-family="Inter,sans-serif" font-size="22" font-weight="300" fill="rgba(244,233,212,0.92)">${escape(name || "无题")}</text>
<text x="60" y="125" font-family="Inter,sans-serif" font-size="11" letter-spacing="2" fill="rgba(244,233,212,0.55)">${key ? key.name : ""} · ${taps.length} 下 · 你的轨迹</text>
<text x="${W - 60}" y="60" text-anchor="end" font-family="Inter,sans-serif" font-size="11" letter-spacing="2" fill="rgba(244,233,212,0.5)">№${Date.now().toString(36).toUpperCase().slice(-4)}</text>
`;

    // 曲线轨迹
    if (taps.length > 1) {
      const pts = taps.map(px);
      let path = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
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
        path += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
      }
      // 阴影线
      svg += `<path d="${path}" fill="none" stroke="url(#trackGrad)" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>`;
      svg += `<path d="${path}" fill="none" stroke="rgba(244,233,212,0.3)" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" transform="translate(0,2)"/>`;
    }

    // 点
    taps.forEach((t, i) => {
      const p = px(t);
      const isFirst = i === 0;
      const isLast = i === taps.length - 1;
      const color = t.color;

      // 序号(每隔 5 个 / 第一个 / 最后一个)
      if (isFirst || isLast || (i + 1) % 5 === 0) {
        svg += `<text x="${p.x.toFixed(1)}" y="${(p.y - 24).toFixed(1)}" text-anchor="middle" font-family="Inter,sans-serif" font-size="10" letter-spacing="1" fill="rgba(244,233,212,0.6)">${i + 1}</text>`;
      }

      // 点的光晕
      svg += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="18" fill="${color}" opacity="0.16"/>`;
      const r = isFirst ? 11 : isLast ? 9 : 6.5;
      svg += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r}" fill="${color}" stroke="rgba(244,233,212,0.9)" stroke-width="${isFirst ? 2.4 : 1.4}"/>`;

      if (isFirst) {
        svg += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="22" fill="none" stroke="${color}" stroke-width="1.4" opacity="0.55"/>`;
        svg += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="32" fill="none" stroke="${color}" stroke-width="0.8" opacity="0.3"/>`;
      }
    });

    svg += `
<text x="${W / 2}" y="${H - 50}" text-anchor="middle" font-family="Inter,sans-serif" font-size="10" letter-spacing="3" fill="rgba(244,233,212,0.4)">ECHO CHAMBER · YOUR TRACK</text>
</svg>`;
    return svg;
  }

  // ===== MP3 编码 (lamejs lazy load) =====
  let lameLoaded = false;
  async function loadLame() {
    if (lameLoaded && window.lamejs) return window.lamejs;
    // 优先本地 vendor,失败 fallback CDN
    try {
      await loadScript("vendor/lame.min.js");
    } catch (e) {
      await loadScript("https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js");
    }
    lameLoaded = true;
    return window.lamejs;
  }

  async function encodeMp3(audioBuffer) {
    const lame = await loadLame();
    if (!lame) throw new Error("lamejs not loaded");
    const numCh = Math.min(2, audioBuffer.numberOfChannels);
    const sampleRate = audioBuffer.sampleRate;

    const leftFloat = audioBuffer.getChannelData(0);
    const rightFloat = numCh > 1 ? audioBuffer.getChannelData(1) : leftFloat;
    const left = floatTo16(leftFloat);
    const right = numCh > 1 ? floatTo16(rightFloat) : left;

    const mp3encoder = new lame.Mp3Encoder(numCh, sampleRate, 128);
    const mp3Data = [];
    const blockSize = 1152;

    for (let i = 0; i < left.length; i += blockSize) {
      const leftChunk = left.subarray(i, i + blockSize);
      let mp3buf;
      if (numCh === 1) {
        mp3buf = mp3encoder.encodeBuffer(leftChunk);
      } else {
        const rightChunk = right.subarray(i, i + blockSize);
        mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk);
      }
      if (mp3buf.length > 0) mp3Data.push(new Uint8Array(mp3buf));
    }
    const mp3End = mp3encoder.flush();
    if (mp3End.length > 0) mp3Data.push(new Uint8Array(mp3End));

    return new Blob(mp3Data, { type: "audio/mpeg" });
  }

  function floatTo16(floatArr) {
    const out = new Int16Array(floatArr.length);
    for (let i = 0; i < floatArr.length; i++) {
      const s = Math.max(-1, Math.min(1, floatArr[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return out;
  }

  // ===== 暴露 API =====
  window.EchoMusic = {
    freqToMidi,
    midiToFreq,
    detectKey,
    detectDevicePower,
    humanize,
    generateHarmony,
    expandComposition,
    structure,
    INSTRUMENTS,
    exportMidi,
    renderSheetSvg,
    renderTrackSvg,
    encodeMp3,
    loadScript,
  };
})();