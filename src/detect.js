/**
 * src/detect.js —— 场景干扰物检测与分类（真实读像素，不掷骰子）
 *
 * 上一版 Cleanup 的「色框」是假的：heuristicCandidates(W, H) 只看画布宽高，
 * 用算术取模随机撒 5 个框再随机贴一个类别标签 —— 图片内容一个像素都没读过，
 * 所以「把汽车认成树、把柱子认成人」是必然结果，不是偶发 bug。
 *
 * 本模块按下面这条链路真实计算（纯函数，Node 侧可做像素级回归测试）：
 *
 *   ① 语义掩膜     肤色（RGB 规则 ∧ YCbCr 规则）、植被（绿度超额指数）、天空
 *   ② 稀有色判别   4bit 量化直方图 + **行占用率**：立面/幕墙的重复色会在大量行出现
 *                  （→ 建筑本体），只在少数行出现的 localized 色块（→ 干扰物）
 *   ③ 连通域标记   8 邻域 BFS，单遍统计dfracfore 面积/包围盒/像素构成/色差/边缘密度
 *   ④ 特征打分     竖高比、填充率、面积占比、贴地性、颜色方差、类别像素占比
 *   ⑤ 合并与过滤   同类框膨胀合并（头+身分离的情况），剔掉过大（那是建筑本身）
 *   ⑥ 尺度复核     用人 ≈ 1.7 m 反推 px/m，再回头检查车高是否落在 1.2–2.3 m、
 *                  树高是否 ≥ 1.5 m；不在物理范围内的判定降权或改判
 *
 * 输出每个框不僅给类别，还给**置信度和判定理由**，并且在 UI 上允许人工改判 ——
 * 识别错了必须能被当场纠正，而不是让用户接受一个黑盒结论。
 */

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const r2 = (v) => Math.round(v * 100) / 100

/* ══ 干扰物类别 ══
   plain 字段是给非专业用户看的一句话解释（与 glossary.js 同源风格）。 */
export const DETECT_KINDS = [
  {
    id: 'person',
    label: '人物',
    color: '#9a3412',
    plain: '照片里走动或站立的人。它不是建筑的一部分，留着会被算法当成「细柱子」参与尺度推算。',
    why: '人是最常用的免费标尺：成年人约 1.7 m，所以既可擦除也可反推比例尺。',
  },
  {
    id: 'vehicle',
    label: '车辆',
    color: '#7c2d12',
    plain: '汽车、自行车、电动车等。它们贴在地上，经常被误判成「一层门洞」或「台阶」。',
    why: '车高通常 1.4–1.9 m，正好像一层门洞的高度，是最容易污染 = 尺度推断的干扰物。',
  },
  {
    id: 'vegetation',
    label: '植被',
    color: '#4d7c0f',
    plain: '树、灌木、草坪、花坛。遮挡立面时会让算法把「最后一层的窗」读丢。',
    why: '植被是最容易被误分类的一类：它的颜色鲜明但形状不定，因此单独走绿度通道判定。',
  },
  {
    id: 'furniture',
    label: '街道家具',
    color: '#57534e',
    plain: '长椅、垃圾桶、路灯、消火栓、遮阳伞等地面上的小物件。',
    why: '它们贴地、体积小，容易被当成台阶踏步或勒脚，从而污染首层标高推断。',
  },
  {
    id: 'misc',
    label: '其他杂物',
    color: '#78716c',
    plain: '不属于上面几类、但明显不属于建筑本体的物体（围挡、施工架、临时标牌等）。',
    why: '置信度低的框默认落到这里，宁可标「不确定」也不要假装认得。',
  },
]

export const KIND_MAP = Object.fromEntries(DETECT_KINDS.map((k) => [k.id, k]))
export const kindLabel = (id) => KIND_MAP[id]?.label || '未分类'
export const kindColor = (id) => KIND_MAP[id]?.color || '#78716c'

/* ══ ① 语义掩膜 ══ */

/** 肤色：RGB 规则（Kovac）∧ YCbCr 规则，双票制。
    只用一个规则时，米黄色外墙和木饰面会大量误判成人（这是上一版错判的主因之一）。 */
