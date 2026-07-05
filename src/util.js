/*
 * Echo Chamber / 回声室
 *
 * src/util.js — 基础工具
 *
 * 频率 / MIDI 互转、设备算力检测、文本格式化等通用函数。
 * 不依赖 DOM 或音频上下文,可在任意环境运行。
 */

// A4 标准音高 (Hz)
const A4_HZ = 440;

// MIDI 一拍对应的 tick 数(MIDI 文件格式约定)
export const MIDI_TICKS_PER_BEAT = 480;

// 频率 -> MIDI 音符号
// 公式: midi = 69 + 12 * log2(f / A4)
export function freqToMidi(freq) {
  return 69 + 12 * Math.log2(freq / A4_HZ);
}

// MIDI 音符号 -> 频率
export function midiToFreq(midi) {
  return A4_HZ * Math.pow(2, (midi - 69) / 12);
}

// 限制数值到区间 [lo, hi]
export function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

// 把任意 hex 颜色串(形如 #f4e9d4)转成 rgba 字符串
export function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
}

// HTML 特殊字符转义,防止注入 / SVG 标签被吃掉
export function escapeHtml(s) {
  return String(s).replace(/[<>&'"]/g, function (c) {
    return {
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      "'": "&apos;",
      '"': "&quot;",
    }[c];
  });
}

// 文件名安全化:把系统保留字符替换为下划线
export function safeFilename(s) {
  return String(s || "").replace(/[/\\:*?"<>|]/g, "_") || "untitled";
}

// 把日期格式化成 YYYY.MM.DD
export function formatDate(d) {
  d = d || new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return d.getFullYear() + "." + m + "." + day;
}

// 设备算力估算:用硬件并发数 + 内存打分,归类 high/mid/low
// high(>=4 分): 启用完整算法链
// mid(2-3 分):  跳过扩展
// low(<=1 分):  只做 humanize
export function detectDevicePower() {
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;
  let score = 0;
  if (cores >= 8) score += 2;
  else if (cores >= 4) score += 1;
  if (mem >= 8) score += 2;
  else if (mem >= 4) score += 1;
  const level = score >= 4 ? "high" : score >= 2 ? "mid" : "low";
  return { level: level, score: score, cores: cores, memory: mem };
}

// 简化随机数生成(避免每处都写 Math.random)
export function rand(a, b) {
  return a + Math.random() * (b - a);
}

// 整数随机数(包含两端)
export function randInt(a, b) {
  return Math.floor(a + Math.random() * (b - a + 1));
}