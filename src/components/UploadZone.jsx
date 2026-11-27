import { useRef, useState, useEffect, useCallback } from 'react'
import { REF_ANCHORS } from '../model.js'
import { classifyRole } from '../fuse.js'
import { resampleImage } from '../image.js'

const ACCEPT = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp']
const MAX_MB = 15
const MAX_N = 6

let uid = 0

/* 标定类型：量什么，决定结果写入哪条约束 */
const MEASURE_KINDS = [
  { id: 'baseline', label: '尺度基准', hint: '量一段已知长度的参照物，反解 px/m' },
  { id: 'firstFloor', label: '首层标高', hint: '竖向量首层层高（地面到二层楼板）' },
  { id: 'totalH', label: '总高度', hint: '竖向量 ±0.000 到檐口/女儿墙顶' },
  { id: 'depth', label: '关键进深', hint: '水平方向量建筑进深' },
]

export default function UploadZone({ files = [], onChange, onCalibrate, disabled, overlay, cleanedUrl, facts = [], visionBusy = false }) {
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState(null)
  const [active, setActive] = useState(0)
  const [picking, setPicking] = useState(false)
  const [p1, setP1] = useState(null)
  const [p2, setP2] = useState(null)
  const [mKind, setMKind] = useState('baseline')
  const [refKind, setRefKind] = useState('door')
  const [refM, setRefM] = useState(2.1)
  const inputRef = useRef(null)
  const boxRef = useRef(null)
  const hostRef = useRef(null)

  const cur = files[Math.min(active, files.length - 1)] || null

  /* 把文件读成带尺寸的对象，逐个追加（不清空已有） */
  const readMany = useCallback(
    (list) => {
      const arr = Array.from(list || [])
      if (!arr.length) return
      const room = MAX_N - files.length
      if (room <= 0) {
        setError(`最多上传 ${MAX_N} 张视角图`)
        return
      }
      const accepted = []
      for (const item of arr.slice(0, room)) {
        if (!ACCEPT.includes(item.type)) {
          setError('仅支持 PNG / JPG / WEBP 等图片格式')
          continue
        }
        if (item.size > MAX_MB * 1024 * 1024) {
          setError(`「${item.name}」超过 ${MAX_MB} MB`)
          continue
        }
        accepted.push(item)
      }
      setError(null)
      if (!accepted.length) return

      let pending = accepted.length
      accepted.forEach((item) => {
        const url = URL.createObjectURL(item)
        const probe = new Image()
        probe.onload = async () => {
          /* 模块二 · 重采样：先在本模块把超大图压到 1080p 上限（质量 0.8），
             再进入视觉分析管线 —— 防止 4000px 级原图解码时撑爆移动端内存。
             压缩失败 / 无需压缩时原样入库，绝不阻塞上传主流程。 */
          let entry = {
            id: ++uid,
            url,
            raw: item,
            name: item.name,
            size: item.size,
            w: probe.width,
            h: probe.height,
          }
          try {
            const oldUrl = url
            entry = await resampleImage(entry)
            if (entry.url !== oldUrl) URL.revokeObjectURL(oldUrl) // 旧大图立刻释放
          } catch {
            /* 保留原 entry */
          }
          onChange([...files, entry])
          if (--pending === 0) setActive(files.length)
        }
        probe.onerror = () => {
          setError('无法解析该图片')
          URL.revokeObjectURL(url)
          if (--pending === 0) setActive(files.length)
        }
        probe.src = url
      })
    },
    [files, onChange],
  )

  useEffect(() => {
    const onPaste = (e) => {
      const items = e.clipboardData?.files
      if (items?.length && !disabled) readMany(items)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [readMany, disabled])

  const onDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    if (disabled) return
    readMany(e.dataTransfer.files)
  }

  const remove = (id) => {
    const target = files.find((x) => x.id === id)
    if (target) URL.revokeObjectURL(target.url)
    const next = files.filter((x) => x.id !== id)
    onChange(next)
    setActive((a) => Math.min(a, Math.max(0, next.length - 1)))
  }

  const clearAll = () => {
    files.forEach((x) => URL.revokeObjectURL(x.url))
    onChange([])
    setActive(0)
  }

  /* ── 尺度标定：在预览图上取两点，输入真实长度 ── */
  const pickAt = (e) => {
    const img = boxRef.current?.getBoundingClientRect()
    const host = hostRef.current?.getBoundingClientRect()
    if (!img || !host) return
    const nx = (e.clientX - img.left) / img.width
    const ny = (e.clientY - img.top) / img.height
    const p = {
      x: nx,
      y: ny,
      cx: (e.clientX - host.left) / host.width,
      cy: (e.clientY - host.top) / host.height,
    }
    if (!p1 || (p1 && p2)) {
      setP1(p)
      setP2(null)
    } else {
      setP2(p)
    }
  }

  const pair = p1 && p2 ? [p1, p2] : null
  const pxLen = pair && cur
    ? Math.hypot((p2.x - p1.x) * cur.w, (p2.y - p1.y) * cur.h)
    : 0

  const applyCalib = () => {
    if (!pxLen || !refM) return
    const pxPerM = pxLen / Number(refM)
    const anchor = REF_ANCHORS.find((a) => a.id === refKind)
    /* 建筑主体约占画面宽度的 78%（经验值，真实实现里由分割 mask 给出） */
    const span = (cur.w / pxPerM) * 0.78
    onCalibrate?.({
      kind: mKind,
      pxPerM,
      meters: Number(refM),
      refKind,
      refLabel: anchor?.label || '自定义',
      span: mKind === 'baseline' ? span : undefined,
    })
    setPicking(false)
  }

  /* ── 已上传：主预览 + 视角缩略图列表 ── */
  if (files.length) {
    const kb = (cur.size / 1024).toFixed(0)
    return (
      <div>
        <div ref={hostRef} className="relative aspect-[4/3] w-full overflow-hidden rounded-lg border border-hair bg-sheet flex items-center justify-center">
          <img
            ref={boxRef}
            src={cleanedUrl || cur.url}
            alt="用户上传的建筑参考图"
            onClick={picking ? pickAt : undefined}
            className={['max-h-full max-w-full object-contain', picking ? 'cursor-crosshair' : ''].join(' ')}
          />
          {picking && p1 && (
            <svg className="pointer-events-none absolute inset-0 h-full w-full">
              <line
                x1={`${p1.cx * 100}%`}
                y1={`${p1.cy * 100}%`}
                x2={p2 ? `${p2.cx * 100}%` : `${p1.cx * 100}%`}
                y2={p2 ? `${p2.cy * 100}%` : `${p1.cy * 100}%`}
                stroke="#9a3412"
                strokeWidth="1.5"
              />
              {[p1, p2].filter(Boolean).map((p, i) => (
                <circle key={i} cx={`${p.cx * 100}%`} cy={`${p.cy * 100}%`} r="3.5" fill="#9a3412" />
              ))}
            </svg>
          )}
          <span className="absolute left-2 top-2 rounded bg-ink/85 px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-white">
            VIEW {Math.min(active, files.length - 1) + 1}/{files.length}
          </span>
          {cleanedUrl && (
            <span className="absolute right-2 top-2 rounded bg-accent px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-white">
              CLEANED
            </span>
          )}
          {overlay && (
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              <div className="absolute inset-0 bg-sheet/55 backdrop-blur-[1px]" />
              <div className="scanline absolute inset-x-0 top-0 h-14 bg-gradient-to-b from-transparent via-accent/30 to-transparent" />
              <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none">
                <defs>
                  <pattern id="uz-net" width="26" height="26" patternUnits="userSpaceOnUse">
                    <path d="M26 0H0v26" fill="none" stroke="#9a3412" strokeWidth="0.6" opacity="0.35" />
                  </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#uz-net)" />
              </svg>
              <span className="absolute bottom-3 left-3 font-mono text-[10px] tracking-wider text-accent">
                PROCESSING GEOMETRY
              </span>
            </div>
          )}
        </div>

        {/* ── 逐视角视觉证据：这张图被真实读出了什么 ── */}
        {(() => {
          const fx = facts.find((x) => x.id === cur.id)
          if (!fx) {
            return visionBusy ? (
              <p className="mt-3 font-mono text-[10.5px] text-accent">正在读取该视角的像素证据…</p>
            ) : null
          }
          if (!fx.ok) return <p className="mt-3 font-mono text-[10.5px] text-accent">{fx.note}</p>
          const role = classifyRole(fx)
          const pc = (v) => `${Math.round((v || 0) * 100)}%`
          return (
            <div className="mt-3 rounded-md border border-hair bg-sheet px-2.5 py-2">
              <p className="font-mono text-[10px] tracking-wider text-muted">
                VISION READ · {role.label} · 置信 {pc(fx.confidence)}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10.5px] text-muted">
                <span>横结构线 <span className="text-ink">{fx.hLines?.length ?? 0}</span></span>
                <span>竖结构线 <span className="text-ink">{fx.vLines?.length ?? 0}</span></span>
                <span>楼层带 <span className="text-ink">{fx.floorBands ?? 0}</span></span>
                <span>竖向分格 <span className="text-ink">{fx.bayDivisions ?? 0}</span></span>
                <span>架空 <span className="text-ink">{pc(fx.pilotisScore)}</span></span>
                <span>玻璃 <span className="text-ink">{pc(fx.glassScore)}</span></span>
                <span>对称 <span className="text-ink">{pc(fx.symmetry)}</span></span>
                {fx.cornerX != null && <span>转角 <span className="text-ink">x={fx.cornerX}</span></span>}
                {fx.footprintRatio && <span>面宽/进深 <span className="text-ink">{fx.footprintRatio}</span></span>}
              </div>
            </div>
          )
        })()}

        {/* 视角缩略图 */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {files.map((fl, i) => (
            <div key={fl.id} className="group relative">
              <button
                onClick={() => setActive(i)}
                className={[
                  'block h-12 w-16 overflow-hidden rounded border transition-all',
                  i === Math.min(active, files.length - 1)
                    ? 'border-ink ring-1 ring-ink/20'
                    : 'border-hair hover:border-ink/50',
                ].join(' ')}
              >
                <img src={fl.url} alt={fl.name} className="h-full w-full object-cover" />
              </button>
              {(() => {
                const fx = facts.find((x) => x.id === fl.id)
                if (!fx) return visionBusy ? (
                  <span className="pointer-events-none absolute bottom-0 left-0 bg-accent/85 px-1 font-mono text-[9px] text-white">
                    …
                  </span>
                ) : null
                const tag = fx.ok
                  ? { corner: '角', oblique: '斜', frontal: '正', unknown: '?' }[classifyRole(fx).role] || '?'
                  : '!'
                return (
                  <span
                    title={fx.ok ? classifyRole(fx).label : fx.note}
                    className="pointer-events-none absolute bottom-0 left-0 bg-ink/85 px-1 font-mono text-[9px] text-white"
                  >
                    {tag}
                  </span>
                )
              })()}
              {!disabled && (
                <button
                  onClick={() => remove(fl.id)}
                  title="移除该视角"
                  className="absolute -right-1.5 -top-1.5 grid h-4 w-4 place-items-center rounded-full border border-hair bg-white text-[10px] leading-none text-muted opacity-0 transition-opacity hover:border-ink hover:text-ink group-hover:opacity-100"
                >
                  ×
                </button>
              )}
            </div>
          ))}

          {!disabled && files.length < MAX_N && (
            <button
              onClick={() => inputRef.current?.click()}
              className="grid h-12 w-16 place-items-center rounded border border-dashed border-[#cfccc5] text-[18px] leading-none text-muted transition-colors hover:border-ink/50 hover:text-ink"
              title="继续添加视角"
            >
              +
            </button>
          )}
        </div>

        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[13px] text-ink">{cur.name}</p>
            <p className="mt-0.5 font-mono text-[11px] text-muted">
              {cur.w}×{cur.h} px · {kb} KB · 共 {files.length} 视角
            </p>
          </div>
          {!disabled && (
            <button
              onClick={clearAll}
              className="shrink-0 rounded-md border border-hair px-3 py-1.5 text-[12px] text-muted transition-colors hover:border-ink hover:text-ink"
            >
              清空
            </button>
          )}
        </div>

        {/* ── 尺度标定 ── */}
        {!disabled && (
          <div className="mt-2.5">
            {!picking ? (
              <button
                onClick={() => {
                  setPicking(true)
                  setP1(null)
                  setP2(null)
                }}
                className="w-full rounded-md border border-dashed border-[#cfccc5] py-2 text-[12px] text-muted transition-colors hover:border-accent hover:text-accent"
              >
                标定 · 量一段：尺度基准 / 首层标高 / 总高 / 进深
              </button>
            ) : (
              <div className="rounded-md border border-accent/40 bg-[#fbf4ef] p-2.5">
                <p className="mb-2 font-mono text-[10.5px] tracking-wider text-accent">
                  {!p1 ? '点击线段起点' : !p2 ? '点击线段终点' : `线段 ${pxLen.toFixed(0)} px`}
                </p>

                {/* 量什么 → 决定写入哪条约束 */}
                <div className="mb-2">
                  <select
                    value={mKind}
                    onChange={(e) => setMKind(e.target.value)}
                    className="w-full rounded border border-hair bg-white px-2 py-1 text-[12px] text-ink outline-none"
                  >
                    {MEASURE_KINDS.map((k) => (
                      <option key={k.id} value={k.id}>{k.label}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] leading-snug text-muted">
                    {MEASURE_KINDS.find((k) => k.id === mKind)?.hint}
                  </p>
                </div>

                {pair && (
                  <div className="mb-2 flex items-center gap-2">
                    {mKind === 'baseline' && (
                      <select
                        value={refKind}
                        onChange={(e) => {
                          setRefKind(e.target.value)
                          const a = REF_ANCHORS.find((x) => x.id === e.target.value)
                          if (a) setRefM(a.m)
                        }}
                        className="rounded border border-hair bg-white px-2 py-1 text-[12px] text-ink outline-none"
                      >
                        {REF_ANCHORS.map((a) => (
                          <option key={a.id} value={a.id}>{a.label}</option>
                        ))}
                      </select>
                    )}
                    <input
                      type="number"
                      step="0.1"
                      min="0.1"
                      value={refM}
                      onChange={(e) => setRefM(e.target.value)}
                      className="w-16 rounded border border-hair bg-white px-2 py-1 text-right text-[12px] text-ink outline-none"
                    />
                    <span className="text-[12px] text-muted">m</span>
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={applyCalib}
                    disabled={!pair || !refM}
                    className="flex-1 rounded-md bg-ink py-1.5 text-[12px] text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                  >
                    应用标定
                  </button>
                  <button
                    onClick={() => setPicking(false)}
                    className="rounded-md border border-hair px-3 py-1.5 text-[12px] text-muted transition-colors hover:text-ink"
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            readMany(e.target.files)
            e.target.value = ''
          }}
        />
      </div>
    )
  }

  /* ── 未上传 ── */
  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault()
          if (!disabled) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => !disabled && inputRef.current?.click()}
        className={[
          'cursor-pointer select-none rounded-lg border border-dashed transition-all duration-200',
          'flex flex-col items-center justify-center gap-4 px-6 py-12 text-center',
          dragging ? 'border-accent bg-[#fbf4ef] scale-[1.01]' : 'border-[#cfccc5] bg-sheet hover:border-ink/40',
          disabled ? 'pointer-events-none opacity-60' : '',
        ].join(' ')}
      >
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.1" className="text-muted">
          <path d="M3 15.5V5.5A1.5 1.5 0 0 1 4.5 4h15A1.5 1.5 0 0 1 21 5.5v10a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 15.5Z" />
          <path d="M3 20h18" strokeLinecap="round" />
          <path d="M7.5 12.5 11 9l2.6 2.6L16.5 8" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="7.6" cy="9.4" r=".9" fill="currentColor" stroke="none" />
        </svg>

        <div>
          <p className="text-[15px] text-ink">拖拽图片到此处</p>
          <p className="mt-1.5 text-[12px] text-muted">
            透视效果图 / 手绘草图 / 现场照片 · 可一次选多张，也可后续继续添加
          </p>
        </div>

        <div className="flex items-center gap-3 pt-1">
          <span className="rounded-md border border-hair px-3 py-1.5 text-[12px] text-ink">选择文件</span>
          <span className="font-mono text-[11px] text-muted">⌘ / Ctrl + V</span>
        </div>
      </div>

      {error && <p className="mt-2.5 text-[12px] text-accent">{error}</p>}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          readMany(e.target.files)
          e.target.value = ''
        }}
      />
    </div>
  )
}
