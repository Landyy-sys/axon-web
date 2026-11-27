/* ═══════════════════════════════════════════════════════════════
   建筑规范自检 · Standard Rules + Self-Review（v0.6 Self-Reflection 闭环）
   ─────────────────────────────────────────────────────────────
   纯前端「标准答案规则库」：把建筑制图与民用建筑设计的通识规则
   写死成声明式规则数组 STANDARD_RULES，每条规则 = { id, label, cite, apply }。
   生成器"自己说自己对"不算数 —— 这里只看最终交付的数据本身。

   三段式闭环（生成 → 对比 → 自检 → 重试）：
   ① STANDARD_RULES  规则库（本文件上半部）
   ② selfCheck(m)    逐条跑规则，产出 issues（向后兼容 v0.4 接口）
   ③ autoCorrect(m)  能自动纠错的错误直接改参数（不报错给用户）
   ④ selfReview(m)   主入口：自检 → 自动纠错 → 复检，一次调用完成

   规则清单（用户点名的三条加 ★）：
   ★ R1 洞口边界     窗/门不得超出总面宽，宽度 ≥ 0.1 m，坐标不得为负
   ★ R2 总高自洽     基座 + 层数 × 层高 = 总高（至檐口，±5cm）
   ★ R3 剖切有效     剖切面必须切到楼梯或门窗洞口（剖到空墙 = 白剖）
   R4 窗宽 ≤ 开间    独立窗/门宽度不得大于开间宽度（带窗幕墙豁免）
   R5 层高-女儿墙    女儿墙顶总高 = 基座 + 层数 × 层高 + 女儿墙高，
                     女儿墙高 ∈ 0–1.5 m（规范 0.5–1.2）
   R6 楼层数边界     洞口不得出现在不存在的楼层
   R7 竖向几何       窗台 < 窗顶；窗顶不得越过屋顶标高
   R8 门必须落地     门只能出现在首层且底标高 = 地面（±30cm 台阶余量）
   R9 柱网边界       结构柱不得落在建筑轮廓之外
   R10 开间自洽      开间数 × 开间宽 = 面宽（±5cm）
   ═══════════════════════════════════════════════════════════════ */

const EPS = 0.02 // 2cm 容差：吸附误差与图纸标注圆整的合法余量
const r2 = (n) => Math.round(n * 100) / 100

