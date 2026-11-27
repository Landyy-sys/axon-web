/**
 * 约束引擎断言 —— 验证「人工约束绝对大于视觉推断」这条原则真的生效。
 * 用法：node scripts/check-model.mjs
 */
import { makeModel, samplePass, finalizeCandidates, makeVariant } from '../src/model.js'
import {
  BUILDING_TYPES,
  TYPE_GROUPS,
  PHYSICS,
  ROOM_NAMES,
  FINISHES,
} from '../src/model.js'
import { fuseViews } from '../src/fuse.js'
import { compute, findPeaks, analyzeView } from '../src/vision.js'
import { GLOSSARY, GLOSSARY_MAP, searchGlossary } from '../src/glossary.js'

let pass = 0
let fail = 0

function ok(name, cond, extra = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.log(`  ✗ ${name} ${extra}`)
  }
}

const U = (v) => ({ v, src: 'user' })

console.log('\n① 层数锁定：即便类型是幕墙塔楼（12–22F 常识），锁定 1F 必须出 1F')
{
  const m = makeModel(1, 1.5, 1, { typeId: 'tower', floors: U(1) })
  ok('floors === 1', m.floors === 1, `实际 ${m.floors}`)
  ok('levels 只有 ±0 与屋面两条（=2）', m.levels.length === 2, `实际 ${m.levels.length}`)
  ok('evidence 标记为人工约束', m.evidence.floorFrom === 'user-constraint', m.evidence.floorFrom)
}

console.log('\n② 幕墙分格线不得进入楼层判定')
{
  const m = makeModel(2, 1.5, 1, { typeId: 'tower', floors: U(1) })
  ok('mullions 有值但不与 levels 交集', m.mullions.length > 0 && !m.mullions.some((z) => m.levels.includes(z)))
  ok('linesSuppressed 记账非零', m.linesSuppressed > 0, `${m.linesSuppressed}`)
  ok('楼层线数量 = floors+1', m.levels.length === m.floors + 1)
}

console.log('\n③ 总高与层数同时给定：反算层高，层数不动')
{
  const m = makeModel(3, 1.5, 1, { typeId: 'residential', floors: U(3), totalH: U(12) })
  ok('层数仍为 3', m.floors === 3, `实际 ${m.floors}`)
  ok('层高 ≈ (12-0.35)/3 = 3.883', Math.abs(m.floorHeight - 3.883) < 0.02, `实际 ${m.floorHeight}`)
  ok('总高回到 12', Math.abs(m.totalH - 12) < 0.02, `实际 ${m.totalH}`)
}

console.log('\n④ 物理常识校验：层高 1.5m 必须告警')
{
  const m = makeModel(4, 1.5, 1, { typeId: 'residential', fh: U(1.5) })
  ok('产生 violation', m.violations.some((v) => v.key === 'floorHeight'), JSON.stringify(m.violations))
  ok('细节被降级', m.detail === false)
}

console.log('\n⑤ 未做场景清洗 → 降级为保守空壳')
{
  const m = makeModel(5, 1.5, 1, { typeId: 'residential', cleaned: false })
  ok('cleaned=false 时 detail=false', m.detail === false)
  ok('降级原因含「未完成场景清洗」', m.degradeReasons.some((r) => r.includes('场景清洗')), JSON.stringify(m.degradeReasons))
}
{
  const m = makeModel(6, 1.5, 3, { typeId: 'residential', cleaned: true, floors: U(4), fh: U(3.0), span: U(24) })
  ok('清洗 + 人工约束齐全时 detail=true', m.detail === true, JSON.stringify(m.degradeReasons))
}

console.log('\n⑥ 审计链：每个关键量都记录来源')
{
  const m = makeModel(7, 1.5, 1, { typeId: 'residential', floors: U(5), depth: U(9) })
  const keys = m.audit.map((a) => a.key)
  ok('审计包含 floors', keys.includes('floors'))
  ok('审计包含 depth', keys.includes('depth'))
  ok('floors 来源为 user', m.audit.find((a) => a.key === 'floors')?.src === 'user')
  ok('depth 来源为 user', m.audit.find((a) => a.key === 'depth')?.src === 'user')
}

console.log('\n⑦ 室内构件不臆想：未声明时楼梯 / 隔墙 / 家具一律不建模')
{
  const base = { typeId: 'residential', cleaned: true, floors: U(4), fh: U(3.0), span: U(24) }
  const m = makeModel(8, 1.5, 1, base)
  ok('默认 stair === null（照片里没有楼梯就不画楼梯）', m.stair === null, JSON.stringify(m.stair))
  ok('三个室内构件全部关闭', ['stair', 'partitions', 'furniture'].every((k) => m.interior[k].on === false))
  ok('omissions 记录三项未建模', m.omissions.length === 3, JSON.stringify(m.omissions.map((o) => o.id)))
  ok('审计标记 stair = NOT MODELLED', m.audit.find((a) => a.key === 'stair')?.value === 'NOT MODELLED')

  const ms = makeModel(9, 1.5, 1, { ...base, interior: { stair: true } })
  ok('声明楼梯后 stair 被建模', ms.stair !== null)
  ok('层高 3.0 → 踢面落在 0.15–0.20', ms.stair.riser >= 0.15 && ms.stair.riser <= 0.2, `${ms.stair?.riser}`)
  ok('声明后 omissions 减少一项', ms.omissions.length === 2, JSON.stringify(ms.omissions.map((o) => o.id)))
}

console.log('\n⑧ 立面/剖面共用同一份门窗竖向尺寸与标高基准')
{
  const m = makeModel(10, 1.5, 1, { typeId: 'residential', cleaned: true, floors: U(3), fh: U(3.0) })
  const om = m.openings.find((o) => o.kind === 'window')
  const sillH = Math.round((om.sill - m.plinth - om.fl * m.floorHeight) * 100) / 100
  ok('窗台高落在常识区间 0.4–1.2', sillH >= 0.4 && sillH <= 1.2, `${sillH}`)
  ok('窗顶不跨楼层线', om.head < m.plinth + (om.fl + 1) * m.floorHeight, `${om.head}`)
  ok('室内外高差为负标高且落在常识区间', m.siteDrop >= 0.15 && m.siteDrop <= 0.9, `${m.siteDrop}`)
  ok('女儿墙高度合规', m.parapet >= 0.5 && m.parapet <= 1.2, `${m.parapet}`)
}

