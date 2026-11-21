/* ═══════════════════════════════════════════════════════════════
   多轮对话反馈修改引擎（前端本地规则解析 · 原型版）

   设计原则（对应「AI 不听话、原样输出」痛点的四条铁律）：
   ① 必须解析修改意图：每条意见都要映射成一个真正的几何/参数变更，
      没有任何规则命中 = 拒绝执行，绝不原样返回上一版。
   ② 状态覆盖：意见与基础参数冲突时，以最新意见为准 ——
      patch 一律打上 src:'user'，model.js 的 pick() 保证 user > calib > vision > type。
   ③ 给出修改说明：每次成功应用都返回人类可读的 changes[]，
      供对话框展示「已为您做了什么」。
   ④ 容错：模糊意见（如「好看点」）或暂不支持的能力（如「加个坡屋顶」）
      明确回复拒绝 + 给出示例，绝不假装改了。

   接入真实 AI 后端时：把 buildPrompt(currentState, text) 的输出
   发给多模态模型，用返回的 JSON patch 替换本文件的解析结果即可 ——
   currentState 的结构（约束 + 构件意图 + 上一版模型/SVG）已经备好。
   ═══════════════════════════════════════════════════════════════ */

/* ── 数字解析工具：支持「3 层」「三米」「3.5m」「每层 3 米」等写法 ── */
const CN_NUM = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
function numAfter(s, m) {
  if (!m) return null
  const t = CN_NUM[m[1]] ?? parseFloat(m[1])
  return Number.isFinite(t) ? t : null
}
const M = '(\\d+(?:\\.\\d+)?|[一两二三四五六七八九十])\\s*(?:米|m\\b|公尺)?'
const has = (src) => (t) => new RegExp(src).test(t)

/* ── 模糊意见黑名单：命中即拒绝（宁可少改，不可假改） ── */
const VAGUE = [
  /^(好|不错|可以|行|嗯|ok|OK)/,
  /(好看|美观|漂亮|现代|大气|高级|酷|漂亮点|好看点|优化一下|完善一下|提升一下|整体.*好)/,
]

export const FB_EXAMPLES = [
  '把层数改成 5 层',
  '层高调到 3.6 米',
  '把立面图的窗户改大一点',
  '增加一个阳台',
  '首层加一个双开门',
  '把柱子移到墙里',
  '把门移到中间',
  '开间数改成 6',
  '面宽 18 米',
  '总高度改成 15 米',
]

/* ── 当前状态结构（currentState）──
   {
     c:        { floors:{v,src}, fh:{v,src}, ... }   最新约束（含历次意见的覆盖）
     ops:      { windowScale, balconies[], addedDoor, doorWiden, doorCenter,
                 columnInline, columnOutside }   构件级意图（累积）
     lastModel: 上一版求解结果（含上一版 openings / 尺寸）
     lastSvg:   上一版立面 SVG 源码字符串
   } */

/**
 * 解析用户意见 → 生成 patch / ops / 修改说明。
 * @returns {{ok:boolean, reply?:string, cPatch?:object, ops?:object, changes?:string[]}}
 */
