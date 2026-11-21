/**
 * 像素级干扰物识别回归 —— 证明「色框」是真在算像素，而不是随机数撒点。
 *
 * 合成一张已知真值的街景：天空 + 带渐变且重复排窗的建筑立面（用来诱惑误报）
 * + 地面 + 一个人 + 一辆红车 + 一棵树 + 一根灯杆。
 * 断言每个物体的检出框必须落在真值附近、且类别必须正确。
 * 另有一组「误判纠偏」用例：故意放一个 3 m 高的超大块，尺度复核必须把它踢出车辆类。
 */
import { detectObjects, isSkin, isVegetation, mergeSameKind, scaleConsistency } from '../src/detect.js'

let pass = 0
let fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`)
  }
}

const W = 520
const H = 320

function buildScene(withBigBlock = false) {
  const data = new Uint8ClampedArray(W * H * 4)
  const put = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return
    const p = (y * W + x) * 4
    data[p] = Math.min(255, Math.max(0, r))
    data[p + 1] = Math.min(255, Math.max(0, g))
    data[p + 2] = Math.min(255, Math.max(0, b))
    data[p + 3] = 255
  }
  const rect = (x0, y0, x1, y1, fn) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) fn(x, y, put)
  }

  /* 天空：越往下越淡 —— 渐变会散落到多个色箱，考验「颜色族传播」 */
  rect(0, 0, W - 1, 132, (x, y, p) => p(x, y, 120 + y * 0.35, 165 + y * 0.3, 226))

  /* 建筑立面：暖灰 + 竖向渐变；窗是深灰蓝 **重复出现在多行** → 必须是背景 */
  rect(0, 133, W - 1, 262, (x, y, p) => {
    const shade = 196 + Math.sin(x / 55) * 10 + (y - 133) * 0.06
    p(x, y, shade, shade - 6, shade - 18)
  })
  for (let row = 0; row < 5; row++) {
    const wy = 145 + row * 24
    for (let col = 0; col < 7; col++) {
      const wx = 14 + col * 58
      rect(wx, wy, wx + 38, wy + 15, (x, y, p) => p(x, y, 92, 104, 118))
    }
  }
  /* 地面 */
  rect(0, 263, W - 1, H - 1, (x, y, p) => p(x, y, 118, 116, 112))

  /* ── 真值物体 1：人。肤色头 + 深蓝衣身，站立地面 ── */
  const truth = {}
  truth.person = { x: 60, y: 190, w: 16, h: 72 }
  rect(66, 190, 75, 199, (x, y, p) => p(x, y, 214, 168, 138)) // 头（肤色）
  rect(63, 200, 78, 254, (x, y, p) => p(x, y, 44, 58, 96)) // 躯干腿（深蓝）
  rect(66, 255, 75, 261, (x, y, p) => p(x, y, 30, 30, 34)) // 鞋

  /* ── 真值物体 2：红车。矮宽、平涂 ── */
  truth.car = { x: 150, y: 232, w: 74, h: 30 }
  rect(150, 232, 223, 248, (x, y, p) => p(x, y, 176, 42, 38))
  rect(158, 249, 215, 261, (x, y, p) => p(x, y, 24, 24, 26)) // 轮胎阴影带

  /* ── 真值物体 3：树。蓬松绿团 + 褐干 ── */
  truth.tree = { x: 300, y: 186, w: 62, h: 62 }
  const cx = 331
  const cy = 232
  for (let y = 186; y <= 262; y++)
    for (let x = 300; x <= 361; x++) {
      const d = Math.hypot((x - cx) / 30, (y - cy) / 38)
      if (d < 0.97) {
        const j = (x * 7 + y * 13) % 17
        put(x, y, 46 + j, 126 + j, 52 + j)
      }
    }
  rect(328, 262, 335, 268, (x, y, p) => p(x, y, 96, 68, 44))

  /* ── 真值物体 4：细高灯杆 ── */
  truth.pole = { x: 258, y: 150, w: 6, h: 112 }
  rect(258, 150, 263, 261, (x, y, p) => p(x, y, 62, 62, 66))

  if (withBigBlock) {
    /* 一块 4 m 高的巨型深色块 —— 尺寸远超车辆，必须被尺度复核踢出 vehicle */
    truth.big = { x: 430, y: 120, w: 70, h: 140 }
    rect(430, 120, 499, 259, (x, y, p) => p(x, y, 40, 44, 52))
  }

  return { data, truth }
}

/* 判定某类是否被正确检出：存在一个该类的框，与真值 IoU > 0.4 */
function iou(a, b) {
  const x0 = Math.max(a.x, b.x)
  const y0 = Math.max(a.y, b.y)
  const x1 = Math.min(a.x + a.w, b.x + b.w)
  const y1 = Math.min(a.y + a.h, b.y + b.h)
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0)
  const uni = a.w * a.h + b.w * b.h - inter
  return uni ? inter / uni : 0
}
const bestOf = (boxes, truth, kind) =>
  boxes.filter((b) => b.kind === kind).map((b) => ({ b, s: iou(b, truth) })).sort((p, q) => q.s - p.s)[0]

console.log('\n① 语义像素规则本身要经得起验证')
{
  ok('肤色 RGB+YCbCr 双规则命中典型人脸色', isSkin(214, 168, 138))
  ok('米黄石材不算肤色（上一版错判主因）', !isSkin(214, 196, 150))
  ok('红砖近似色不算肤色', !isSkin(178, 96, 74))
  ok('草地绿判定为植被', isVegetation(64, 138, 58))
  ok('青灰玻璃幕墙不算植被', !isVegetation(150, 172, 182))
  ok('深蓝不算植被', !isVegetation(40, 58, 110))
}

console.log('\n② 合成街景：每个真值物体都要被检出且类别正确')
const scene = buildScene(false)
const det = detectObjects({ data: scene.data, W, H })
console.log(
  `     检出 ${det.boxes.length} 个框：` +
    det.boxes.map((b) => `${b.kind}@${b.x},${b.y}(${b.w}×${b.h}) ${b.score.toFixed(2)}`).join(' · '),
)
{
  const t = scene.truth
  for (const [key, kind] of [
    ['person', 'person'],
    ['car', 'vehicle'],
    ['tree', 'vegetation'],
    ['pole', 'furniture'],
  ]) {
    const m = bestOf(det.boxes, t[key], kind)
    ok(
      `${kind} 被检出且位置正确（IoU>0.4）`,
      m && m.s > 0.4,
      m ? `IoU=${m.s.toFixed(2)} box=${JSON.stringify(m.b)}` : '完全没检出',
    )
  }
  ok('没有把重复的立面窗当干扰物', det.boxes.length <= 8, `共 ${det.boxes.length} 个框`)
  ok('每个框都带判定理由', det.boxes.every((b) => b.reasons?.length), JSON.stringify(det.boxes[0]?.reasons))
  ok('尺度复核给出了 px/m', !!det.stats?.pxPerM, JSON.stringify(det.stats?.source))
}

console.log('\n③ 误判纠偏：超大块不能被当成车（尺度复核的单元测试）')
{
  /* 直接用框的像素尺寸喂给复核器：两个人（68px ≈ 1.7 m 作为标尺）在场，
     其中一个 150px 高的框被初步判为「车辆」→ 实算下来 3.75 m，必须改判。
     这比在合成图里硬凑透视一致性更干净，也更能说明纠偏逻辑本身是对的。 */
  const res = scaleConsistency(
    [
      { id: 'p1', kind: 'person', h: 68, w: 20, bottomGap: 4 },
      { id: 'p2', kind: 'person', h: 70, w: 22, bottomGap: 6 },
      { id: 'v1', kind: 'vehicle', h: 150, w: 320, bottomGap: 2 }, // 3.7 m 高 / 8 m 长 → 不像车
      { id: 'v2', kind: 'vehicle', h: 60, w: 170, bottomGap: 3 }, // 1.5 m 高 / 4.2 m 长 → 正常车
      { id: 'f1', kind: 'furniture', h: 26, w: 8, bottomGap: 1 }, // 0.65 m → 正常小件
    ],
    { H: 400, W: 600 },
  )
  ok('由人体中位数反推出 px/m（70px ÷ 1.7m ≈ 41.2）', Math.abs(res.pxPerM - 41.18) < 0.5, `${res.pxPerM} px/m`)
  const fixGoal = res.reclassified.find((r) => r.id === 'v1')
  ok('3.7 m 的巨块被踢出车辆类', fixGoal && fixGoal.to !== 'vehicle', JSON.stringify(fixGoal))
  ok('正常 1.5 m 的车保持原判', !res.reclassified.some((r) => r.id === 'v2'), JSON.stringify(res.reclassified))
  ok('0.65 m 的小件保持街道家具', !res.reclassified.some((r) => r.id === 'f1'))
  console.log(`     px/m=${res.pxPerM} · ${res.source}`)
  res.reclassified.forEach((r) => console.log(`     纠偏 ${r.id}: ${r.from} → ${r.to}（${r.msg}）`))
}

console.log('\n③b 同一场景用合成图再验一遍')
{
  const s2 = buildScene(true)
  const d2 = detectObjects({ data: s2.data, W, H })
  console.log(`     含巨块场景检出 ${d2.boxes.length} 框：` + d2.boxes.map((b) => b.kind).join(','))
  const t = s2.truth
  const asVehicle = bestOf(d2.boxes, t.big, 'vehicle')
  ok('巨块没被当成车', !asVehicle || asVehicle.s < 0.3, JSON.stringify(asVehicle?.b))
  ok('原有的车/人/树仍然能检出', bestOf(d2.boxes, t.car, 'vehicle')?.s > 0.4 && bestOf(d2.boxes, t.tree, 'vegetation')?.s > 0.4)
}

console.log('\n④ 合并逻辑：头与身分离时应并为一个人')
{
  const merged = mergeSameKind(
    [
      { kind: 'person', score: 0.8, x: 66, y: 190, w: 10, h: 10, area: 100, areaFrac: 0.001, reasons: ['头'] },
      { kind: 'person', score: 0.7, x: 63, y: 200, w: 16, h: 55, area: 800, areaFrac: 0.005, reasons: ['身'] },
      { kind: 'vehicle', score: 0.6, x: 300, y: 300, w: 60, h: 20, area: 1200, areaFrac: 0.01, reasons: ['远车'] },
    ],
    6,
  )
  ok('同人物两框合并', merged[0].kind === 'person' && merged[0].merged >= 1, JSON.stringify(merged[0]))
  ok('不同类不合并', merged.length === 2, `合并后 ${merged.length} 个`)
}

console.log('\n⑤ 鲁棒：异常输入不能崩')
{
  const empty = detectObjects({ data: new Uint8ClampedArray(400), W: 20, H: 5 })
  ok('纯黑图不崩且无框', empty.boxes.length === 0)
  const bad = detectObjects({ data: null, W: 0, H: 0 })
  ok('空输入不崩', bad.boxes.length === 0)
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`)
process.exit(fail ? 1 : 0)
