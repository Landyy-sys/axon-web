import { useEffect, useRef, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { IsometricDrawing, ElevationDrawing, SectionDrawing, PlanDrawing } from '../drawings.jsx'
import SheetFrame from '../drawings/SheetFrame.jsx'
import { safeNum } from '../drawings/shared.jsx'
import ViewFusion from './ViewFusion.jsx'
import Term from './Term.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'
import { exportPng, exportPdf } from '../export.js'

const TABS = [
  { id: 'iso', label: '等轴测图', en: 'ISOMETRIC' },
  { id: 'elev', label: '正交立面', en: 'ELEVATION' },
  { id: 'sec', label: '剖面图', en: 'SECTION A—A' },
  { id: 'plan', label: '平面图', en: 'PLAN' },
]

/* 一句话总览：把求解结果翻译成不需要专业背景也能读懂的话。
   这是本轮面向大众的关键改动 —— 图纸本身是专业的，旁边的说明必须不是。 */
function plainSummary(m) {
  const cols = m.plan?.columnX?.length || 0
  const s = [
    `按「${m.type.label}」的常识，把照片里的建筑还原成`,
    `面宽 ${m.length} m`,
    `× 进深 ${m.depth} m`,
    `× ${m.floors} 层、每层 ${m.floorHeight} m 的体块`,
    m.totalH != null ? `，总高约 ${m.totalH} m` : '',
    '。',
    cols ? `平面上按 ${cols} 根柱位排布柱网。` : '',
    m.structure === 'pilotis' ? '底层由柱子撑起架空，所以地面那层的墙不到底。' : '',
    m.omissions?.length ? `注意：楼梯、内隔墙、家具在照片里看不见，图上刻意留白并标了「未建模」，不是漏画。` : '',
  ]
  return s.join('')
}

const TAG = (on) =>
  [
    'rounded-md border px-2.5 py-1.5 text-[11px] transition-colors',
    on ? 'border-ink bg-ink text-white' : 'border-hair text-muted hover:text-ink',
  ].join(' ')

export default function ResultPanel({ result, onRegenerate, busy, onSvgSnapshot }) {
  const [tab, setTab] = useState('iso')
  const [showInferred, setShowInferred] = useState(false)
  const [showLevels, setShowLevels] = useState(true)
  const [showOpenings, setShowOpenings] = useState(true)
  const [exporting, setExporting] = useState(null) // 'png' | 'pdf' | null
  const [allProgress, setAllProgress] = useState(null) // 1..4 | null（「下载图纸」批量导出进度）
  const [exportErr, setExportErr] = useState(null)
  const holder = useRef(null)

  const { model, meta } = result

  /* 把当前视图的 SVG 源码上报给 App（多轮对话的「上一版图纸」状态）
     —— 序列化包 try/catch：XMLSerializer 偶发异常绝不能打断渲染主流程 */
  useEffect(() => {
    try {
      const svg = holder.current?.querySelector('svg')
      if (svg && onSvgSnapshot) onSvgSnapshot(new XMLSerializer().serializeToString(svg))
    } catch (e) {
      console.warn('[AXON] SVG 快照序列化失败（不影响出图）：', e)
    }
  }, [model, tab, showLevels, showOpenings, onSvgSnapshot])

  /* ── 一键「下载图纸」：无需切换 Tab，把平 / 立 / 剖 / 等轴测四种视图
     全部离屏渲染成 SVG，再逐张栅格化为高清 PNG（3 倍 ≈ 300 DPI）。
     离屏渲染与屏幕显示走同一 renderView 出口（含 A3 图框与图签），
     保证下载到手的图和屏幕上看到的分毫不差。某一张失败不影响其余。 ── */
  const VIEW_DEFS = [
    { id: 'iso', comp: IsometricDrawing, extra: { showInferred, showOpenings }, name: '等轴测', sheetTitle: '等轴测分析图 ISOMETRIC', sheetNo: 'A-01', basis: (m) => Math.max(m.length, m.depth, m.totalH) },
    { id: 'elev', comp: ElevationDrawing, extra: { showLevels, showOpenings }, name: '立面', sheetTitle: '南立面图 ELEVATION', sheetNo: 'A-02', basis: (m) => m.length },
    { id: 'sec', comp: SectionDrawing, extra: {}, name: '剖面', sheetTitle: '剖面图 SECTION A—A', sheetNo: 'A-03', basis: (m) => m.depth },
    { id: 'plan', comp: PlanDrawing, extra: {}, name: '平面', sheetTitle: '平面图 PLAN', sheetNo: 'A-04', basis: (m) => m.length },
  ]

  /* 统一渲染出口：A3 图框 + 图签（比例按视图基准自动计算）+ 视图本体 */
  const renderView = (id) => {
    const d = VIEW_DEFS.find((v) => v.id === id)
    return (
      <SheetFrame model={model} title={d.sheetTitle} sheetNo={d.sheetNo} scaleBasis={d.basis(model)}>
        <d.comp model={model} {...d.extra} />
      </SheetFrame>
    )
  }

  const doExportAll = async () => {
    if (exporting || allProgress) return
    setExportErr(null)
    try {
      for (let i = 0; i < VIEW_DEFS.length; i++) {
        const { name } = VIEW_DEFS[i]
        setAllProgress(i + 1)
        const markup = renderToStaticMarkup(renderView(VIEW_DEFS[i].id))
        const doc = new DOMParser().parseFromString(markup, 'image/svg+xml')
        const svg = doc.documentElement
        if (!svg || svg.tagName === 'parsererror') throw new Error(`${name}视图渲染失败`)
        await exportPng(svg, `axon-${name}`, 3)
        /* 连续触发多个下载事件之间留出间隙，避免浏览器吞掉后面的下载 */
        await new Promise((r) => setTimeout(r, 250))
      }
    } catch (e) {
      setExportErr(`批量导出失败：${String(e?.message || e).slice(0, 80)}`)
    } finally {
      setAllProgress(null)
    }
  }

  const download = () => {
    const svg = holder.current?.querySelector('svg')
    if (!svg) return
    const clone = svg.cloneNode(true)
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    const src = new XMLSerializer().serializeToString(clone)
    const blob = new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + src], {
      type: 'image/svg+xml;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `axon-${tab}.svg`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  /* 高清位图 / PDF 导出：取当前视图的 SVG 源码 → 离屏 canvas 栅格化（3 倍 ≈ 300 DPI）。
     零依赖：不用 CDN 的 html2canvas / jsPDF，断网、file:// 双击都能导。 */
  const doExport = async (kind) => {
    const svg = holder.current?.querySelector('svg')
    if (!svg || exporting) return
    setExporting(kind)
    setExportErr(null)
    try {
      if (kind === 'png') await exportPng(svg, `axon-${tab}`, 3)
      else await exportPdf(svg, `axon-${tab}`, 3)
    } catch (e) {
      setExportErr(`导出失败：${String(e?.message || e).slice(0, 60)}`)
    } finally {
      setExporting(null)
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Tab 栏 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hair pb-px">
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={[
                'relative -mb-px border-b-2 px-3 py-2.5 text-[13px] transition-colors',
                tab === t.id ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink',
              ].join(' ')}
            >
              {t.label}
              <span className="ml-2 hidden font-mono text-[10px] tracking-wider text-muted sm:inline">{t.en}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 pb-1.5">
          {tab === 'iso' && (
            <button onClick={() => setShowInferred((v) => !v)} className={TAG(showInferred)}>
              推断区域
            </button>
          )}
          {tab !== 'sec' && (
            <>
              <button onClick={() => setShowLevels((v) => !v)} className={TAG(showLevels)}>
                楼层线
              </button>
              <button onClick={() => setShowOpenings((v) => !v)} className={TAG(showOpenings)}>
                门窗
              </button>
            </>
          )}
          {tab === 'sec' && (
            <span className="rounded-md border border-hair px-2.5 py-1.5 text-[11px] text-muted">
              楼梯 {model.interior?.stair?.on ? '已建模（人工声明）' : '未建模'}
            </span>
          )}
          {tab === 'plan' && (
            <span className="rounded-md border border-hair px-2.5 py-1.5 text-[11px] text-muted">
              房间 {model.interior?.partitions?.on ? '已建模（人工声明）' : '未建模'}
            </span>
          )}
          <button
            onClick={doExportAll}
            disabled={!!exporting || !!allProgress}
            title="一键导出平 / 立 / 剖 / 等轴测全部四张视图的高清 PNG（约 300 DPI）"
            className="rounded-md bg-ink px-3 py-1.5 text-[11px] font-medium text-white transition-opacity hover:opacity-85 disabled:opacity-40"
          >
            {allProgress ? `下载中 ${allProgress}/4…` : '⬇ 下载图纸'}
          </button>
          <button onClick={download} className="rounded-md border border-hair px-2.5 py-1.5 text-[11px] text-ink transition-colors hover:border-ink">
            SVG
          </button>
          <button
            onClick={() => doExport('png')}
            disabled={!!exporting}
            title="当前视图导出为高清 PNG（约 300 DPI）"
            className="rounded-md border border-hair px-2.5 py-1.5 text-[11px] text-ink transition-colors hover:border-ink disabled:opacity-40"
          >
            {exporting === 'png' ? '导出中…' : 'PNG'}
          </button>
          <button
            onClick={() => doExport('pdf')}
            disabled={!!exporting}
            title="当前视图导出为单页 PDF"
            className="rounded-md border border-hair px-2.5 py-1.5 text-[11px] text-ink transition-colors hover:border-ink disabled:opacity-40"
          >
            {exporting === 'pdf' ? '导出中…' : 'PDF'}
          </button>
          <button
            onClick={onRegenerate}
            disabled={busy}
            className="rounded-md bg-ink px-2.5 py-1.5 text-[11px] text-white transition-opacity hover:opacity-85 disabled:opacity-40"
          >
            重生成
          </button>
        </div>
      </div>

      {/* 图纸画布（A3 图框 + 图签 + 视图，与导出走同一出口）
          —— 每个标签页独立套一层 ErrorBoundary（key={tab} 切页自动重置）：
          某一张图渲染抛错（坐标 NaN、undefined 调 toFixed 等）时，
          只在这张图的区域显示红色提示卡，其余标签页照常可用，绝不白屏 */}
      <div ref={holder} className="grid-bg flex-1 overflow-hidden rounded-lg border border-hair bg-sheet">
        <ErrorBoundary key={tab} label={TABS.find((t) => t.id === tab)?.label}>
          {tab === 'iso' && renderView('iso')}
          {tab === 'elev' && renderView('elev')}
          {tab === 'sec' && renderView('sec')}
          {tab === 'plan' && renderView('plan')}
        </ErrorBoundary>
      </div>

      {exportErr && (
        <p className="mt-2 rounded-md border border-[#b91c1c]/40 bg-[#fef2f2] px-2.5 py-1.5 text-[11px] text-[#7f1d1d]">
          {exportErr}
        </p>
      )}

      {/* ── 建筑规范自检校验结果（Self-Reflection 闭环出口）──
          通过 → 图纸下方小绿勾；自动纠错过的版本同时注明纠错处数 */}
      {meta.qc?.ok && (
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-[#15803d]">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#15803d" strokeWidth="1.8">
            <path d="M2.5 8.5 6.5 12.5 13.5 4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>已通过建筑规范自检校验</span>
          <span className="font-mono text-[10.5px] text-[#15803d]/70">
            [{meta.qc.rules || 10} 条规则 · {meta.qc.checked || meta.qc.rules || 10} 项检查
            {meta.qc.fixed ? ` · 自动纠错 ${meta.qc.fixed} 处` : ''}]
          </span>
        </p>
      )}
      {meta.qc?.ok && meta.qc.fixes?.length > 0 && (
        <p className="mt-1 font-mono text-[10.5px] leading-relaxed text-muted">
          自动纠错明细：{meta.qc.fixes.join('；')}
        </p>
      )}

      {/* 元数据条（safeNum：任何求解量异常时显示占位符，绝不抛 toFixed 异常） */}
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 font-mono text-[11px] text-muted">
        <span>engine <span className="text-ink">TRELLIS.2</span></span>
        <span>seed <span className="text-ink">{meta.seed}</span></span>
        <span>views <span className="text-ink">{model.views}</span></span>
        <span>coverage <span className="text-ink">{safeNum(model.coverage * 100, 0, '—')}%</span></span>
        <span>floors <span className="text-ink">{model.floors}F</span></span>
        <span>fh <span className="text-ink">{safeNum(model.floorHeight)} m</span></span>
        <span>totalH <span className="text-ink">{safeNum(model.totalH)} m</span></span>
        <span>span <span className="text-ink">{safeNum(model.length, 1)}×{safeNum(model.depth, 1)} m</span></span>
        <span>scale <span className="text-ink">{model.scale?.err ?? '—'}</span></span>
        <span className="ml-auto">{safeNum(meta.ms / 1000, 1, '—')}s</span>
      </div>

      {/* 多轮采样一致度 + 交叉校验 */}
      {model.refine && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10.5px] text-muted">
          <span>
            refine{' '}
            <span className={model.refine.agreement >= 0.9 ? 'text-ink' : 'text-accent'}>
              {model.refine.passes} 轮 · 一致度 {Math.round(model.refine.agreement * 100)}%
            </span>
          </span>
          <span>
            cross-check{' '}
            <span className={model.issues?.length ? 'text-accent' : 'text-ink'}>
              {model.issues?.length ? `${model.issues.length} 项冲突` : '平立剖一致'}
            </span>
          </span>
          <span>
            consensus{' '}
            <span className="text-ink">
              {(model.refine.consensus || []).map((c) => `${c.k}=${c.v}`).join(' · ') || '—'}
            </span>
          </span>
        </div>
      )}

      {/* 判定依据 —— 可审计（鼠标悬停任一虚线名词即可看通俗解读） */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10.5px] text-muted">
        <span>
          <Term id="buildingType" className="not-italic">类型</Term>{' '}
          <span className="text-ink">{model.type.label}</span>
        </span>
        <span>
          lines <span className="text-ink">{model.linesDetected}</span> 检出 /{' '}
          <span className="text-accent">{model.linesSuppressed}</span> 剔除
        </span>
        <span>floor-from <span className="text-ink">{model.evidence.floorFrom}</span></span>
        {model.variant?.id && (
          <span>
            variant <span className="text-ink">{model.variant.id}</span> ·{' '}
            <Term id="wwr">
              <span className="text-ink">WWR {model.variant.wwr}</span>
            </Term>{' '}
            · <span className="text-ink">{model.variant.rhythm}</span> ·{' '}
            <span className="text-ink">entry {model.variant.entry}</span>
          </span>
        )}
        <span>
          <Term id="scale">比例</Term> <span className="text-ink">{model.scale?.mode ?? '—'}</span>
        </span>
        <span>
          cleanup{' '}
          <span className={model.cleaned ? 'text-ink' : 'text-accent'}>
            {model.cleaned ? 'done' : 'SKIPPED'}
          </span>
        </span>
        {model.feedback && (
          <span>
            feedback{' '}
            <span className="text-ink">
              {[
                model.feedback.windowScale ? `窗×${model.feedback.windowScale}` : null,
                model.feedback.balconies?.length ? `阳台×${model.feedback.balconies.length}` : null,
                model.feedback.addedDoor ? '加门' : null,
                model.feedback.doorWiden ? '门加宽' : null,
                model.feedback.doorCenter ? '门居中' : null,
                model.feedback.columnInline ? '柱入墙' : null,
                model.feedback.columnOutside ? '柱外露' : null,
              ]
                .filter(Boolean)
                .join(' · ') || 'on'}
            </span>
          </span>
        )}
      </div>

      {/* 一句话总览：用大白话说清楚这张图说了什么（面向非专业读者） */}
      <p className="mt-2 rounded-md border-l-2 border-ink/25 bg-sheet/60 px-2.5 py-2 text-[11.5px] leading-relaxed text-muted">
        <span className="text-ink">这张图在说什么：</span>
        {plainSummary(model)}
      </p>

      {/* ── 多视角融合：每个上传的视角具体贡献了什么 ── */}
      <ViewFusion model={model} />

      {/* ── 物理常识违背：显式告警 ── */}
      {model.violations.length > 0 && (
        <div className="mt-2 rounded-md border border-[#b91c1c]/40 bg-[#fef2f2] px-3 py-2">
          <p className="font-mono text-[10px] tracking-wider text-[#b91c1c]">
            PHYSICS VIOLATION · {model.violations.length} 项
          </p>
          {model.violations.map((v, i) => (
            <p key={i} className="mt-0.5 text-[11px] leading-snug text-[#7f1d1d]">
              · {v.msg}
            </p>
          ))}
          <p className="mt-1 text-[11px] leading-snug text-[#7f1d1d]">
            已按「宁可保守也不出错」原则降级：图纸仅保留结构框架，细节构件已省略。
          </p>
        </div>
      )}

      {/* 严格性声明 */}
      <div className="mt-3 flex items-start gap-2 rounded-md border border-hair bg-white/60 px-3 py-2.5">
        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
        <p className="text-[11.5px] leading-relaxed text-muted">
          四种视图均由重建后的同一份几何体经<span className="text-ink">正交投影渲染</span>得出，非图像模型直接生成。
          平面图与剖面图共用同一条剖切位置 A—A（y = {model.plan?.cutY} m，自动避开柱位），
          平面洞口直接取自立面 openings，三视图绝不各算一套。
          立面线宽执行 GB/T 50104 四级体系（1.4b 地坪 / b 外轮廓 / 0.5b 门窗檐口 / 0.25b 分格尺寸），
          竖向三道尺寸为总高 · 层高 · 细部，标高以首层完成面为 ±0.000。
          {model.evidence.note && <>楼层线（{model.evidence.note}）。</>}
          {model.linesSuppressed > 0 && (
            <>
              {' '}幕墙分格 {model.linesSuppressed} 条已剔除出楼层判定。
            </>
          )}
          {model.omissions?.length > 0 && (
            <>
              {' '}
              <span className="text-accent">
                剖面未建模：{model.omissions.map((o) => o.label).join(' · ')}
              </span>
              （照片中不可见，无视觉证据，故不臆想）。
            </>
          )}
        </p>
      </div>
    </div>
  )
}
