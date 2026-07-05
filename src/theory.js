/*
 * Echo Chamber / 回声室
 *
 * src/theory.js — 音乐理论
 *
 * 调性检测 (Krumhansl-Schmuckler)、调内音吸附、和弦模板。
 * 不依赖 DOM 或音频上下文。
 */

import { freqToMidi } from "./util.js";

// Krumhansl-Schmuckler 大调 / 小调的音级权重分布
// 数字是经验权重:稳定音级(I/III/V)高,不稳定的(II/IV)低
const MAJOR_WEIGHTS = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_WEIGHTS = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

// 12 个调名
const KEY_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// 给一组音高,推断最可能的调
// 算法:把音折叠到 12 个 pitch class,做加权相关性打分
export function detectKey(freqs) {
  if (!freqs || freqs.length === 0) {
    return { tonic: 0, mode: "major", name: "C" };
  }

  const hist = new Array(12).fill(0);
  for (const f of freqs) {
    const m = Math.round(freqToMidi(f));
    const pc = ((m % 12) + 12) % 12;
    hist[pc] += 1;
  }

  let bestScore = -Infinity;
  let best = { tonic: 0, mode: "major", name: "C" };

  for (let tonic = 0; tonic < 12; tonic++) {
    let scoreMajor = 0;
    let scoreMinor = 0;
    for (let i = 0; i < 12; i++) {
      const pc = (tonic + i) % 12;
      scoreMajor += hist[pc] * MAJOR_WEIGHTS[i];
      scoreMinor += hist[pc] * MINOR_WEIGHTS[i];
    }
    if (scoreMajor > bestScore) {
      bestScore = scoreMajor;
      best = { tonic: tonic, mode: "major", name: KEY_NAMES[tonic] };
    }
    if (scoreMinor > bestScore) {
      bestScore = scoreMinor;
      best = { tonic: tonic, mode: "minor", name: KEY_NAMES[tonic] + "m" };
    }
  }

  return best;
}

// 大调 / 小调音阶的半音间隔(相对主音)
const SCALE_INTERVALS = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};

// 把一个 midi 音拉到最近的调内音
// 优先同八度,允许 ±1 八度调整以最小化距离
export function snapToScale(midi, key) {
  const intervals = SCALE_INTERVALS[key.mode] || SCALE_INTERVALS.major;
  const tonic = key.tonic || 0;

  // 当前音相对主音的 pitch class(0-11)
  const relPc = ((midi - tonic) % 12 + 12) % 12;

  // 在音阶内找最近的相对音级
  let bestInterval = intervals[0];
  let bestDistance = 99;
  for (const s of intervals) {
    let d = Math.abs(s - relPc);
    if (d > 6) d = 12 - d;
    if (d < bestDistance) {
      bestDistance = d;
      bestInterval = s;
    }
  }

  // 目标 pitch class(绝对值)
  const targetPc = (tonic + bestInterval) % 12;

  // 试 ±1 八度,挑距离 midi 最近的候选
  const baseOctave = Math.floor(midi / 12) * 12;
  const candidates = [
    baseOctave - 12 + targetPc,
    baseOctave + targetPc,
    baseOctave + 12 + targetPc,
  ];

  let chosen = candidates[1];
  let chosenDistance = Math.abs(candidates[1] - midi);
  for (let i = 0; i < candidates.length; i++) {
    const d = Math.abs(candidates[i] - midi);
    if (d < chosenDistance) {
      chosenDistance = d;
      chosen = candidates[i];
    }
  }
  return chosen;
}

// 调内和弦模板:返回相对主音的半音偏移
const CHORD_TEMPLATES = {
  I: [0, 4, 7],
  ii: [2, 5, 9],
  iii: [4, 7, 11],
  IV: [5, 9, 12],
  V: [7, 11, 14],
  vi: [9, 12, 16],
  vii: [11, 14, 17],
};

// 给主音和和弦模板,算出具体的 midi 音列表
// templateName: I / ii / iii / IV / V / vi / vii
export function chordNotes(rootMidi, templateName) {
  const offs = CHORD_TEMPLATES[templateName] || CHORD_TEMPLATES.I;
  const out = new Array(offs.length);
  for (let i = 0; i < offs.length; i++) {
    out[i] = rootMidi + offs[i];
  }
  return out;
}

// 调名列表导出(供 SVG 渲染时使用)
export { KEY_NAMES };

// 调名 (含 m 后缀) -> MIDI 调号字节(SF: -7 七个降号 到 +7 七个升号)
export function keySignatureSf(keyName) {
  const map = {
    C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, "F#": 6, "C#": 7,
    F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7,
  };
  return map[keyName] || 0;
}