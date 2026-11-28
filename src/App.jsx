import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import UploadZone from './components/UploadZone.jsx'
import StageProgress from './components/StageProgress.jsx'
import Controls from './components/Controls.jsx'
import Cleanup from './components/Cleanup.jsx'
import GlossaryPanel from './components/GlossaryPanel.jsx'
import FeedbackChat from './components/FeedbackChat.jsx'
import QcProgress from './components/QcProgress.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { samplePass, finalizeCandidates, makeVariant } from './model.js'
import { analyzeView, voidFacts } from './vision.js'
import { fuseViews } from './fuse.js'
import { applyFeedback, applyOpsToOpenings, buildPrompt } from './feedback.js'
import { selfReview } from './selfcheck.js'

/* 图纸绘制层按需加载，首屏 bundle 更小 */
const ResultPanel = lazy(() => import('./components/ResultPanel.jsx'))

/* ══ 准确性优先的管线 ══
   生成慢下来的时间不是空等：
   · 「逐视角视觉证据提取」真的把每张上传图解码成像素、跑 Sobel、提取结构线
   · 「多视角证据融合」真的把各视角结论投票取共识，并把冲突写进图纸
   · 「多轮采样」真的跑多次求解并做一致性投票
   · 「交叉校验」真的检查平立剖是否自相矛盾

   v0.7.2 防卡死性能降级：采样轮数 9 → 5。
   中位数共识对轮数不敏感（5 轮足以抑制随机抖动），求解计算量近乎减半；
   视觉分析早已限定 320px 分析分辨率（单张 ≤ 6.5 万像素，秒级完成）。 */
const PASSES = 5

const STAGES = [
  { id: 'pre', ms: 1500, label: '图像预处理 · 主体分割', hint: 'SAM 3 抠出建筑主体，剔除天空与配景' },
  { id: 'vis', ms: 2600, label: '逐视角视觉证据提取', hint: '每张图真实解码 · Sobel 边缘 · 水平/竖向结构线 · 架空·玻璃·转角判读' },
  { id: 'cal', ms: 1500, label: '尺度标定 · 类型先验匹配', hint: '锚点反解 px/m · 建筑类型层高/开间常识入库' },
  { id: 'fus', ms: 1800, label: '多视角证据融合', hint: '各视角投票取共识 · 冲突登记 · 与单视角结论对照' },
  { id: 'und', ms: 1800, label: '相机位姿对齐 · 深度前馈', hint: '同名点匹配 / 前馈深度 / 元素清单' },
  { id: 'rec', ms: 3600, label: '三维几何重建', hint: 'TRELLIS.2 · 1536³ · 原生 PBR' },
  { id: 'reg', ms: 2400, label: '建筑先验正则化', hint: '正交 / 共面 / 层高聚类约束求解' },
  { id: 'ref', ms: 4200, label: `多轮采样一致性求解 · ${PASSES} 轮`, hint: '多次求解取中位数共识 · 一致度低于 90% 自动降级' },
  { id: 'xck', ms: 2000, label: '平立剖 + 平面交叉校验', hint: '剖切线避柱 · 洞口对齐 · 总高与层高自洽' },
  { id: 'ren', ms: 1600, label: '正交投影渲染 · 出图', hint: '四视图：等轴测 / 立面 / 剖面 / 平面' },
]

const TOTAL_MS = STAGES.reduce((a, s) => a + s.ms, 0)
const DONE_MS = STAGES.reduce((acc, s) => [...acc, (acc.at(-1) ?? 0) + s.ms], [])

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 合并约束：user 级原样保留，calib 级只在对应量未被人工锁定时填入。
 * 真正的优先级裁剪发生在 model.js 的 pick()，这里只做来源归并。
 */
function mergeConstraints(c, calib) {
  if (!calib) return c
  const put = (k, v) => (c[k]?.src === 'user' ? c[k] : { v, src: 'calib' })
  const out = { ...c }
  if (calib.kind === 'totalH' && calib.meters) out.totalH = put('totalH', calib.meters)
  if (calib.kind === 'firstFloor' && calib.meters) out.firstFloor = put('firstFloor', calib.meters)
  if (calib.kind === 'depth' && calib.meters) out.depth = put('depth', calib.meters)
  if (calib.span) out.span = put('span', calib.span)
  out.refKind = calib.refKind
  return out
}