export function isSkinRGB(r, g, b) {
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  return r > 95 && g > 40 && b > 20 && mx - mn > 15 && Math.abs(r - g) > 15 && r > g && r > b
}
export function isSkinYCbCr(r, g, b) {
  const y = 0.299 * r + 0.587 * g + 0.114 * b
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b
  return y > 80 && cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173
}
export function hueDeg(r, g, b) {
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  if (mx === mn) return 0
  const d = mx - mn
  let h
  if (mx === r) h = ((g - b) / d) % 6
  else if (mx === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  h *= 60
  return h < 0 ? h + 360 : h
}

/** 第三道票：HSV 色相/饱和度窗口。
    前两票（RGB + YCbCr）区分不了「米黄石材」和「浅色皮肤」——两者的 Cr/Cb 落点很近，
    真正拉开距离的是**色相**：肤色集中落在 0–25°（偏橙），石材是 ~43°（偏黄）。
    同理，饱和上限 0.50 用来排除红砖（0.58）一类低识别度红褐色。 */
export function isSkinHSV(r, g, b) {
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  const sat = mx === 0 ? 0 : (mx - mn) / mx
  const hue = hueDeg(r, g, b)
  return hue <= 25 && sat >= 0.12 && sat <= 0.5 && mx >= 90
}
export const isSkin = (r, g, b) => isSkinRGB(r, g, b) && isSkinYCbCr(r, g, b) && isSkinHSV(r, g, b)

/** 植被：绿度超额指数 ExG = 2G − R − B，配合相对绿优势
    （避免把青灰玻璃幕墙误判成植被 —— 幕墙反而是 R/B 偏高的冷色）。 */
export function isVegetation(r, g, b) {
  const exg = 2 * g - r - b
  return exg > 16 && g > r * 1.07 && g > b * 1.07 && g > 32
}

/** 天空：偏蓝、明亮、低饱和。用于定地平线。 */
export function isSky(r, g, b) {
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  return b > r + 6 && mx > 145 && mx - mn < 78
}

export function hsvSaturation(r, g, b) {
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  return mx === 0 ? 0 : (mx - mn) / mx
}

/** 一次遍历生成三张语义掩膜 */
export function semanticMasks({ data, W, H }) {
  const n = W * H
  const skin = new Uint8Array(n)
  const veg = new Uint8Array(n)
  const sky = new Uint8Array(n)
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = data[p]
    const g = data[p + 1]
    const b = data[p + 2]
    if (isSkin(r, g, b)) skin[i] = 1
    if (isVegetation(r, g, b)) veg[i] = 1
    if (isSky(r, g, b)) sky[i] = 1
  }
  return { skin, veg, sky }
}

/* ══ ② 稀有色判别：把「重复立面图案」与「局部物体」分开 ══
   三条判别：
   A. 面积判据  count/N > 5%          → 必然是大面材质（墙面 / 天空 / 玻璃）
   B. 重复判据  该色在 ≥3 段互不相邻的行簇里出现（runs ≥ 3）
                                      → 立面窗阵列 / 楼层线 / 幕墙分格，是建筑本体
   C. 散布判据  同时在 >15% 行 **且** >8% 列上出现 → 沿两个方向摊开的材质
   （只满足其一不行：路灯竖着占满很多行，但只占极少数列 → 仍是物体）
   三条都不满足，才进入「颜色族传播」做最后一道防渐变误报。 */
export const RARE_COUNT_MAX = 0.05
export const RARE_ROW_SPAN = 0.15
export const RARE_COL_SPAN = 0.08
export const RARE_RUNS_MAX = 3

