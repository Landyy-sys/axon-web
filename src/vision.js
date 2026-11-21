/* ═══════════════════════════════════════════════════════════════════════
   src/vision.js —— 逐视角真实图像分析

   这一层是「多视角上传真的有用」的前提。
   之前 App 只把 files.length（张数）和平均宽高比喂给生成器，
   图片内容一个像素都没读过 —— 所以传 1 张和传 5 张出来的图一模一样。

   现在每张上传的视角图都会被真实解码并计算：
     · 灰度 + Sobel 边缘图
     · 行方向投影 → 水平结构线（楼板线 / 檐口线 / 女儿墙）→ 楼层带数量
     · 列方向投影 → 竖向结构线（柱 / 竖向分格）→ 开间数、柱位线索
     · 底部暗带 + 竖向重复 → 底层架空（pilotis）置信度
     · 顶部连续低边缘亮带 → 天空占比与建筑体轮廓顶
     · 冷色低饱和 + 高网格密度 → 玻璃幕墙置信度
     · 中央强竖线 + 左右明度差 → 转角（同时看到两个立面）→ 面宽/进深比
     · 镜像相关 → 立面是否对称

   所有结果都是可审计的结构化数字，直接进 fuse.js 做多视角融合。
   ═══════════════════════════════════════════════════════════════════════ */

const TARGET_W = 320 // 分析分辨率（足够提取结构线，又能秒级完成）

const r3 = (v) => Math.round(v * 1000) / 1000
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)

function stdev(a, m) {
  if (!a.length) return 0
  const mu = m ?? mean(a)
  return Math.sqrt(mean(a.map((x) => (x - mu) ** 2)))
}

/* ── 解码图片：优先 createImageBitmap，降级到 <img> ── */
async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file)
    } catch {
      /* 落到下面的 <img> 方案 */
    }
  }
  const url = typeof file === 'string' ? file : URL.createObjectURL(file)
  const img = new Image()
  img.crossOrigin = 'anonymous'
  await new Promise((res, rej) => {
    img.onload = res
    img.onerror = () => rej(new Error('image decode failed'))
    img.src = url
  })
  if (typeof file !== 'string') setTimeout(() => URL.revokeObjectURL(url), 0)
  return img
}

/* ── Sobel 边缘 + 行列投影 + 亮度剖面（导出以便 Node 侧做算法回归） ── */
export function compute(src, W, H) {
  const gray = new Float32Array(W * H)
  for (let i = 0; i < W * H; i++) {
    const p = i * 4
    gray[i] = (src[p] * 0.299 + src[p + 1] * 0.587 + src[p + 2] * 0.114) / 255
  }

  const edge = new Float32Array(W * H)
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x
      const tl = gray[i - W - 1], tc = gray[i - W], tr = gray[i - W + 1]
      const ml = gray[i - 1], mr = gray[i + 1]
      const bl = gray[i + W - 1], bc = gray[i + W], br = gray[i + W + 1]
      const gx = -tl + tr - 2 * ml + 2 * mr - bl + br
      const gy = tl + 2 * tc + tr - bl - 2 * bc - br
      edge[i] = Math.min(1, Math.hypot(gx, gy) * 0.5)
    }
  }

  /* 行/列投影：强度 + 覆盖率（有边缘的像素占比）。
     覆盖率是区分「一条真正的结构线」和「一堆噪点」的关键。 */
  const row = new Float32Array(H)
  const rowCov = new Float32Array(H)
  const col = new Float32Array(W)
  const colCov = new Float32Array(W)
  const lumRow = new Float32Array(H)
  const ET = 0.16
  for (let y = 0; y < H; y++) {
    let s = 0, n = 0, l = 0
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      const e = edge[i]
      s += e
      if (e > ET) n++
      l += gray[i]
    }
    row[y] = s / W
    rowCov[y] = n / W
    lumRow[y] = l / W
  }
  for (let x = 0; x < W; x++) {
    let s = 0, n = 0
    for (let y = 0; y < H; y++) {
      const e = edge[y * W + x]
      s += e
      if (e > ET) n++
    }
    col[x] = s / H
    colCov[x] = n / H
  }

  /* 冷色（玻璃）像素占比：偏蓝 + 中低亮度 + 低饱和 */
  let cold = 0
  const N = W * H
  for (let i = 0; i < N; i++) {
    const p = i * 4
    const rr = src[p], gg = src[p + 1], bb = src[p + 2]
    const mx = Math.max(rr, gg, bb), mn = Math.min(rr, gg, bb)
    const sat = mx ? (mx - mn) / mx : 0
    const l = (mx + mn) / 2
    if (bb - rr > 6 && sat < 0.42 && l > 30 && l < 225) cold++
  }

  return { gray, edge, row, rowCov, col, colCov, lumRow, coldRatio: cold / N }
}

