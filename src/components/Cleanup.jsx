import { useCallback, useEffect, useRef, useState } from 'react'
import { detectObjects, DETECT_KINDS, KIND_MAP } from '../detect.js'

/**
 * 场景清洗 —— 建模前的强制前置步骤。
 *
 * 【本版改动：色框不再是假的】
 * 上一版 heuristicCandidates(W, H) 只看画布宽高，用取模随机数贴标签，
 * 图片一个像素都没读 —— 所以「把车认成树」是必然结果。
 * 现在跑 src/detect.js 的真实管线：肤色双规则 / 绿度指数 / 二维散布 + 行簇重复
 * 判别 / 连通域 / 形状打分 / 人体 1.7 m 尺度复核，并且：
 *   · 每个框给出置信度 + 判定理由
 *   · 允许人工当场改判（识别错了必须能被纠正，而不是接受黑盒结论）
 *   · 低置信度框用虚线 + 「待确认」，宁可说不确定也不假装认得
 */

const BRUSHES = [18, 34, 60, 100]
const DETECT_MAX = 520 // 检测分辨率上限：再高只是浪费算力，几何判断不需要原始分辨率
const GRAY = '#d9d6cf' // 「纯灰剔除」的底色：中性灰，不参与肤色/绿度/稀有色判据