export function colorStats({ data, W, H }, opts = {}) {
  const cntMax = opts.cntMax ?? RARE_COUNT_MAX
  const rowSpanMax = opts.rowSpanMax ?? RARE_ROW_SPAN
  const colSpanMax = opts.colSpanMax ?? RARE_COL_SPAN
  const n = W * H
  const counts = new Int32Array(4096)
  const rowSeen = new Int32Array(4096)
  const colSeen = new Int32Array(4096)
  const runs = new Int32Array(4096) // 连续行簇数量：识别「阵列式重复」
  const rowMark = new Int32Array(4096).fill(-1) // 本行是否已计过
  const rowLast = new Int32Array(4096).fill(-1) // 上一次出现的行号
  const colMark = new Int32Array(4096).fill(-1)

  /* 行主序一趟：count / rowSeen / runs */
  for (let y = 0, i = 0; y < H; y++) {
    for (let x = 0; x < W; x++, i++) {
      const p = i * 4
      const key = ((data[p] >> 4) << 8) | ((data[p + 1] >> 4) << 4) | (data[p + 2] >> 4)
      counts[key]++
      if (rowMark[key] !== y) {
        rowMark[key] = y
        rowSeen[key]++
        if (rowLast[key] !== y - 1) runs[key]++
        rowLast[key] = y
      }
    }
  }
  /* 列主序一趟：colSeen（行主序扫描拿不到「某色出现在多少列」） */
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      const p = (y * W + x) * 4
      const key = ((data[p] >> 4) << 8) | ((data[p + 1] >> 4) << 4) | (data[p + 2] >> 4)
      if (colMark[key] !== x) {
        colMark[key] = x
        colSeen[key]++
      }
    }
  }

  const isRare = new Uint8Array(4096)
  for (let k = 0; k < 4096; k++) {
    if (!counts[k]) continue
    const rowSpan = rowSeen[k] / H
    const colSpan = colSeen[k] / W
    const frac = counts[k] / n
    const hugeArea = frac > cntMax
    const repeated = runs[k] >= RARE_RUNS_MAX
    const spreadBoth = rowSpan > rowSpanMax && colSpan > colSpanMax
    isRare[k] = hugeArea || repeated || spreadBoth ? 0 : 1
  }

  /* 颜色族传播：真实照片有光影渐变，同一材质会散落到相邻色箱里。
     若某色箱的 26 邻域中存在「大面积」同类色（≥1.5% 画面），
     说明它属于某个大材质的边缘渐变，不算局部物体。缺这一步，
     带渐变的幕墙 / 石材会被整片误报成干扰物。 */
  const bigFam = new Uint8Array(4096)
  for (let k = 0; k < 4096; k++) if (counts[k] / n >= 0.015) bigFam[k] = 1
  const out = new Uint8Array(isRare)
  for (let k = 0; k < 4096; k++) {
    if (!out[k]) continue
    const r0 = (k >> 8) & 15
    const g0 = (k >> 4) & 15
    const b0 = k & 15
    for (let dr = -1; dr <= 1; dr++) {
      for (let dg = -1; dg <= 1; dg++) {
        for (let db = -1; db <= 1; db++) {
          const r1 = r0 + dr
          const g1 = g0 + dg
          const b1 = b0 + db
          if (r1 < 0 || r1 > 15 || g1 < 0 || g1 > 15 || b1 < 0 || b1 > 15) continue
          const j = (r1 << 8) | (g1 << 4) | b1
          if (bigFam[j]) {
            out[k] = 0
            dr = dg = db = 2
          }
        }
      }
    }
  }
  return { counts, rowSeen, colSeen, runs, isRare: out }
}

/* ══ 边缘能量 ══ */
export function gradientEnergy({ data, W, H }) {
  const n = W * H
  const gray = new Float32Array(n)
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    gray[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]
  }
  const mag = new Float32Array(n)
  let sum = 0
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x
      const gx = gray[i + 1] - gray[i - 1]
      const gy = gray[i + W] - gray[i - W]
      const m = Math.abs(gx) + Math.abs(gy)
      mag[i] = m
      sum += m
    }
  }
  const mean = sum / n || 1
  return { gray, mag, mean }
}

/** 地平线：从上往下扫，取「天空像素占比仍 > 50%」的最后一行 */
export function findHorizon(sky, W, H) {
  let last = -1
  for (let y = 0; y < H; y++) {
    let c = 0
    for (let x = 0; x < W; x++) if (sky[y * W + x]) c++
    if (c / W > 0.5) last = y
  }
  return last < 0 ? Math.round(H * 0.3) : Math.min(last, Math.round(H * 0.85))
}