/* 峰值提取：局部阈值 + 邻域抑制 */
export function findPeaks(arr, cov, covMin, opts = {}) {
  const { k = 1.15, gap = 3, limit = 40 } = opts
  const m = mean(arr)
  const sd = stdev(arr, m)
  const th = Math.max(m + k * sd, 1e-4)
  const order = Array.from(arr.keys()).sort((a, b) => arr[b] - arr[a])
  const out = []
  for (const i of order) {
    if (arr[i] < th) break
    if (cov && cov[i] < covMin) continue
    if (out.some((u) => Math.abs(u.i - i) < gap)) continue
    out.push({ i, v: arr[i], cov: cov ? cov[i] : 1 })
    if (out.length >= limit) break
  }
  out.sort((a, b) => a.i - b.i)
  return { peaks: out, mean: m, th }
}

/* 一维自相关对称性：0=完全不对称，1=完全对称 */
function symmetryScore(arr) {
  const n = arr.length
  if (n < 8) return 0
  const mu = mean(arr)
  const dev = arr.map((v) => v - mu)
  const sd = stdev(arr, mu) || 1e-6
  let acc = 0
  for (let i = 0; i < n; i++) acc += dev[i] * dev[n - 1 - i]
  return clamp01(acc / (n * sd * sd) * 0.5 + 0.5)
}

/**
 * 分析一张视角图。
 * @param {{raw?:Blob, url?:string, name?:string, id?:any}} view 上传项（需带 raw 原始 File）
 * @returns {Promise<object>} ViewFacts
 */