console.log('\n⑨ 体量裁剪不得删掉主体（等轴测依赖 main）')
{
  const m = makeModel(11, 1.5, 1, { typeId: 'factory', floors: U(1) })
  ok('厂房仍保留 main 体量', m.volumes.some((v) => v.id === 'main'), JSON.stringify(m.volumes.map((v) => v.id)))
  ok('厂房不再有门廊与侧翼', !m.volumes.some((v) => v.id === 'porch' || v.id === 'wing'))
}

console.log('\n⑩ 平面图：柱网 / 轴线 / 剖切避柱 / 洞口对应 / 室内不臆想')
{
  /* 用萨伏伊真值驱动 */
  const cs = {
    typeId: 'residential', cleaned: true,
    span: U(21.5), depth: U(19), floors: U(1),
    totalH: U(2.75 + 2.58),
    structure: 'pilotis', pilotiH: U(2.75), grid: U(4.75),
    fenestration: 'ribbon', roof: 'roofGarden',
  }
  const m = makeModel(21, 21.5 / 19, 4, cs)
  const P = m.plan
  ok('双向轴线各 5 根（4 跨 × 4.75 m）', P.axisX.length === 5 && P.axisY.length === 5, `${P.axisX.length}×${P.axisY.length}`)
  ok('柱网内收 · 四面悬挑 1.25 m', Math.abs(P.axisX[0].x - 1.25) < 0.06, `${P.axisX[0].x}`)
  ok('柱位 5×5 = 25 个', P.columns.length === 25, `${P.columns.length}`)
  ok(
    '剖切线避开柱位',
    Math.min(...P.axisY.map((a) => Math.abs(a.y - P.cutY))) >= 0.4,
    `cutY=${P.cutY}`,
  )
  ok(
    '平面洞口与立面 openings 一一对应',
    P.southOpenings.length === m.openings.filter((o) => o.fl === 0 && o.kind !== 'solid').length,
  )
  ok('未声明时房间 / 楼梯都不建模', P.rooms.length === 0 && P.stairBox === null)
  ok('架空层入口是坡道而非台阶', P.entry.kind === 'ramp')
  ok('窗顶不越过上层楼板底', m.openings.every((o) => o.kind === 'solid' || o.kind === 'door' || o.head <= m.base + (o.fl + 1) * m.floorHeight - m.slab + 0.01))

  const md = makeModel(22, 21.5 / 19, 4, {
    ...cs,
    interior: { stair: true, partitions: true, furniture: false },
  })
  ok('声明后房间被划分', md.plan.rooms.length > 0, `${md.plan.rooms.length}`)
  ok('声明后楼梯间被建模', md.plan.stairBox !== null)
  ok('声明后 omissions 只剩家具一项', md.omissions.length === 1, JSON.stringify(md.omissions.map((o) => o.id)))
}

console.log('\n⑪ 准确性优先：多轮采样一致性 + 交叉校验')
{
  const base = { typeId: 'residential', cleaned: true, floors: U(3), fh: U(3.0), span: U(24) }
  const cands = Array.from({ length: 9 }, (_, i) => samplePass(77, 1.5, 2, base, i))
  const fin = finalizeCandidates(cands)
  ok('一致度 ≥ 90%', fin.agreement >= 0.9, `${fin.agreement}`)
  ok('交叉校验无冲突', fin.issues.length === 0, JSON.stringify(fin.issues))
  ok('refine 记账 9 轮', fin.model.refine.passes === 9)
  ok('共识值写入审计链', fin.model.audit.some((a) => a.key === 'refine'))

  /* 约束不可信时（纯推断）多轮必有分歧 → 必须降级 */
  const loose = Array.from({ length: 9 }, (_, i) => samplePass(88, 1.9, 1, { typeId: 'office', cleaned: true }, i))
  const fl = finalizeCandidates(loose)
  ok('纯推断时一致度下降并触发保守模式', fl.agreement < 1 || fl.model.detail === false, `${fl.agreement} detail=${fl.model.detail}`)
}

console.log('\n⑫ 多视角：不同的视角组合必须产出不同的建筑（治「多传图和少传图一个样」）')
{
  /* 构造两个不同的逐视角分析结果：单张正立面 vs 三视角（含两张转角） */
  const frontal = {
    ok: true, confidence: 0.6, name: 'front.jpg',
    hLines: [{ y: 0.3 }, { y: 0.55 }, { y: 0.8 }], vLines: [{ x: 0.2 }, { x: 0.5 }, { x: 0.8 }],
    floorBands: 3, bayDivisions: 3, columnClues: 2,
    pilotisScore: 0.2, glassScore: 0.2, symmetry: 0.8, faces: 1, cornerX: null,
    footprintRatio: null, topSolid: true,
  }
  const corner = {
    ok: true, confidence: 0.7, name: 'corner.jpg',
    hLines: [{ y: 0.28 }, { y: 0.42 }, { y: 0.56 }, { y: 0.7 }, { y: 0.84 }],
    vLines: [{ x: 0.15 }, { x: 0.3 }, { x: 0.55 }, { x: 0.7 }, { x: 0.85 }],
    floorBands: 5, bayDivisions: 5, columnClues: 6,
    pilotisScore: 0.72, glassScore: 0.55, symmetry: 0.3, faces: 2, cornerX: 0.5,
    footprintRatio: 1.6, topSolid: false,
  }

  const f1 = fuseViews([frontal])
  const f3 = fuseViews([frontal, corner, { ...corner, name: 'side.jpg', pilotisScore: 0.66 }])

  ok('单视角融合只认到 1 个立面', (f1.hyp.observed || []).length === 1, JSON.stringify(f1.hyp.observed))
  ok('三视角融合观测到更多立面', (f3.hyp.observed || []).length > (f1.hyp.observed || []).length,
    `${(f3.hyp.observed || []).length} vs ${(f1.hyp.observed || []).length}`)
  ok('层数随视角证据改变', f3.hyp.floors?.v !== f1.hyp.floors?.v, `${f1.hyp.floors?.v} → ${f3.hyp.floors?.v}`)
  ok('开间数随视角证据改变', f3.hyp.bays?.v !== f1.hyp.bays?.v, `${f1.hyp.bays?.v} → ${f3.hyp.bays?.v}`)
  ok('底层架空由多视角投票定性', f3.hyp.structure === 'pilotis', String(f3.hyp.structure))
  ok('转角视角给出面宽/进深比', !!f3.hyp.footprintRatio?.v, JSON.stringify(f3.hyp.footprintRatio))
  ok('多视角增益有据可查（gained 非空）', (f3.gained || []).length > 0, JSON.stringify(f3.gained))
  ok('视角矛盾被登记', (f3.conflicts || []).length > 0, JSON.stringify(f3.conflicts))

  /* 关键：把融合结果喂进引擎，几何必须真的不同 */
  const V1 = makeVariant(4242)
  const m1 = makeModel(4242, 1.5, 1, { typeId: 'residential', cleaned: true, vision: f1.hyp, fusion: f1, variant: V1 })
  const m3 = makeModel(4242, 1.5, 3, { typeId: 'residential', cleaned: true, vision: f3.hyp, fusion: f3, variant: V1 })
  ok('层数不同', m1.floors !== m3.floors, `${m1.floors} vs ${m3.floors}`)
  ok('开间数不同', m1.bays !== m3.bays, `${m1.bays} vs ${m3.bays}`)
  ok('结构体系不同（出现架空）', m1.structure !== m3.structure, `${m1.structure} vs ${m3.structure}`)
  ok('进深不同（转角视角给出了面宽/进深比）', m1.depth !== m3.depth, `${m1.depth} vs ${m3.depth}`)
  ok('平面图观测立面数不同', m1.plan.observed.length !== m3.plan.observed.length,
    `${m1.plan.observed} vs ${m3.plan.observed}`)
  ok('立面洞口数量不同', m1.openings.length !== m3.openings.length, `${m1.openings.length} vs ${m3.openings.length}`)
  ok('视觉证据进入审计链', m3.audit.some((a) => a.src === 'vision'))
  ok('evidence 标记为多视角视觉判定', m3.evidence.floorFrom === 'multi-view-vision', m3.evidence.floorFrom)
}