/* ══ ③ 连通域标记（8 邻域，迭代栈避免递归爆栈） ══ */
export function labelComponents(mask, W, H, minArea = 1) {
  const n = W * H
  const labels = new Int32Array(n).fill(-1)
  const out = []
  const stack = []
  for (let s = 0; s < n; s++) {
    if (!mask[s] || labels[s] >= 0) continue
    const id = out.length
    const comp = {
      id,
      area: 0,
      minX: W,
      minY: H,
      maxX: -1,
      maxY: -1,
      skinCnt: 0,
      vegCnt: 0,
      rareCnt: 0,
      sumSat: 0,
      sumSat2: 0,
      edgeSum: 0,
    }
    stack.push(s)
    labels[s] = id
    while (stack.length) {
      const i = stack.pop()
      const x = i % W
      const y = (i / W) | 0
      comp.area++
      if (x < comp.minX) comp.minX = x
      if (x > comp.maxX) comp.maxX = x
      if (y < comp.minY) comp.minY = y
      if (y > comp.maxY) comp.maxY = y
      const nb = [
        i - 1, i + 1, i - W, i + W,
        i - W - 1, i - W + 1, i + W - 1, i + W + 1,
      ]
      for (let k = 0; k < 8; k++) {
        const j = nb[k]
        if (j < 0 || j >= n) continue
        /* 防止跨行环绕 */
        if (k >= 2 && Math.abs((j % W) - x) > 1) continue
        if (mask[j] && labels[j] < 0) {
          labels[j] = id
          stack.push(j)
        }
      }
    }
    if (comp.area >= minArea) out.push(comp)
  }
  return { labels, comps: out }
}

/* ══ ④ 逐连通域特征 + 打分 ══ */

/** 把硬判据写成「区间贴合度」而不是一刀切，便于累积置信度 */
function band(v, lo, hi, soft = 0.35) {
  if (v >= lo && v <= hi) return 1
  const d = v < lo ? lo - v : v - hi
  const span = (hi - lo) * soft || 1
  return clamp(1 - d / span, 0, 1)
}

export function classifyRegion(f) {
  const R = []
  /* 竖高比 h/w：人 1.6–4.5；车侧视约 0.4–0.75；路灯可达 6+ */
  const aspect = f.h / Math.max(1, f.w)
  /* 填充率：人/柱细长但连续，树冠蓬松，车是实心盒子 */
  const fill = f.area / Math.max(1, f.w * f.h)
  const areaFrac = f.area / f.N

  const skinFrac = f.skinCnt / Math.max(1, f.area)
  const vegFrac = f.vegCnt / Math.max(1, f.area)
  const nearBottom = f.bottomGap <= Math.max(2, f.H * 0.035) ? 1 : band(f.bottomGap, 0, f.H * 0.35, 0.8)

  /* ── 植被：绿度通道主导，这条最不容易误判 ── */
  if (vegFrac > 0.4 && f.area >= 30) {
    let s = 0.5 + 0.25 * band(vegFrac, 0.5, 1) + 0.1 * band(areaFrac, 0.0005, 0.3) + 0.15 * band(fill, 0.2, 1.0, 0.5)
    R.push(`绿度像素 ${Math.round(vegFrac * 100)}%`)
    R.push(`填充率 ${r2(fill)}（枝叶蓬松）`)
    if (nearBottom > 0.5) R.push('底部落地')
    return { kind: 'vegetation', score: clamp(s, 0, 1), reasons: R, feature: { aspect, fill, areaFrac, vegFrac } }
  }

  /* ── 人物：肤色 + 细长 + 贴地 ── */
  const personParts = []
  if (skinFrac > 0.04) {
    personParts.push(0.42 * band(skinFrac, 0.06, 0.6, 0.5))
    R.push(`肤色像素 ${Math.round(skinFrac * 100)}%`)
  }
  personParts.push(0.28 * band(aspect, 1.5, 4.6, 0.5))
  personParts.push(0.16 * band(areaFrac, 0.0003, 0.05, 0.6))
  personParts.push(0.14 * nearBottom)
  const personScore = skinFrac > 0.04 ? personParts.reduce((a, b) => a + b, 0) : 0

  /* ── 车辆：矮宽、贴地、漆面颜色一致 ── */
  const uniform = clamp(1 - f.satStd * 3.2, 0, 1) // 车漆是平涂的，色差小
  const chromaticFire = f.meanSat > 0.18 || (f.meanV < 0.5 && f.meanSat < 0.3) // 彩漆 or 深色
  const carScore =
    vegFrac < 0.12 && skinFrac < 0.06
      ? 0.3 * band(aspect, 0.3, 0.9, 0.5) +
        0.18 * band(areaFrac, 0.002, 0.07, 0.6) +
        0.2 * nearBottom +
        0.18 * uniform +
        0.14 * (chromaticFire ? 1 : 0.3)
      : 0

  /* ── 街道家具：贴地的小件；细高者为路灯/消火栓，矮扁者为长椅/垃圾桶 ── */
  const furnitureScore =
    vegFrac < 0.25 && skinFrac < 0.08 && areaFrac < 0.02
      ? 0.3 * nearBottom +
        0.25 * (aspect > 3.5 ? band(aspect, 4, 14, 0.6) : band(aspect, 0.4, 1.6, 0.5)) +
        0.25 * band(areaFrac, 0.0002, 0.012, 0.6) +
        0.2 * uniform
      : 0

  const cands = [
    { kind: 'person', score: personScore },
    { kind: 'vehicle', score: carScore },
    { kind: 'furniture', score: furnitureScore },
  ].sort((a, b) => b.score - a.score)

  const best = cands[0]
  if (!best || best.score < 0.28) {
    R.push(`竖高比 ${r2(aspect)} · 填充率 ${r2(fill)}`)
    R.push(vegFrac > 0.1 ? `含少量绿色 ${Math.round(vegFrac * 100)}%` : '无明确类别特征')
    return { kind: 'misc', score: clamp(Math.max(best?.score || 0, 0.15), 0, 1), reasons: R, feature: { aspect, fill, areaFrac, vegFrac } }
  }
  if (best.kind === 'person') {
    if (aspect >= 1.2) R.push(`竖高比 ${r2(aspect)}（人形区间）`)
    R.push(`占画面 ${(areaFrac * 100).toFixed(2)}%`)
    if (nearBottom > 0.5) R.push('底部贴地')
  } else if (best.kind === 'vehicle') {
    R.push(`竖高比 ${r2(aspect)}（侧视车身偏扁）`)
    R.push(`漆面色差 σ=${r2(f.satStd)}（平涂）`)
    if (nearBottom > 0.5) R.push('底部贴地')
  } else {
    R.push(aspect > 3.5 ? `细高比 ${r2(aspect)}（灯杆类）` : `矮扁 ${r2(aspect)}（长椅/桶类）`)
    if (nearBottom > 0.5) R.push('底部贴地')
  }
  return { kind: best.kind, score: clamp(best.score, 0, 1), reasons: R, feature: { aspect, fill, areaFrac, vegFrac } }
}

