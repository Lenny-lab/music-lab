/*
 * Echo Chamber / 回声室
 *
 * src/export.js — 文件导出
 *
 * 4 种导出:PNG(1080×1080 星座图)、SVG(轨迹/乐谱)、MP3(离线渲染 + lamejs 编码)、MIDI
 * 统一入口 exportFile(type, ...),按 type 分发。
 */

import { freqToMidi, hexToRgba, safeFilename, MIDI_TICKS_PER_BEAT } from "./util.js";
import { keySignatureSf } from "./theory.js";
import { renderSheetSvg, renderTrackSvg } from "./svg.js";
import { playAt, INSTRUMENTS } from "./synth.js";
import { compositionEndMs } from "./composer.js";

// ============ PNG 导出 ============

// 把当前 taps 渲染成 1080×1080 星座图,返回 blob
export function exportPng(state, name) {
  const SIZE = 1080;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");

  // 深色径向底
  const bg = ctx.createRadialGradient(SIZE / 2, SIZE / 2, 0, SIZE / 2, SIZE / 2, SIZE * 0.7);
  bg.addColorStop(0, "#16161f");
  bg.addColorStop(1, "#08080c");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // 星尘
  for (let i = 0; i < 220; i++) {
    const x = (i * 137.5 + 23) % SIZE;
    const y = (i * 219.7 + 47) % SIZE;
    const a = 0.05 + ((i * 17) % 7) * 0.02;
    ctx.fillStyle = "rgba(244, 233, 212, " + a + ")";
    ctx.fillRect(x, y, 1, 1);
  }

  const sx = SIZE / state.W;
  const sy = SIZE / state.H;
  function tapXY(tap) {
    return { x: tap.x * sx, y: tap.y * sy };
  }

  // 连线
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

  // 点 + 光晕
  for (const tap of state.taps) {
    const p = tapXY(tap);
    const r = 18;
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    g.addColorStop(0, tap.color);
    g.addColorStop(0.5, hexToRgba(tap.color, 0.5));
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
    ctx.fillStyle = tap.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // 文字层
  const opt = state.optimized;
  ctx.fillStyle = "rgba(244, 233, 212, 0.45)";
  ctx.font = "500 22px Inter, 'Helvetica Neue', sans-serif";
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillText("ECHO CHAMBER", 60, 60);

  ctx.fillStyle = "rgba(244, 233, 212, 0.4)";
  ctx.font = "300 18px Inter, sans-serif";
  const insName = INSTRUMENTS[state.instrument] ? INSTRUMENTS[state.instrument].name : "";
  ctx.fillText(
    (opt && opt.key ? opt.key.name + " · " : "") + insName,
    60, 100
  );

  ctx.textAlign = "right";
  ctx.fillStyle = "#ffd6a0";
  ctx.font = "400 22px Inter, sans-serif";
  ctx.fillText("#" + state.compositionNum, SIZE - 60, 60);

  const finalName = (name || "").trim() || "无题";
  ctx.fillStyle = "#f4e9d4";
  ctx.font = "300 38px 'Songti SC', 'Source Han Serif SC', 'STSong', serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(finalName, SIZE / 2, SIZE - 120);

  ctx.fillStyle = "rgba(244, 233, 212, 0.4)";
  ctx.font = "italic 18px Inter, sans-serif";
  ctx.fillText("30 下 · 一首曲子", SIZE / 2, SIZE - 70);

  return new Promise(function (resolve, reject) {
    canvas.toBlob(function (blob) {
      if (!blob) reject(new Error("toBlob failed"));
      else resolve(blob);
    }, "image/png");
  });
}

// ============ SVG 导出 ============

export function exportSvgTrack(state, name) {
  const opt = state.optimized;
  if (!opt) throw new Error("没有可用的乐谱数据");
  const svg = renderTrackSvg(state.taps, opt.key, name);
  return new Blob([svg], { type: "image/svg+xml" });
}

export function exportSvgSheet(state, name) {
  const opt = state.optimized;
  if (!opt) throw new Error("没有可用的乐谱数据");
  const allNotes = (opt.melody || [])
    .concat(opt.harmony || [])
    .concat(opt.expansion || [])
    .sort(function (a, b) { return a.t - b.t; });
  const keyName = (opt.key && opt.key.name)
    ? opt.key.name + (opt.key.mode === "minor" ? "m" : "")
    : "C";
  const svg = renderSheetSvg(allNotes, keyName, name);
  return new Blob([svg], { type: "image/svg+xml" });
}

// ============ MP3 编码 ============

// 用 OfflineAudioContext 渲染整段曲子 + lamejs 编码 MP3
export async function exportMp3(state, name) {
  const opt = state.optimized;
  if (!opt) throw new Error("没有可用的乐谱数据");

  // 收集所有 notes 算总时长
  const allNotes = (opt.melody || []).concat(opt.harmony || []).concat(opt.expansion || []);
  const totalMs = compositionEndMs(allNotes, 1500);
  const sampleRate = 44100;
  const totalSamples = Math.ceil(sampleRate * totalMs / 1000);

  let offline;
  try {
    offline = new OfflineAudioContext(2, totalSamples, sampleRate);
  } catch (e) {
    throw new Error("浏览器不支持离线音频渲染");
  }

  // 用绝对时间调度每个 note(秒)
  for (const n of opt.melody || []) {
    playAt(offline, state.instrument, n.freq, n.t / 1000, n.duration, n.velocity);
  }
  for (const n of opt.harmony || []) {
    playAt(offline, state.instrument, n.freq, n.t / 1000, n.duration, n.velocity);
  }
  for (const n of opt.expansion || []) {
    playAt(offline, state.instrument, n.freq, n.t / 1000, n.duration, n.velocity);
  }

  const buffer = await offline.startRendering();
  const lame = await loadLame();
  if (!lame) throw new Error("MP3 编码器未就绪");
  return encodeLameMp3(lame, buffer);
}

// 加载 lamejs,优先本地 vendor,失败回 CDN
async function loadLame() {
  if (window.__lameReady && window.lamejs) return window.lamejs;
  try {
    await loadScript("vendor/lame.min.js");
  } catch (e) {
    await loadScript("https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js");
  }
  if (!window.lamejs) throw new Error("lamejs not available");
  window.__lameReady = true;
  return window.lamejs;
}

function loadScript(src) {
  return new Promise(function (resolve, reject) {
    const cached = window.__scriptCache && window.__scriptCache[src];
    if (cached) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = false;
    s.onload = function () {
      if (!window.__scriptCache) window.__scriptCache = {};
      window.__scriptCache[src] = true;
      resolve();
    };
    s.onerror = function () { reject(new Error("Failed to load " + src)); };
    document.head.appendChild(s);
  });
}

function encodeLameMp3(lame, audioBuffer) {
  const numCh = Math.min(2, audioBuffer.numberOfChannels);
  const sampleRate = audioBuffer.sampleRate;
  const leftFloat = audioBuffer.getChannelData(0);
  const rightFloat = numCh > 1 ? audioBuffer.getChannelData(1) : leftFloat;
  const left = floatTo16(leftFloat);
  const right = numCh > 1 ? floatTo16(rightFloat) : left;

  const encoder = new lame.Mp3Encoder(numCh, sampleRate, 128);
  const mp3Data = [];
  const blockSize = 1152;

  for (let i = 0; i < left.length; i += blockSize) {
    const leftChunk = left.subarray(i, i + blockSize);
    let mp3buf;
    if (numCh === 1) {
      mp3buf = encoder.encodeBuffer(leftChunk);
    } else {
      const rightChunk = right.subarray(i, i + blockSize);
      mp3buf = encoder.encodeBuffer(leftChunk, rightChunk);
    }
    if (mp3buf.length > 0) mp3Data.push(new Uint8Array(mp3buf));
  }
  const end = encoder.flush();
  if (end.length > 0) mp3Data.push(new Uint8Array(end));

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

// ============ MIDI 导出 ============

// 把乐谱编成标准 MIDI 文件字节流
export function exportMidi(state, bpm) {
  bpm = bpm || 96;
  const opt = state.optimized;
  if (!opt) throw new Error("没有可用的乐谱数据");
  const allNotes = (opt.melody || []).concat(opt.harmony || []).concat(opt.expansion || []);
  if (allNotes.length === 0) return new Uint8Array();
  allNotes.sort(function (a, b) { return a.t - b.t; });

  const usPerBeat = Math.round(60_000_000 / bpm);
  const events = [];
  const trackName = "Echo!";
  const trackNameBytes = stringToAsciiBytes(trackName);
  events.push({ delta: 0, type: "meta", data: [0xFF, 0x03].concat(trackNameBytes) });
  events.push({
    delta: 0,
    type: "meta",
    data: [0xFF, 0x51, 0x03,
      (usPerBeat >> 16) & 0xFF,
      (usPerBeat >> 8) & 0xFF,
      usPerBeat & 0xFF],
  });
  events.push({ delta: 0, type: "meta", data: [0xFF, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08] });
  const sf = keySignatureSf(opt.key ? opt.key.name : "C");
  events.push({
    delta: 0,
    type: "meta",
    data: [0xFF, 0x59, 0x02, sf, opt.key && opt.key.mode === "minor" ? 1 : 0],
  });

  // 按 type 分通道:melody=0, pad=1, bass=2, passing/tail 也走 melody 通道
  const channels = {
    melody: 0, passing: 0, tail: 0,
    pad: 1, bass: 2,
  };
  const programs = {
    0: INSTRUMENTS[state.instrument] ? INSTRUMENTS[state.instrument].program : 0,
    1: 88,
    2: 32,
  };
  // 先发 Program Change 给每个用到的通道
  for (const chKey of Object.keys(programs)) {
    const ch = parseInt(chKey, 10);
    events.push({
      delta: 0,
      type: "channel",
      data: [0xC0 | ch, programs[ch]],
    });
  }

  // 把 notes 转成 on/off 事件并按时间排好
  let cursorTick = 0;
  for (const n of allNotes) {
    const startTick = Math.round((n.t / 1000) * (MIDI_TICKS_PER_BEAT * bpm / 60));
    const durTick = Math.max(20, Math.round(((n.duration || 1) * bpm / 60) * MIDI_TICKS_PER_BEAT));
    const midi = Math.max(0, Math.min(127, Math.round(freqToMidi(n.freq))));
    const vel = Math.max(1, Math.min(127, Math.round((n.velocity || 0.8) * 127)));
    const ch = channels[n.type] != null ? channels[n.type] : 0;
    const delta = Math.max(0, startTick - cursorTick);
    cursorTick = startTick;
    events.push({ delta: delta, type: "channel", data: [0x90 | ch, midi, vel] });
    events.push({ delta: durTick, type: "channel", data: [0x80 | ch, midi, 0] });
  }
  events.push({ delta: 0, type: "meta", data: [0xFF, 0x2F, 0x00] });

  const trackBytes = encodeTrack(events);
  const headerBytes = encodeMidiHeader(1, MIDI_TICKS_PER_BEAT, trackBytes.length);
  const total = new Uint8Array(headerBytes.length + trackBytes.length);
  total.set(headerBytes, 0);
  total.set(trackBytes, headerBytes.length);
  return total;
}

function stringToAsciiBytes(s) {
  const out = [];
  for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0x7F);
  return out;
}

// Variable Length Quantity(MIDI 时间增量)
function encodeVlq(n) {
  const bytes = [];
  bytes.push(n & 0x7F);
  n = Math.floor(n / 128);
  while (n > 0) {
    bytes.push((n & 0x7F) | 0x80);
    n = Math.floor(n / 128);
  }
  bytes.reverse();
  return bytes;
}

function encodeTrack(events) {
  const out = [];
  out.push(0x4D, 0x54, 0x72, 0x6B); // "MTrk"
  const lenPos = out.length;
  out.push(0, 0, 0, 0); // 占位长度

  let len = 0;
  for (const ev of events) {
    for (const b of encodeVlq(ev.delta)) {
      out.push(b);
      len++;
    }
    if (ev.type === "meta") {
      out.push(0xFF); len++;
      out.push(ev.data[1]); len++;
      const dataLen = ev.data.length - 2;
      for (const b of encodeVlq(dataLen)) {
        out.push(b);
        len++;
      }
      for (let i = 2; i < ev.data.length; i++) {
        out.push(ev.data[i]);
        len++;
      }
    } else {
      for (const b of ev.data) {
        out.push(b);
        len++;
      }
    }
  }

  out[lenPos] = (len >> 24) & 0xFF;
  out[lenPos + 1] = (len >> 16) & 0xFF;
  out[lenPos + 2] = (len >> 8) & 0xFF;
  out[lenPos + 3] = len & 0xFF;
  return out;
}

function encodeMidiHeader(numTracks, ticksPerBeat, trackLen) {
  trackLen = trackLen || 0;
  const out = [];
  out.push(0x4D, 0x54, 0x68, 0x64); // "MThd"
  out.push(0, 0, 0, 6);
  out.push(0, 0); // format 0
  out.push(0, numTracks);
  out.push((ticksPerBeat >> 8) & 0xFF, ticksPerBeat & 0xFF);
  return out;
}

// ============ 统一入口 ============

// 把 blob 触发下载
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}

// 主入口:type: "png" | "track" | "sheet" | "mp3" | "midi"
export async function exportFile(type, state, name) {
  const safe = safeFilename(name);
  const num = state.compositionNum;
  switch (type) {
    case "png": {
      const blob = await exportPng(state, name);
      downloadBlob(blob, "echo-" + num + "-" + safe + ".png");
      return;
    }
    case "track": {
      const blob = exportSvgTrack(state, name);
      downloadBlob(blob, "echo-" + num + "-" + safe + "-track.svg");
      return;
    }
    case "sheet": {
      const blob = exportSvgSheet(state, name);
      downloadBlob(blob, "echo-" + num + "-" + safe + "-sheet.svg");
      return;
    }
    case "mp3": {
      const blob = await exportMp3(state, name);
      downloadBlob(blob, "echo-" + num + "-" + safe + ".mp3");
      return;
    }
    case "midi": {
      const bytes = exportMidi(state, 96);
      const blob = new Blob([bytes], { type: "audio/midi" });
      downloadBlob(blob, "echo-" + num + "-" + safe + ".mid");
      return;
    }
    default:
      throw new Error("unknown export type: " + type);
  }
}