console.log('\n⑬ 方案变体：同一批输入重新生成必须给出不同的合规解')
{
  ok('变体可复现', JSON.stringify(makeVariant(7)) === JSON.stringify(makeVariant(7)))
  const seen = new Set()
  for (let s = 1; s <= 40; s++) seen.add(makeVariant(s).wwr)
  ok('窗墙比至少三种取值', seen.size >= 3, `实际 ${[...seen].join('/')}`)

  const vA = { id: 'V-100', wwr: 0.34, rhythm: 'grouped', entry: 'left', eaves: 'cornice', grid: 'half-bay' }
  const vB = { id: 'V-200', wwr: 0.62, rhythm: 'accent', entry: 'right', eaves: 'recessed', grid: 'double-bay' }
  const opts = { typeId: 'residential', cleaned: true, floors: U(3), fh: U(3), span: U(24) }
  const mA = makeModel(555, 1.5, 2, { ...opts, variant: vA })
  const mB = makeModel(555, 1.5, 2, { ...opts, variant: vB })
  const wA = mA.openings.find((o) => o.kind === 'window')
  const wB = mB.openings.find((o) => o.kind === 'window')
  ok('窗宽随窗墙比变体改变', wA && wB && Math.abs(wA.x1 - wA.x0 - (wB.x1 - wB.x0)) > 0.05,
    `${wA && (wA.x1 - wA.x0)} vs ${wB && (wB.x1 - wB.x0)}`)
  ok('入口位置随变体改变', mA.plan.entry.x !== mB.plan.entry.x, `${mA.plan.entry.x} vs ${mB.plan.entry.x}`)
  ok('柱网随变体改变', mA.grid !== mB.grid, `${mA.grid} vs ${mB.grid}`)
  ok('檐口高度随变体改变', mA.parapet !== mB.parapet, `${mA.parapet} vs ${mB.parapet}`)
  ok('人工锁定项不被变体影响', mA.floors === mB.floors && mA.bays === mB.bays,
    `${mA.floors}/${mA.bays} vs ${mB.floors}/${mB.bays}`)
  /* 变体再怎么变，也不能违反物理常识 */
  ok('变体不产生新的物理违背', mA.violations.length === 0 && mB.violations.length === 0,
    `${mA.violations.length}/${mB.violations.length}`)
}

console.log('\n⑭ 像素级算法回归：证明「读图」是真的在算像素，不是摆设')
{
  /* 合成一张 320×240 的建筑立面：
     · 三条深色横带 y=60/120/180（楼板线）
     · 四条深色竖线 x=40/110/180/250（柱 / 分格）
     · 底部 25% 压暗 + 竖向重复（架空柱列） */
  const W = 320, H = 240
  const data = new Uint8ClampedArray(W * H * 4)
  const put = (x, y, r, g, b) => {
    const p = (y * W + x) * 4
    data[p] = r; data[p + 1] = g; data[p + 2] = b; data[p + 3] = 255
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const darkFloor = Math.abs(y - 60) < 2 || Math.abs(y - 120) < 2 || Math.abs(y - 180) < 2
      const darkCol = Math.abs(x - 40) < 2 || Math.abs(x - 110) < 2 || Math.abs(x - 180) < 2 || Math.abs(x - 250) < 2
      let v = 235
      if (darkFloor || darkCol) v = 70
      if (y > H * 0.75) v = Math.max(40, v - 90) // 底层压暗
      put(x, y, v, v, v)
    }
  }
  /* 底层压暗区再叠上柱子（竖向明暗交替） */
  for (let y = Math.floor(H * 0.78); y < H; y++) {
    for (let x = 0; x < W; x++) if (x % 40 < 8) put(x, y, 25, 25, 25)
  }

  const { row, rowCov, col, colCov } = compute(data, W, H)
  const rp = findPeaks(row, rowCov, 0.42, { k: 1.1, gap: 2 }).peaks.map((p) => p.i)
  const cp = findPeaks(col, colCov, 0.45, { k: 1.0, gap: 2, limit: 30 }).peaks.map((p) => p.i)
  const near = (arr, target, tol) => arr.some((v) => Math.abs(v - target) <= tol)

  ok('三条楼板线在正确位置被检出', [60, 120, 180].every((y) => near(rp, y, 3)), `检出 ${rp.join(',')}`)
  ok('四条竖向结构线在正确位置被检出', [40, 110, 180, 250].every((x) => near(cp, x, 3)), `检出 ${cp.join(',')}`)
  ok('峰值数量受控（没有把噪点当成线）', rp.length <= 12 && cp.length <= 14, `row=${rp.length} col=${cp.length}`)
}