/* ══ 主入口 ══ */
export function detectObjects(px, opts = {}) {
  const { data, W, H } = px
  if (!data || !W || !H) return { boxes: [], stats: null }
  const N = W * H

  const { skin, veg, sky } = semanticMasks(px)
  const { isRare } = colorStats(px, opts)
  const { mag } = gradientEnergy(px)
  const horizonY = opts.horizonY ?? findHorizon(sky, W, H)

  /* 前景掩膜：语义掩膜 ∪（稀有色 ∧ 有明显色或偏暗 ∧ 非天空 ∧ 在地平线以下） */
  const fg = new Uint8Array(N)
  const vegRowLimit = Math.round(horizonY * 0.45)
  for (let y = 0, i = 0; y < H; y++) {
    for (let x = 0; x < W; x++, i++) {
      const p = i * 4
      const key = ((data[p] >> 4) << 8) | ((data[p + 1] >> 4) << 4) | (data[p + 2] >> 4)
      if (veg[i] && y >= vegRowLimit) {
        fg[i] = 1
        continue
      }
      if (skin[i]) {
        fg[i] = 1
        continue
      }
      if (sky[i] || y < horizonY) continue
      if (!isRare[key]) continue
      const r = data[p]
      const g = data[p + 1]
      const b = data[p + 2]
      const sat = hsvSaturation(r, g, b)
      const v = Math.max(r, g, b) / 255
      if (sat > 0.12 || v < 0.55) fg[i] = 1
    }
  }

  const minArea = Math.max(opts.minArea ?? 24, Math.round(N * 0.00018))
  const { comps } = labelComponents(fg, W, H, minArea)

  /* 逐团统计 → 特征 */
  const feats = []
  for (const c of comps) {
    const w = c.maxX - c.minX + 1
    const h = c.maxY - c.minY + 1
    let sumSat = 0
    let sumSat2 = 0
    let sumV = 0
    let edgeSum = 0
    let cnt = 0
    /* 包围盒遍历：统计颜色方差（车漆平涂 vs 枝叶纹理）与边缘密度 */
    for (let y = c.minY; y <= c.maxY; y++) {
      for (let x = c.minX; x <= c.maxX; x++) {
        const i = y * W + x
        const p = i * 4
        const s = hsvSaturation(data[p], data[p + 1], data[p + 2])
        sumSat += s
        sumSat2 += s * s
        sumV += Math.max(data[p], data[p + 1], data[p + 2]) / 255
        edgeSum += mag[i]
        cnt++
      }
    }
    const meanSat = sumSat / Math.max(1, cnt)
    const satStd = Math.sqrt(Math.max(0, sumSat2 / Math.max(1, cnt) - meanSat * meanSat))
    const f = {
      x: c.minX,
      y: c.minY,
      w,
      h,
      area: c.area,
      bottomGap: H - 1 - c.maxY,
      meanSat,
      satStd,
      meanV: sumV / Math.max(1, cnt),
      edgeDensity: edgeSum / Math.max(1, cnt),
      N,
      W,
      H,
    }
    feats.push(f)
  }

  /* skinCnt / vegCnt / rareCnt 需要回填（labelComponents 里没有 data，这里补统计） */
  for (const f of feats) {
    let skinCnt = 0
    let vegCnt = 0
    for (let y = f.y; y < f.y + f.h; y++) {
      for (let x = f.x; x < f.x + f.w; x++) {
        const i = y * W + x
        const p = i * 4
        if (isSkin(data[p], data[p + 1], data[p + 2])) skinCnt++
        if (isVegetation(data[p], data[p + 1], data[p + 2])) vegCnt++
      }
    }
    f.skinCnt = skinCnt
    f.vegCnt = vegCnt
    f.skinFrac = skinCnt / Math.max(1, f.area)
    f.vegFrac = vegCnt / Math.max(1, f.area)
  }

  const raw = []
  for (const f of feats) {
    /* 太大 → 那是建筑本体，不是干扰物 */
    const areaFrac = f.area / N
    if (areaFrac > 0.34) continue
    if (f.vegFrac < 0.4 && areaFrac > 0.22) continue
    if (f.w < 4 || f.h < 4) continue
    const cls = classifyRegion(f)
    if (!cls) continue
    raw.push({
      id: `d${raw.length}`,
      kind: cls.kind,
      score: cls.score,
      reasons: cls.reasons,
      feature: cls.feature,
      x: f.x,
      y: f.y,
      w: f.w,
      h: f.h,
      area: f.area,
      areaFrac,
      bottomGap: f.bottomGap,
      meanV: f.meanV,
      corrected: false,
    })
  }

  /* ⑤ 同类框膨胀合并：解决「头（肤色）与身体（衣服）被切成两团」 */
  const boxes = mergeSameKind(raw, 6)
  boxes.sort((a, b) => b.score - a.score)

  /* ⑥ 尺度复核：用人反推 px/m，再检验车/树是否符合物理尺寸 */
  const stats = scaleConsistency(boxes, { H, W, horizonY })

  boxes.forEach((b, i) => (b.id = `d${i}`))
  for (const b of boxes) {
    if (stats.pxPerM) {
      b.impliedH = r2(b.h / stats.pxPerM)
      b.impliedW = r2(b.w / stats.pxPerM)
    }
  }

  const counts = DETECT_KINDS.reduce((m, k) => ({ ...m, [k.id]: boxes.filter((b) => b.kind === k.id).length }), {})
  const confident = boxes.filter((b) => b.score >= 0.55).length
  return {
    boxes,
    stats: { ...stats, horizonY, total: boxes.length, confident, uncertain: boxes.length - confident, counts },
  }
}

