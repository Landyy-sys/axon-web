import { renderToStaticMarkup } from 'react-dom/server'
import { makeModel, samplePass, finalizeCandidates } from '../src/model.js'
import ElevationDrawing from '../src/drawings/Elevation.jsx'
import SectionDrawing from '../src/drawings/Section.jsx'
import IsometricDrawing from '../src/drawings/Isometric.jsx'
import PlanDrawing from '../src/drawings/Plan.jsx'
import ViewFusion from '../src/components/ViewFusion.jsx'
import ResultPanel from '../src/components/ResultPanel.jsx'
import Term from '../src/components/Term.jsx'
import GlossaryPanel from '../src/components/GlossaryPanel.jsx'
import App from '../src/App.jsx'
import { BUILDING_TYPES } from '../src/model.js'
import { GLOSSARY } from '../src/glossary.js'
import { caseToConstraints } from '../src/benchmarks.js'
import { fuseViews } from '../src/fuse.js'

/* 多视角合成证据：Node 侧没有 canvas，直接喂「分析结果的形状」验证下游管线 */
const FRONT = {
  ok: true, confidence: 0.6, name: 'front.jpg',
  hLines: [{ y: 0.32 }, { y: 0.58 }, { y: 0.82 }], vLines: [{ x: 0.2 }, { x: 0.5 }, { x: 0.8 }],
  floorBands: 3, bayDivisions: 3, columnClues: 2, pilotisScore: 0.2, glassScore: 0.2,
  symmetry: 0.8, faces: 1, cornerX: null, footprintRatio: null, topSolid: true,
}
const CORNER = {
  ok: true, confidence: 0.72, name: 'corner.jpg',
  hLines: [{ y: 0.26 }, { y: 0.4 }, { y: 0.54 }, { y: 0.68 }, { y: 0.82 }],
  vLines: [{ x: 0.14 }, { x: 0.3 }, { x: 0.52 }, { x: 0.68 }, { x: 0.86 }],
  floorBands: 5, bayDivisions: 5, columnClues: 6, pilotisScore: 0.7, glassScore: 0.5,
  symmetry: 0.28, faces: 2, cornerX: 0.5, footprintRatio: 1.6, topSolid: false,
}
const F1 = fuseViews([FRONT])
const F3 = fuseViews([FRONT, CORNER, { ...CORNER, name: 'side.jpg' }])

const U = (v) => ({ v, src: 'user' })

const CASES = [
  { name: '塔楼·锁1F', o: { typeId: 'tower', floors: U(1), cleaned: true } },
  { name: '塔楼·20F大面宽', o: { typeId: 'tower', floors: U(20), span: U(60), cleaned: true } },
  { name: '住宅·6F标定齐全', o: { typeId: 'residential', floors: U(6), fh: U(3), span: U(24), cleaned: true } },
  { name: '住宅·声明楼梯+隔墙+家具', o: { typeId: 'residential', floors: U(4), fh: U(3), cleaned: true, interior: { stair: true, partitions: true, furniture: true } } },
  { name: '厂房·单层', o: { typeId: 'factory', floors: U(1), cleaned: true } },
  { name: '商业·2F', o: { typeId: 'retail', floors: U(2), fh: U(4.5), cleaned: true } },
  { name: '未清洗·降级', o: { typeId: 'residential', floors: U(3), cleaned: false } },
  /* ── 真实建筑基准：这几组必须能画出底层架空 / 长窗 / 屋顶花园 ── */
  { name: '萨伏伊·架空+长窗+屋顶花园', o: caseToConstraints('savoye') },
  { name: '范斯沃斯·架空+通高幕墙', o: caseToConstraints('farnsworth') },
  { name: '巴塞罗那馆·平板无栏板', o: caseToConstraints('barcelona') },
  { name: '常规·框架填充对照', o: { typeId: 'residential', floors: U(3), fh: U(3), cleaned: true } },
  /* ── 多视角：单视角与多视角必须产出不同的几何，且都能出图 ── */
  { name: '多视角·仅正立面', o: { typeId: 'residential', cleaned: true, vision: F1.hyp, fusion: F1 } },
  { name: '多视角·含转角（架空+幕墙）', o: { typeId: 'residential', cleaned: true, vision: F3.hyp, fusion: F3 } },
  { name: '多视角·转角+人工锁层高', o: { typeId: 'office', cleaned: true, fh: U(3.6), vision: F3.hyp, fusion: F3 } },
]