console.log('\n⑮ 健壮性：拿不到像素时必须优雅降级，不能让生成流程挂掉')
{
  /* Node 里没有 document/canvas —— 与浏览器 file:// 下被同源策略拦掉是同一类情况 */
  const bad = await analyzeView({ id: 9, name: 'x.jpg' }).catch(() => null)
  ok('analyzeView 不抛错', !!bad)
  ok('标记为不可用且不参与融合', bad && bad.ok === false && bad.confidence === 0)
  const none = fuseViews([])
  const hypKeys = Object.keys(none.hyp).filter((k) => k !== 'observed')
  ok('空视角不产生任何几何假设（只剩默认的单立面）', hypKeys.length === 0, JSON.stringify(none.hyp))
  const allBad = fuseViews([bad])
  ok('全无法解析时模型退回类型常识', (() => {
    const m = makeModel(31, 1.5, 1, { typeId: 'residential', cleaned: true, vision: allBad.hyp, fusion: allBad })
    return m.floors >= 1 && m.detail === false
  })())
}

console.log('\n⑯ 建筑原型细分：各类必须各自完备，且能产出不同的几何')
{
  ok('原型数量足够细', BUILDING_TYPES.length >= 16, `${BUILDING_TYPES.length} 类`)
  const noGroup = BUILDING_TYPES.filter((t) => !TYPE_GROUPS.some((g) => g.id === t.group)).map((t) => t.id)
  ok('每类都归属到一个分组', noGroup.length === 0, JSON.stringify(noGroup))
  const badFh = BUILDING_TYPES.filter(
    (t) => t.fh < PHYSICS.floorHeight[0] || t.fh > PHYSICS.floorHeight[1],
  ).map((t) => `${t.id}:${t.fh}`)
  ok('层高落在物理常识区间内', badFh.length === 0, JSON.stringify(badFh))
  const badBay = BUILDING_TYPES.filter(
    (t) => t.bayW < PHYSICS.bayWidth[0] || t.bayW > PHYSICS.bayWidth[1],
  ).map((t) => `${t.id}:${t.bayW}`)
  ok('开间落在物理常识区间内', badBay.length === 0, JSON.stringify(badBay))
  ok('层数区间自洽', BUILDING_TYPES.every((t) => t.floors[0] >= 1 && t.floors[0] <= t.floors[1]))
  const noRoom = BUILDING_TYPES.filter((t) => !Array.isArray(ROOM_NAMES[t.id]) || ROOM_NAMES[t.id].length < 6).map((t) => t.id)
  ok('每类都有房间名表', noRoom.length === 0, JSON.stringify(noRoom))
  const noFin = BUILDING_TYPES.filter((t) => !FINISHES[t.id]?.wall || !FINISHES[t.id]?.frame).map((t) => t.id)
  ok('每类都有外装修做法', noFin.length === 0, JSON.stringify(noFin))
  ok('每类都有一句话通俗说明', BUILDING_TYPES.every((t) => (t.note || '').length >= 12))
  ok('博物馆默认走「独立柱」体系', BUILDING_TYPES.find((t) => t.id === 'museum').structure === 'columns')

  /* 每一类都要能跑出一个不违反常识的模型 */
  const broken = []
  const seen = new Set()
  for (const t of BUILDING_TYPES) {
    const m = makeModel(1234, 1.5, 1, { typeId: t.id, cleaned: true })
    if (m.violations.length) broken.push(`${t.id}:${m.violations.map((v) => v.msg).join('/')}`)
    if (m.floors < t.floors[0] || m.floors > t.floors[1]) broken.push(`${t.id}:floors=${m.floors}`)
    seen.add(`${Math.round(m.floorHeight * 10)}|${m.bay ? Math.round(m.bay * 10) : 'x'}|${m.floors}`)
  }
  ok('所有类型都能求解且不违背常识', broken.length === 0, broken.join(' ; '))
  ok('不同类型确实产生不同几何', seen.size >= BUILDING_TYPES.length - 3, `${seen.size} 种组合 / ${BUILDING_TYPES.length} 类`)
}

console.log('\n⑰ 名词通俗化：每条术语必须同时给大白话、规范释义、图上怎么看')
{
  ok('术语数量充足', GLOSSARY.length >= 30, `${GLOSSARY.length} 条`)
  ok('每条都有通俗解释', GLOSSARY.every((t) => (t.plain || '').length >= 10))
  ok('每条都有规范释义', GLOSSARY.every((t) => (t.pro || '').length >= 10))
  ok('每条都说明「图上怎么看」', GLOSSARY.every((t) => (t.see || '').length >= 6))
  ok('术语 id 唯一', new Set(GLOSSARY.map((t) => t.id)).size === GLOSSARY.length)
  const must = ['span', 'bays', 'bayWidth', 'depth', 'floorHeight', 'totalHeight', 'parapet', 'curtainWall', 'cutLine', 'plan', 'section', 'elevation', 'isometric', 'scale', 'lineWeight']
  ok('点名要懂的词都在', must.every((k) => GLOSSARY_MAP[k]), must.filter((k) => !GLOSSARY_MAP[k]).join(','))
  ok('通俗解释不是规范原文的复制', GLOSSARY.every((t) => t.plain !== t.pro))
  ok('搜索按词命中', searchGlossary('开间').some((t) => t.id === 'bays') && searchGlossary('面宽').some((t) => t.id === 'span'))
  ok('搜索空词返回全部', searchGlossary('').length === GLOSSARY.length)
  /* 通俗解释里不能堆英文行话（一句话出现 3 个以上拉丁词视为偷懒） */
  const jargon = GLOSSARY.filter((t) => (t.plain.match(/[A-Za-z]{4,}/g) || []).length >= 3)
  ok('通俗解释没有堆砌英文行话', jargon.length === 0, jargon.map((t) => t.id).join(','))
}