/* ═════════ ① 前端标准答案规则库（Standard Rules）═════════ */
export const STANDARD_RULES = [
  {
    id: 'opening-bounds',
    label: '窗户/门不得超出总面宽，宽度 ≥ 0.1 m，坐标不得为负',
    cite: '建筑制图几何自洽 · 洞口必须落在墙体范围内',
    apply(m) {
      const out = []
      for (const o of m.openings || []) {
        if (Number.isFinite(o.x0) && Number.isFinite(o.x1)) {
          if (o.x0 < -EPS || o.x1 > m.length + EPS || o.x1 - o.x0 < 0.1) {
            out.push({
              key: 'opening-out',
              msg: `洞口 ${o.x0}–${o.x1} m 超出总面宽 ${m.length} m 或宽度非法`,
            })
          }
        }
      }
      return out
    },
  },
  {
    id: 'total-height',
    label: '基座 + 层数 × 层高 = 总高（至檐口，±5cm）',
    cite: 'GB/T 50104 · 竖向尺寸标注必须自洽',
    apply(m) {
      const H = Number.isFinite(m.totalH) ? m.totalH : (m.base ?? 0) + m.floors * m.floorHeight
      const calc = (Number.isFinite(m.base) ? m.base : 0) + m.floors * m.floorHeight
      if (Math.abs(calc - H) > 0.05) {
        return [
          {
            key: 'height-mismatch',
            msg: `总高 ${H} m ≠ ${m.floors}F × ${m.floorHeight} m + 基座 ${m.base ?? 0} m（层高标注失配）`,
          },
        ]
      }
      return []
    },
  },
  {
    id: 'section-cut',
    label: '剖切面必须切到楼梯或门窗洞口（剖到无洞实墙 = 无效剖面）',
    cite: 'GB/T 50104 · 剖面图应剖到门窗洞口或楼梯间',
    apply(m) {
      const cutY = m.plan?.cutY
      const depth = Number.isFinite(m.depth) ? m.depth : null
      if (Number.isFinite(cutY) && depth != null && (cutY < -EPS || cutY > depth + EPS)) {
        return [{ key: 'cut-out', msg: `剖切位置 y = ${cutY} m 超出进深 0–${depth} m` }]
      }
      const hasOpening = (m.openings || []).some((o) => o.kind !== 'solid')
      const hasStair = !!m.interior?.stair?.on || !!m.stair
      if (!hasOpening && !hasStair) {
        return [{ key: 'section-empty', msg: '剖切面未切到任何门窗洞口或楼梯，剖面无信息量' }]
      }
      return []
    },
  },
  {
    id: 'window-vs-bay',
    label: '独立窗/门宽度不得大于开间宽度（带形窗/幕墙豁免）',
    cite: '民用建筑设计通则 · 窗洞宽度 ≤ 开间轴线宽度',
    apply(m) {
      const out = []
      const bay = Number.isFinite(m.bay) ? m.bay : null
      if (!bay) return out
      for (const o of m.openings || []) {
        /* ribbon / curtain 通长满铺整层，天然横跨多个开间，不在本条约束内 */
        if (o.kind === 'ribbon' || o.kind === 'curtain') continue
        if (Number.isFinite(o.x0) && Number.isFinite(o.x1) && o.x1 - o.x0 > bay * 1.02 + EPS) {
          out.push({
            key: 'window-vs-bay',
            msg: `洞口宽 ${(o.x1 - o.x0).toFixed(2)} m 大于开间宽 ${bay} m`,
          })
        }
      }
      return out
    },
  },
  {
    id: 'parapet-height',
    label: '女儿墙顶总高 = 基座 + 层数 × 层高 + 女儿墙高；女儿墙高 ∈ 0–1.5 m',
    cite: 'GB 50352 · 女儿墙（非上人 0.5–0.6 m，上人屋面 ≥ 1.1 m）',
    apply(m) {
      const out = []
      if (m.parapet != null && (!(m.parapet >= 0) || m.parapet > 1.5)) {
        out.push({ key: 'parapet-range', msg: `女儿墙高度 ${m.parapet} m 超出常识区间 0–1.5 m` })
      }
      /* 女儿墙顶必须高于檐口（防止负值倒挂）；
         架空建筑基座高，女儿墙再矮也画在檐口之上 —— 倒挂只发生在
         「女儿墙被算进了基座以下」这种求解失真里 */
      if (m.parapet != null && m.parapet > 0 && Number.isFinite(m.base) && m.base - m.parapet > EPS) {
        out.push({
          key: 'parapet-inverted',
          msg: `女儿墙高度 ${m.parapet} m 大于建筑可见高度，几何倒挂`,
        })
      }
      return out
    },
  },
  {
    id: 'floor-count',
    label: '洞口不得出现在不存在的楼层',
    cite: '建筑制图几何自洽 · 楼层边界',
    apply(m) {
      const out = []
      for (const o of m.openings || []) {
        if (Number.isFinite(o.fl) && o.fl >= m.floors) {
          out.push({
            key: 'floor-out',
            msg: `洞口出现在第 ${o.fl + 1} 层，超出总层数 ${m.floors} 层`,
          })
        }
      }
      return out
    },
  },
  {
    id: 'opening-vertical',
    label: '窗台 < 窗顶；窗顶不得越过屋顶标高（女儿墙顶以上不许开洞）',
    cite: '建筑制图几何自洽 · 竖向洞口边界',
    apply(m) {
      const H = Number.isFinite(m.totalH) ? m.totalH : (m.base ?? 0) + m.floors * m.floorHeight
      const out = []
      for (const o of m.openings || []) {
        if (Number.isFinite(o.sill) && Number.isFinite(o.head)) {
          if (o.head <= o.sill) {
            out.push({
              key: 'sill-above-head',
              msg: `洞口窗台 ${o.sill} m 高于窗顶 ${o.head} m，几何倒置`,
            })
          } else if (o.head > H + EPS) {
            out.push({
              key: 'head-above-roof',
              msg: `洞口窗顶 ${o.head} m 越过屋顶标高 ${H} m`,
            })
          }
        }
      }
      return out
    },
  },
  {
    id: 'door-grounded',
    label: '门必须落地：只允许首层，底标高 = 地面（±30cm 台阶余量）',
    cite: '"门长在半空中"是最容易被一眼识破的荒谬几何',
    apply(m) {
      const out = []
      const base = Number.isFinite(m.base) ? m.base : 0
      for (const o of m.openings || []) {
        if (o.kind !== 'door') continue
        const onGround = (o.fl ?? 0) === 0 && Math.abs((o.sill ?? base) - base) <= 0.3
        if (!onGround) {
          out.push({
            key: 'door-floating',
            msg: `门悬空：位于第 ${(o.fl ?? 0) + 1} 层、底标高 ${o.sill} m ≠ 地面 ${base} m`,
          })
        }
      }
      return out
    },
  },
  {
    id: 'column-bounds',
    label: '结构柱不得落在建筑轮廓之外',
    cite: '建筑制图几何自洽 · 柱网边界',
    apply(m) {
      if (!m.plan || !Array.isArray(m.plan.columns)) return []
      const depth = Number.isFinite(m.depth) ? m.depth + EPS : Infinity
      for (const col of m.plan.columns) {
        if (col.x < -EPS || col.x > m.length + EPS || col.y < -EPS || col.y > depth) {
          return [{ key: 'col-out', msg: '结构柱落在建筑轮廓之外' }]
        }
      }
      return []
    },
  },
  {
    id: 'bay-grid',
    label: '开间数 × 开间宽 = 面宽（±5cm）',
    cite: '建筑制图几何自洽 · 水平模数协调',
    apply(m) {
      if (!Number.isFinite(m.bay) || !Number.isFinite(m.length)) return []
      const calc = m.bays * m.bay
      if (Math.abs(calc - m.length) > 0.05) {
        return [
          {
            key: 'bay-mismatch',
            msg: `面宽 ${m.length} m ≠ ${m.bays} 开间 × ${m.bay} m（水平模数失配）`,
          },
        ]
      }
      return []
    },
  },
]