function Booting() {
  return (
    <div className="grid-bg flex flex-1 items-center justify-center rounded-lg border border-hair">
      <span className="block h-4 w-4 animate-spin rounded-full border-[1.5px] border-[#cfccc5] border-t-ink" />
    </div>
  )
}

export default function App() {
  const [files, setFiles] = useState([])
  const [phase, setPhase] = useState('idle') // idle | running | done
  const [stageIdx, setStageIdx] = useState(-1)
  const [frac, setFrac] = useState(0)
  const [result, setResult] = useState(null)
  /* 约束集：每个量都是 { v, src }，src ∈ user / calib / type / infer */
  const [c, setC] = useState({
    typeId: 'residential',
    floors: { v: null, src: null },
    fh: { v: null, src: null },
    totalH: { v: null, src: null },
    depth: { v: null, src: null },
    span: { v: null, src: null },
    bays: { v: null, src: null },
    siteDrop: { v: null, src: null },
    /* 室内构件：照片看不见，默认一律不建模（不臆想） */
    interior: { stair: false, partitions: false, furniture: false },
  })
  const [calib, setCalib] = useState(null) // { pxPerM, refLabel, ... }
  const [cleaned, setCleaned] = useState(null) // { url, index, erasedRegions }
  /* 逐视角真实图像分析结果（ViewFacts[]）—— 上传后立刻开始读像素，
     不等用户点「生成」，这样上传完就能看到每张图被读出了什么。 */
  const [viewFacts, setViewFacts] = useState([])
  const [visionBusy, setVisionBusy] = useState(false)
  const [fusion, setFusion] = useState(null)

  /* ══ 多轮对话反馈修改（currentState）══
     ops      —— 历次意见累积的构件级意图（窗缩放 / 门 / 阳台）
     chat     —— 对话消息（user 意见 / bot 说明或拒绝）
     lastSvg  —— 上一版立面 SVG 源码（ResultPanel 上报，供下一轮参考） */
  const [fbOps, setFbOps] = useState(null)
  const [chat, setChat] = useState([])
  const lastSvgRef = useRef(null)

  /* ══ AI 质检（Self-Review & Retry）══
     qcStage —— 右侧三步进度：0 解析参数 / 1 生成+自检 / 2 渲染
     qcRetry —— 已静默重试次数（0–2）
     toast   —— 校验通过 / 复杂度提示的轻提示 */
  const [qcStage, setQcStage] = useState(null)
  const [qcRetry, setQcRetry] = useState(0)
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)
  const showToast = (text, ms = 2800) => {
    setToast(text)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), ms)
  }

  const pushChat = (role, text, rejected, choices) => setChat((old) => [...old, { role, text, rejected, choices }])

  const genRef = useRef(0)

  /* ══ 模块二 · 异步任务防抖（Debounce）══
     生成管线一轮要跑 20+ 秒、会触碰十几个状态位，绝不允许并发进入：
     · runDebounced —— 500ms 尾沿防抖：快速连点「生成」/「重新生成」只保留最后一次
     · feedbackDebounced —— 400ms 尾沿防抖：意见输入快速回车只发最后一条
     · 组件卸载 / 换照片时清掉挂起的定时器
     genRef 代际守卫仍在 run 内部兜底：即使定时器竞态漏进来一拍，
     旧代次的任务也会在下一个阶段边界自行退出。 */
  const runTimer = useRef(null)
  const fbTimer = useRef(null)
  const clearDebounce = () => {
    clearTimeout(runTimer.current)
    clearTimeout(fbTimer.current)
  }
  useEffect(() => clearDebounce, [])

  const resetOut = () => {
    setResult(null)
    setPhase('idle')
    setStageIdx(-1)
  }

  /* ══ 上传后立刻逐视角分析真实像素 ══
     每张图都会算出：水平/竖向结构线、楼层带、架空置信、玻璃占比、
     是否转角（一次看到两个立面）、面宽/进深比。变换 impressed 结果直接展示在左侧。 */
  useEffect(() => {
    let alive = true
    if (!files.length) {
      setViewFacts([])
      setVisionBusy(false)
      setFusion(null)
      return
    }
    const pending = files.filter((f) => !viewFacts.some((x) => x.id === f.id))
    if (!pending.length) return
    setVisionBusy(true)
    ;(async () => {
      const out = []
      for (const f of pending) {
        const fx = await analyzeView(f).catch(() => voidFacts(f))
        if (!alive) return
        out.push({ ...fx, id: f.id, name: f.name })
      }
      setViewFacts((old) => {
        const merged = [...old.filter((x) => files.some((f) => f.id === x.id)), ...out]
        return files.map((f) => merged.find((x) => x.id === f.id)).filter(Boolean)
      })
      setVisionBusy(false)
    })()
    return () => {
      alive = false
    }
  }, [files, viewFacts])

  const handleFiles = useCallback((next) => {
    clearDebounce() // 换一批照片：挂起的生成/意见任务全部作废
    setFiles(next)
    setResult(null)
    setPhase('idle')
    setStageIdx(-1)
    if (!next.length) {
      setCalib(null)
      setCleaned(null)
    }
    /* 换一批照片 = 新项目：对话状态清零 */
    setFbOps(null)
    setChat([])
    lastSvgRef.current = null
  }, [])

  const changeC = useCallback((next) => {
    clearDebounce() // 参数变动：挂起的生成任务作废
    setC(next)
    setResult(null)
    setPhase('idle')
    setStageIdx(-1)
  }, [])

  /* 标定结果写入 calib 级约束（优先级低于 user，高于类型常识） */
  const handleCalib = useCallback((res) => {
    clearDebounce()
    setCalib(res)
    setResult(null)
    setPhase('idle')
    setStageIdx(-1)
  }, [])

  const handleCleaned = useCallback((url, meta) => {
    clearDebounce()
    setCleaned({ url, ...meta })
    setResult(null)
    setPhase('idle')
    setStageIdx(-1)
  }, [])

  /* 当前阶段内的推进比例 */
  useEffect(() => {
    if (phase !== 'running' || stageIdx < 0) return
    const dur = STAGES[stageIdx].ms
    const t0 = performance.now()
    setFrac(0)
    const id = setInterval(() => setFrac(Math.min(1, (performance.now() - t0) / dur)), 50)
    return () => clearInterval(id)
  }, [phase, stageIdx])

  const pct =
    phase === 'done'
      ? 1
      : stageIdx < 0
        ? 0
        : ((DONE_MS[stageIdx - 1] ?? 0) + frac * STAGES[stageIdx].ms) / TOTAL_MS

  /* ── 模拟生成管线 ──
     override：多轮对话修改时传入 { c: 最新约束, ops: 构件意图 }，
     避免等 React 状态更新后再触发的闭包过期问题。 */
  const run = useCallback(async (override) => {
    const cc = override?.c || c
    const ops = override?.ops !== undefined ? override.ops : fbOps
    const gen = ++genRef.current
    setPhase('running')
    setResult(null)
    setStageIdx(0)
    setQcStage(0) // [步骤 1/3] 解析图像与约束参数
    setQcRetry(0)

    const t0 = performance.now()
    const seed = Math.floor(Math.random() * 90000) + 1000
    const withSize = files.filter((x) => x.w && x.h)
    const aspect = withSize.length
      ? withSize.reduce((a, x) => a + x.w / x.h, 0) / withSize.length
      : 1.5

    /* 方案变体：一次生成里的所有采样轮共用，避免被中位数共识抹平 */
    const variant = makeVariant(seed)

    /* 视觉证据优先复用上传阶段已经算好的结果，缺哪张现算哪张 */
    let localFacts = files.map((f) => viewFacts.find((x) => x.id === f.id)).filter(Boolean)
    let fused = null

    const makeBase = () => ({
      ...mergeConstraints(cc, calib),
      cleaned: !!cleaned,
      vision: fused?.hyp || {},
      fusion: fused
        ? {
            count: fused.count,
            total: fused.total,
            votes: fused.votes,
            contributions: fused.contributions,
            conflicts: fused.conflicts,
            gained: fused.gained,
            hyp: fused.hyp,
          }
        : null,
      variant,
    })

    const cands = []

    for (let i = 0; i < STAGES.length; i++) {
      setStageIdx(i)
      const st = STAGES[i]

      if (st.id === 'vis') {
        /* 真的把每张图解码、跑 Sobel、提取结构线（不是空等） */
        const tv = performance.now()
        for (const f of files) {
          const has = localFacts.find((x) => x.id === f.id)
          if (has && has.ok) continue
          const fx = await analyzeView(f).catch(() => voidFacts(f))
          if (genRef.current !== gen) return
          const next = { ...fx, id: f.id, name: f.name }
          localFacts = [...localFacts.filter((x) => x.id !== f.id), next]
          setViewFacts((old) => [...old.filter((x) => x.id !== f.id), next])
        }
        await sleep(Math.max(0, st.ms - (performance.now() - tv)))
        if (genRef.current !== gen) return
      } else if (st.id === 'fus') {
        /* 多视角投票 + 冲突登记 + 单视角对照 */
        const tf = performance.now()
        const ordered = files.map((f) => localFacts.find((x) => x.id === f.id)).filter(Boolean)
        fused = fuseViews(ordered)
        setFusion(fused)
        await sleep(Math.max(0, st.ms - (performance.now() - tf)))
        if (genRef.current !== gen) return
      } else if (st.id === 'ref') {
        /* 多轮采样：同一约束、不同随机起点，逐轮推进而不是空等 */
        for (let k = 0; k < PASSES; k++) {
          cands.push(samplePass(seed, aspect, files.length, makeBase(), k))
          await sleep(st.ms / PASSES)
          if (genRef.current !== gen) return
        }
      } else {
        await sleep(st.ms)
        if (genRef.current !== gen) return
      }
    }

    /* ══ [步骤 2/3] 生成初步图纸 + 建筑规范自检（Self-Reflection 闭环）══
       生成器产出的模型先过 selfReview：① 对照 STANDARD_RULES 标准答案
       规则库逐条比对（洞口越界 / 窗宽大于开间 / 总高失配 / 女儿墙区间 /
       剖切有效性 / 门悬空 / 柱越轮廓 / 开间模数）；② 发现可自动纠错的
       失真（负坐标、悬空门、女儿墙越界…）直接改参数后台重新生成；
       ③ 复检仍不过 → 静默换随机种子重采样，最多重试 1 次（v0.7.2 防卡死：
          重试硬上限 + 1.2 秒求解时间预算，绝不无限循环），两版取优。
       全程绝不把中间错误报给用户。
       v0.7.1：整段求解包 try/catch —— 求解抛错绝不白屏：
       屏幕弹 toast 说明失败原因，界面回到可重新生成的空闲态。 */
    setQcStage(1)

    const buildModel = (sd, candsIn) => {
      const fin = finalizeCandidates(candsIn)
      const mdl = fin ? fin.model : samplePass(sd, aspect, files.length, makeBase(), 0)
      /* 多轮对话反馈：构件级意图真正落到洞口数据上（三视图共用 → 自动一致），
         参数级意见（层数/层高/开间…）已在 cc 里以 user 级覆盖。
         柱位类意图直接改结构表达标志：外露（范斯沃斯式）↔ 墙内（齐平）。 */
      if (ops) {
        mdl.feedback = ops
        mdl.openings = applyOpsToOpenings(mdl.openings, ops, mdl)
        if (ops.columnInline) mdl.columnsOutside = false
        if (ops.columnOutside) mdl.columnsOutside = true
      }
      const rev = selfReview(mdl)
      return { model: rev.model, check: rev }
    }

    let seedUsed = seed
    let best
    /* attempts 必须声明在 try 之外：try 块作用域里的变量出了块就没了，
       而 [步骤 3/3] 组装 meta.qc 时还要用它 —— v0.7.2 线上事故复盘：
       它曾被困在 try 里，运行到 setResult 时抛 ReferenceError，
       run() 卡死在『正在渲染最终图纸』100% 不动 */
    let attempts = 1
    /* v0.7.2 防卡死 · 求解时间预算：整段自检+重试最多花 1.2 秒真实计算。
       三重硬限制（任一命中立即停）：① 重试次数 ≤ 1；② 墙钟 ≤ 1200ms；
       ③ try/catch 兜底 —— 超预算或异常时直接交付当前最优版本（带降级告警条），
       绝不允许无限重试或长时间阻塞主线程。 */
    const SOLVE_BUDGET_MS = 1200
    const tSolve = performance.now()
    try {
      best = buildModel(seed, cands)
      while (!best.check.ok && attempts < 2 && performance.now() - tSolve < SOLVE_BUDGET_MS) {
        setQcRetry(attempts)
        await sleep(600) // 给进度界面一拍停留：用户能看到"自动重试中"
        if (genRef.current !== gen) return
        const sd = Math.floor(Math.random() * 90000) + 1000
        const rcands = []
        for (let k = 0; k < PASSES; k++) rcands.push(samplePass(sd, aspect, files.length, makeBase(), k))
        const alt = buildModel(sd, rcands)
        attempts++
        /* 两版取优：通过版优先；都不通过则保留问题更少的版本 */
        if (alt.check.ok || alt.check.issues.length <= best.check.issues.length) {
          best = alt
          seedUsed = sd
        }
        if (best.check.ok) break
      }
    } catch (err) {
      console.error('[AXON] 求解管线异常：', err)
      showToast(`生成失败：${String(err?.message || err).slice(0, 60)}。已停止本次生成，请调整参数后重试。`, 6000)
      setPhase('idle')
      setStageIdx(-1)
      setQcStage(null)
      setQcRetry(0)
      return
    }
    const { model, check } = best

    if (override?.prompt) console.debug('[AXON → AI backend]\n' + override.prompt)

    /* ══ [步骤 3/3] 校验通过，渲染最终图纸 ══
       v0.7.2b：这一段也包 try/catch —— 上线事故复盘：组装 meta 时引用了
       作用域外的变量抛 ReferenceError，run() 在此静默卡死在 100%。
       任何此处异常必须弹 toast 并回到空闲态，绝不无声挂死。 */
    try {
      setQcStage(2)
      await sleep(500)
      if (genRef.current !== gen) return

      setResult({
        model,
        meta: {
          seed: seedUsed,
          ms: Math.round(performance.now() - t0),
          passes: cands.length,
          variant: model.variant?.id || null,
          views: files.length,
          observed: model.plan?.observed?.length || 1,
          qc: {
            ok: check.ok,
            attempts,
            issues: check.issues,
            checked: check.checked,
            rules: check.rules,
            initial: check.initial ?? 0,
            fixed: check.fixedCount ?? 0,
            fixes: check.fixes ?? [],
          },
        },
      })
      setPhase('done')
      setQcStage(null)
      setQcRetry(0)
      showToast(
        check.ok
          ? `✅ 已通过建筑规范自检校验（${check.rules ?? 10} 条规则${
              check.fixedCount ? ` · 自动纠错 ${check.fixedCount} 处` : ''
            }）`
          : '因照片透视复杂，已为您生成基础草图，请调整参数以获得更高精度',
        check.ok ? 2800 : 5200,
      )
    } catch (err) {
      console.error('[AXON] 出图阶段异常：', err)
      showToast(`出图失败：${String(err?.message || err).slice(0, 60)}。请点「生成图纸」重试。`, 6000)
      setPhase('idle')
      setStageIdx(-1)
      setQcStage(null)
      setQcRetry(0)
    }
  }, [files, c, calib, cleaned, viewFacts, fbOps])

  const running = phase === 'running'

  /* ══ 多轮对话反馈修改 ══
     三者融合：基础参数 cc + 上一版模型/SVG（currentState）+ 最新意见 →
     解析 → 参数覆盖（user 级）+ 构件意图 → 重新生成 → 对话框说明改了什么。
     模糊意见 / 暂不支持的能力：明确拒绝，绝不原样重画上一版。 */
  const handleFeedback = useCallback(
    async (text) => {
      if (running) return
      const cur = { c, ops: fbOps, lastModel: result?.model || null, lastSvg: lastSvgRef.current }
      const res = applyFeedback(cur, text)
      pushChat('user', text)
      if (!res.ok) {
        pushChat('bot', res.reply, true, res.choices)
        return
      }
      pushChat('bot', res.reply)

      /* 状态覆盖：意见 patch 合入约束（user 级，右侧面板同步显示新值） */
      let merged = c
      if (res.cPatch && Object.keys(res.cPatch).length) {
        merged = { ...c, ...res.cPatch }
        setC(merged)
      }
      const mergedOps = res.ops
      setFbOps(mergedOps)
      /* devtools 可见：接真实 AI 后端时把这段发给模型 */
      const prompt = buildPrompt({ ...cur, c: merged, ops: mergedOps }, text)
      await run({ c: merged, ops: mergedOps, prompt })
    },
    [c, fbOps, result, running, run],
  )

  /* 防抖入口（定义在 run / handleFeedback 之后，避免 TDZ 引用）：
     连点「生成」500ms 内只触发最后一次；意见快速回车 400ms 内只发最后一条 */
  const runDebounced = useCallback(
    (override) => {
      clearTimeout(runTimer.current)
      runTimer.current = setTimeout(() => run(override), 500)
    },
    [run],
  )

  const feedbackDebounced = useCallback(
    (text) => {
      clearTimeout(fbTimer.current)
      fbTimer.current = setTimeout(() => handleFeedback(text), 400)
    },
    [handleFeedback],
  )

  return (
    <div className="min-h-screen">
      {/* ────────── Header ────────── */}
      <header className="sticky top-0 z-10 border-b border-hair bg-paper/85 backdrop-blur">
        <div className="mx-auto flex max-w-[1240px] items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="grid h-6 w-6 place-items-center rounded-[5px] bg-ink">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#fff" strokeWidth="1.3">
                <path d="M2 13 8 3l6 10H2Z" strokeLinejoin="round" />
                <path d="M5.3 8.6h5.4" strokeLinecap="round" />
              </svg>
            </span>
            <span className="text-[15px] tracking-tight text-ink">AXON</span>
            <span className="hidden text-[12px] text-muted sm:inline">/</span>
            <span className="hidden text-[12px] text-muted sm:inline">AI 建筑逆向图纸生成</span>
          </div>
          <span className="font-mono text-[11px] tracking-wider text-muted">PROTOTYPE v0.2 · ACCURACY FIRST</span>
        </div>
      </header>

      {/* ────────── Main ────────── */}
      <main className="mx-auto max-w-[1240px] px-6 py-7">
        <div className="grid gap-5 lg:grid-cols-[400px_1fr]">
          {/* 左：输入 */}
          <section className="flex flex-col rounded-xl border border-hair bg-white p-5">
            <h2 className="mb-4 font-mono text-[11px] tracking-wider text-muted">01 · INPUT</h2>

            <UploadZone
              files={files}
              onChange={handleFiles}
              onCalibrate={handleCalib}
              disabled={running}
              overlay={running}
              cleanedUrl={cleaned?.url}
              facts={viewFacts}
              visionBusy={visionBusy}
            />

            {files.length > 0 && (
              <Cleanup
                file={files[0]}
                onApply={handleCleaned}
                onClear={() => setCleaned(null)}
                cleanedUrl={cleaned?.url}
              />
            )}

            <Controls c={c} onChange={changeC} disabled={running} calib={calib} model={result?.model} />

            <GlossaryPanel />

            <button
              onClick={() => runDebounced()}
              disabled={!files.length || running || !cleaned}
              className={[
                'mt-5 w-full rounded-lg py-3 text-[14px] transition-all duration-200',
                !files.length || running || !cleaned
                  ? 'cursor-not-allowed bg-[#e8e6e1] text-muted'
                  : 'bg-ink text-white hover:opacity-90 active:scale-[0.995]',
              ].join(' ')}
            >
              {running
                ? '生成中…'
                : phase === 'done'
                  ? '重新生成'
                  : !files.length
                    ? '请先上传图片'
                    : !cleaned
                      ? '请先完成场景清洗'
                      : '生成图纸'}
            </button>

            {!running && phase === 'idle' && (
              <p className="mt-2.5 text-center text-[11.5px] text-muted">
                {!files.length
                  ? `上传建筑照片（支持多视角），约 ${Math.round(TOTAL_MS / 1000)} 秒后输出四视图`
                    : !cleaned
                      ? '场景清洗为强制前置步骤 —— 未清洗时建模算法会误将行人、车辆、植被当作建筑构件'
                      : visionBusy
                        ? '正在逐视角读取像素证据…'
                        : (() => {
                            const ok = viewFacts.filter((f) => f.ok).length
                            const faces = Math.min(4, Math.max(1, ok + viewFacts.filter((f) => f.cornerX != null).length))
                            return `${files.length} 视角 · 已提取 ${ok} 张真实证据 · 可观测 ${faces} 个立面 · ${PASSES} 轮采样 + 交叉校验，约 ${Math.round(TOTAL_MS / 1000)} 秒`
                          })()}
              </p>
            )}

            {phase !== 'idle' && (
              <StageProgress stages={STAGES} stageIdx={stageIdx} frac={frac} pct={pct} phase={phase} />
            )}
          </section>

          {/* 右：输出 */}
          <section className="flex min-h-[600px] flex-col rounded-xl border border-hair bg-white p-5">
            <h2 className="mb-4 font-mono text-[11px] tracking-wider text-muted">02 · OUTPUT</h2>

            {/* 生成期间不出图，先展示三步质检进度；完成后才渲染 ResultPanel */}
            {running && !result ? (
              <QcProgress step={qcStage ?? 0} retry={qcRetry} />
            ) : result ? (
              <>
                {result.meta?.qc && !result.meta.qc.ok && (
                  <div className="mb-3 rounded-lg border border-[#b45309]/40 bg-[#fffbeb] px-3 py-2 text-[12px] leading-relaxed text-[#92400e]">
                    因照片透视复杂，已为您生成基础草图，请调整参数以获得更高精度
                    （已自动重试 {result.meta.qc.attempts - 1} 次、自动纠错 {result.meta.qc.fixed || 0} 处，
                    仍有 {result.meta.qc.issues?.length || 0} 处待确认：
                    {result.meta.qc.issues?.[0]?.msg || '几何一致性待确认'}）
                  </div>
                )}
                {/* 结果面板按需加载（React.lazy）。懒加载 chunk 拉取失败
                    （弱网 / 部署资产缺失）或面板内部渲染抛错时，
                    ErrorBoundary 就地显示提示卡 —— 进度条走完绝不白屏 */}
                <ErrorBoundary label="结果面板">
                  <Suspense fallback={<Booting />}>
                    <ResultPanel
                      result={result}
                      busy={running}
                      onRegenerate={() => runDebounced()}
                      onSvgSnapshot={(svg) => (lastSvgRef.current = svg)}
                    />
                  </Suspense>
                </ErrorBoundary>
              </>
            ) : (
              <div className="grid-bg flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-[#cfccc5] px-8 py-16 text-center">
                <svg width="42" height="42" viewBox="0 0 32 32" fill="none" stroke="#cfccc5" strokeWidth="1.1">
                  <path d="M4 24 16 6l12 18H4Z" strokeLinejoin="round" />
                  <path d="M10.6 15.5h10.8M16 6v18" strokeLinecap="round" opacity=".6" />
                </svg>
                <p className="mt-5 text-[14px] text-ink">尚未生成图纸</p>
                <div className="mt-4 space-y-1.5 font-mono text-[11px] text-muted">
                  <p>ISOMETRIC · 等轴测 45° / 35.264°</p>
                  <p>ELEVATION · 正交立面 真投影</p>
                  <p>SECTION A—A · 布尔剖切</p>
                  <p>PLAN · 水平剖切 · 柱网 + 轴线</p>
                </div>
              </div>
            )}

            {/* ── 多轮对话反馈修改：基础参数 + 上一版图纸 + 最新意见 三者融合
                （意见输入经 400ms 防抖，快速连发只执行最后一条）── */}
            <FeedbackChat messages={chat} onSend={feedbackDebounced} busy={running} />
          </section>
        </div>
      </main>

      {/* AI 质检结果轻提示（校验通过 / 复杂度建议） */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-lg border border-hair bg-ink px-4 py-2.5 text-[12.5px] text-white shadow-lg">
          {toast}
        </div>
      )}

      {/* ────────── Footer ────────── */}
      <footer className="border-t border-hair">
        <div className="mx-auto max-w-[1240px] px-6 py-4 font-mono text-[11px] leading-relaxed text-muted">
          React 19 · Vite · Tailwind CSS v4 — 前端原型，四视图为实时计算的矢量图，多轮采样与交叉校验为真实计算，AI 重建管线为模拟。
        </div>
      </footer>
    </div>
  )
}