console.log('\n⑱ 多轮对话反馈修改：解析 · 覆盖 · 真改 · 容错')
{
  const FB = await import('../src/feedback.js')
  const { applyFeedback, applyOpsToOpenings, buildPrompt } = FB
  const cur = {
    c: { floors: { v: 5, src: 'user' }, fh: { v: 3.3, src: 'user' } },
    ops: null,
    lastModel: { floors: 5, floorHeight: 3.3, bays: 5, length: 21, totalH: 18, PAR: 0 },
    lastSvg: '<svg>上一版</svg>',
  }

  /* 铁律一：意图必须真正落到参数 / 构件 */
  const r1 = applyFeedback(cur, '把层数改成 3 层')
  ok('层数意见被解析', r1.ok && r1.cPatch?.floors?.v === 3)
  ok('冲突覆盖：以最新意见为准', r1.cPatch?.floors?.src === 'user' && r1.reply.includes('以你的最新要求为准'))
  const r2 = applyFeedback(cur, '层高调到 3.6 米')
  ok('层高意见被解析', r2.ok && Math.abs(r2.cPatch.fh.v - 3.6) < 0.01)
  const r3 = applyFeedback(cur, '把立面图的窗户改大一点')
  ok('窗户放大落到构件意图', r3.ok && r3.ops?.windowScale === 1.2 && r3.changes.length > 0)
  const r4 = applyFeedback(cur, '增加一个阳台')
  ok('阳台意图被解析', r4.ok && Array.isArray(r4.ops?.balconies) && r4.ops.balconies.length === 1)
  const r5 = applyFeedback(cur, '首层加一个门')
  ok('加门意图被解析', r5.ok && r5.ops?.addedDoor === true)
  const r6 = applyFeedback(cur, '开间数改成 6')
  ok('开间意见被解析', r6.ok && r6.cPatch?.bays?.v === 6)
  const r7 = applyFeedback(cur, '面宽 18 米')
  ok('面宽换算为每跨跨度', r7.ok && Math.abs(r7.cPatch.span.v - 18 / 5) < 0.01, String(r7.cPatch?.span?.v))

  /* 铁律四：模糊意见与暂不支持能力必须拒绝，绝不假装修改 */
  const v1 = applyFeedback(cur, '好看点')
  ok('模糊意见被拒绝', !v1.ok && v1.reply.includes('抱歉'))
  const v2 = applyFeedback(cur, '整体优化一下')
  ok('含糊优化被拒绝', !v2.ok)
  const v3 = applyFeedback(cur, '加个坡屋顶')
  ok('暂不支持的能力被拒绝', !v3.ok && v3.reply.includes('抱歉'))
  const v4 = applyFeedback(cur, '')
  ok('空输入被拒绝', !v4.ok)

  /* 累积：上一轮窗放大 + 本轮加阳台，ops 合并而不是覆盖丢失 */
  const r8 = applyFeedback({ ...cur, ops: r3.ops }, '每层都加阳台')
  ok('构件意图累积合并', r8.ok && r8.ops.windowScale === 1.2 && r8.ops.balconies.length > 1)

  /* 铁律一（几何落地）：applyOpsToOpenings 必须真的改变洞口 */
  const openings = [
    { kind: 'window', fl: 0, bay: 0, x0: 1.2, x1: 2.8, sill: 0.9, head: 2.4 },
    { kind: 'window', fl: 0, bay: 1, x0: 5.2, x1: 6.8, sill: 0.9, head: 2.4 },
    { kind: 'door', fl: 0, bay: 2, x0: 9.5, x1: 10.9, sill: 0, head: 2.3 },
  ]
  const model = { floorHeight: 3.3, base: 0.45, length: 21, columns: [0, 4.2, 8.4, 12.6, 16.8, 21] }
  const scaled = applyOpsToOpenings(openings, { windowScale: 1.2 }, model)
  const w0 = scaled.find((o) => o.bay === 0 && o.kind === 'window')
  ok('窗洞真的变宽', w0.x1 - w0.x0 > openings[0].x1 - openings[0].x0)
  ok('窗洞不越柱位', w0.x0 >= model.columns[0] + 0.3 - 0.01 && w0.x1 <= model.columns[1] - 0.3 + 0.01)
  const widened = applyOpsToOpenings(openings, { doorWiden: true }, model)
  const d0 = widened.find((o) => o.kind === 'door')
  ok('门洞加宽且到 2.4 m', d0.x1 - d0.x0 > 2 && Math.abs(d0.head - model.base - 2.4) < 0.01)
  const noDoor = openings.filter((o) => o.kind !== 'door')
  const added = applyOpsToOpenings(noDoor, { addedDoor: true }, model)
  ok('无门时真的新增了 door 构件', added.some((o) => o.kind === 'door'))
  const untouched = applyOpsToOpenings(openings, null, model)
  ok('无意图时原样返回（不乱动）', untouched === openings)

  /* 位置类指令（任务二：意图提取中间件覆盖「移/放」） */
  const r9 = applyFeedback(cur, '把柱子移到墙里')
  ok('柱入墙指令被解析', r9.ok && r9.ops?.columnInline === true && !r9.ops?.columnOutside)
  const r9b = applyFeedback({ ...cur, ops: r9.ops }, '柱子移到墙外')
  ok('柱外露指令并覆盖前值', r9b.ok && r9b.ops?.columnOutside === true && !r9b.ops?.columnInline)
  const r10 = applyFeedback(cur, '把门移到中间')
  ok('门居中指令被解析', r10.ok && r10.ops?.doorCenter === true)

  /* 门居中的几何落地：中轴 10.5 m 落在第 2 跨（8.4–12.6），居中且不越柱位 */
  const doorMoved = applyOpsToOpenings(
    [{ kind: 'door', fl: 0, bay: 0, x0: 1.2, x1: 2.6, sill: 0, head: 2.3 }],
    { doorCenter: true },
    { floorHeight: 3.3, base: 0, length: 21, columns: [0, 4.2, 8.4, 12.6, 16.8, 21] },
  )
  const dc = doorMoved.find((o) => o.kind === 'door')
  ok('门真的移到立面正中', dc.bay === 2 && Math.abs(dc.x0 - 9.8) < 0.01 && Math.abs(dc.x1 - 11.2) < 0.01, `bay=${dc.bay} x=${dc.x0}-${dc.x1}`)
  ok('居中后不越柱位', dc.x0 >= 8.7 - 0.01 && dc.x1 <= 12.3 + 0.01)

  /* 100mm 吸附（任务三）：所有洞口坐标必须是 0.1 m 的整数倍 */
  const scaledAll = applyOpsToOpenings(openings, { windowScale: 1.2 }, model)
  ok(
    '洞口坐标吸附 100mm',
    scaledAll.every((o) => [o.x0, o.x1, o.sill, o.head].every((v) => Math.abs(v * 10 - Math.round(v * 10)) < 1e-9)),
  )

  /* finalizeCandidates 输出的主尺寸同样吸附 100mm 且总高自洽 */
  const fm = finalizeCandidates(
    Array.from({ length: 9 }, (_, i) => samplePass(4, 1.4, 1, { typeId: 'office', cleaned: true }, i)),
  )
  if (fm) {
    const mm = fm.model
    const aligned = ['length', 'depth', 'floorHeight', 'bay'].every((k) => Math.abs(mm[k] * 10 - Math.round(mm[k] * 10)) < 1e-9)
    ok('主尺寸吸附 100mm', aligned, `L=${mm.length} D=${mm.depth} FH=${mm.floorHeight}`)
    ok('吸附后总高仍自洽', Math.abs(mm.totalH - (mm.base + mm.floors * mm.floorHeight)) <= 0.05)
    ok(
      '洞口几何吸附 100mm',
      (mm.openings || []).every((o) => [o.x0, o.x1, o.sill, o.head].every((v) => Math.abs(v * 10 - Math.round(v * 10)) < 1e-9)),
    )
  }

  /* 铁律三：修改说明存在且可读 */
  ok('修改说明非空且中文', r1.changes.every((s) => s.length >= 4) && /层/.test(r1.reply))
  ok('拒绝时给出示例', v1.reply.includes('例如'))

  /* Prompt 模板含四条铁律 */
  const p = buildPrompt(cur, '改成 3 层')
  ok('Prompt 含最新意见优先铁律', p.includes('最新意见为准'))
  ok('Prompt 含上一版参数与 SVG', p.includes('上一版图纸 SVG'))
}

