/**
 * 真实建筑图纸 vs 引擎输出 —— 结构化 diff
 *
 * 用法：node scripts/benchmark.mjs
 *
 * 这不是单元测试，是「看图找茬」的自动化版本：
 * 把真实建筑的实测参数喂进引擎，逐项检查真实图纸上必须出现的表达，
 * 引擎有没有能力画出来。画不出来的列进差异表，作为改造清单。
 */
import { makeModel, samplePass, finalizeCandidates } from '../src/model.js'
import { CASE_LIB, caseToConstraints } from '../src/benchmarks.js'

const C = {
  ok: '\x1b[32m', bad: '\x1b[31m', warn: '\x1b[33m', dim: '\x1b[2m',
  b: '\x1b[1m', r: '\x1b[0m',
}

/* ══ 检查器：给定 model，判断某个真实表达项是否被画出来 ══ */
const CHECKS = {
  pilotis: (m) => ({
    pass: m.structure === 'pilotis' && (m.pilotiH ?? 0) > 0.2,
    got: `structure=${m.structure} pilotiH=${m.pilotiH}`,
  }),
  ribbonWindow: (m) => {
    const rb = (m.openings || []).filter((o) => o.kind === 'ribbon')
    const span = rb.length ? Math.max(...rb.map((o) => o.x1 - o.x0)) : 0
    return {
      pass: rb.length > 0 && span > m.bay * 1.5,
      got: rb.length ? `ribbon ${rb.length} 段，最长 ${span.toFixed(2)} m（开间 ${m.bay}）` : `无 ribbon，只有 ${[...new Set((m.openings||[]).map(o=>o.kind))].join('/')}`,
    }
  },
  roofGarden: (m) => ({
    pass: m.roof === 'roofGarden',
    got: `roof=${m.roof}`,
  }),
  curvedScreen: (m) => ({
    pass: (m.roofFeatures || []).includes('curvedScreen'),
    got: `roofFeatures=[${(m.roofFeatures || []).join(',')}]`,
  }),
  ramp: (m) => ({
    pass: (m.roofFeatures || []).includes('ramp') || (m.circulation || []).includes('ramp'),
    got: `roofFeatures=[${(m.roofFeatures || []).join(',')}]`,
  }),
  columnGrid: (m) => ({
    pass: (m.grid ?? 0) > 0 && Math.abs((m.grid ?? 0) - m.bay) > 0.01,
    got: `grid=${m.grid} bay=${m.bay}${m.grid && Math.abs(m.grid - m.bay) <= 0.01 ? '（柱网被开间绑架）' : ''}`,
  }),
  noPlinth: (m) => ({
    pass: m.structure === 'pilotis' ? (m.plinth ?? 1) < 0.2 : true,
    got: `plinth=${m.plinth}`,
  }),
  flatRoof: (m) => ({
    pass: ['roofGarden', 'flatSlab', 'parapet'].includes(m.roof),
    got: `roof=${m.roof}`,
  }),
  curtainWall: (m) => {
    const cw = (m.openings || []).filter((o) => o.kind === 'curtain')
    return { pass: cw.length > 0, got: cw.length ? `curtain ${cw.length}` : '无' }
  },
  columnOutside: (m) => ({
    pass: !!m.columnsOutside,
    got: `columnsOutside=${m.columnsOutside}`,
  }),
  noParapet: (m) => ({
    pass: (m.parapet ?? 0) < 0.05,
    got: `parapet=${m.parapet}`,
  }),
  flatSlab: (m) => ({
    pass: ['flatSlab', 'roofGarden'].includes(m.roof),
    got: `roof=${m.roof}`,
  }),
  freeWalls: (m) => ({
    pass: !!m.planFree,
    got: `planFree=${m.planFree}`,
  }),

  /* ══ 平面图必备表达（本轮新增的训练项） ══ */
  planAxis: (m) => {
    const P = m.plan
    if (!P) return { pass: false, got: '无平面数据' }
    return {
      pass: P.axisX.length >= 2 && P.axisY.length >= 1 && !!P.axisX[0].label && !!P.axisY[0].label,
      got: `纵轴 ${P.axisX.length}（${P.axisX.map((a) => a.label).join(' ')}）× 横轴 ${P.axisY.length}（${P.axisY.map((a) => a.label).join(' ')}）`,
    }
  },
  planColumns: (m, cs) => {
    const P = m.plan
    if (!P) return { pass: false, got: '无平面数据' }
    const dx = P.axisX.length > 1 ? P.axisX[1].x - P.axisX[0].x : 0
    const spacingOK = Math.abs(dx - m.grid) < 0.05
    const want = cs?.planTruth
    let pass = P.axisX.length >= 2 && P.axisY.length >= 1 && spacingOK
    if (want?.colsX?.v) pass = pass && Math.abs(P.axisX.length - want.colsX.v) <= (want.colsX.tol ?? 0)
    if (want?.colsY?.v) pass = pass && Math.abs(P.axisY.length - want.colsY.v) <= (want.colsY.tol ?? 0)
    return {
      pass,
      got: `${P.columns.length} 柱位（${P.axisX.length}×${P.axisY.length}）柱距 ${dx} vs grid ${m.grid}${want?.colsX ? ` · 真值 ${want.colsX.v}×${want.colsY?.v ?? '-'}` : ''}`,
    }
  },
  planCantilever: (m, cs) => {
    const P = m.plan
    if (!P) return { pass: false, got: '无平面数据' }
    const ins = P.axisX[0].x
    const want = cs?.planTruth?.cantilever
    const pass = want ? Math.abs(ins - want.v) <= (want.tol ?? 0.5) : ins > 0.05
    return {
      pass,
      got: `悬挑 ${ins.toFixed(2)} m${want ? ` · 真值 ${want.v} ± ${want.tol}` : ''}`,
    }
  },
  planCut: (m) => {
    const P = m.plan
    if (!P) return { pass: false, got: '无平面数据' }
    const d = Math.min(...P.axisY.map((a) => Math.abs(a.y - P.cutY)))
    return { pass: d >= 0.4, got: `cutY=${P.cutY} m · 距最近轴线 ${d.toFixed(2)} m` }
  },
  planOpenings: (m) => {
    const P = m.plan
    if (!P) return { pass: false, got: '无平面数据' }
    const elev = (m.openings || []).filter((o) => o.fl === 0 && o.kind !== 'solid')
    const same =
      elev.length === P.southOpenings.length &&
      elev.every(
        (o, i) =>
          Math.abs(o.x0 - P.southOpenings[i].x0) < 0.011 &&
          Math.abs(o.x1 - P.southOpenings[i].x1) < 0.011,
      )
    return {
      pass: same && elev.length > 0,
      got: `立面 ${elev.length} 个洞口 vs 平面 ${P.southOpenings.length} 个${same ? ' · 一一对应' : ' · 不一致'}`,
    }
  },
  planOmission: (m) => {
    const P = m.plan
    if (!P) return { pass: false, got: '无平面数据' }
    const declared = !!m.interior?.partitions?.on || !!m.interior?.stair?.on
    const clean = P.rooms.length === 0 && P.stairBox === null
    return {
      pass: declared ? true : clean && (m.omissions?.length ?? 0) > 0,
      got: `rooms=${P.rooms.length} stairBox=${P.stairBox ? '有' : '无'} omissions=${(m.omissions || []).length}`,
    }
  },
}

