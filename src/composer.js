/*
 * Echo Chamber / 回声室
 *
 * src/composer.js — 自动编曲
 *
 * humanize(人性化微变)、harmony(和声)、expand(算法扩展)、
 * structure(分句 + 动态),把用户原始 taps 加工成完整谱面。
 */

import { freqToMidi, midiToFreq, clamp } from "./util.js";
import { snapToScale, detectKey } from "./theory.js";

// 给每个 tap 加入微 timing / velocity / duration 变化
// 让机械的输入听起来像"被弹的琴键"
export function humanize(taps, level) {
  if (!taps || taps.length === 0) return [];

  // 按设备算力分级:high/mid/low 偏移幅度不同
  const timingAmp = level === "high" ? 28 : level === "mid" ? 22 : 12;
  const velMin = 0.62;
  const velRange = 0.32;

  return taps.map(function (tap, i) {
    // micro-timing offset,左右对称
    const tOffset = (Math.random() - 0.5) * 2 * timingAmp;

    // velocity:首音重、末音轻、中段起伏、顶点稍重
    let velocity = velMin + Math.random() * velRange;
    if (i === 0) velocity = 0.92;
    else if (i === taps.length - 1) velocity = 0.55;
    else if (i === Math.floor(taps.length / 2)) velocity = 0.95;

    // duration:和前后音的间距成反比,边缘用兜底值
    const prevT = i > 0 ? taps[i - 1].t : tap.t - 280;
    const nextT = i < taps.length - 1 ? taps[i + 1].t : tap.t + 700;
    const gap = (nextT - prevT) / 1000;
    let duration = clamp(gap * 0.85, 0.35, 1.8);
    duration *= 0.88 + Math.random() * 0.24;

    return Object.assign({}, tap, {
      t: tap.t + tOffset,
      velocity: velocity,
      duration: duration,
    });
  });
}