export async function analyzeView(view) {
  const fallback = {
    id: view?.id,
    name: view?.name || 'view',
    ok: false,
    confidence: 0,
    hLines: [], vLines: [], floorBands: 0, bayDivisions: 0, columnClues: 0,
    pilotisScore: 0, glassScore: 0, symmetry: 0, faces: 1, cornerX: null,
    footprintRatio: null, skyRatio: 0, bodyTop: 0, bodyBottom: 1, topSolid: false,
    note: '该视角无法解析，未参与融合',
  }
  try {
    const bmp = await decode(view.raw || view.url)
    const bw = bmp.width || view.w || TARGET_W
    const bh = bmp.height || view.h || TARGET_W
    const W = Math.min(TARGET_W, bw)
    const H = Math.max(8, Math.round((bh / bw) * W))
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(bmp, 0, 0, W, H)
    if (bmp.close) bmp.close()
    const { data } = ctx.getImageData(0, 0, W, H)

    const { edge, row, rowCov, col, colCov, lumRow, coldRatio } = compute(data, W, H)

    /* ── 天空：顶部连续「亮且几乎没有边缘」的行 ── */
    const lumMean = mean(lumRow)
    let skyEnd = 0
    for (let y = 0; y < Math.floor(H * 0.5); y++) {
      if (lumRow[y] > lumMean * 1.06 && rowCov[y] < 0.22) skyEnd = y + 1
      else if (y - skyEnd > 3) break
    }
    const skyRatio = r3(skyEnd / H)

    /* ── 水平结构线：要求「贯穿」而不是局部线段 ── */
    const Hres = findPeaks(row, rowCov, 0.42, { k: 1.1, gap: Math.max(2, Math.round(H / 60)) })
    const bodyTopRow = skyEnd
    const bodyBotRow = H - 1
    const hLines = Hres.peaks
      .filter((p) => p.i > bodyTopRow + 2 && p.i < bodyBotRow - 1)
      .map((p) => ({ y: r3(p.i / H), strength: r3(p.v), coverage: r3(p.cov) }))

    /* 楼层带：相邻两条强水平线构成一个层带，忽略过密的装饰线（幕墙分格） */
    const strong = hLines.filter((l) => l.coverage > 0.55)
    let bands = 0
    for (let i = 1; i < strong.length; i++) {
      const dy = strong[i].y - strong[i - 1].y
      if (dy >= 0.06) bands++ // <6% 高度的间隔视为分格而非楼层
    }
    const floorBands = clamp(strong.length ? bands + 1 : 0, 0, 40)

    /* ── 竖向结构线（柱 / 分格） ── */
    const Vres = findPeaks(col, colCov, 0.45, { k: 1.0, gap: Math.max(2, Math.round(W / 50)), limit: 30 })
    const vLines = Vres.peaks.map((p) => ({ x: r3(p.i / W), strength: r3(p.v), coverage: r3(p.cov) }))
    const bayDivisions = Math.max(0, vLines.filter((l) => l.x > 0.06 && l.x < 0.94).length - 1)

    /* ── 底层架空：底部暗带 + 竖向重复（柱子） ── */
    const bot0 = Math.floor(H * 0.66)
    const lumBot = mean(Array.from(lumRow).slice(bot0))
    const darkRatio = clamp01((lumMean - lumBot) / Math.max(0.12, lumMean) * 1.6)
    /* 柱子：底部带里沿 x 方向的竖向边缘起伏次数 */
    let osc = 0
    const bandRow = Math.floor(H * 0.82)
    let prev = 0
    let pv = edge[bandRow * W]
    for (let x = 1; x < W; x++) {
      const v = edge[bandRow * W + x]
      if (pv < 0.12 && v >= 0.12) osc++
      pv = v
    }
    const columnClues = osc
    const columnEvidence = clamp01(osc / 8)
    const pilotisScore = r3(clamp01(darkRatio * 0.55 + columnEvidence * 0.45))

    /* ── 玻璃幕墙：冷色占比 + 网格密度 ── */
    const density = clamp01((Hres.peaks.length / Math.max(1, H * 0.05)) * 0.5 + (Vres.peaks.length / Math.max(1, W * 0.06)) * 0.5)
    const glassScore = r3(clamp01(coldRatio * 1.5 * 0.55 + density * 0.45))

    /* ── 转角：中央区存在一条贯穿的强竖线 + 左右明度差 ── */
    let corner = null
    const cands = vLines.filter((l) => l.x > 0.22 && l.x < 0.78 && l.coverage > 0.6)
    if (cands.length) {
      const best = cands.reduce((a, b) => (b.strength > a.strength ? b : a))
      const l0 = mean(Array.from(grayRowMean(data, W, H, 0, Math.floor(best.x * W))))
      const l1 = mean(Array.from(grayRowMean(data, W, H, Math.floor(best.x * W), W)))
      const diff = Math.abs(l0 - l1)
      if (diff > 0.045) corner = { x: best.x, contrast: r3(diff), leftW: best.x, rightW: r3(1 - best.x) }
    }

    const faces = corner ? 2 : 1
    const footprintRatio = corner ? r3(Math.max(corner.leftW, corner.rightW) / Math.max(0.08, Math.min(corner.leftW, corner.rightW))) : null

    /* ── 顶部实檐 / 女儿墙：顶部第二条线以下有大面积实心亮带 ── */
    const topSolid = strong.length >= 2 && strong[strong.length - 1].y - strong[strong.length - 2].y > 0.1

    const confidence = r3(
      clamp01(0.3 + Math.min(0.3, hLines.length * 0.05) + Math.min(0.25, vLines.length * 0.04) + (corner ? 0.15 : 0)),
    )

    return {
      id: view?.id,
      name: view?.name || 'view',
      ok: true,
      srcW: bw, srcH: bh, aspect: r3(bw / bh), W, H,
      hLines, vLines, floorBands, bayDivisions, columnClues,
      pilotisScore, glassScore, symmetry: r3(symmetryScore(Array.from(col))),
      faces, cornerX: corner ? corner.x : null, footprintRatio,
      skyRatio, bodyTop: r3(skyEnd / H), bodyBottom: r3(bodyBotRow / H),
      topSolid, coldRatio: r3(coldRatio), density: r3(density),
      confidence,
    }
  } catch (e) {
    const name = String(e?.name || '')
    return {
      ...fallback,
      note:
        name === 'SecurityError'
          ? '浏览器禁止读取该图像素（file:// 直接打开时会受同源限制），请启动本地服务后再试'
          : `该视角解析失败（${String(e?.message || e).slice(0, 40)}）`,
    }
  }
}

function grayRowMean(data, W, H, x0, x1) {
  const out = new Float32Array(H)
  for (let y = 0; y < H; y++) {
    let s = 0
    for (let x = x0; x < x1; x++) {
      const p = (y * W + x) * 4
      s += (data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114) / 255
    }
    out[y] = s / Math.max(1, x1 - x0)
  }
  return out
}

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v
}

/** 分析失败的保底事实对象 */
export function voidFacts(view) {
  return {
    id: view?.id,
    name: view?.name || 'view',
    ok: false,
    confidence: 0,
    hLines: [], vLines: [], floorBands: 0, bayDivisions: 0, columnClues: 0,
    pilotisScore: 0, glassScore: 0, symmetry: 0, faces: 1, cornerX: null,
    footprintRatio: null, skyRatio: 0, bodyTop: 0, bodyBottom: 1, topSolid: false,
    note: '未参与分析',
  }
}