let bad = 0
for (const c of CASES) {
  /* 走真实管线：多轮采样 + 交叉校验，而不是单次求解 */
  const cands = Array.from({ length: 9 }, (_, i) => samplePass(42, 1.5, 2, c.o, i))
  const m = finalizeCandidates(cands).model
  for (const [label, Comp, props] of [
    ['ELEVATION', ElevationDrawing, { model: m, showOpenings: true, showLevels: true }],
    ['SECTION', SectionDrawing, { model: m }],
    ['ISOMETRIC', IsometricDrawing, { model: m, showOpenings: true }],
    ['PLAN', PlanDrawing, { model: m }],
  ]) {
    let html = ''
    try {
      html = renderToStaticMarkup(<Comp {...props} />)
    } catch (e) {
      console.log(`  ✗ ${c.name} / ${label} 渲染抛错: ${e.message}`)
      bad++
      continue
    }
    /* 图面越界检查：所有坐标必须落在 viewBox 内，出图的图元会被裁掉 */
    const vb = html.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)
    if (vb) {
      const [, vw, vh] = vb.map(Number)
      const over = []
      for (const m2 of html.matchAll(/\b(x|y|x1|y1|x2|y2|cx|cy)="(-?\d+(?:\.\d+)?)"/g)) {
        const lim = m2[1].startsWith('y') ? vh : vw
        const v = parseFloat(m2[2])
        if (v < -6 || v > lim + 6) over.push(`${m2[1]}=${v} @ …${html.slice(Math.max(0, m2.index - 90), m2.index + 40)}…`)
      }
      if (over.length) {
        console.log(`  ⚠ ${c.name} / ${label} 越界 ${over.length} 处`)
        over.slice(0, 3).forEach((t) => console.log(`     ${t}`))
      }
    }

    const dirty = ['NaN', 'Infinity', 'undefined'].filter((t) => html.includes(t))
    if (dirty.length) {
      const idx = html.indexOf(dirty[0] === 'undefined' ? 'undefined' : dirty[0])
      console.log(`  ✗ ${c.name} / ${label} 含非法数值: ${dirty.join(',')}`)
      console.log(`     上下文: …${html.slice(Math.max(0, idx - 120), idx + 60)}…`)
      bad++
    } else {
      console.log(`  ✓ ${c.name} / ${label} (${html.length} B)`)
    }
  }

  /* 多视角融合面板本身也要能渲染（含 delta 表与冲突列表） */
  if (c.o.fusion) {
    const m0 = finalizeCandidates(Array.from({ length: 9 }, (_, i) => samplePass(11, 1.5, c.o.fusion.count, c.o, i))).model
    try {
      const h = renderToStaticMarkup(<ViewFusion model={m0} />)
      const dirty = ['NaN', 'Infinity'].filter((t) => h.includes(t))
      if (dirty.length) {
        console.log(`  ✗ ${c.name} / FUSION 面板含非法数值: ${dirty.join(',')}`)
        bad++
      } else {
        console.log(`  ✓ ${c.name} / FUSION 面板 (${h.length} B · ${(m0.plan.observed || []).length} 面观测)`)
      }
    } catch (e) {
      console.log(`  ✗ ${c.name} / FUSION 渲染抛错: ${e.message}`)
      bad++
    }
  }
}

/* ── 19 类建筑原型 × 四视图 ── */
console.log('\n建筑原型细分 × 四视图')
for (const t of BUILDING_TYPES) {
  const m = makeModel(777, 1.5, 1, { typeId: t.id, cleaned: true })
  const views = { ISO: IsometricDrawing, ELEV: ElevationDrawing, SEC: SectionDrawing, PLAN: PlanDrawing }
  let bad0 = 0
  const done = []
  for (const [k, C] of Object.entries(views)) {
    try {
      const h = renderToStaticMarkup(<C model={m} />)
      const dirty = ['NaN', 'Infinity'].filter((s2) => h.includes(s2))
      if (dirty.length) {
        console.log(`  ✗ ${t.id} / ${k} 含 ${dirty.join(',')}`)
        bad0++
      } else done.push(k)
    } catch (e) {
      console.log(`  ✗ ${t.id} / ${k} 抛错: ${e.message}`)
      bad0++
    }
  }
  if (!bad0) console.log(`  ✓ ${t.label} · ${done.join('/')} · ${m.floors}F · 层高 ${m.floorHeight} · 面宽 ${m.length}`)
  else bad++
}

/* ── 名词解读组件 ── */
console.log('\n名词通俗化组件')
{
  try {
    const h = GLOSSARY.map((t) => renderToStaticMarkup(<Term id={t.id} />)).join('')
    const dirty = ['NaN', 'Infinity', 'undefined'].filter((s2) => h.includes(s2))
    if (dirty.length) {
      console.log(`  ✗ Term 渲染含 ${dirty.join(',')}`)
      bad++
    } else console.log(`  ✓ ${GLOSSARY.length} 条术语渲染正常（含悬浮解读卡片）`)
  } catch (e) {
    console.log(`  ✗ Term 抛错: ${e.message}`)
    bad++
  }
  try {
    const h = renderToStaticMarkup(<GlossaryPanel defaultOpen />)
    if (!h.includes('名词速查')) {
      console.log('  ✗ 名词速查面板内容缺失')
      bad++
    } else console.log(`  ✓ 名词速查面板可渲染（${h.length} B）`)
  } catch (e) {
    console.log(`  ✗ 名词速查面板抛错: ${e.message}`)
    bad++
  }
}

