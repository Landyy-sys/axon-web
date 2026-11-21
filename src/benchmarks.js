/**
 * ══════════════════════════════════════════════════════════════
 *  真实建筑基准案例库 · GROUND TRUTH
 * ══════════════════════════════════════════════════════════════
 *
 *  用途：把「真实建筑图纸上有什么」固化成机器可读的真值，
 *        用来逐项 diff 引擎输出，找出我们的图差在哪。
 *
 *  ⚠ 数据标定原则（与本项目「不臆想」红线一致）：
 *    · 每个数值都标 src（出处）与 tol（容差）
 *    · src='measured'   —— 多来源一致的可查实测值
 *    · src='graphical'  —— 由公开图纸按比例量读，误差较大
 *    · src='derived'    —— 由上述两项推算
 *    · 拿不准的一律标 tol 并写 judged，绝不冒充精确值
 */

export const CASE_LIB = [
  {
    id: 'savoye',
    name: '萨伏伊别墅',
    en: 'Villa Savoye, Poissy',
    architect: 'Le Corbusier & Pierre Jeanneret',
    year: '1928–1931',
    /* 多角度：四个方向立面均有实测照片，是研究最充分的现代建筑之一 */
    views: 4,
    photoRef:
      'forgemind.net/media/le-corbusier-villa-savoye · Wikipedia:Villa Savoye · chiselandmouse.com（含东西向 / 南北向剖面、三层平面）',

    /* ── 体量 ── */
    span: { v: 21.5, src: 'measured', tol: 0.3, note: '长约 21.5 m（70.5 ft），多来源一致' },
    depth: { v: 19.0, src: 'measured', tol: 0.3, note: '宽约 19 m（62.3 ft）' },
    /* ⚠ 层数语义必须说清楚，否则会算出荒谬的层高：
       常被称「三层」= 底层架空 + 二层 piano nobile + 屋顶露台，
       但只有二层是完整居住空间，屋顶是露台不计层数。
       因此这里记 1 层主体 + 架空 2.75 + 屋面栏板 1.0，总高 ≈ 6.9 m。 */
    floors: { v: 1, src: 'measured', tol: 0, note: '主体一层居住空间；底层架空、屋顶露台不计层数' },
    totalH: {
      v: 2.58, src: 'derived', tol: 0.3,
      note: '±0.000（二层完成面）至屋面完成面 = 净高 2.26 + 楼板 0.32',
    },
    overallH: {
      v: 6.9, src: 'graphical', tol: 0.4,
      note: '室外地坪至弧墙顶 ≈ 架空 2.75 + 2.58 + 栏板 1.0 + 弧墙 0.6',
    },

    /* ── 结构：这是最大的一条差异 ── */
    structure: {
      system: 'pilotis',
      pilotiH: { v: 2.75, src: 'graphical', tol: 0.3, note: '底层架空净高，汽车可驶入' },
      grid: { v: 4.75, src: 'measured', tol: 0.1, note: '柱网 4.75 m 中距，双向' },
      note: '多米诺体系：柱 + 楼板承重，外墙完全不承重 → 自由立面 / 自由平面',
    },

    /* ── 洞口：横向长窗，柯布五点之四 ── */
    fenestration: {
      kind: 'ribbon',
      sill: { v: 0.45, src: 'graphical', tol: 0.15, note: '长窗下缘距本层完成面约 0.4–0.6 m' },
      head: { v: 2.26, src: 'measured', tol: 0.1, note: '长窗上缘顶到顶，与净高 2.26 m 齐平' },
      note: '横向长窗贯通整条立面、转过转角，不被开间打断 —— 引擎原本只能画逐开间的独立窗',
    },

    /* ── 屋面：屋顶花园，柯布五点之二 ── */
    roof: {
      kind: 'roofGarden',
      parapet: { v: 1.0, src: 'graphical', tol: 0.2, note: '屋顶栏板兼挡风墙' },
      features: ['roofGarden', 'curvedScreen', 'solarium', 'ramp'],
      note: '平屋面 + 屋顶花园 + 弧形挡风墙围合的日光浴场，坡道自二层直达屋面',
    },

    /* ── 平面：自由平面，柯布五点之三 ── */
    plan: {
      kind: 'free',
      note: '内墙不承重、不落在柱网上，房间自由排布 —— 平面不能由开间网格反推',
      rooms: ['门厅', '车库', '仆人房', '起居室', '主卧', '厨房', '屋顶花园', '日光浴场'],
    },

    /* ── 底层平面真值（本次新增，用来训练平面图） ──
       来源：公开底层平面图 + 多米诺体系研究文献
       纵横双向各 4 跨 × 4.75 m = 19 m，前后左右各悬挑 1.25 m 凑出 21.5 × 19 m。
       底层三面透空，弧形玻璃围合（顺应 1927 雪铁龙转弯半径），
       内设门厅 / 车库 / 洗衣房 / 仆人房，坡道居中，另有螺旋楼梯。 */
    planTruth: {
      grid: { v: 4.75, tol: 0.1 },
      spansX: { v: 4, tol: 0, note: '面宽向 4 跨' },
      spansY: { v: 4, tol: 0, note: '进深向 4 跨' },
      cantilever: { v: 1.25, tol: 0.45, note: '柯布 1.25 m 模数，四面各悬挑一档' },
      colsX: { v: 5, tol: 0, note: '4 跨 → 5 排柱' },
      colsY: { v: 5, tol: 0, note: '4 跨 → 5 榀' },
      stair: '螺旋楼梯 + 折形坡道',
      groundRooms: ['门厅', '车库', '洗衣房', '仆人房'],
      note: '弧形玻璃围合顺应车道转弯半径；坡道自门厅居中上行至二层',
    },

    /* ── 真实图纸必备表达项（diff 的检查清单） ── */
    required: [
      { key: 'pilotis', label: '底层架空柱廊（pilotis）' },
      { key: 'ribbonWindow', label: '横向长窗贯通立面' },
      { key: 'roofGarden', label: '屋顶花园 / 栏板' },
      { key: 'curvedScreen', label: '曲面挡风墙（solarium）' },
      { key: 'ramp', label: '坡道（建筑漫步）' },
      { key: 'columnGrid', label: '柱网 4.75 m 与开间解耦' },
      { key: 'noPlinth', label: '无勒脚（底层透空）' },
      { key: 'flatRoof', label: '平屋面无挑檐' },
      /* ── 平面图必备表达 ── */
      { key: 'planAxis', label: '平面双向轴线 + 圆圈编号' },
      { key: 'planColumns', label: '平面柱网 5×5 交点' },
      { key: 'planCantilever', label: '柱网内收 · 外皮悬挑 1.25 m' },
      { key: 'planCut', label: '剖切线 A—A 避开柱位' },
      { key: 'planOpenings', label: '平面洞口与立面一一对应' },
      { key: 'planOmission', label: '室内未建模项显式声明' },
    ],
  },

  {
    id: 'farnsworth',
    name: '范斯沃斯住宅',
    en: 'Farnsworth House, Plano',
    architect: 'Mies van der Rohe',
    year: '1945–1951',
    views: 4,
    photoRef: 'Wikipedia:Farnsworth House · 四面全玻璃，架空于洪泛区之上',

    span: { v: 23.5, src: 'measured', tol: 0.5, note: '长约 23.5 m（77 ft）' },
    depth: { v: 8.8, src: 'measured', tol: 0.5, note: '进深约 8.8 m（29 ft）' },
    floors: { v: 1, src: 'measured', tol: 0, note: '单层' },
    totalH: { v: 3.0, src: 'graphical', tol: 0.3, note: '±0.000 室内完成面至屋面完成面约 3.0 m' },
    overallH: { v: 4.6, src: 'graphical', tol: 0.4, note: '地坪至屋面 ≈ 架空 1.6 + 3.0' },

    structure: {
      system: 'pilotis',
      pilotiH: { v: 1.6, src: 'graphical', tol: 0.3, note: '架空约 1.6 m，高于洪水位' },
      grid: { v: 6.7, src: 'measured', tol: 0.3, note: '钢柱间距约 6.7 m（22 ft）' },
      note: '8 根外露 H 型钢柱支承上下两片楼板，柱在幕墙外侧',
    columnsOutside: true,
    },
    fenestration: {
      kind: 'curtain',
      sill: { v: 0.0, src: 'measured', tol: 0.1, note: '整层通高玻璃' },
      head: { v: 3.0, src: 'graphical', tol: 0.2, note: '玻璃到顶，与结构同高' },
      note: '通高玻璃幕墙，柱在玻璃外侧 —— 玻璃不被柱打断',
    },
    roof: {
      kind: 'flatSlab',
      parapet: { v: 0, src: 'measured', tol: 0, note: '无女儿墙，屋面板直接出挑' },
      features: ['flatSlab', 'cantilever'],
      note: '上下两片白色钢平板 + 玻璃盒，屋面板外挑',
    },
    plan: { kind: 'free', rooms: ['起居', '卧室', '厨房', '卫浴', '外廊'] },
    /* 平面真值：8 根 H 型钢柱（两侧各 4 根，柱距约 6.7 m），
       核心筒（卫浴 + 设备）居中不与外墙相接，其余全部通透。 */
    planTruth: {
      grid: { v: 6.7, tol: 0.3 },
      spansX: { v: 3, tol: 1, note: '面宽向约 3 跨' },
      cantilever: { v: 1.7, tol: 0.8, note: '两端各悬挑（23.5 − 3×6.7 = 3.4）' },
      colsX: { v: 4, tol: 1, note: '每侧 4 根 × 两侧 = 8 根' },
      stair: '室外台阶',
      groundRooms: ['起居', '卧室', '厨房', '卫浴核心筒', '外廊'],
      note: '核心筒居中 · 柱在幕墙外侧，平面上看柱落在玻璃之外',
    },
    required: [
      { key: 'pilotis', label: '底层架空（钢柱）' },
      { key: 'curtainWall', label: '通高玻璃幕墙' },
      { key: 'columnOutside', label: '柱在玻璃外侧' },
      { key: 'noParapet', label: '无女儿墙 · 屋面板出挑' },
      { key: 'columnGrid', label: '柱网与立面对位' },
      { key: 'planAxis', label: '平面双向轴线 + 圆圈编号' },
      { key: 'planColumns', label: '平面柱网按柱距排布' },
      { key: 'planCantilever', label: '柱网内收 · 外皮悬挑' },
      { key: 'planCut', label: '剖切线 A—A 避开柱位' },
      { key: 'planOpenings', label: '平面洞口与立面一一对应' },
      { key: 'planOmission', label: '室内未建模项显式声明' },
    ],
  },

  {
    id: 'barcelona',
    name: '巴塞罗那德国馆',
    en: 'Barcelona Pavilion',
    architect: 'Mies van der Rohe',
    year: '1929',
    views: 4,
    photoRef: 'Wikipedia:Barcelona Pavilion · 8 根十字钢柱 + 独立墙片',

    span: { v: 50.0, src: 'graphical', tol: 2, note: '基座约 50 m × 25 m（馆体更小）' },
    depth: { v: 25.0, src: 'graphical', tol: 2, note: '含水池与基座' },
    floors: { v: 1, src: 'measured', tol: 0, note: '单层' },
    totalH: { v: 3.4, src: 'graphical', tol: 0.3, note: '馆体净高约 3.0–3.4 m' },

    structure: {
      system: 'columns',
      pilotiH: { v: 0, src: 'measured', tol: 0, note: '不架空，落在基座上' },
      grid: { v: 5.6, src: 'graphical', tol: 0.6, note: '8 根十字断面钢柱，间距不等' },
      note: '柱与承重墙分离，墙片独立 free-standing —— 平面完全不由网格决定',
    },
    fenestration: {
      kind: 'ribbon',
      sill: { v: 0.1, src: 'graphical', tol: 0.1, note: '通高玻璃' },
      head: { v: 3.0, src: 'graphical', tol: 0.2, note: '到顶' },
      note: '大面积通高玻璃 + 独立墙片，室内外界限模糊',
    },
    roof: {
      kind: 'flatSlab',
      parapet: { v: 0, src: 'measured', tol: 0, note: '平板屋面无栏板，靠柱支承' },
      features: ['flatSlab', 'freeWalls'],
      note: '屋面板由 8 根柱支承，薄板出挑',
    },
    plan: { kind: 'free', rooms: ['展厅', '水池', '雕塑庭院', '服务间'] },
    /* 平面真值：8 根十字断面钢柱（间距不等）+ 独立墙片，
       墙片完全不落在柱网上 —— 平面无法由网格反推。 */
    planTruth: {
      grid: { v: 5.6, tol: 0.6 },
      spansX: { v: 8, tol: 2, note: '基座向约 8 跨' },
      cantilever: { v: 2.6, tol: 1.2, note: '柱网内收于基座之内' },
      stair: '无（单层展馆）',
      groundRooms: ['展厅', '水池', '雕塑庭院', '服务间'],
      note: '独立墙片不落柱网，平面图不能按柱网切房间',
    },
    required: [
      { key: 'freeWalls', label: '独立墙片 · 不落在柱网上' },
      { key: 'flatSlab', label: '平板屋面 · 柱承' },
      { key: 'noParapet', label: '无女儿墙' },
      { key: 'planAxis', label: '平面双向轴线 + 圆圈编号' },
      { key: 'planColumns', label: '平面柱网按柱距排布' },
      { key: 'planCut', label: '剖切线 A—A 避开柱位' },
      { key: 'planOpenings', label: '平面洞口与立面一一对应' },
      { key: 'planOmission', label: '室内未建模项显式声明' },
    ],
  },
]