export function applyFeedback(cur, text) {
  const t = String(text || '').trim()
  if (!t) return { ok: false, reply: '请输入修改意见，例如：' + FB_EXAMPLES[0] }
  if (VAGUE.some((re) => re.test(t)) && !/\d|层|窗|门|阳台|开间|面宽|进深|层高|总高/.test(t)) {
    return {
      ok: false,
      reply:
        '抱歉，「' + t + '」太模糊了，我无法确定要改哪里 —— 请给出更具体的修改指令，例如：' +
        FB_EXAMPLES.slice(0, 3).join('；'),
    }
  }

  const cPatch = {}
  const changes = []
  const prev = cur?.lastModel || null
  const ops = { ...(cur?.ops || {}) }

  /* ① 层数：数值层（冲突覆盖：以用户最新意见为准） */
  let m = t.match(new RegExp('(?:改成?|改为?|设为?|调[整为到]?|只要|要|做)\\s*' + M + '\\s*层|(\\d+|[一两二三四五六七八九十])\\s*层'))
  if (m) {
    const v = Math.round(numAfter(t, m))
    if (v >= 1 && v <= 30 && !(v === 1 && /一层楼高/.test(t))) {
      cPatch.floors = { v, src: 'user' }
      changes.push(
        prev && prev.floors !== v
          ? `层数由 ${prev.floors} 层改为 ${v} 层（以你的最新要求为准）`
          : `层数设为 ${v} 层`,
      )
    }
  }

  /* ② 层高：显式数值 / 相对调整 */
  m = t.match(new RegExp('层高[^。；]*?' + M))
  if (m) {
    const v = numAfter(t, m)
    if (v >= 2.2 && v <= 6) {
      cPatch.fh = { v, src: 'user' }
      changes.push(prev && Math.abs(prev.floorHeight - v) > 0.01 ? `层高由 ${prev.floorHeight.toFixed(2)} m 调整为 ${v} m` : `层高设为 ${v} m`)
    }
  } else if (/层高.*(提高|调高|加高|增大|大一点|高一点)/.test(t)) {
    const curFh = cur?.c?.fh?.v ?? prev?.floorHeight ?? 3.3
    const v = Math.round((curFh + 0.3) * 100) / 100
    cPatch.fh = { v, src: 'user' }
    changes.push(`层高由 ${curFh.toFixed(2)} m 上调 0.3 m 至 ${v} m`)
  } else if (/层高.*(降低|调低|压低|矮一点|低一点)/.test(t)) {
    const curFh = cur?.c?.fh?.v ?? prev?.floorHeight ?? 3.3
    const v = Math.round(Math.max(2.2, curFh - 0.3) * 100) / 100
    cPatch.fh = { v, src: 'user' }
    changes.push(`层高由 ${curFh.toFixed(2)} m 下调 0.3 m 至 ${v} m`)
  }

  /* ③ 总高度 */
  m = t.match(new RegExp('总(?:高|高度)[^。；]*?' + M))
  if (m) {
    const v = numAfter(t, m)
    if (v >= 3 && v <= 120) {
      cPatch.totalH = { v, src: 'user' }
      changes.push(`总高度设为 ${v} m（引擎将按层高自动配平层数）`)
    }
  }

  /* ④ 开间数：「改成 6 开间」「6 个开间」「开间数改成 6」三种语序都支持。
     正则三分支易漏语序，改用关键词窗口法：锁定「开间」后在其前后找数字。 */
  const bi = t.indexOf('开间')
  if (bi >= 0) {
    const win = t.slice(Math.max(0, bi - 10), bi + 8)
    const mm = win.match(/(\d+(?:\.\d+)?|[一两二三四五六七八九十])/)
    const v = mm ? Math.round(numAfter(win, mm)) : NaN
    if (Number.isFinite(v) && v >= 1 && v <= 16) {
      cPatch.bays = { v, src: 'user' }
      changes.push(`开间数改为 ${v}（柱网随之重排）`)
    }
  }

  /* ⑤ 面宽：换算成每开间跨度（span） */
  m = t.match(new RegExp('面宽[^。；]*?' + M))
  if (m) {
    const L = numAfter(t, m)
    if (L >= 4 && L <= 120) {
      const bays = cPatch.bays?.v ?? cur?.c?.bays?.v ?? prev?.bays ?? 5
      const v = Math.round((L / Math.max(1, bays)) * 100) / 100
      cPatch.span = { v, src: 'user' }
      changes.push(`面宽设为 ${L} m（${bays} 开间 → 每跨约 ${v} m）`)
    }
  }

  /* ⑥ 进深 */
  m = t.match(new RegExp('进深[^。；]*?' + M))
  if (m) {
    const v = numAfter(t, m)
    if (v >= 3 && v <= 60) {
      cPatch.depth = { v, src: 'user' }
      changes.push(`进深设为 ${v} m`)
    }
  }

  /* ⑦ 窗户大小：构件级意图，渲染与 openings 求解真实生效 */
  if (has(/(窗|窗子|窗户|开窗).*(大|宽|高|放大|加大|加宽|扩)/.source)(t)) {
    ops.windowScale = 1.2
    changes.push('已将立面窗洞放大 20%（洞口宽高同步，剖面/平面共用同一份洞口数据）')
  } else if (has(/(窗|窗子|窗户|开窗).*(小|窄|缩小|收)/.source)(t)) {
    ops.windowScale = 0.85
    changes.push('已将立面窗洞缩小 15%')
  }

  /* ⑧ 加门 / 门加大 */
  if (/(加|增加|增设|添|装)[一个双扇]*.{0,4}(门|入口|大门)/.test(t) && !/窗/.test(t)) {
    ops.addedDoor = true
    changes.push('已在首层立面中央增设一门（M1，宽约 1.8 m），并同步进平面洞口')
  } else if (/(门).*(大|宽|加宽|放大)/.test(t)) {
    ops.doorWiden = true
    changes.push('已将首层门洞加宽至约 2.4 m')
  }

  /* ⑨ 阳台 */
  if (/(加|增加|增设|添|要)[一个?]*.{0,6}阳台/.test(t)) {
    const floors = cur?.c?.floors?.v ?? prev?.floors ?? 3
    if (/每层|所有层|层层/.test(t)) {
      ops.balconies = Array.from({ length: Math.max(0, floors - 1) }, (_, i) => i)
      changes.push(`已为 2—${floors} 层逐层增设外挑阳台（挑板 1.4 m + 金属栏杆）`)
    } else {
      const list = ops.balconies || []
      const target = list.length ? Math.max(...list) + 1 : 1
      if (target < floors) {
        ops.balconies = [...list, target]
        changes.push(`已增设阳台（第 ${target + 1} 层外挑 1.4 m，带栏杆）`)
      } else {
        ops.balconies = [floors - 2 >= 0 ? floors - 2 : 0]
        changes.push('建筑层数有限，阳台已设在最高可用层')
      }
    }
  }

  /* ⑩ 位置类指令：「移 / 挪 / 放」+ 目标元素 + 目标位置。
     意图提取三步：①找动作词（移|挪|放）②找目标元素（柱/门）③找位置（墙里/中间/外侧）。
     命中后写入构件状态机（ops），由 applyOpsToOpenings / App 真正落地。 */
  if (/(柱|柱子|柱网|框架柱)/.test(t) && /(移|挪|放|藏|收)/.test(t)) {
    if (/(墙里|墙内|内侧|里面|内部|齐平|平齐|藏)/.test(t)) {
      ops.columnInline = true
      delete ops.columnOutside
      changes.push('已将外露结构柱移入墙内（外立面齐平，柱网与跨度不变）')
    } else if (/(墙外|外侧|外面|暴露|外露)/.test(t)) {
      ops.columnOutside = true
      delete ops.columnInline
      changes.push('已将结构柱移到玻璃外墙外侧（结构表达式的立面）')
    }
  }
  if (/(门|入口|大门)/.test(t) && /(移|挪|放|挪到|搬到)/.test(t) && /(中间|中央|中部|正中|居中)/.test(t)) {
    ops.doorCenter = true
    changes.push('已将门移到立面正中（在所在跨内自动对中，不越柱位）')
  }

  /* ⑪ 暂不支持的能力：明确拒绝，绝不假装改了 */
  const unsupported = [
    [/(坡屋顶|斜屋顶|尖顶|歇山|庑殿)/, '坡屋面'],
    [/(旋转|弧形|曲线|曲面).*(楼|体|墙)/, '曲面形体'],
    [/(泳池|喷泉|雕塑)/, '泳池/雕塑等配景'],
  ]
  if (unsupported.some(([re]) => re.test(t)) && !changes.length) {
    return {
      ok: false,
      reply: '抱歉，「' + unsupported.find(([re]) => re.test(t))[1] + '」暂不在当前原型的建模范围内，请给出更具体的修改指令，例如：' + FB_EXAMPLES.slice(0, 3).join('；'),
    }
  }

  if (!changes.length) {
    return {
      ok: false,
      reply:
        '抱歉，我没有从「' + t + '」里解析出可执行的修改（不能假装改了）—— 请给出更具体的修改指令，例如：' +
        FB_EXAMPLES.slice(0, 4).join('；'),
    }
  }

  const reply = '收到，' + changes.join('；') + '。正在按最新参数重新生成四视图…'
  return { ok: true, reply, cPatch, ops, changes }
}

