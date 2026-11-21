import React from 'react'
import {
  INK, MUTED, FAINT, ACCENT, SHEET,
  f, pts, Person, Stamp, ScaleBar, GroundHatch, InferredHatch,
} from './shared.jsx'

const C = 0.8660254 // cos30
const S = 0.5 // sin30

export default function IsometricDrawing({ model, showInferred = false, showOpenings = true }) {
  const U = 24 // px per meter
  const P = (x, y, z) => [(x - y) * C * U, (x + y) * S * U - z * U]

  const { volumes, length: L, depth: D } = model
  const pad = 52
  /* 主体体量必须存在（厂房类型已保证 main 不被裁剪），仍留兜底避免图纸崩掉 */
  const main = model.volumes.find((v) => v.id === 'main') || volumes[0]

  const facesOf = (v) => ({
    top: [P(v.x0, v.y0, v.z1), P(v.x1, v.y0, v.z1), P(v.x1, v.y1, v.z1), P(v.x0, v.y1, v.z1)],
    fx: [P(v.x1, v.y0, v.z0), P(v.x1, v.y1, v.z0), P(v.x1, v.y1, v.z1), P(v.x1, v.y0, v.z1)],
    fy: [P(v.x0, v.y1, v.z0), P(v.x1, v.y1, v.z0), P(v.x1, v.y1, v.z1), P(v.x0, v.y1, v.z1)],
  })

  const gx0 = -2.5, gy0 = -2.5, gx1 = L + 2.5, gy1 = D + 3.2
  const all = []
  volumes.forEach((v) => {
    for (const x of [v.x0, v.x1]) for (const y of [v.y0, v.y1]) for (const z of [v.z0, v.z1]) all.push(P(x, y, z))
  })
  for (const [x, y] of [[gx0, gy0], [gx1, gy0], [gx1, gy1], [gx0, gy1]]) all.push(P(x, y, 0))

  const xs = all.map((p) => p[0]), ys = all.map((p) => p[1])
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)

  const vbX = minX - pad - 92
  const vbY = minY - pad - 10
  const vbW = maxX - minX + pad * 2 + 128
  const vbH = maxY - minY + pad * 2 + 46

  const sw = Math.max(0.9, Math.hypot(vbW, vbH) / 600)
  const fs = Math.max(9, vbH / 34)

  const ordered = [...volumes].sort((a, b) => a.x0 + a.y0 + a.z0 - (b.x0 + b.y0 + b.z0))
  const r2 = (v) => Math.round(v * 100) / 100

  /* 落在主体量正立面上的开洞：横向长窗贯通全长，不能因超出体量边界被整条滤掉 */
  const faceOpenings = (model.openings || []).filter(
    (o) => o.kind !== 'solid' && o.x1 > main.x0 && o.x0 < main.x1,
  )

  /* 架空柱的 y 向排布：与 x 向同用结构柱网 */
  const colYs = []
  if (model.structure === 'pilotis') {
    const g = Math.max(1.5, model.grid || 4.75)
    for (let y = 0.6; y <= D - 0.35; y += g) colYs.push(r2(Math.min(y, D - 0.6)))
  }
  const colFaces = (cx, cy, z0, z1, w) => ({
    fx: [P(cx + w, cy - w, z0), P(cx + w, cy + w, z0), P(cx + w, cy + w, z1), P(cx + w, cy - w, z1)],
    fy: [P(cx - w, cy + w, z0), P(cx + w, cy + w, z0), P(cx + w, cy + w, z1), P(cx - w, cy + w, z1)],
  })

  return (
    <svg viewBox={`${f(vbX)} ${f(vbY)} ${f(vbW)} ${f(vbH)}`} className="block h-full w-full" role="img" aria-label="建筑等轴测体块分析图">
      <defs>
        <GroundHatch id="iso-g" sw={sw} />
        <InferredHatch id="iso-inf" sw={sw} />
      </defs>

      {/* 地面 */}
      <polygon points={pts([P(gx0, gy0, 0), P(gx1, gy0, 0), P(gx1, gy1, 0), P(gx0, gy1, 0)])} fill="url(#iso-g)" stroke={FAINT} strokeWidth={sw * 0.8} strokeDasharray={`${sw * 3} ${sw * 3}`} opacity="0.65" />
      {Array.from({ length: Math.ceil((gx1 - gx0) / 2) + 1 }, (_, i) => gx0 + 2 * i).map((x, i) => (
        <line key={`gx${i}`} x1={f(P(x, gy0, 0)[0])} y1={f(P(x, gy0, 0)[1])} x2={f(P(x, gy1, 0)[0])} y2={f(P(x, gy1, 0)[1])} stroke={FAINT} strokeWidth={sw * 0.55} />
      ))}
      {Array.from({ length: Math.ceil((gy1 - gy0) / 2) + 1 }, (_, i) => gy0 + 2 * i).map((y, i) => (
        <line key={`gy${i}`} x1={f(P(gx0, y, 0)[0])} y1={f(P(gx0, y, 0)[1])} x2={f(P(gx1, y, 0)[0])} y2={f(P(gx1, y, 0)[1])} stroke={FAINT} strokeWidth={sw * 0.55} />
      ))}

      {/* 体块 */}
      {ordered.map((v) => {
        const { top, fx, fy } = facesOf(v)
        return (
          <g key={v.id} strokeLinejoin="round">
            <polygon points={pts(fy)} fill="#e4e1db" stroke={INK} strokeWidth={sw} />
            <polygon points={pts(fx)} fill="#efede8" stroke={INK} strokeWidth={sw} />
            <polygon points={pts(top)} fill={SHEET} stroke={INK} strokeWidth={sw} />
          </g>
        )
      })}

      {/* ── 底层架空柱 pilotis ──
          等轴测必须和立面一致地表达「底层透空」：
          柱自地面直达主体底面，方盒子浮在上面。 */}
      {model.structure === 'pilotis' &&
        (model.columns || [])
          .filter((cx) => cx >= main.x0 - 0.2 && cx <= main.x1 + 0.2)
          .map((cx, i) =>
            colYs.map((cy, k) => {
              const { fx, fy } = colFaces(cx, cy, 0, main.z0, 0.16)
              return (
                <g key={`pc${i}-${k}`}>
                  <polygon points={pts(fy)} fill="#d8d4cb" stroke={INK} strokeWidth={sw * 0.85} />
                  <polygon points={pts(fx)} fill="#efede8" stroke={INK} strokeWidth={sw * 0.85} />
                </g>
              )
            })
          )}

      {/* ── 结构楼层线（粗，带标高）—— 与开窗严格区分 ── */}
      {main &&
        (main.levels || []).map((z, i) => (
          <g key={`lv${i}`} stroke={INK} strokeWidth={sw * 1.15} opacity="0.9">
            <line x1={f(P(main.x1, main.y0, z)[0])} y1={f(P(main.x1, main.y0, z)[1])} x2={f(P(main.x1, main.y1, z)[0])} y2={f(P(main.x1, main.y1, z)[1])} />
            <line x1={f(P(main.x0, main.y1, z)[0])} y1={f(P(main.x0, main.y1, z)[1])} x2={f(P(main.x1, main.y1, z)[0])} y2={f(P(main.x1, main.y1, z)[1])} />
          </g>
        ))}

      {/* ── 立面开洞（细线 + 浅填充，不跨楼层线）── */}
      {showOpenings &&
        main &&
        faceOpenings.map((o, i) => {
          const a = P(o.x0, main.y1, o.sill)
          const b = P(o.x1, main.y1, o.sill)
          const c = P(o.x1, main.y1, o.head)
          const d = P(o.x0, main.y1, o.head)
          return (
            <g key={`op${i}`}>
              <polygon points={pts([a, b, c, d])} fill={SHEET} stroke={MUTED} strokeWidth={sw * 0.7} opacity="0.95" />
              {o.kind === 'window' && (
                <line x1={f(a[0])} y1={f((a[1] + d[1]) / 2)} x2={f(b[0])} y2={f((b[1] + c[1]) / 2)} stroke={MUTED} strokeWidth={sw * 0.5} opacity="0.7" />
              )}
            </g>
          )
        })}

      {/* 推断区域 —— 视角越多面积越小 */}
      {showInferred && (
        <g>
          <polygon points={pts([P(0, D, 0), P(L, D, 0), P(L, D, model.maxZ), P(0, D, model.maxZ)])} fill="url(#iso-inf)" stroke={ACCENT} strokeWidth={sw} strokeDasharray={`${sw * 4} ${sw * 3}`} opacity={0.85 - model.coverage * 0.4} />
          {model.coverage < 0.8 && (
            <polygon points={pts([P(L, 0, 0), P(L, D, 0), P(L, D, model.maxZ), P(L, 0, model.maxZ)])} fill="url(#iso-inf)" stroke={ACCENT} strokeWidth={sw} strokeDasharray={`${sw * 4} ${sw * 3}`} opacity={0.5 - model.coverage * 0.3} />
          )}
        </g>
      )}

      {/* 标高 */}
      {model.levels.map((z, i) => {
        const [x, y] = P(0, D, z)
        return (
          <g key={`m${i}`}>
            <line x1={vbX + 14} y1={f(y)} x2={x - sw * 4} y2={f(y)} stroke={MUTED} strokeWidth={sw * 0.7} />
            <path d={`M ${f(x)} ${f(y)} l ${-sw * 5} ${-sw * 3} l 0 ${sw * 6} Z`} fill={i === 0 ? ACCENT : INK} />
            <text x={vbX + 14} y={f(y) - fs * 0.42} fontSize={fs * 0.78} fontFamily="ui-monospace, monospace" fill={i === 0 ? ACCENT : MUTED}>
              +{z.toFixed(3)}
            </text>
          </g>
        )
      })}

      {/* 人形 */}
      <Person x={f(P(L + 1.6, D + 1.2, 0)[0])} groundY={f(P(L + 1.6, D + 1.2, 0)[1])} h={1.75 * U} opacity={0.8} />

      {/* 指北针 */}
      <g transform={`translate(${f(maxX - 4)}, ${f(minY - 6)})`}>
        <circle r={fs * 1.5} fill={SHEET} stroke={MUTED} strokeWidth={sw * 0.8} />
        <path d={`M 0 ${-fs * 1.32} L ${fs * 0.4} ${fs * 0.52} L 0 ${fs * 0.12} L ${-fs * 0.4} ${fs * 0.52} Z`} fill={INK} />
        <text y={-fs * 1.9} textAnchor="middle" fontSize={fs * 0.72} fontFamily="ui-monospace, monospace" fill={MUTED}>N</text>
      </g>

      {/* 图例 —— 明确区分「楼层线」与「开窗」 */}
      <g transform={`translate(${f(vbX + 14)}, ${f(vbY + vbH - 54)})`}>
        <line x1="0" y1="0" x2="30" y2="0" stroke={INK} strokeWidth={sw * 1.15} />
        <text x="38" y="3.5" fontSize={fs * 0.72} fontFamily="ui-monospace, monospace" fill={MUTED}>结构楼层线 · 楼板标高</text>
        <rect x="0" y="10" width="30" height="15" fill={SHEET} stroke={MUTED} strokeWidth={sw * 0.7} />
        <line x1="0" y1="17.5" x2="30" y2="17.5" stroke={MUTED} strokeWidth={sw * 0.5} opacity="0.7" />
        <text x="38" y="21" fontSize={fs * 0.72} fontFamily="ui-monospace, monospace" fill={MUTED}>立面开洞 · 窗 / 门</text>
      </g>

      <ScaleBar x={vbX + 14} y={vbY + vbH - 16} fs={fs} sw={sw} meters={5} pxPerMeter={U} />
      <Stamp x={vbX + vbW - 186} y={vbY + 16} sw={sw} lines={['ISOMETRIC 45° / 35.264°', 'ORTHOGRAPHIC · TRUE SCALE', `VIEWS ${model.views} · COV ${Math.round(model.coverage * 100)}%`]} />
    </svg>
  )
}