// 在旋律上添加 pad(长音)和偶尔 bass walking
export function generateHarmony(melody, key, level) {
  if (level === "low" || !melody || melody.length === 0) return [];

  const out = [];
  // 和弦进行按 5 个一组循环
  const chordOrder = ["I", "vi", "IV", "V", "I"];
  let chordIdx = 0;

  for (let i = 0; i < melody.length; i++) {
    if (i > 0 && i % 4 === 0) {
      chordIdx = (chordIdx + 1) % chordOrder.length;
    }

    const tap = melody[i];
    const tapMidi = Math.round(freqToMidi(tap.freq));
    // 把 melody 音拉到调内,作为 pad 的根音参考
    const chordRoot = snapToScale(tapMidi, key);

    // pad: 每个旋律音都加一个低八度长音
    const dur = i < melody.length - 1
      ? (melody[i + 1].t - tap.t) / 1000 + 0.3
      : 1.8;
    out.push({
      type: "pad",
      voice: "pad",
      t: tap.t,
      freq: midiToFreq(chordRoot - 12),
      duration: clamp(dur, 0.8, 3.5),
      velocity: 0.085,
      color: tap.color,
    });

    // walking bass: 仅 high 档,每 5 个音走一次
    if (i > 0 && i % 5 === 0 && level === "high") {
      const prevBass = out[out.length - 1].type === "bass"
        ? out[out.length - 1]
        : null;
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

// 算法扩展:邻音填充 + 末句收尾
export function expandComposition(melody, key, level) {
  if (level === "low" || !melody || melody.length < 4) return [];
  const out = [];

  // 1. 邻音填充:间隔 > 600ms 且音高差 > 3 半音,中间加一个通过音
  for (let i = 0; i < melody.length - 1; i++) {
    const gap = melody[i + 1].t - melody[i].t;
    if (gap > 600) {
      const m1 = Math.round(freqToMidi(melody[i].freq));
      const m2 = Math.round(freqToMidi(melody[i + 1].freq));
      if (Math.abs(m2 - m1) > 3) {
        const mid = Math.round((m1 + m2) / 2);
        out.push({
          type: "passing",
          voice: "melody",
          t: melody[i].t + gap / 2,
          freq: midiToFreq(snapToScale(mid, key)),
          duration: 0.35,
          velocity: 0.55,
          color: melody[i].color,
        });
      }
    }
  }

  // 2. 末句收尾:把最后一个音级进到主音(仅 high 档)
  if (level === "high" && melody.length >= 6) {
    const last = melody[melody.length - 1];
    const lastMidi = Math.round(freqToMidi(last.freq));
    const tonicMidi = snapToScale(60 + key.tonic, key);

    let cur = lastMidi;
    const totalSteps = 4;
    const stepInterval = 320;
    for (let i = 1; i <= totalSteps; i++) {
      const diff = tonicMidi - cur;
      const dir = diff >= 0 ? 1 : -1;
      const remain = totalSteps - i + 1;
      const step = Math.max(1, Math.round(Math.abs(diff) / remain));
      cur = cur + dir * step;
      const snapped = snapToScale(cur, key);
      out.push({
        type: "tail",
        voice: "melody",
        t: last.t + i * stepInterval,
        freq: midiToFreq(snapped),
        duration: i === totalSteps ? 1.4 : 0.5,
        velocity: i === totalSteps ? 0.7 : 0.5,
        color: last.color,
      });
    }
  }

  return out;
}

// 按时间间隔自动分句,给每句内 tap 加动态(0→1→0 拱形)
// 不修改原数组,返回 phrases(每个 phrase 仍是 melody 对象的引用)
export function structure(melody) {
  if (!melody || melody.length === 0) return [];

  const GAP_MS = 550;
  const phrases = [[]];
  for (let i = 0; i < melody.length; i++) {
    const tap = melody[i];
    const cur = phrases[phrases.length - 1];
    if (cur.length > 0) {
      const prev = cur[cur.length - 1];
      if (tap.t - prev.t > GAP_MS) phrases.push([]);
    }
    phrases[phrases.length - 1].push(tap);
  }

  // 给每句内 tap.velocity 加动态拱形
  const totalPhrases = phrases.length;
  for (let pIdx = 0; pIdx < phrases.length; pIdx++) {
    const phrase = phrases[pIdx];
    const dynamicScale = pIdx === totalPhrases - 1 ? 0.85 : 1.0;
    for (let i = 0; i < phrase.length; i++) {
      const localT = i / Math.max(1, phrase.length - 1);
      const arc = Math.sin(localT * Math.PI);
      const base = phrase[i].velocity != null ? phrase[i].velocity : 0.8;
      phrase[i].velocity = base * (0.85 + arc * 0.2) * dynamicScale;
    }
  }

  return phrases;
}

// 一站式:接 taps(用户输入),返回完整乐谱数据
export function compose(taps, instrument, level) {
  if (!taps || taps.length === 0) {
    return {
      melody: [],
      harmony: [],
      expansion: [],
      phrases: [],
      key: { tonic: 0, mode: "major", name: "C" },
      instrument: instrument,
      device: { level: level },
    };
  }

  // humanize / 调性 / 和声 / 扩展 / 分句,顺序敏感
  const melody = humanize(taps, level);
  const key = detectKey(melody.map(function (m) { return m.freq; }));
  // 和声与扩展不读 melody.velocity,只读 freq 和 t
  const harmony = generateHarmony(melody, key, level);
  const expansion = expandComposition(melody, key, level);
  // structure 会 mutate melody[i].velocity(动态拱形),放在最后
  const phrases = structure(melody);

  return {
    melody: melody,
    harmony: harmony,
    expansion: expansion,
    phrases: phrases,
    key: key,
    instrument: instrument,
    device: { level: level },
  };
}

// 给定节奏点 + 力度,反算单次播放的最终音长(用于 OfflineAudioContext 渲染时对齐)
// 这里保留 composer 内部约定:每个 melody 音的 duration 已经是带 fade 的最终值
export function noteEndTime(note) {
  return note.t + (note.duration || 1.6) * 1000;
}

// 一组 notes 的最大结束时间 + 拖尾
export function compositionEndMs(notes, tailMs) {
  tailMs = tailMs || 1500;
  let max = 0;
  for (const n of notes) {
    const end = noteEndTime(n);
    if (end > max) max = end;
  }
  return max + tailMs;
}