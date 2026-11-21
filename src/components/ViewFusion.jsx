import { useState } from 'react'

const r2 = (v) => Math.round(v * 100) / 100

function Chip({ children, tone = 'plain' }) {
  const cls =
    tone === 'vision'
      ? 'border border-accent/40 bg-[#fbf4ef] text-accent'
      : tone === 'conflict'
        ? 'border border-[#b91c1c]/40 bg-[#fef2f2] text-[#7f1d1d]'
        : 'border border-hair bg-sheet text-muted'
  return <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${cls}`}>{children}</span>
}

/**
 * 多视角融合报告 —— 回答两个问题：
 *   1. 我多传的这几张图到底被用到哪儿了？
 *   2. 和「只传第一张」相比，结论究竟变了什么？
 */
export default function ViewFusion({ model }) {
  const [open, setOpen] = useState(true)
  const f = model?.fusion
  if (!f || !f.count) return null

  const observed = model?.plan?.observed || []
  const fa = model?.plan?.unobserved || []
  const H = f.hyp || {}

  return (
    <div className="mt-2 rounded-md border border-hair bg-white/60 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] tracking-wider text-muted">
        <button onClick={() => setOpen((v) => !v)} className="text-ink hover:opacity-70">
          {open ? '▾' : '▸'} MULTI-VIEW FUSION
        </button>
        <span>
          可用视角 <span className="text-ink">{f.count}</span>/{f.total}
        </span>
        <span>
          观测立面 <span className="text-ink">{observed.length}</span> 面
          {fa.length > 0 && <span className="text-muted"> · 未观测 {fa.join(' / ')}</span>}
        </span>
        {model?.variant?.id && (
          <span>
            variant <span className="text-ink">{model.variant.id}</span>
          </span>
        )}
      </div>

      {open && (
        <>
          {/* ── 每个视角贡献了什么 ── */}
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {f.contributions.map((c) => (
              <div key={c.id} className="rounded border border-hair px-2 py-1.5">
                <p className="truncate text-[11.5px] leading-tight text-ink">
                  V{c.id} · {c.name}
                </p>
                <p className="mt-0.5 font-mono text-[10px] text-muted">{c.roleLabel}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {c.items.map((it) => (
                    <Chip key={it.key}>{it.value}</Chip>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* ── 融合后的结论 ── */}
          <div className="mt-2 flex flex-wrap items-center gap-1 font-mono text-[10px]">
            <Chip tone="vision">floors {H.floors?.v ?? '—'} · {H.floors?.src || 'n/a'}</Chip>
            <Chip tone="vision">bays {H.bays?.v ?? '—'} · {H.bays?.src || 'n/a'}</Chip>
            {H.structure && <Chip tone="vision">structure {H.structure}</Chip>}
            {H.fenestration && <Chip tone="vision">fenestration {H.fenestration}</Chip>}
            {H.roof && <Chip tone="vision">roof {H.roof}</Chip>}
            {H.footprintRatio?.v && (
              <Chip tone="vision">
                面宽/进深 {H.footprintRatio.v} · vision
              </Chip>
            )}
            <Chip>observed {observed.join(' / ')}</Chip>
          </div>

          {/* ── 与「只传第一张」的增量对比 ── */}
          {f.gained?.length > 0 && (
            <div className="mt-2">
              <p className="font-mono text-[10px] tracking-wider text-muted">
                DELTA vs 单视角（只传第一张会得到什么）
              </p>
              <table className="mt-1 w-full table-fixed font-mono text-[10.5px]">
                <tbody>
                  {f.gained.map((g) => (
                    <tr key={g.key} className="border-t border-hair/60">
                      <td className="w-[92px] py-0.5 pr-2 text-muted">{g.label}</td>
                      <td className="w-[42%] py-0.5 text-muted line-through decoration-muted/40">
                        {String(g.single)}
                      </td>
                      <td className="py-0.5 text-ink">{String(g.multi)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {f.gained && f.gained.length === 0 && (
            <p className="mt-2 font-mono text-[10.5px] text-muted">
              本次新增视角与首张结论一致，未引入新的几何证据（多以 Sheets 交叉验证为主）。
            </p>
          )}

          {/* ── 视角之间的冲突 ── */}
          {f.conflicts?.length > 0 && (
            <div className="mt-2">
              <p className="font-mono text-[10px] tracking-wider text-[#b91c1c]">
                VIEW CONFLICT · {f.conflicts.length} 项
              </p>
              {f.conflicts.map((x, i) => (
                <p key={i} className="mt-0.5 text-[11px] leading-snug text-[#7f1d1d]">
                  · {x.msg}
                </p>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