console.log('\n⑲ v0.3 口语意图词典 + 高情商引导（面向大众）')
{
  const { applyFeedback, COLLOQUIAL_INTENTS, GUIDED_CHOICES } = await import('../src/feedback.js')
  const cur = {
    c: { floors: { v: 5, src: 'user' }, fh: { v: 3.3, src: 'user' } },
    ops: null,
    lastModel: { floors: 5, floorHeight: 3.3, bays: 5, length: 21, totalH: 18 },
  }

  /* ── 测试用例：用户点名的几句大白话 ── */
  const q1 = applyFeedback(cur, '这窗户是不是有点小？')
  ok('大白话「窗户有点小？」→ 放大 20%', q1.ok && q1.ops?.windowScale === 1.2)
  const q2 = applyFeedback(cur, '屋顶看着怪怪的')
  ok('大白话「怪怪的」→ 随机换一版样式', q2.ok && !!q2.cPatch?.variant?.id, String(q2.cPatch?.variant?.id))
  const q3 = applyFeedback(cur, '弄个门')
  ok('大白话「弄个门」→ 加门', q3.ok && q3.ops?.addedDoor === true)
  const q4 = applyFeedback(cur, '加个口子也行，搞个入口')
  ok('大白话「口子/入口」→ 加门', q4.ok && q4.ops?.addedDoor === true)
  const q5 = applyFeedback(cur, '太丑了，换一版吧')
  ok('大白话「太丑了」→ 随机换版', q5.ok && !!q5.cPatch?.variant)
  const q6 = applyFeedback(cur, '宽敞点')
  ok('大白话「宽敞点」→ 窗放大', q6.ok && q6.ops?.windowScale === 1.2)
  const q7 = applyFeedback(cur, '窗户太大了，收一收')
  ok('大白话「太大收一收」→ 窗收小', q7.ok && q7.ops?.windowScale === 0.85)
  const q8 = applyFeedback(cur, '门口太小了，进不去人')
  ok('大白话「门口太小」→ 门加宽', q8.ok && q8.ops?.doorWiden === true)

  /* ── 高情商引导：疑问句绝不回"无法解析"，抛选择题 ── */
  const g1 = applyFeedback(cur, '剖面图是不是错了？')
  ok('疑问句触发选择题引导', !g1.ok && Array.isArray(g1.choices) && g1.choices.length === 3 && !g1.reply.includes('无法解析'))
  const g2 = applyFeedback(cur, '这不对吧')
  ok('否定句同样给选项', !g2.ok && g2.choices?.length === 3)
  ok('引导选项可点选且指令可执行', GUIDED_CHOICES.every((ch) => ch.label && ch.cmd && applyFeedback(cur, ch.cmd).ok === true))

  /* ── 边界：真模糊仍拒绝（不装懂），词典不误伤 ── */
  const b1 = applyFeedback(cur, '好看点')
  ok('纯模糊意见仍被拒绝（不假改）', !b1.ok && b1.reply.includes('抱歉'))
  const b2 = applyFeedback(cur, '不丑，挺好的')
  ok('「不丑」不误触发换版', !b2.ok || b2.cPatch?.variant === undefined)

  /* ── 词典结构自检 ── */
  ok('口语词典含 8 类意图且 id 唯一', COLLOQUIAL_INTENTS.length === 8 && new Set(COLLOQUIAL_INTENTS.map((r) => r.id)).size === 8)
}