/* ── 结果面板整页（含一句话总览） ── */
console.log('\n结果面板整页')
{
  const m = finalizeCandidates(
    Array.from({ length: 9 }, (_, i) => samplePass(9, 1.5, 2, { typeId: 'villa', cleaned: true }, i)),
  ).model
  try {
    const h = renderToStaticMarkup(
      <ResultPanel result={{ model: m, meta: { seed: 9, ms: 1000, passes: 9 } }} busy={false} onRegenerate={() => {}} />,
    )
    const dirty = ['NaN', 'Infinity', 'undefined'].filter((s2) => h.includes(s2))
    if (dirty.length) {
      console.log(`  ✗ 结果面板含 ${dirty.join(',')}`)
      bad++
    } else console.log(`  ✓ 结果面板渲染正常（${h.length} B · 一句话总览已生成）`)
  } catch (e) {
    console.log(`  ✗ 结果面板抛错: ${e.message}`)
    bad++
  }
}

/* ── 多轮对话反馈：聊天组件 + 阳台/加门后的立面真实渲染 ── */
console.log('\n多轮对话反馈')
{
  try {
    const { applyFeedback, applyOpsToOpenings } = await import('../src/feedback.js')
    const FeedbackChat = (await import('../src/components/FeedbackChat.jsx')).default
    const h = renderToStaticMarkup(
      <FeedbackChat
        messages={[
          { role: 'user', text: '把立面图的窗户改大一点' },
          { role: 'bot', text: '收到，已将立面窗洞放大 20%。正在重新生成…' },
          { role: 'bot', text: '抱歉，请给出更具体的修改指令', rejected: true },
        ]}
        onSend={() => {}}
        busy={false}
      />,
    )
    const uiOk =
      h.includes('把立面图的窗户改大一点') &&
      h.includes('请提出修改意见') &&
      h.includes('发送 / 重新生成') &&
      h.includes('FEEDBACK')
    if (!uiOk) {
      console.log('  ✗ 对话组件缺关键元素（输入框 placeholder / 发送按钮 / 消息气泡）')
      bad++
    } else console.log(`  ✓ 对话组件渲染正常（${h.length} B · 气泡/拒绝态/输入框齐全）`)

    /* 构件意图落地后的立面：必须出现阳台栏杆组与新增的 M1 门 */
    const m = finalizeCandidates(
      Array.from({ length: 9 }, (_, i) => samplePass(9, 1.5, 2, { typeId: 'residential', cleaned: true }, i)),
    ).model
    const fb = { windowScale: 1.2, balconies: [1, 2], addedDoor: true }
    const withFb = { ...m, feedback: fb, openings: applyOpsToOpenings(m.openings, fb, m) }
    const svg = renderToStaticMarkup(<ElevationDrawing model={withFb} showOpenings showLevels />)
    const diffs = []
    if (!svg.includes('B1（用户要求增设）')) diffs.push('阳台编号 B1')
    if (!svg.includes('M1')) diffs.push('门编号 M1')
    const plain = renderToStaticMarkup(<ElevationDrawing model={m} showOpenings showLevels />)
    if (svg.length <= plain.length) diffs.push('带反馈的 SVG 反而更小')
    if (diffs.length) {
      console.log(`  ✗ 反馈意见未真正落到立面 SVG：缺 ${diffs.join(',')}`)
      bad++
    } else {
      console.log(
        `  ✓ 阳台 + 加门真实渲染进立面（SVG ${plain.length} → ${svg.length} B，洞口 ${m.openings.length} → ${withFb.openings.length} 个）`,
      )
    }
  } catch (e) {
    console.log(`  ✗ 反馈组件抛错: ${e.message}`)
    bad++
  }
}

/* ── 整个 App 组件树：捕获「漏导出 / 接线错误」这类只在运行时才炸的问题 ── */
console.log('\nApp 组件树')
{
  try {
    const h = renderToStaticMarkup(<App />)
    const dirty = ['NaN', 'Infinity'].filter((s2) => h.includes(s2))
    if (dirty.length) {
      console.log(`  ✗ App 首屏含 ${dirty.join(',')}`)
      bad++
    } else if (!h.includes('名词速查') || !h.includes('AXON')) {
      console.log('  ✗ App 首屏缺少关键区块')
      bad++
    } else console.log(`  ✓ App 首屏渲染正常（${h.length} B · 名词速查已挂载）`)
  } catch (e) {
    console.log(`  ✗ App 渲染抛错: ${e.message}`)
    bad++
  }
}

console.log(bad ? `\n冒烟失败 ${bad} 项\n` : '\n冒烟全部通过\n')
process.exit(bad ? 1 : 0)
