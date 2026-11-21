/* ═══════════════════════════════════════════════════════════════════════
   src/fuse.js —— 多视角证据融合

   把 vision.js 逐张图算出的 ViewFacts 融合成「可以被约束引擎消费的假设」。
   设计原则与全局一致：**没有视觉证据就不输出** —— 每张 tarQ evidence
   必须达到票数门槛才写进假设，证据不足的项保持空值，让引擎退回类型常识。

   融合产物全部打 src:'vision'，优先级排在「人工标定 calib」之下、
   「类型常识 type」之上 —— 照片说的不算数，但比拍脑袋的常识准。

   同时输出三样东西给 UI：
     · contributions —— 每个视角具体贡献了哪几条结论（回答「多传的图有没有用」）
     · conflicts     —— 视角之间互相矛盾的地方
     · single        —— 只用第一张时融合出的假设，用来和多视角结果对照
   ═══════════════════════════════════════════════════════════════════════ */

const SUPPORT_MIN = 0.5 // 至少半数可用视角同意才采纳

const r2 = (v) => Math.round(v * 100) / 100

function median(arr) {
  if (!arr.length) return null
  const s = [...arr].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function mode(arr) {
  if (!arr.length) return null
  const map = new Map()
  for (const v of arr) map.set(v, (map.get(v) || 0) + 1)
  let best = null, bestN = 0
  for (const [v, n] of map) if (n > bestN || (n === bestN && v < best)) {
    best = v
    bestN = n
  }
  return { value: best, count: bestN }
}

/** 判断单个视角的拍摄角色 */
export function classifyRole(f) {
  if (!f || !f.ok) return { role: 'unknown', label: '未解析' }
  if (f.faces >= 2 && f.cornerX != null) {
    return { role: 'corner', label: '转角视角 · 同时可见两个立面' }
  }
  /* 单面透视：竖向线向一侧明显加密 → 斜向拍摄同一立面 */
  const L = (f.vLines || []).filter((l) => l.x < 0.4).length
  const R = (f.vLines || []).filter((l) => l.x > 0.6).length
  const total = L + R
  if (total >= 4 && Math.abs(L - R) / total > 0.45) {
    return { role: 'oblique', label: '斜视角 · 同一立面透视收敛' }
  }
  if (f.symmetry > 0.62) return { role: 'frontal', label: '正向立面 · 近似对称' }
  return { role: 'frontal', label: '正向立面' }
}

/* ── 核心：对一组 facts 做融合（不含 single 对照，避免递归） ── */
function fuseOnce(facts) {
  const usable = (facts || []).filter((f) => f && f.ok && f.confidence > 0.3)
  const roles = usable.map((f) => {
    const { role, label } = classifyRole(f)
    return { ...f, role, roleLabel: label }
  })
  const n = roles.length
  const hyp = {}
  const votes = {}
  const contributions = []
  const conflicts = []

  const enough = (count) => n > 0 && count / n >= SUPPORT_MIN

  /* ── ① 层数：由「楼层带」投票 ── */
  const floorVotes = roles.map((f) => f.floorBands).filter((v) => v >= 1)
  if (floorVotes.length) {
    const mo = mode(floorVotes)
    votes.floors = { values: floorVotes, agree: mo.count }
    if (enough(mo.count)) {
      hyp.floors = { v: Math.max(1, Math.round(mo.value)), src: 'vision' }
    } else {
      const md = median(floorVotes)
      /* 票数不足时仍然给出、但降级为 infer（不压过类型常识） */
      hyp.floors = { v: Math.max(1, Math.round(md)), src: 'infer' }
    }
    if (new Set(floorVotes).size > 1) {
      conflicts.push({
        key: 'floors',
        msg: `各视角读到的楼层带不一致：${floorVotes.join('/')} 层，已按众数 ${mo.value} 层定性`,
        values: floorVotes,
      })
    }
  }

  /* ── ② 开间：深度学习竖向分格（不含两端勒口），只有正视/转角视角可信 ── */
  const bayVotes = roles
    .filter((f) => f.role === 'frontal' || f.role === 'corner')
    .map((f) => f.bayDivisions + 1)
    .filter((v) => v >= 2 && v <= 30)
  if (bayVotes.length) {
    const mo = mode(bayVotes)
    votes.bays = { values: bayVotes, agree: mo.count }
    if (enough(mo.count)) hyp.bays = { v: mo.value, src: 'vision' }
    else hyp.bays = { v: Math.round(median(bayVotes)), src: 'infer' }
    if (new Set(bayVotes).size > 1) {
      conflicts.push({ key: 'bays', msg: `各视角竖向分格不一致：${bayVotes.join('/')} 开间`, values: bayVotes })
    }
  }

  /* ── ③ 底层架空：暗带 + 柱列线索，任一视角强命中即可定性 ── */
  const pilotisHit = roles.filter((f) => f.pilotisScore > 0.5)
  if (enough(pilotisHit.length)) {
    hyp.structure = 'pilotis'
    votes.pilotis = { agree: pilotisHit.length, values: roles.map((f) => f.pilotisScore) }
  }

  /* ── ④ 洞口方式：冷色玻璃 + 网格密度 ── */
  const glass = median(roles.map((f) => f.glassScore).filter((v) => v != null))
  if (glass != null) {
    votes.glass = { value: glass }
    if (glass > 0.5) hyp.fenestration = 'curtain'
    else if (glass > 0.32) hyp.fenestration = 'ribbon'
  }

  /* ── ⑤ 屋面：顶部是否有一道实体檐口/女儿墙 ── */
  const solid = roles.filter((f) => f.topSolid).length
  if (enough(solid)) hyp.roof = 'parapet'
  else if (n && solid === 0 && glass > 0.45) hyp.roof = 'flatSlab'

  /* ── ⑥ 观测到的立面：这是「多传几张图」最直接的收益 ──
     每多一个独立的机位/角色，就多一个可视立面；转角视角一次给两个。 */
  let observed = 0
  for (const f of roles) observed += f.role === 'corner' ? 2 : f.role === 'unknown' ? 0 : 1
  const faceOrder = ['south', 'east', 'west', 'north']
  const observedFaces = faceOrder.slice(0, Math.min(4, Math.max(1, observed)))
  hyp.observed = observedFaces

  /* ── ⑦ 平面比例：转角视角能同时看到两个面 → 面宽 / 进深 比 ── */
  const ratios = roles.filter((f) => f.footprintRatio).map((f) => f.footprintRatio)
  if (ratios.length) {
    const md = r2(median(ratios))
    hyp.footprintRatio = { v: Math.min(3, Math.max(1, md)), src: 'vision' }
    votes.footprintRatio = { values: ratios }
    if (Math.max(...ratios) - Math.min(...ratios) > 0.5) {
      conflicts.push({ key: 'footprintRatio', msg: `各视角给出的面宽/进深比差异较大：${ratios.join(' / ')}`, values: ratios })
    }
  }

  /* ── 每个视角具体贡献了什么（UI 直接展示） ── */
  for (const f of roles) {
    const items = []
    items.push({ key: 'detected', value: `${f.hLines.length} 条横结构线 / ${f.vLines.length} 条竖结构线` })
    if (f.floorBands >= 1) items.push({ key: 'floors', value: `${f.floorBands} 个楼层带` })
    if (f.bayDivisions + 1 >= 2) items.push({ key: 'bays', value: `${f.bayDivisions + 1} 开间` })
    if (f.pilotisScore > 0.5) items.push({ key: 'pilotis', value: `底层架空置信 ${r2(f.pilotisScore)}` })
    if (f.glassScore > 0.32) items.push({ key: 'glass', value: `玻璃占比 ${r2(f.glassScore)}` })
    if (f.cornerX != null) items.push({ key: 'corner', value: `转角 @ x=${r2(f.cornerX)}` })
    if (f.topSolid) items.push({ key: 'roof', value: '顶部实体檐口' })
    contributions.push({
      id: f.id ?? f.name ?? `v${contributions.length}`, name: f.name, role: f.role, roleLabel: f.roleLabel,
      faces: f.role === 'corner' ? 2 : 1,
      items,
    })
  }

  return { count: n, total: (facts || []).length, roles, hyp, votes, contributions, conflicts }
}

/**
 * 融合全部视角，并额外给出「只传第一张」的对照结果。
 * @param {Array} facts ViewFacts[]
 */
export function fuseViews(facts) {
  const fused = fuseOnce(facts)
  const first = (facts || []).slice(0, 1)
  const single = first.length ? fuseOnce(first) : null

  /* 与单视角对照：列出多视角带来的实际增量 */
  const gained = []
  if (single) {
    const keys = [
      ['floors', '层数'], ['bays', '开间数'], ['structure', '结构体系'],
      ['fenestration', '洞口方式'], ['roof', '屋面形式'], ['footprintRatio', '面宽/进深比'],
    ]
    for (const [k, label] of keys) {
      const a = single.hyp[k]
      const b = fused.hyp[k]
      const va = a && a.v != null ? a.v : a
      const vb = b && b.v != null ? b.v : b
      const same = JSON.stringify(va) === JSON.stringify(vb)
      if (!same) gained.push({ key: k, label, single: va ?? '无', multi: vb ?? '无' })
    }
    const nf = (fused.hyp.observed || []).length
    const sf = (single.hyp.observed || []).length
    if (nf !== sf) gained.push({ key: 'observed', label: '观测立面', single: `${sf} 面`, multi: `${nf} 面` })
  }

  return { ...fused, single, gained }
}