/** 把案例真值转成 makeModel 认得的约束集 */
export function caseToConstraints(id) {
  const cs = CASE_LIB.find((c) => c.id === id)
  if (!cs) return {}
  return {
    typeId: cs.structure.system === 'pilotis' ? 'residential' : 'residential',
    /* 全部按 user 级注入：真值就是人工设定，优先级最高 */
    span: { v: cs.span.v, src: 'user' },
    depth: { v: cs.depth.v, src: 'user' },
    floors: { v: cs.floors.v, src: 'user' },
    /* ⚠ 基准换算：案例真值的 totalH 以「±0.000 首层完成面」为基准，
       而引擎的 totalH 以 z=0（室外地坪）为基准。
       架空建筑必须补上架空高度，否则层高会被算成负数并 clamp 到下限。
       萨伏伊：2.75 + 2.58 = 5.33 → 层高 2.58（净高 2.26 + 楼板 0.32）✓ */
    totalH: { v: (cs.structure?.pilotiH?.v ?? 0) + cs.totalH.v, src: 'user' },
    cleaned: true,
    /* 新增的结构 / 洞口 / 屋面语义 */
    structure: cs.structure.system,
    pilotiH: { v: cs.structure.pilotiH.v, src: 'user' },
    grid: { v: cs.structure.grid.v, src: 'user' },
    fenestration: cs.fenestration.kind,
    sill: { v: cs.fenestration.sill.v, src: 'user' },
    head: { v: cs.fenestration.head.v, src: 'user' },
    roof: cs.roof.kind,
    parapet: { v: cs.roof.parapet.v, src: 'user' },
    columnsOutside: !!cs.structure.columnsOutside,
    planFree: cs.plan?.kind === 'free',
  }
}

export const getCase = (id) => CASE_LIB.find((c) => c.id === id)

/**
 * 侧栏一键套用的建筑原型。
 * 前三个是真实建筑的实测真值，最后一个是常规对照。
 */
export const PRESETS = [
  {
    id: 'savoye',
    label: '萨伏伊别墅',
    note: '架空 2.75 · 长窗 · 屋顶花园 · 柱网 4.75',
    c: caseToConstraints('savoye'),
  },
  {
    id: 'farnsworth',
    label: '范斯沃斯住宅',
    note: '架空 1.6 · 通高幕墙 · 柱在玻璃外',
    c: caseToConstraints('farnsworth'),
  },
  {
    id: 'barcelona',
    label: '巴塞罗那馆',
    note: '独立柱 · 平板屋面 · 自由墙片',
    c: caseToConstraints('barcelona'),
  },
  {
    id: 'normal',
    label: '常规框架',
    note: '落地 · 逐开间窗 · 女儿墙平屋面（对照）',
    c: { structure: 'frame', fenestration: 'window', roof: 'parapet' },
  },
]