/** 尺度一致性复核：
    人 ≈ 1.7 m 是最可靠的免费标尺。先由「人物框高度中位数」估 px/m，
    再反过来检查每一类是否符合真实尺寸；不符合的当场改判/降权并写明理由。 */
export function scaleConsistency(boxes, opts = {}) {
  const H = opts.H
  const persons = boxes.filter((b) => b.kind === 'person' && b.bottomGap <= H * 0.35)
  let pxPerM = null
  let source = null
  if (persons.length >= 2) {
    const hs = persons.map((b) => b.h).sort((a, b) => a - b)
    const medH = hs[Math.floor(hs.length / 2)]
    pxPerM = medH / 1.7
    source = `${persons.length} 个人体框中位数 ${medH}px ÷ 1.7m`
  } else if (persons.length === 1) {
    pxPerM = persons[0].h / 1.7
    source = `单个人体框 ${persons[0].h}px ÷ 1.7m（置信略低）`
  }
  if (!pxPerM) return { pxPerM: null, source: '未检出可作为标尺的人体', reclassified: [] }

  const reclassified = []
  for (const b of boxes) {
    const mH = b.h / pxPerM
    const mW = b.w / pxPerM
    /* 各类真实的物理尺寸范围（GB 常用值 / 生活常识）：
       车 总高 1.1–2.4 m（轿车 1.45 左右，SUV/面包 1.9，含行李架不超 2.3）
       街道家具 0.15–9.5 m（垃圾桶 0.9 / 长椅 0.8 / 路灯杆 6–12）
       人 0.8–2.4 m    植被 不限高，但 <0.3 m 的绿色块多半是花盆 */
    const fix = (to, msg) => {
      if (b.kind !== to) {
        reclassified.push({ id: b.id, from: b.kind, to, msg })
        b.kind = to
        b.reasons = [...(b.reasons || []), msg]
        b.score = Math.max(0.2, b.score - 0.15)
        b.autoFixed = true
      }
    }
    if (b.kind === 'vehicle') {
      if (mH > 2.6 || mW > 8.5) fix('misc', `推得实尺寸 ${r2(mW)}×${r2(mH)} m 超出车辆合理范围（≤2.4 高 / ≤6.5 长）`)
      else if (mH < 0.6) fix('furniture', `推得实高仅 ${r2(mH)} m，按人体比例更像地面小件`)
    } else if (b.kind === 'person') {
      if (mH > 2.5) fix('misc', `推得实高 ${r2(mH)} m 不可能是人`)
      else if (mH < 0.75) fix('furniture', `推得实高 ${r2(mH)} m，低于幼童，更像小件`)
    } else if (b.kind === 'furniture') {
      if (mH > 9.5) fix('misc', `推得实高 ${r2(mH)} m 超出街道家具范围（路灯一般 6–12 m，再高存疑）`)
    } else if (b.kind === 'vegetation') {
      if (mH < 0.3 && mW < 0.3) fix('furniture', `推得实尺寸 ${r2(mW)}×${r2(mH)} m，更像摆件`)
    }
    b.meters = { h: r2(mH), w: r2(mW) }
  }
  return { pxPerM: r2(pxPerM * 100) / 100, source, reclassified, personBoxes: persons.length }
}

