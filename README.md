# Echo Chamber · 回声室 (v2)

你的三十下,一首你自己的曲子。本地算力 + 算法作曲。

## 怎么跑

```bash
node serve.js          # 起本地服务 http://127.0.0.1:8766/
```

## 玩法

- 进入页面,选一个音色(钢琴 / 八音盒 / Pad / 弦乐)
- 任意点击 30 次 — 每次位置决定音高(顶部高音,底部低音)
- 听自己的曲子被回放(经过算法优化)
- 命名 / 保存 / 分享 / 再来一首

## 技术优化(v2 升级)

### 1. Humanization · 人性化
每个音自动加:
- micro-timing offset (±15-28ms,基于设备)
- velocity 0.65-1.0 浮动(首音重、末音轻、中间起伏)
- duration 0.4-1.8s 基于音间距

**效果**:从"电子节拍器"变成"被弹"的琴键。

### 2. 调性检测 · Krumhansl-Schmuckler
自动检测 30 音的最可能调性(大调/小调)。

### 3. 智能和声
基于调性自动加:
- **Pad**:每个用户音下方加一个三和弦长音
- **Bass walking**(强设备):每 5 个音走一个 bass step

**效果**:从"单声部旋律"变成"有伴奏的小曲"。

### 4. 算法扩展
- **邻音填充**:在间隔 > 600ms 的两个音之间加 passing tone
- **末句收尾**(强设备):自动加 4 个音级进到主音

**效果**:从 ~10s 延展到 ~30s。

### 5. 结构化分句
30 音按时间间隔自动分成 4 个乐句,每句有 micro-crescendo。

### 6. 设备算力感知
用 `navigator.hardwareConcurrency` + `deviceMemory` 检测:
- **High**(4-5 分):完整算法链(humanization + harmony + expansion + walking bass)
- **Mid**(2-3 分):humanization + harmony(无 expansion)
- **Low**(0-1 分):只跑 humanization

**全程本地运行,不联网。**

### 7. 多音色
4 种 Web Audio 实时合成音色:
- 钢琴(triangle + sine 泛音 + sub bass)
- 八音盒(明亮 sine + 高泛音,长 release)
- Pad(双 sawtooth detune,长 attack/release)
- 弦乐(三 sawtooth detune + sub bass)

### 8. 多格式导出
- **PNG**:1080×1080 星座图(可发朋友圈)
- **SVG**:手写五线谱(可在浏览器或矢量编辑器打开)
- **WAV**:OfflineAudioContext 渲染(可在任何播放器播放)
- **MID**:标准 MIDI 文件(可在 GarageBand / Logic / FL Studio 打开)

## 文件

- `index.html` - 入口
- `style.css` - 样式
- `app.js` - 主交互逻辑
- `music.js` - 音乐理论 + 优化 + 导出
- `serve.js` - 本地 server

## demo

- `?demo=30` - 自动点 30 下
- `?demo=30&sheet=1` - 完成后自动展示乐谱
- `?demo=30` 后缀不同端口都 OK