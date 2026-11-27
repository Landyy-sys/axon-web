/* ═══════════════════════════════════════════════════════════════
   AI 质检 · Self-Check（v0.4 新增：自我审查与重试闭环）
   ─────────────────────────────────────────────────────────────
   渲染最终图纸前的最后一道独立闸门：对求解出的模型做纯逻辑校验。
   刻意不与生成器（model.js）共用任何中间状态 —— 生成器
   "自己说自己对"不算数，这里只看最终交付的数据本身。

   检查三类问题（用户点名的三类 + 兜底）：
   ① 横向越界 —— 窗 / 门 / 洞口尺寸是否超出总面宽、宽度是否为正
   ② 竖向失配 —— 层数 × 层高 + 基座 是否等于总高；洞口层数是否
      越界；窗顶是否越过屋顶标高
   ③ 荒谬几何 —— 门长在半空中（不在首层地面标高）、窗台高于窗顶、
      结构柱落在建筑轮廓外

   @param {object} m  makeModel / finalizeCandidates 产出的模型
   @returns {{ ok:boolean, issues:Array<{key,msg}>, checked:number }}
     ok       —— 全部通过才为 true
     issues   —— [{ key, msg }]，key 用于上层分类统计
     checked  —— 实际执行的校验条数（写进质检报告）

   测试用例（scripts/check-model.mjs ⑳ 块）：
   · makeModel 正常输出 → ok:true，issues 为空
   · 手工污染：窗 x1 = length + 2        → 'opening-out'
   · 手工污染：门挪到 fl=2、sill=8       → 'door-floating'
   · 手工污染：floors=5 但 totalH 不变   → 'height-mismatch'
   · 手工污染：窗台 4.2 / 窗顶 1.0       → 'sill-above-head'
   ═══════════════════════════════════════════════════════════════ */

export function selfCheck(m) {
  const EPS = 0.02 // 2cm 容差：吸附误差与图纸标注圆整的合法余量

  if (!m || !Number.isFinite(m.floors) || !Number.isFinite(m.length)) {
    return { ok: false, issues: [{ key: 'no-model', msg: '未获得有效模型数据' }], checked: 0 }
  }

  const issues = []
  let checked = 0
  const L = m.length
  const H = Number.isFinite(m.totalH) ? m.totalH : (m.base ?? 0) + m.floors * m.floorHeight
  const base = Number.isFinite(m.base) ? m.base : 0

  /* ── 每个洞口逐条过筛 ── */
  for (const o of m.openings || []) {
    checked++

    /* ① 横向：洞口必须落在立面总面宽之内，且宽度合法（> 10cm） */
    if (Number.isFinite(o.x0) && Number.isFinite(o.x1)) {
      if (o.x0 < -EPS || o.x1 > L + EPS || o.x1 - o.x0 < 0.1) {
        issues.push({
          key: 'opening-out',
          msg: `洞口 ${o.x0}–${o.x1} m 超出总面宽 ${L} m 或宽度非法`,
        })
        continue // 越界的洞口后续几何必然失真，不再重复报
      }
    }

    /* ② 竖向：洞口层数不得超出总层数 */
    if (Number.isFinite(o.fl) && o.fl >= m.floors) {
      issues.push({
        key: 'floor-out',
        msg: `洞口出现在第 ${o.fl + 1} 层，超出总层数 ${m.floors} 层`,
      })
    }

    /* 窗顶不得越过屋顶标高（女儿墙顶以上不许开洞） */
    if (Number.isFinite(o.sill) && Number.isFinite(o.head)) {
      if (o.head <= o.sill) {
        issues.push({
          key: 'sill-above-head',
          msg: `洞口窗台 ${o.sill} m 高于窗顶 ${o.head} m，几何倒置`,
        })
      } else if (o.head > H + EPS) {
        issues.push({
          key: 'head-above-roof',
          msg: `洞口窗顶 ${o.head} m 越过屋顶标高 ${H} m`,
        })
      }
    }

    /* ③ 门必须落地：只允许出现在首层，且底标高等于室内地面（±30cm 台阶余量）
       —— "门长在半空中"是最容易被一眼识破的荒谬几何 */
    if (o.kind === 'door') {
      const onGround = (o.fl ?? 0) === 0 && Math.abs((o.sill ?? base) - base) <= 0.3
      if (!onGround) {
        issues.push({
          key: 'door-floating',
          msg: `门悬空：位于第 ${(o.fl ?? 0) + 1} 层、底标高 ${o.sill} m ≠ 地面 ${base} m`,
        })
      }
    }
  }

  /* ② 层数 × 层高 + 基座 = 总高（±5cm，与图纸标注自洽，同 crossCheck ⑥ 口径） */
  checked++
  const calc = base + m.floors * m.floorHeight
  if (Math.abs(calc - H) > 0.05) {
    issues.push({
      key: 'height-mismatch',
      msg: `总高 ${H} m ≠ ${m.floors}F × ${m.floorHeight} m + 基座 ${base} m（层高标注失配）`,
    })
  }

  /* ②b 女儿墙（v0.5 独立参数）：高度必须在常识区间 0–1.5 m 且不为负 ——
     超出即视为求解或人工输入失真（规范 0.5–1.2 m，1.5 为降级容差上限） */
  checked++
  if (m.parapet != null && (!(m.parapet >= 0) || m.parapet > 1.5)) {
    issues.push({
      key: 'parapet-range',
      msg: `女儿墙高度 ${m.parapet} m 超出常识区间 0–1.5 m`,
    })
  }

  /* ②c 女儿墙顶标高：有女儿墙时洞口窗顶同样不得越过女儿墙顶（已由 H+容差覆盖，
     但女儿墙顶本身要 ≥ 檐口，防止负值倒挂） */
  if (m.parapet != null && m.parapet > 0 && m.base != null && m.base - m.parapet > EPS) {
    issues.push({ key: 'parapet-inverted', msg: `女儿墙高度 ${m.parapet} m 大于建筑可见高度，几何倒挂` })
  }

  /* ③ 平面几何：结构柱不得越出建筑轮廓 */
  if (m.plan && Array.isArray(m.plan.columns)) {
    checked++
    for (const col of m.plan.columns) {
      if (
        col.x < -EPS ||
        col.x > L + EPS ||
        col.y < -EPS ||
        col.y > (Number.isFinite(m.depth) ? m.depth + EPS : Infinity)
      ) {
        issues.push({ key: 'col-out', msg: '结构柱落在建筑轮廓之外' })
        break
      }
    }
  }

  return { ok: issues.length === 0, issues, checked }
}
