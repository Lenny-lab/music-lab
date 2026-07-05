/*
 * Echo Chamber / 回声室
 *
 * src/synth.js — 音色合成
 *
 * 4 种 Web Audio 实时合成音色(钢琴 / 八音盒 / Pad / 弦乐)
 * 每个音色由若干 oscillator + 包络 + filter 组成。
 * playAt 是唯一出口:实时和 OfflineAudioContext 共用一份调度逻辑。
 */

// 音色库
//   voices:  振荡器叠加,mult 是基频倍数,gain 是该 osc 的相对音量,detune 单位 cent
//   filter:  lowpass,open 是起始频率(Hz),close 是 60% 时长后衰减到的频率
//   env:     attack / sustain / release(秒)
//   peak:    总峰值音量,会被 note.velocity 再次缩放
//   program: MIDI General MIDI program(0-127),导出 MIDI 时给对应通道
export const INSTRUMENTS = {
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
    program: 0,
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
    program: 10,
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
    program: 88,
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
    program: 48,
  },
};

// 在指定 AudioContext 上调度一个音
// t0 是绝对时间(秒),实时调用方传 ctx.currentTime,离线调用方传 note.t/1000
// t0 会被 clamp 到非负(OfflineAudioContext 拒绝负 t0)
export function playAt(ctx, instrumentName, freq, t0, dur, vel) {
  const ins = INSTRUMENTS[instrumentName];
  if (!ins || !ctx) return;
  if (!isFinite(t0) || t0 < 0) t0 = 0;
  if (!isFinite(freq) || freq <= 0) return;
  const peakV = (vel != null ? vel : 0.8) * (ins.peak || 0.15);
  const durS = dur || ins.duration;

  // 低通滤波器:从 open 频率衰到 close 频率,模拟乐器自然暗化
  const filter = ctx.createBiquadFilter();
  filter.type = ins.filter.type;
  filter.Q.value = ins.filter.q;
  filter.frequency.setValueAtTime(ins.filter.open, t0);
  filter.frequency.exponentialRampToValueAtTime(
    Math.max(ins.filter.close, 80),
    t0 + durS * 0.6
  );

  // 简化的 ADSR 包络:attack → sustain → 自然衰减到 0
  const main = ctx.createGain();
  main.gain.setValueAtTime(0, t0);
  main.gain.linearRampToValueAtTime(peakV, t0 + ins.env.a);
  main.gain.exponentialRampToValueAtTime(peakV * ins.env.s, t0 + ins.env.a + 0.1);
  main.gain.exponentialRampToValueAtTime(0.001, t0 + durS);

  // 多振荡器叠加
  for (const v of ins.voices) {
    const osc = ctx.createOscillator();
    osc.type = v.type;
    osc.frequency.value = freq * v.mult;
    if (v.detune) osc.detune.value = v.detune;
    const g = ctx.createGain();
    g.gain.value = v.gain;
    osc.connect(g).connect(filter);
    osc.start(t0);
    osc.stop(t0 + durS + 0.05);
  }

  filter.connect(main).connect(ctx.destination);
}

// 立刻播放(相对当前时间)
export function playNow(ctx, instrumentName, freq, when, dur, vel) {
  return playAt(
    ctx,
    instrumentName,
    freq,
    ctx.currentTime + (when || 0),
    dur,
    vel
  );
}