/** 同类框合并：膨胀 r 像素后相交即并为一个（应对头/身、车身/车窗分离） */
export function mergeSameKind(boxes, r = 6) {
  const src = boxes.slice().sort((a, b) => b.score - a.score)
  const out = []
  const hit = (A, B) =>
    A.x - r < B.x + B.w + r && A.x + A.w + r > B.x - r && A.y - r < B.y + B.h + r && A.y + A.h + r > B.y - r
  const mergeInto = (A, B) => {
    const x0 = Math.min(A.x, B.x)
    const y0 = Math.min(A.y, B.y)
    const x1 = Math.max(A.x + A.w, B.x + B.w)
    const y1 = Math.max(A.y + A.h, B.y + B.h)
    A.x = x0
    A.y = y0
    A.w = x1 - x0
    A.h = y1 - y0
    A.area += B.area
    A.areaFrac = Math.max(A.areaFrac, B.areaFrac)
    A.score = Math.max(A.score, B.score)
    A.reasons = Array.from(new Set([...A.reasons, ...B.reasons])).slice(0, 4)
    A.merged = (A.merged || 0) + 1
  }
  for (const b of src) {
    let done = false
    for (const t of out) {
      if (t.kind === b.kind && hit(t, b)) {
        mergeInto(t, b)
        done = true
        break
      }
    }
    if (!done) out.push({ ...b })
  }
  return out
}

/** 从 {data,width,height} 的 ImageData 直接跑（浏览器侧便捷入口） */
export function detectFromImageData(imageData, opts) {
  return detectObjects({ data: imageData.data, W: imageData.width, H: imageData.height }, opts)
}