export default function Cleanup({ file, onApply, onClear, cleanedUrl }) {
  const canvasRef = useRef(null)
  const imgRef = useRef(null)
  const maskRef = useRef(null)
  const blurRef = useRef(null)

  const [ready, setReady] = useState(false)
  const [brush, setBrush] = useState(34)
  const [tool, setTool] = useState('brush') // 'brush' 涂抹 | 'rect' 框选
  const [maskMode, setMaskMode] = useState('blur') // 'blur' 模糊 | 'gray' 纯灰
  const [rectDrag, setRectDrag] = useState(null) // {x0,y0,x1,y1} 画布坐标，正在拖的框
  const [cands, setCands] = useState([])
  const [erased, setErased] = useState(0)
  const [drawing, setDrawing] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [detectNote, setDetectNote] = useState(null) // null 正常；string 降级原因
  const [stats, setStats] = useState(null)
  const [openId, setOpenId] = useState(null) // 展开判定详情 / 改判菜单的框
  const [corrections, setCorrections] = useState([])

  /* ── 载入图片 + 真实检测 ── */
  useEffect(() => {
    if (!file?.url) return
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      imgRef.current = img
      const W = Math.min(img.width, 900)
      const H = Math.round((img.height / img.width) * W)

      const cv = canvasRef.current
      cv.width = W
      cv.height = H

      const mk = (w, h) => {
        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        return c
      }
      maskRef.current = mk(W, H)
      const blur = mk(W, H)
      blurRef.current = blur
      const bctx = blur.getContext('2d')
      bctx.filter = 'blur(14px)'
      bctx.drawImage(img, 0, 0, W, H)
      bctx.filter = 'none'

      render()
      setReady(true)
      setErased(0)
      setCorrections([])
      setOpenId(null)
      setClosed(false)

      /* 真实检测：缩到 DETECT_MAX 后读像素，再把框坐标放大回画布尺度。
         有服务端时先探云端高精度分割（百度 / 阿里，见 scripts/api-segment.mjs）：
         200 → 云端框与本地框合并；501 / 失败 → 纯本地管线，零配置也能用。 */
      setDetecting(true)
      setDetectNote(null)
      /* 用一个 tick 让浏览器先把画布画出来，再做同步的像素计算 */
      setTimeout(async () => {
        let cloudBoxes = []
        const b64 = typeof file.url === 'string' && file.url.startsWith('data:') ? file.url.slice(file.url.indexOf(',') + 1) : null
        if (b64) {
          try {
            const res = await fetch('/api/segment', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ image: b64 }),
            })
            if (res.ok) {
              const d = await res.json()
              const k = W / img.width // 云端框基于原图像素，缩放到画布尺度
              cloudBoxes = (d.boxes || []).map((b, i) => ({
                id: `c${i}`,
                kind: b.kind,
                score: Math.max(0.56, b.score || 0.9), // 云端结果不做虚线待确认
                cloud: true,
                x: Math.round(b.box.x * k),
                y: Math.round(b.box.y * k),
                w: Math.max(6, Math.round(b.box.w * k)),
                h: Math.max(6, Math.round(b.box.h * k)),
                reasons: [`云端分割模型检出（${d.provider}）`],
              }))
            }
          } catch { /* file:// 或网络不通 → 静默回退本地 */ }
        }
        const s = Math.min(1, DETECT_MAX / Math.max(W, H))
        const dw = Math.max(1, Math.round(W * s))
        const dh = Math.max(1, Math.round(H * s))
        const small = mk(dw, dh)
        const sctx = small.getContext('2d', { willReadFrequently: true })
        sctx.drawImage(img, 0, 0, dw, dh)
        let res = null
        try {
          const im = sctx.getImageData(0, 0, dw, dh)
          res = detectObjects({ data: im.data, W: dw, H: dh })
        } catch (e) {
          const name = String(e?.name || '')
          setDetectNote(
            name === 'SecurityError'
              ? '浏览器禁止读取像素（file:// 直接打开时会受同源限制）。请启动本地服务后重试；现在仍可用笔刷手工涂抹。'
              : `像素读取失败：${String(e?.message || e).slice(0, 40)}。仍可用笔刷手工涂抹。`,
          )
        }
        let localBoxes = []
        if (res) {
          const k = 1 / s
          localBoxes = res.boxes.map((b, i) => ({
            ...b,
            id: `d${i}`,
            x: Math.round(b.x * k),
            y: Math.round(b.y * k),
            w: Math.max(6, Math.round(b.w * k)),
            h: Math.max(6, Math.round(b.h * k)),
          }))
          setStats(res.stats)
        } else if (!cloudBoxes.length) {
          setCands([])
          setStats(null)
        }
        setCands([...cloudBoxes, ...localBoxes])
        if (cloudBoxes.length) {
          setDetectNote((n) => n || `已用云端高精度分割复核（${cloudBoxes.length} 个目标），本地规则结果一并给出。`)
        }
        setDetecting(false)
      }, 30)
    }
    img.src = file.url
  }, [file?.url])

  /* ── 合成：原图 + (mask ∩ 遮罩底图)。遮罩底图按 maskMode 取模糊底图或纯灰色 ── */
  const render = useCallback(() => {
    const cv = canvasRef.current
    const img = imgRef.current
    if (!cv || !img) return
    const ctx = cv.getContext('2d')
    ctx.clearRect(0, 0, cv.width, cv.height)
    ctx.drawImage(img, 0, 0, cv.width, cv.height)
    const mask = maskRef.current
    const blur = blurRef.current
    if (!mask || !blur) return
    const tmp = document.createElement('canvas')
    tmp.width = cv.width
    tmp.height = cv.height
    const tctx = tmp.getContext('2d')
    if (maskMode === 'gray') {
      tctx.fillStyle = GRAY
      tctx.fillRect(0, 0, tmp.width, tmp.height)
    } else {
      tctx.drawImage(blur, 0, 0)
    }
    tctx.globalCompositeOperation = 'destination-in'
    tctx.drawImage(mask, 0, 0)
    ctx.drawImage(tmp, 0, 0)
  }, [maskMode])

  /* maskMode 切换后需要重合成一次 */
  useEffect(() => {
    render()
  }, [maskMode, render])

  /* 画布坐标换算 */
  const canvasPt = (e) => {
    const cv = canvasRef.current
    const r = cv.getBoundingClientRect()
    return {
      x: ((e.clientX - r.left) / r.width) * cv.width,
      y: ((e.clientY - r.top) / r.height) * cv.height,
    }
  }

  const stroke = useCallback(
    (e) => {
      const mask = maskRef.current
      if (!mask) return
      const { x, y } = canvasPt(e)
      const mctx = mask.getContext('2d')
      mctx.fillStyle = '#fff'
      mctx.beginPath()
      mctx.arc(x, y, brush / 2, 0, Math.PI * 2)
      mctx.fill()
      render()
    },
    [brush, render],
  )

  /* 框选：按下记起点，抬起把矩形写进 mask（一次拖拽剔除一辆车/一棵树正好） */
  const rectCommit = () => {
    const mask = maskRef.current
    const d = rectDrag
    if (!mask || !d) return
    const x = Math.min(d.x0, d.x1)
    const y = Math.min(d.y0, d.y1)
    const w = Math.abs(d.x1 - d.x0)
    const h = Math.abs(d.y1 - d.y0)
    if (w > 4 && h > 4) {
      const mctx = mask.getContext('2d')
      mctx.fillStyle = '#fff'
      mctx.fillRect(x, y, w, h)
      setErased((n) => n + 1)
      render()
    }
    setRectDrag(null)
  }

  const canvasHandlers =
    tool === 'brush'
      ? {
          onMouseDown: (e) => {
            setDrawing(true)
            setOpenId(null)
            stroke(e)
          },
          onMouseMove: (e) => drawing && stroke(e),
          onMouseUp: () => setDrawing(false),
          onMouseLeave: () => setDrawing(false),
        }
      : {
          onMouseDown: (e) => {
            setOpenId(null)
            const { x, y } = canvasPt(e)
            setRectDrag({ x0: x, y0: y, x1: x, y1: y })
          },
          onMouseMove: (e) => {
            if (!rectDrag) return
            const { x, y } = canvasPt(e)
            setRectDrag((d) => ({ ...d, x1: x, y1: y }))
          },
          onMouseUp: rectCommit,
          onMouseLeave: rectCommit,
        }

  const fillRect = (c) => {
    const mask = maskRef.current
    if (!mask) return
    const mctx = mask.getContext('2d')
    mctx.fillStyle = '#fff'
    mctx.fillRect(c.x, c.y, c.w, c.h)
    render()
  }

  const eraseCand = (c) => {
    fillRect(c)
    setCands((p) => p.filter((k) => k.id !== c.id))
    setErased((n) => n + 1)
    setOpenId(null)
  }

  const eraseAll = () => {
    cands.forEach(fillRect)
    setErased((n) => n + cands.length)
    setCands([])
    setOpenId(null)
  }

  const eraseKind = (kindId) => {
    const hit = cands.filter((c) => c.kind === kindId)
    hit.forEach(fillRect)
    setErased((n) => n + hit.length)
    setCands((p) => p.filter((c) => c.kind !== kindId))
    setOpenId(null)
  }

  /* 人工改判：识别错了必须能被当场纠正 */
  const reclassify = (c, kindId) => {
    setCands((p) => p.map((k) => (k.id === c.id ? { ...k, kind: kindId, userFixed: true, score: 1 } : k)))
    setCorrections((p) => [...p, { from: c.kind, to: kindId }])
    setOpenId(null)
  }
  /* 标记为「不是干扰物」：从候选里移除，但不擦、不计数 */
  const keepIt = (c) => {
    setCands((p) => p.filter((k) => k.id !== c.id))
    setCorrections((p) => [...p, { from: c.kind, to: 'keep' }])
    setOpenId(null)
  }

  const reset = () => {
    const mask = maskRef.current
    if (mask) mask.getContext('2d').clearRect(0, 0, mask.width, mask.height)
    render()
    setErased(0)
    setOpenId(null)
    setCorrections([])
    if (imgRef.current) {
      /* 重新触发一次检测（重新赋值 url 走同一条 effect 分支不可靠，直接重放图景） */
      setDetecting(true)
      setTimeout(() => {
        const cv = canvasRef.current
        if (!cv) return setDetecting(false)
        const s = Math.min(1, DETECT_MAX / Math.max(cv.width, cv.height))
        const dw = Math.max(1, Math.round(cv.width * s))
        const dh = Math.max(1, Math.round(cv.height * s))
        const small = document.createElement('canvas')
        small.width = dw
        small.height = dh
        const sctx = small.getContext('2d', { willReadFrequently: true })
        sctx.drawImage(imgRef.current, 0, 0, dw, dh)
        try {
          const im = sctx.getImageData(0, 0, dw, dh)
          const res = detectObjects({ data: im.data, W: dw, H: dh })
          const k = 1 / s
          setCands(
            res.boxes.map((b, i) => ({
              ...b,
              id: `r${i}`,
              x: Math.round(b.x * k),
              y: Math.round(b.y * k),
              w: Math.max(6, Math.round(b.w * k)),
              h: Math.max(6, Math.round(b.h * k)),
            })),
          )
          setStats(res.stats)
        } catch (e) {
          setCands([])
        }
        setDetecting(false)
      }, 20)
    }
    onClear?.()
  }

  const apply = () => {
    const cv = canvasRef.current
    if (!cv) return
    const counts = DETECT_KINDS.reduce((m, k) => ({ ...m, [k.id]: cands.filter((c) => c.kind === k.id).length }), {})
    onApply?.(cv.toDataURL('image/png'), {
      erasedRegions: erased,
      detected: stats?.counts || {},
      remaining: counts,
      corrections: corrections.length,
      pxPerM: stats?.pxPerM || null,
    })
  }

  const counts = cands.reduce((m, c) => ({ ...m, [c.kind]: (m[c.kind] || 0) + 1 }), {})
  const uncertain = cands.filter((c) => c.score < 0.55).length
  const cv = canvasRef.current
  const sx = cv && cv.width ? cv.clientWidth / cv.width : 1
  const wrapW = cv?.clientWidth || 400
  const openBox = cands.find((c) => c.id === openId)
  const POP_W = 218

  return (
    <div className="mt-2.5 rounded-lg border border-accent/40 bg-[#fbf4ef] p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-mono text-[10.5px] tracking-wider text-accent">02 · SCENE CLEANUP — 建模前强制步骤</p>
        {cleanedUrl && <span className="font-mono text-[10.5px] text-accent">已应用 ✓</span>}
      </div>

      <div className="relative overflow-hidden rounded-md border border-hair bg-white">
        <canvas
          ref={canvasRef}
          {...canvasHandlers}
          className={tool === 'brush' ? 'block w-full cursor-crosshair' : 'block w-full cursor-cell'}
        />

        {/* 框选拖拽中的预览框 */}
        {rectDrag && (() => {
          const cv = canvasRef.current
          const k = cv && cv.width ? cv.clientWidth / cv.width : 1
          const x = Math.min(rectDrag.x0, rectDrag.x1) * k
          const y = Math.min(rectDrag.y0, rectDrag.y1) * k
          const w = Math.abs(rectDrag.x1 - rectDrag.x0) * k
          const h = Math.abs(rectDrag.y1 - rectDrag.y0) * k
          return (
            <div
              className="pointer-events-none absolute border-2 border-accent bg-accent/15"
              style={{ left: x, top: y, width: w, height: h }}
            />
          )
        })()}

        {/* 真实检测出的候选框 */}
        {ready &&
          cands.map((c) => {
            const cv = canvasRef.current
            const sx = cv ? cv.clientWidth / cv.width : 1
            const meta = KIND_MAP[c.kind] || KIND_MAP.misc
            const low = c.score < 0.55
            const open = openId === c.id
            return (
              <div key={c.id} className="absolute" style={{ left: c.x * sx, top: c.y * sx, width: c.w * sx, height: c.h * sx }}>
                <button
                  onClick={() => eraseCand(c)}
                  style={{ borderColor: meta.color, borderStyle: low ? 'dashed' : 'solid' }}
                  className="h-full w-full border-2 transition-opacity hover:opacity-50"
                >
                  <span />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setOpenId(open ? null : c.id)
                  }}
                  style={{ background: meta.color }}
                  className="absolute -top-[15px] left-0 flex items-center gap-1 whitespace-nowrap px-1 font-mono text-[9px] leading-[14px] text-white"
                >
                  {meta.label}
                  <span className="opacity-80">{Math.round(c.score * 100)}%</span>
                  {c.userFixed && <span className="opacity-90">改</span>}
                  {c.autoFixed && <span className="opacity-90">纠</span>}
                </button>

              </div>
            )
          })}

        {detecting && (
          <div className="absolute inset-0 grid place-items-center bg-white/70">
            <span className="font-mono text-[10.5px] text-accent">正在读取像素并识别干扰物…</span>
          </div>
        )}
      </div>

      {/* 改判菜单画在裁切容器外面 —— 放在 overflow-hidden 内部会被边缘裁掉。
          横向做避让，保证菜单不会跑出图框。 */}
      {openBox && (
        <div
          className="relative z-20"
          style={{ height: 0 }}
        >
          <div
            className="absolute rounded-md border border-hair bg-white p-2 shadow-lg"
            style={{
              left: Math.max(0, Math.min(openBox.x * sx, wrapW - POP_W - 4)),
              top: (openBox.y + openBox.h) * sx + 18,
              width: POP_W,
            }}
          >
            <p className="text-[11px] leading-snug text-muted">{KIND_MAP[openBox.kind]?.plain}</p>
            <div className="mt-1.5 space-y-0.5">
              {openBox.reasons?.map((r, i) => (
                <p key={i} className="font-mono text-[9.5px] leading-tight text-muted">
                  · {r}
                </p>
              ))}
            </div>
            {openBox.meters && (
              <p className="mt-1.5 font-mono text-[9.5px] text-accent">
                实算约 {openBox.meters.w} × {openBox.meters.h} m（按人体 1.7 m 折算）
              </p>
            )}
            <p className="mt-1.5 text-[9.5px] text-muted">判定不对？点一下改成正确类别：</p>
            <div className="mt-1 grid grid-cols-2 gap-1">
              {DETECT_KINDS.filter((k) => k.id !== openBox.kind).map((k) => (
                <button
                  key={k.id}
                  onClick={() => reclassify(openBox, k.id)}
                  className="rounded border px-1 py-0.5 text-[10px] transition-colors hover:border-ink"
                  style={{ borderColor: `${k.color}66`, color: k.color }}
                >
                  {k.label}
                </button>
              ))}
            </div>
            <div className="mt-1.5 flex gap-1">
              <button
                onClick={() => keepIt(openBox)}
                className="flex-1 rounded border border-hair px-1 py-0.5 text-[10px] text-muted hover:border-ink hover:text-ink"
              >
                不是干扰物（保留）
              </button>
              <button
                onClick={() => eraseCand(openBox)}
                className="rounded border border-accent/50 px-1.5 py-0.5 text-[10px] text-accent hover:bg-accent/10"
              >
                擦除
              </button>
            </div>
          </div>
        </div>
      )}

      <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
        {detectNote ? (
          <span className="text-accent">{detectNote}</span>
        ) : tool === 'brush' ? (
          <>
            点<span className="text-ink">色框内部</span>擦除，或用笔刷<span className="text-accent">直接涂抹</span>
            车辆 / 树木；点彩色标签看判定理由并<span className="text-accent">人工改判</span>。
          </>
        ) : (
          <>
            在图上<span className="text-accent">拖一个框</span>把整辆车 / 整棵树框进去，松手即剔除 ——
            框选比涂抹快，边缘也更干净。
          </>
        )}
      </p>

      {/* 类别图例 + 批量移除 */}
      {ready && !detecting && (
        <div className="mt-2 space-y-1">
          {DETECT_KINDS.map((k) => {
            const n = counts[k.id] || 0
            if (!n && !stats?.counts?.[k.id]) return null
            return (
              <div key={k.id} className="flex items-start gap-1.5">
                <span className="mt-[3px] h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: k.color }} />
                <p className="min-w-0 flex-1 text-[10.5px] leading-snug text-muted">
                  <span className="text-ink">
                    {k.label} {n ? `${n} 个` : '已清除'}
                  </span>{' '}
                  —— {k.why}
                </p>
                {n > 0 && (
                  <button
                    onClick={() => eraseKind(k.id)}
                    className="shrink-0 rounded border border-hair px-1.5 py-0.5 font-mono text-[9.5px] text-muted transition-colors hover:border-accent hover:text-accent"
                  >
                    全删
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {stats && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[9.5px] text-muted">
          <span>
            共检出 <span className="text-ink">{stats.total}</span> 个
          </span>
          {uncertain > 0 && (
            <span>
              待确认 <span className="text-accent">{uncertain}</span>
            </span>
          )}
          {stats.pxPerM && (
            <span>
              人体标尺 <span className="text-ink">{stats.pxPerM}</span> px/m
            </span>
          )}
          {stats.reclassified?.length > 0 && (
            <span className="text-accent">尺度复核纠偏 {stats.reclassified.length}</span>
          )}
          {corrections.length > 0 && <span className="text-accent">人工改判 {corrections.length}</span>}
        </div>
      )}

      {/* 工具与遮罩样式：涂抹/框选 × 模糊/纯灰 */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[10px] text-muted">工具</span>
          {[
            ['brush', '涂抹'],
            ['rect', '框选'],
          ].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTool(id)}
              className={[
                'rounded border px-2 py-0.5 text-[11px] transition-colors',
                tool === id ? 'border-ink bg-ink text-white' : 'border-hair text-muted hover:text-ink',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[10px] text-muted">剔除底</span>
          {[
            ['blur', '模糊'],
            ['gray', '纯灰'],
          ].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setMaskMode(id)}
              title={id === 'gray' ? '剔除区域填充纯灰色，完全不参与自动识别' : '剔除区域用模糊原图填充，保留环境色'}
              className={[
                'rounded border px-2 py-0.5 text-[11px] transition-colors',
                maskMode === id ? 'border-ink bg-ink text-white' : 'border-hair text-muted hover:text-ink',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </div>
        {tool === 'brush' && (
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[10px] text-muted">笔刷</span>
            {BRUSHES.map((b) => (
              <button
                key={b}
                onClick={() => setBrush(b)}
                className={[
                  'rounded border px-2 py-0.5 text-[11px] transition-colors',
                  brush === b ? 'border-ink bg-ink text-white' : 'border-hair text-muted hover:text-ink',
                ].join(' ')}
              >
                {b}
              </button>
            ))}
          </div>
        )}
        <span className="ml-auto font-mono text-[10px] text-muted">已移除 {erased}</span>
      </div>

      <div className="mt-2 flex gap-2">
        <button
          onClick={apply}
          disabled={!ready}
          className="flex-1 rounded-md bg-ink py-1.5 text-[12px] text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          应用清洗结果
        </button>
        <button
          onClick={eraseAll}
          disabled={!cands.length}
          className="rounded-md border border-hair bg-white px-3 py-1.5 text-[12px] text-muted transition-colors hover:text-ink disabled:opacity-40"
        >
          全部移除
        </button>
        <button
          onClick={reset}
          className="rounded-md border border-hair bg-white px-3 py-1.5 text-[12px] text-muted transition-colors hover:text-ink"
        >
          复原
        </button>
      </div>
    </div>
  )
}