/**
 * 把构件级意图真正落到 openings 上（三视图共用同一份数据 → 自动一致）。
 * 所有坐标吸附到 100mm（0.1 m）基准 —— GB 模数 1M，杜绝 3.137 m 这种"机器味"尺寸。
 * @param {Array} openings model.openings
 * @param {{windowScale?:number, addedDoor?:boolean, doorWiden?:boolean, doorCenter?:boolean}} ops
 * @param {object} model 求解结果（columns / floorHeight / base / length / floors）
 */
export function applyOpsToOpenings(openings, ops, model) {
  if (!ops || (!ops.windowScale && !ops.addedDoor && !ops.doorWiden && !ops.doorCenter)) return openings
  const out = openings.map((o) => ({ ...o }))
  const FH = model.floorHeight
  /* 与立面绘制同一基准：首层完成面 = model.base ?? model.plinth（架空建筑被抬高） */
  const PAR = model.base ?? model.plinth ?? 0
  const cols = model.columns || [0, model.length]
  const colL = (bay) => cols[bay] ?? 0
  const colR = (bay) => cols[bay + 1] ?? model.length
  /* 100mm 吸附 */
  const snap = (v) => Math.round(v * 10) / 10

  const clampWin = (o) => {
    const l = colL(o.bay) + 0.3
    const r = colR(o.bay) - 0.3
    const w = Math.min(r - l, o.x1 - o.x0)
    const cx = Math.min(Math.max((o.x0 + o.x1) / 2, l + w / 2), r - w / 2)
    /* 先吸附再夹回边界：吸附产生的 ±0.05 偏差不能突破柱位 */
    o.x0 = Math.max(l, Math.min(snap(cx - w / 2), snap(cx + w / 2) - 0.2))
    o.x1 = Math.min(r, Math.max(snap(cx + w / 2), o.x0 + 0.2))
    const zBot = PAR + o.fl * FH + 0.5
    const zTop = PAR + (o.fl + 1) * FH - 0.35
    const h = Math.min(zTop - zBot, o.head - o.sill)
    const cz = Math.min(Math.max((o.sill + o.head) / 2, zBot + h / 2), zTop - h / 2)
    o.sill = Math.max(zBot, Math.min(snap(cz - h / 2), snap(cz + h / 2) - 0.1))
    o.head = Math.min(zTop, Math.max(snap(cz + h / 2), o.sill + 0.1))
    return o
  }

  if (ops.windowScale && ops.windowScale !== 1) {
    for (const o of out) {
      if (o.kind !== 'window') continue // ribbon / curtain 贯通构件不缩放
      const cx = (o.x0 + o.x1) / 2
      const cz = (o.sill + o.head) / 2
      o.x0 = cx - (cx - o.x0) * ops.windowScale
      o.x1 = cx + (o.x1 - cx) * ops.windowScale
      o.sill = cz - (cz - o.sill) * ops.windowScale
      o.head = cz + (o.head - cz) * ops.windowScale
      clampWin(o)
    }
  }

  if (ops.doorWiden) {
    const d = out.find((o) => o.kind === 'door')
    if (d) {
      const cx = (d.x0 + d.x1) / 2
      d.x0 = snap(cx - 1.2)
      d.x1 = snap(cx + 1.2)
      d.head = PAR + 2.4
    }
  }

  /* 门移到正中：目标位置 = 建筑中轴；若中轴不落在门所在跨内，换到包含中轴的那一跨。
     宽度保持不变，左右各留 ≥0.3m 墙垛，坐标吸附 100mm。 */
  if (ops.doorCenter) {
    const d = out.find((o) => o.kind === 'door')
    if (d) {
      const L = model.length
      const w = d.x1 - d.x0
      let bay = 0
      while (bay < cols.length - 1 && cols[bay + 1] < L / 2) bay++
      const l = colL(bay) + 0.3
      const r = colR(bay) - 0.3
      const cx = Math.min(Math.max(L / 2, l + w / 2), r - w / 2)
      d.bay = bay
      d.x0 = snap(cx - w / 2)
      d.x1 = snap(cx + w / 2)
    }
  }

  if (ops.addedDoor && !out.some((o) => o.kind === 'door')) {
    const base = out.find((o) => o.kind === 'window' && o.fl === 0) || out.find((o) => o.kind === 'window')
    if (base) {
      const cx = (base.x0 + base.x1) / 2
      out.splice(out.indexOf(base), 1, {
        kind: 'door',
        fl: 0,
        bay: base.bay,
        x0: snap(cx - 0.9),
        x1: snap(cx + 0.9),
        sill: PAR,
        head: PAR + 2.3,
      })
    }
  }
  return out
}