/* ═════════ ② selfCheck：逐条跑规则（v0.4 兼容接口）═════════
   @returns {{ ok, issues:[{key,msg}], checked, rules }} */
export function selfCheck(m) {
  if (!m || !Number.isFinite(m.floors) || !Number.isFinite(m.length)) {
    return { ok: false, issues: [{ key: 'no-model', msg: '未获得有效模型数据' }], checked: 0, rules: 0 }
  }
  const issues = []
  for (const rule of STANDARD_RULES) {
    try {
      issues.push(...rule.apply(m))
    } catch {
      /* 单条规则内部异常不拖垮整体质检 */
    }
  }
  return { ok: issues.length === 0, issues, checked: STANDARD_RULES.length, rules: STANDARD_RULES.length }
}

/* ═════════ ③ autoCorrect：自动纠错（不报错，直接改参数）═════════
   把可修复的失真直接修正成合规值 —— 负坐标吸附回边界、悬空门落地、
   女儿墙夹回常识区间、总高按层数×层高重算……
   @returns {{ model, fixes:string[] }}  model 为深拷贝，fixes 供审计展示 */
export function autoCorrect(m) {
  const fixes = []
  let out
  try {
    out = structuredClone(m)
  } catch {
    out = JSON.parse(JSON.stringify(m))
  }
  const L = out.length
  const H = Number.isFinite(out.totalH) ? out.totalH : (out.base ?? 0) + out.floors * out.floorHeight
  const base = Number.isFinite(out.base) ? out.base : 0
  const bay = Number.isFinite(out.bay) ? out.bay : null

  /* ── 洞口逐个过筛 ── */
  const keep = []
  for (const o of out.openings || []) {
    /* 负坐标 / 越界：吸附回面宽边界 */
    if (Number.isFinite(o.x0) && Number.isFinite(o.x1)) {
      if (o.x0 < -EPS) {
        fixes.push(`洞口左缘 ${o.x0} m 吸附回 0（原为负坐标）`)
        o.x0 = 0
      }
      if (o.x1 > L + EPS) {
        o.x1 = r2(L)
        fixes.push(`洞口右缘吸附回面宽 ${L} m`)
      }
    }
    /* 楼层越界：直接剔除（没有这层楼，挪哪都不对） */
    if (Number.isFinite(o.fl) && o.fl >= out.floors) {
      fixes.push(`剔除第 ${(o.fl ?? 0) + 1} 层越界洞口`)
      continue
    }
    /* 窗台/窗顶倒置：窗顶 = 窗台 + 最低可采光照度窗高 0.9 m */
    if (Number.isFinite(o.sill) && Number.isFinite(o.head) && o.head <= o.sill) {
      o.head = r2(Math.min(o.sill + 0.9, H))
      fixes.push(`窗顶倒置修正为 ${o.head} m（窗台 ${o.sill} m + 0.9 m）`)
    }
    /* 窗顶越过屋顶：压回屋顶之下 */
    if (Number.isFinite(o.head) && o.head > H + EPS) {
      o.head = r2(H - 0.05)
      fixes.push(`窗顶压回屋顶标高之下（${o.head} m）`)
      if (o.head <= o.sill) {
        fixes.push(`该洞口压回后无有效高度，整条剔除`)
        continue
      }
    }
    /* 门悬空：放回首层地面 */
    if (o.kind === 'door' && ((o.fl ?? 0) !== 0 || Math.abs((o.sill ?? base) - base) > 0.3)) {
      o.fl = 0
      o.sill = r2(base)
      fixes.push('悬空门放回首层地面标高')
    }
    /* 窗宽大于开间：居中收窄至开间 90% */
    if (
      bay &&
      o.kind !== 'ribbon' &&
      o.kind !== 'curtain' &&
      Number.isFinite(o.x0) &&
      Number.isFinite(o.x1) &&
      o.x1 - o.x0 > bay * 1.02 + EPS
    ) {
      const cx = (o.x0 + o.x1) / 2
      const w = bay * 0.9
      o.x0 = r2(cx - w / 2)
      o.x1 = r2(cx + w / 2)
      fixes.push(`洞口宽度收窄至开间 90%（${o.x1 - o.x0} m ≤ 开间 ${bay} m）`)
    }
    keep.push(o)
  }
  out.openings = keep

  /* ── 总高失配：按 基座 + 层数 × 层高 重算 ── */
  const calc = r2(base + out.floors * out.floorHeight)
  if (Number.isFinite(out.totalH) && Math.abs(calc - out.totalH) > 0.05) {
    fixes.push(`总高按 ${out.floors}F × ${out.floorHeight} m + 基座 ${base} m 重算为 ${calc} m`)
    out.totalH = calc
  }

  /* ── 女儿墙出常识区间：夹回规范上限 ── */
  if (out.parapet != null && (!(out.parapet >= 0) || out.parapet > 1.5)) {
    const v = r2(Math.min(Math.max(out.parapet >= 0 ? out.parapet : 0.9, 0), 1.2))
    fixes.push(`女儿墙高度夹回规范区间（${out.parapet} m → ${v} m）`)
    out.parapet = v
  }
  if (out.parapet != null && out.parapet > 0 && Number.isFinite(out.base) && out.base - out.parapet > EPS) {
    out.parapet = 0
    fixes.push('女儿墙与基座倒挂，取消女儿墙（屋面改为无栏板出挑）')
  }

  /* ── 结构柱越轮廓：吸附回边界内 ── */
  if (out.plan && Array.isArray(out.plan.columns) && Number.isFinite(out.depth)) {
    let fixedCol = false
    out.plan.columns = out.plan.columns.map((col) => {
      const c2 = { ...col }
      if (c2.x < -EPS || c2.x > L + EPS) {
        c2.x = r2(Math.min(Math.max(c2.x, 0), L))
        fixedCol = true
      }
      if (c2.y < -EPS || c2.y > out.depth + EPS) {
        c2.y = r2(Math.min(Math.max(c2.y, 0), out.depth))
        fixedCol = true
      }
      return c2
    })
    if (fixedCol) fixes.push('越界结构柱吸附回建筑轮廓内')
  }

  /* ── 开间模数失配：面宽以开间积为准重算 ── */
  if (Number.isFinite(out.bay) && Number.isFinite(out.length) && Math.abs(out.bays * out.bay - out.length) > 0.05) {
    fixes.push(`面宽按 ${out.bays} × ${out.bay} m 重算为 ${r2(out.bays * out.bay)} m`)
    out.length = r2(out.bays * out.bay)
  }

  return { model: out, fixes }
}

/* ═════════ ④ selfReview：主入口（自检 → 纠错 → 复检）═════════
   @returns {{
     ok         —— 复检通过与否
     issues     —— 复检后仍存在的问题（应为空或极少）
     initial    —— 首轮自检问题数（0 = 一次通过）
     fixedCount —— 自动纠错处数
     fixes      —— 纠错明细（审计用）
     model      —— 最终交付模型（可能已被纠错修正）
     checked / rules —— 执行的规则条数
   }} */
export function selfReview(m) {
  const first = selfCheck(m)
  if (first.ok) {
    return {
      ok: true,
      issues: [],
      initial: 0,
      fixedCount: 0,
      fixes: [],
      model: m,
      checked: first.checked,
      rules: STANDARD_RULES.length,
    }
  }
  /* 发现问题 → 自动纠错 → 复检（不把中间错误抛给用户） */
  const { model: fixed, fixes } = autoCorrect(m)
  const second = selfCheck(fixed)
  return {
    ok: second.ok,
    issues: second.issues,
    initial: first.issues.length,
    fixedCount: fixes.length,
    fixes,
    model: fixed,
    checked: second.checked,
    rules: STANDARD_RULES.length,
  }
}