let totalMissing = 0
const fixList = []

for (const cs of CASE_LIB) {
  console.log(`\n${C.b}${C.b}══ ${cs.name} · ${cs.en} ══${C.r}`)
  console.log(`${C.dim}${cs.architect} · ${cs.year} · 视角 ${cs.views}${C.r}`)
  console.log(`${C.dim}${cs.photoRef}${C.r}`)

  const cons = caseToConstraints(cs.id)
  const aspect = cs.span.v / cs.depth.v
  const m = makeModel(101, aspect, cs.views, cons)

  /* 几何真值偏差 */
  console.log(`\n  ${C.b}几何偏差${C.r}`)
  const geo = [
    ['面宽', cs.span.v, m.length, cs.span.tol],
    ['进深', cs.depth.v, m.depth, cs.depth.tol],
    ['层数', cs.floors.v, m.floors, cs.floors.tol],
    ['柱距', cs.structure.grid.v, m.grid, cs.structure.grid.tol],
  ]
  for (const [label, want, got, tol] of geo) {
    const d = Math.abs((want ?? 0) - (got ?? 0))
    const ok = d <= (tol ?? 0.5)
    if (!ok && got != null) totalMissing++
    console.log(
      `    ${ok ? C.ok + '✓' : C.bad + '✗'}${C.r} ${label.padEnd(4)} 真值 ${String(want).padStart(6)} · 引擎 ${String(got ?? 'N/A').padStart(6)} · Δ ${d.toFixed(2)} ≤ ${tol}`
    )
  }

  /* 表达项 diff */
  console.log(`\n  ${C.b}真实图纸必备表达${C.r}`)
  for (const req of cs.required) {
    const fn = CHECKS[req.key]
    if (!fn) { console.log(`    ${C.warn}?${C.r} ${req.label}（无检查器）`); continue }
    const { pass, got } = fn(m, cs)
    if (!pass) {
      totalMissing++
      if (!fixList.includes(req.label)) fixList.push(req.label)
    }
    console.log(
      `    ${pass ? C.ok + '✓' : C.bad + '✗'}${C.r} ${req.label.padEnd(22)} ${C.dim}${got}${C.r}`
    )
  }

  /* 平面真值偏差 */
  if (cs.planTruth) {
    const P = m.plan
    console.log(`\n  ${C.b}平面真值偏差${C.r}`)
    const pt = [
      ['悬挑', cs.planTruth.cantilever?.v, P.axisX[0].x, cs.planTruth.cantilever?.tol ?? 0.5],
      ['面宽跨数', cs.planTruth.spansX?.v, P.axisX.length - 1, cs.planTruth.spansX?.tol ?? 1],
      ['进深跨数', cs.planTruth.spansY?.v, P.axisY.length - 1, cs.planTruth.spansY?.tol ?? 2],
    ].filter((x) => x[1] != null)
    for (const [label, want, got, tol] of pt) {
      const d = Math.abs(want - got)
      const ok = d <= tol
      if (!ok) totalMissing++
      console.log(
        `    ${ok ? C.ok + '✓' : C.bad + '✗'}${C.r} ${label.padEnd(6)} 真值 ${String(want).padStart(5)} · 引擎 ${String(got).padStart(5)} · Δ ${d.toFixed(2)} ≤ ${tol}`
      )
    }
    console.log(`${C.dim}    ${cs.planTruth.note}${C.r}`)
  }

  /* ══ 多轮采样一致性 + 平立剖交叉校验（准确性优先管线） ══ */
  console.log(`\n  ${C.b}多轮采样一致性${C.r}`)
  const cands = Array.from({ length: 9 }, (_, i) => samplePass(101, aspect, cs.views, cons, i))
  const fin = finalizeCandidates(cands)
  const agr = Math.round(fin.agreement * 100)
  console.log(
    `    ${fin.agreement >= 0.9 ? C.ok + '✓' : C.warn + '⚠'}${C.r} ${fin.model.refine.passes} 轮采样 · 一致度 ${agr}% · 共识 ${fin.model.refine.consensus.map((x) => `${x.k}=${x.v}`).join(' ')}`
  )
  if (fin.issues.length) {
    totalMissing += fin.issues.length
    for (const it of fin.issues) {
      if (!fixList.includes(it.msg)) fixList.push(it.msg)
      console.log(`    ${C.bad}✗${C.r} 交叉校验：${it.msg}`)
    }
  } else {
    console.log(`    ${C.ok}✓${C.r} 平立剖交叉校验无冲突（剖切避柱 · 洞口对齐 · 总高自洽）`)
  }
  if (!fin.model.detail) {
    console.log(`${C.dim}    保守模式：${fin.model.degradeReasons.join(' / ')}${C.r}`)
  }
}

console.log(`\n${C.b}══════════════════════════════════════${C.r}`)
if (totalMissing === 0) {
  console.log(`${C.ok}${C.b}全部通过：引擎已具备这些真实建筑的表达能力${C.r}\n`)
} else {
  console.log(`${C.bad}${C.b}${totalMissing} 项与真实图纸不符${C.r}`)
  console.log(`${C.b}改造清单：${C.r}`)
  fixList.forEach((t, i) => console.log(`  ${i + 1}. ${t}`))
  console.log()
}
process.exit(0)