/**
 * 接入真实 AI 后端时使用的 Prompt 模板（四条铁律写死在指令里）。
 * 本地原型阶段仅用于展示 / 调试（console.debug），不发起网络请求。
 */
export function buildPrompt(cur, text) {
  const prev = cur?.lastModel
  return [
    '你是建筑图纸修改引擎。请根据【最新修改意见】输出修改后的图纸参数 JSON。',
    '',
    '【铁律一 · 必须真正修改】逐条解析意见并落到参数/构件上；用户说"加个门"，输出里就必须真的出现 door 构件，绝不允许原样返回上一版。',
    '【铁律二 · 最新意见优先】意见与基础参数冲突时（如基础 5 层、意见 3 层），一律以最新意见为准。',
    '【铁律三 · 必须给出说明】输出一句简短中文说明，讲清你改了什么（例如"已将 3 层层高上调"）。',
    '【铁律四 · 容错拒绝】意见模糊（如"好看点"）或技术上无法实现时，只回复"抱歉，请给出更具体的修改指令"，不许假装修改。',
    '',
    '【基础参数（用户最初填写）】' + JSON.stringify(cur?.c || {}),
    '【构件意图（历次意见累积）】' + JSON.stringify(cur?.ops || {}),
    '【上一版图纸参数】' + (prev ? JSON.stringify({ floors: prev.floors, floorHeight: prev.floorHeight, totalH: prev.totalH, length: prev.length, depth: prev.depth, bays: prev.bays, openings: prev.openings }) : '无（首轮）'),
    '【上一版图纸 SVG】' + (cur?.lastSvg ? cur.lastSvg.slice(0, 4000) + '…（已截断）' : '无'),
    '【最新修改意见】' + text,
  ].join('\n')
}
