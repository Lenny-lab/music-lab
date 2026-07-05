# Echo Chamber · 回声室

> 你的三十下,一首你自己的曲子。  本地算法作曲,Web Audio 实时合成 + 多格式导出。

## 怎么跑

```bash
node serve.js
# 浏览器打开 http://127.0.0.1:8766/
```

## 玩法

1. 进入页面,选一个音色(钢琴 / 八音盒 / Pad / 弦乐)
2. 在屏幕上点 30 下 — 每次位置决定音高(顶部高音,底部低音)
3. 听自己的曲子被回放(经过算法优化:humanize / harmony / 末句收尾)
4. 命名 / 保存 / 分享 / 再来一首

## 演示模式

```
?demo=30            30 下自动 tap,每下 1.2s
?demo=30&fast=1     快速 demo,每下 60ms
?sheet=1            完成后直接显示乐谱 SVG(覆盖全屏)
?track=1            完成后直接显示轨迹 SVG
```

组合示例:`?demo=30&fast=1&sheet=1`

## 文件结构

```
index.html          入口
style.css           样式
serve.js            本地 HTTP server

src/
  main.js           主控:状态机 + DOM + 演奏调度 + 演示
  util.js           基础工具:频率/MIDI 转换、设备检测、文本格式化
  theory.js         音乐理论:调性检测、调内音吸附、和弦模板
  composer.js       自动编曲:humanize / harmony / expand / structure
  synth.js          音色库 + 实时/离线音频调度
  render.js         Canvas 渲染:背景、舞台、halo
  svg.js            SVG 渲染:五线谱、轨迹连线
  export.js         文件导出:PNG / SVG / MP3 / MIDI

vendor/
  lame.min.js       MP3 编码器(本地离线,CDN 兜底)

LICENSE             MIT
```

## 技术要点

### 1. 演奏调度(Web Audio 精确时间)
每个 note 在它自己的相对时间 `t` 处调度,而不是固定间隔的 `setTimeout` 链。
这样 melody / harmony / expansion 三层在 audio context 内部严格同步,误差在 sample 级。

### 2. Humanize
微 timing offset (±15-28ms) + velocity 起伏(首音重/末音轻/中段拱形) + duration 跟间距联动。
让"被播的电子节拍器"变成"被弹的琴键"。

### 3. 调性检测
Krumhansl-Schmuckler:把 30 音折叠到 12 个 pitch class,跟大调/小调模板做相关性打分,选最大者。

### 4. 智能和声
- **Pad**:每个旋律音下方加一个低八度长音(三和弦 root)
- **Bass walking**(high 档):每 5 个音走一个 bass step
- 调内音吸附保证 pad 听起来"在调里"

### 5. 算法扩展
- **邻音填充**:间隔 > 600ms 且音高差 > 3 半音,中间加一个 passing tone
- **末句收尾**(high 档):把最后一个音级进到主音,4 步走完

### 6. 设备算力感知
- **High**(4-5 分):完整算法链
- **Mid**(2-3 分):跳过扩展
- **Low**(≤1 分):只做 humanize

### 7. 4 种音色合成
钢琴(triangle + sine 泛音 + sub)、八音盒(明亮 sine + 高泛音 + 长 release)、
Pad(双 sawtooth detune + 长 attack)、弦乐(三 sawtooth detune + sub)。
都是实时 Web Audio 合成,零外部音源。

### 8. 多格式导出
- **PNG**(1080×1080 星座图)
- **轨迹 SVG**(30 个触点按序连成平滑 bezier,带编号、起手点光环、渐变描边)
- **乐谱 SVG**(手写五线谱,多 stave,8 音/行,高音谱号 + 4/4 拍号 + 终止线 + 升降号 + 加线)
- **MP3**(OfflineAudioContext 渲染 + lamejs 本地编码,128kbps)
- **MIDI**(format 0,带调号、拍号、Program Change,可在 GarageBand / Logic / FL Studio 打开)

## 浏览器兼容

需要支持 ES Modules(Chrome 89+ / Firefox 108+ / Safari 16.4+)、
Web Audio API、OfflineAudioContext、`<canvas>`、`<svg>`。

## 许可

MIT