console.log('\n⑳ AI 质检 selfCheck（Self-Review & Retry 闭环）')
{
  const { selfCheck } = await import('../src/selfcheck.js')
  const U = (n) => ({ v: n, src: 'user' })

  /* ── 合规模型必须通过：正常生成 100 版抽检 ── */
  let allOk = true
  let checkedN = 0
  for (let s = 1; s <= 100; s++) {
    const m = makeModel(s, 1.5, 1, { typeId: 'residential', floors: U(3), fh: U(3.0), span: U(18) })
    const r = selfCheck(m)
    checkedN = Math.max(checkedN, r.checked)
    if (!r.ok) { allOk = false; console.log('   seed', s, r.issues) }
  }
  ok('100 版合规模型全部通过自检', allOk)
  ok('自检条数真实执行（> 5 项/模型）', checkedN > 5)

  /* ── 手工污染三类问题，逐类验证被抓出 ── */
  const m1 = makeModel(7, 1.5, 1, { typeId: 'residential', floors: U(3), fh: U(3.0) })
  m1.openings[0].x1 = m1.length + 2
  ok('污染①：窗超出总面宽 → opening-out', selfCheck(m1).issues.some((i) => i.key === 'opening-out'))

  const m2 = makeModel(8, 1.5, 1, { typeId: 'residential', floors: U(3), fh: U(3.0) })
  const d2 = m2.openings.find((o) => o.kind === 'door') || m2.openings[0]
  d2.kind = 'door'; d2.fl = 2; d2.sill = 8
  ok('污染②：门悬空（3 层 / 8 m 标高）→ door-floating', selfCheck(m2).issues.some((i) => i.key === 'door-floating'))

  const m3 = makeModel(9, 1.5, 1, { typeId: 'residential', floors: U(3), fh: U(3.0) })
  m3.floors = 5 // 层数改了，总高没动
  ok('污染③：层数与总高失配 → height-mismatch', selfCheck(m3).issues.some((i) => i.key === 'height-mismatch'))

  const m4 = makeModel(10, 1.5, 1, { typeId: 'residential', floors: U(3), fh: U(3.0) })
  m4.openings[0].sill = 4.2; m4.openings[0].head = 1.0
  ok('污染④：窗台高于窗顶 → sill-above-head', selfCheck(m4).issues.some((i) => i.key === 'sill-above-head'))

  /* ── 空模型防御 ── */
  ok('空模型返回 no-model 而非崩溃', selfCheck(null).issues[0]?.key === 'no-model')
}

console.log('\n㉑ 女儿墙独立参数（Parapet，v0.5）')
{
  const { selfCheck } = await import('../src/selfcheck.js')
  const U = (n) => ({ v: n, src: 'user' })

  /* ── 三档来源 ── */
  const m1 = makeModel(11, 1.5, 1, { typeId: 'residential', floors: U(3), fh: U(3.0), parapet: U(1.2) })
  ok('user 女儿墙 1.2 m 绝对优先（上人屋面）', m1.parapet === 1.2)
  const m2 = makeModel(12, 1.5, 1, { typeId: 'residential', floors: U(3), fh: U(3.0), parapetOff: { v: true, src: 'user' } })
  ok('取消勾选「包含女儿墙」→ parapet = 0', m2.parapet === 0)
  const m3 = makeModel(13, 1.5, 1, { typeId: 'residential', floors: U(3), fh: U(3.0) })
  /* 未指定 → 类型先验 0.6 ± 檐口变体修正（cornice +0.25 / recessed -0.25 / 无 0），
     始终落在 [0.35, 0.85] 的合规区间内 */
  ok(
    '未指定 → 沿用类型先验 ± 檐口变体（0.35–0.85 合规区间）',
    m3.parapet >= 0.35 && m3.parapet <= 0.85,
    String(m3.parapet),
  )
  const m4 = makeModel(14, 1.5, 1, { typeId: 'museum', floors: U(2), fh: U(4.5), parapet: U(0.9) })
  ok('flatSlab 屋面勾选女儿墙 → 同样生效 0.9', m4.parapet === 0.9)

  /* ── 总高联动：檐口不变，女儿墙顶 = 檐口 + parapet ── */
  ok('檐口高 = 基座 + 3F × 3.0（口径不变）', Math.abs(m1.totalH - (m1.base + 9)) < 0.01)
  ok('女儿墙顶 = 檐口 + 1.2（总高联动）', Math.abs(m1.totalH + m1.parapet - (m1.base + 9 + 1.2)) < 0.01)

  /* ── 越界钳制：UI 输 5 m 会被 clamp 到物理区间 [0.5, 1.2] ── */
  const m5 = makeModel(15, 1.5, 1, { typeId: 'residential', floors: U(3), fh: U(3.0), parapet: U(5) })
  ok('输入 5 m 被常识区间钳制到 ≤ 1.2', m5.parapet <= 1.2)

  /* ── selfCheck 联动：带女儿墙的模型通过质检，污染版被抓出 ── */
  ok('女儿墙 1.2 m 模型通过 selfCheck', selfCheck(m1).ok)
  const bad = { ...m1, parapet: 9 }
  ok('女儿墙 9 m → parapet-range 质检失败', selfCheck(bad).issues.some((i) => i.key === 'parapet-range'))

  /* ── 口语意图：「加女儿墙 / 不要女儿墙」 ── */
  const { applyFeedback } = await import('../src/feedback.js')
  const cur = { c: { floors: U(3), fh: U(3.0) }, ops: null, lastModel: { floors: 3, floorHeight: 3.0, bays: 5, length: 21, totalH: 9.45 } }
  const r1 = applyFeedback(cur, '屋顶加个女儿墙吧')
  ok('口语「加女儿墙」→ parapet 0.9 user 级', r1.ok && r1.cPatch?.parapet?.v === 0.9)
  const r2 = applyFeedback(cur, '女儿墙 1.1 米')
  ok('口语带数值「女儿墙 1.1 米」→ 1.1', r2.ok && r2.cPatch?.parapet?.v === 1.1)
  const r3 = applyFeedback(cur, '不要女儿墙了')
  ok('口语「不要女儿墙」→ parapetOff 且不误加', r3.ok && r3.cPatch?.parapetOff?.v === true && r3.cPatch?.parapet?.v == null)
  const r4 = applyFeedback(cur, '去掉女儿墙，太压抑了')
  ok('口语「去掉女儿墙」→ parapetOff', r4.ok && r4.cPatch?.parapetOff?.v === true)
}

console.log('\n㉒ Self-Reflection 闭环：STANDARD_RULES 规则库 + autoCorrect + selfReview')
{
  const { STANDARD_RULES, selfCheck, autoCorrect, selfReview } = await import('../src/selfcheck.js')
  const U = (n) => ({ v: n, src: 'user' })

  /* ── 规则库完整性 ── */
  ok('规则库 ≥ 10 条且每条都有 id/label/apply', STANDARD_RULES.length >= 10 && STANDARD_RULES.every((r) => r.id && r.label && typeof r.apply === 'function'))
  ok('用户点名的三条规则在库中（洞口边界/总高/剖切）',
    STANDARD_RULES.some((r) => r.id === 'opening-bounds') &&
    STANDARD_RULES.some((r) => r.id === 'total-height') &&
    STANDARD_RULES.some((r) => r.id === 'section-cut'))

  /* ── 100 版合规模型必须一次通过 selfReview（0 纠错）── */
  let allOk = true
  let anyFixed = false
  for (let s = 100; s <= 199; s++) {
    const m = makeModel(s, 1.5, 1, { typeId: 'residential', floors: U(3), fh: U(3.0), span: U(18) })
    const r = selfReview(m)
    if (!r.ok || r.fixedCount > 0) {
      allOk = false
      console.log('   seed', s, r.issues, r.fixes)
    }
    if (r.fixedCount > 0) anyFixed = true
  }
  ok('100 版合规模型全部一次通过 selfReview（无误纠）', allOk)
  ok('合规模型零自动纠错（不乱改好数据）', !anyFixed)

  /* ── 污染⑤：窗宽大于开间 → window-vs-bay，且 autoCorrect 收窄修复 ── */
  const w1 = makeModel(7, 1.5, 1, { typeId: 'residential', floors: U(3), fh: U(3.0) })
  const win = w1.openings.find((o) => o.kind === 'window' && o.x1 - o.x0 < w1.bay)
  if (win) {
    win.x1 = Math.round((win.x0 + w1.bay * 1.6) * 100) / 100 // 故意拉宽到开间 1.6 倍
    const c1 = selfCheck(w1)
    ok('污染⑤：窗宽 > 开间宽 → window-vs-bay', c1.issues.some((i) => i.key === 'window-vs-bay'))
    const rv1 = selfReview(w1)
    ok('selfReview 自动纠错：收窄后复检通过', rv1.ok && rv1.model.openings.some((o) => o.x1 - o.x0 <= rv1.model.bay * 1.02 + 0.02))
    ok('纠错明细已记录', rv1.fixedCount > 0 && rv1.fixes.length === rv1.fixedCount)
  } else {
    ok('污染⑤：窗宽 > 开间宽（该种子无独立窗，跳过）', true)
  }

  /* ── 污染⑥：窗户坐标为负 → opening-out，autoCorrect 吸附回边界 ── */
  const w2 = makeModel(8, 1.5, 1, { typeId: 'residential', floors: U(3), fh: U(3.0) })
  w2.openings[0].x0 = -0.8
  ok('污染⑥：负坐标 → opening-out', selfCheck(w2).issues.some((i) => i.key === 'opening-out'))
  const rv2 = selfReview(w2)
  ok('selfReview 自动纠错：负坐标吸附回 0 且复检通过', rv2.ok && rv2.model.openings[0].x0 >= 0)

  /* ── 污染⑦：女儿墙比总高还大 → parapet-range，autoCorrect 夹回 ── */
  const w3 = makeModel(9, 1.5, 1, { typeId: 'residential', floors: U(3), fh: U(3.0), parapet: U(1.2) })
  w3.parapet = 9
  ok('污染⑦：女儿墙 9 m → parapet-range', selfCheck(w3).issues.some((i) => i.key === 'parapet-range'))
  const rv3 = selfReview(w3)
  ok('selfReview 自动纠错：女儿墙夹回 0–1.2 m', rv3.ok && rv3.model.parapet <= 1.2 && rv3.model.parapet >= 0)

  /* ── 污染⑧：总高失配 → height-mismatch，autoCorrect 重算 ── */
  const w4 = makeModel(10, 1.5, 1, { typeId: 'residential', floors: U(3), fh: U(3.0) })
  w4.floors = 6 // 层数改了，总高没动
  ok('污染⑧：层数与总高失配 → height-mismatch', selfCheck(w4).issues.some((i) => i.key === 'height-mismatch'))
  const rv4 = selfReview(w4)
  ok('selfReview 自动纠错：总高按 6F 重算且复检通过',
    rv4.ok && Math.abs(rv4.model.totalH - (rv4.model.base + 6 * rv4.model.floorHeight)) < 0.05)

  /* ── 污染⑨：门悬空 → door-floating，autoCorrect 落地 ── */
  const w5 = makeModel(11, 1.5, 1, { typeId: 'residential', floors: U(3), fh: U(3.0) })
  const d5 = w5.openings.find((o) => o.kind === 'door') || w5.openings[0]
  d5.kind = 'door'; d5.fl = 2; d5.sill = 8
  ok('污染⑨：门悬空 → door-floating', selfCheck(w5).issues.some((i) => i.key === 'door-floating'))
  const rv5 = selfReview(w5)
  ok('selfReview 自动纠错：门放回首层地面', rv5.ok && rv5.model.openings.some((o) => o.kind === 'door' && o.fl === 0))

  /* ── 剖切有效性规则 ── */
  const w6 = makeModel(12, 1.5, 1, { typeId: 'residential', floors: U(3), fh: U(3.0) })
  w6.openings = w6.openings.filter((o) => o.kind === 'solid') // 只留实墙 → 剖面无信息量
  ok('污染⑩：剖切面无洞口无楼梯 → section-empty', selfCheck(w6).issues.some((i) => i.key === 'section-empty'))
  ok('剖切位置越出进深 → cut-out', selfCheck({ ...w6, plan: { ...w6.plan, cutY: w6.depth + 3 } }).issues.some((i) => i.key === 'cut-out'))

  /* ── autoCorrect 不污染原模型（深拷贝）── */
  const w7 = makeModel(13, 1.5, 1, { typeId: 'residential', floors: U(3), fh: U(3.0) })
  w7.openings[0].x0 = -0.5
  const snap = w7.openings[0].x0
  autoCorrect(w7)
  ok('autoCorrect 返回深拷贝，原模型不被改动', w7.openings[0].x0 === snap)

  /* ── selfCheck 兼容接口仍可用（v0.4 老调用方不破）── */
  ok('selfCheck(null) 仍返回 no-model', selfCheck(null).issues[0]?.key === 'no-model')
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`)
process.exit(fail ? 1 : 0)
