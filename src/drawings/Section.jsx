import React from 'react'
import {
  INK, MUTED, FAINT, ACCENT, SHEET, SHEET_W,
  f, Person, Stamp, ScaleBar, DimLine, GroundHatch,
  PocheConcrete, PocheMasonry, PocheInsulation, PocheEarth,
  CutLine, Axis, Pilotis, RoofGarden, Ramp,
} from './shared.jsx'

/**
 * SECTION A—A · 竖向剖切
 *
 * 制图红线（本版最重要的一条）：
 *   剖面只允许画「剖切面切到的实体」+「剖切面以外确实看得见的东西」。
 *   楼梯 / 内隔墙 / 家具在照片上完全不可见，属于纯脑补 ——
 *   除非用户在左侧人工声明「剖切经过楼梯间」，否则一个踏步都不画，
 *   并在图纸左上角显式列出「未建模项」，让读者知道这是克制而不是遗漏。
 *
 * 线宽分级（GB/T 50001 · 50004）：
 *   剖切到的主要构件 b / 次要构件 0.5b / 剖切面以外轮廓 0.25b / 尺寸与轴线 0.25b
 */
export default function SectionDrawing({ model }) {
  const VB_H = 580
  const L = model.length
  const F = model.floors
  const FH = model.floorHeight
  /* 首层完成面（±0.000）：架空建筑被抬到 pilotiH */
  const PAR = model.base ?? model.plinth
  const SLAB = model.slab
  const FIN = 0.05
  const WALL = 0.3
  const COL = 0.4
  const BEAM = 0.5
  const PARA = model.parapet ?? 0.6
  const isPilotis = model.structure === 'pilotis'
  const DROP = isPilotis ? (model.pilotiH ?? 0) : (model.siteDrop ?? 0.45)
  /* 结构柱位（米制）：剖面按真实柱网排柱，不再是「一根柱撑全场」 */
  const colsM = (model.columns && model.columns.length ? model.columns : [L * 0.28]).filter((c) => c <= L)

  const totalH = F * FH
  /* 左右留出尺寸链 / 标高 / 图签空间 */
  const s = Math.min(470 / (L + 0.8), 330 / (totalH + PARA + DROP + 0.6))
  const x0 = (SHEET_W - L * s) / 2
  const baseY = VB_H - 215

  const sw = 1.9 // b（基本线宽）
  const fs = 11
  const LW = { cut: 1.0, minor: 0.5, seen: 0.25, anno: 0.25 }
  const W = (k) => sw * LW[k]

  /* 构造层次仅在约束可信时展开；室内构件只认人工声明 */
  const detail = !!model.detail && F <= 8
  const hasStair = !!model.interior?.stair?.on && !!model.stair
  const hasPartitions = !!model.interior?.partitions?.on
  const hasFurniture = !!model.interior?.furniture?.on
  const stair = model.stair

  /* 门窗竖向尺寸必须与立面严格一致：直接取自同一份 openings */
  const om = (model.openings || []).find((o) => o.kind === 'window' || o.kind === 'curtain')
  const sillH = om ? Math.round((om.sill - PAR - om.fl * FH) * 100) / 100 : 0.9
  const winH = om ? Math.round((om.head - om.sill) * 100) / 100 : 1.5

  const X = (mx) => x0 + mx * s
  const Y = (mz) => baseY - (mz - PAR) * s
  const xEnd = x0 + L * s
  const partX = X(L * 0.58)
  const colX = X(L * 0.28)
  /* 剖切位置索引：用平面 cutY 在进深中的比例定位，保证与 PLAN 同一条剖切线 */
  const clamp01 = (v) => Math.max(0.06, Math.min(0.94, v))
  const cutRatio = model.plan?.cutY != null ? clamp01(model.plan.cutY / model.depth) : 0.5

  const clear = Math.round((FH - SLAB - FIN) * 100) / 100
  const stride = F > 8 ? 2 : 1
  const groundY = Y(PAR - DROP)

  const dxTotal = x0 - 152
  const dxFloor = x0 - 104
  const dxFine = x0 - 58
  /* 地坪线两端延伸，夹紧在图框内 */
  const gl = Math.max(2, x0 - 200)
  const gr = Math.min(SHEET_W - 2, xEnd + 200)

  return (
    <svg viewBox={`0 0 ${SHEET_W} ${VB_H}`} className="block h-full w-full" role="img" aria-label="建筑剖面图 SECTION A—A">
      <defs>
        <GroundHatch id="sec-g" sw={sw} />
        <PocheConcrete id="sec-conc" sw={sw} />
        <PocheMasonry id="sec-mason" sw={sw} />
        <PocheInsulation id="sec-insul" sw={sw} />
        <PocheEarth id="sec-earth" sw={sw} />
        <pattern id="sec-screed" width="4" height="4" patternUnits="userSpaceOnUse">
          <line x1="0" y1="4" x2="4" y2="0" stroke={MUTED} strokeWidth="0.4" opacity="0.5" />
        </pattern>
      </defs>

      {/* ══ 图纸标题 + 未建模项声明 ══ */}
      <g>
        <text x="8" y="22" fontSize="14" fontFamily="ui-monospace, monospace" letterSpacing="0.06em" fill={INK}>
          SECTION A—A
        </text>
        <text x="8" y="37" fontSize={fs * 0.72} fontFamily="ui-monospace, monospace" fill={MUTED}>
          1 : 100 · 竖向剖切 · 正投影
        </text>
        {model.omissions.length > 0 && (
          <>
            <text x="8" y="55" fontSize={fs * 0.68} fontFamily="ui-monospace, monospace" fill={ACCENT}>
              未建模（照片中不可见 · 无视觉证据）
            </text>
            <text x="8" y="69" fontSize={fs * 0.68} fontFamily="ui-monospace, monospace" fill={ACCENT}>
              {model.omissions.map((o) => o.label).join(' · ')}
            </text>
          </>
        )}
      </g>

      {/* ══ 剖切位置索引（平面示意 + A—A 剖切线） ══ */}
      <g>
        <text x="8" y="92" fontSize={fs * 0.68} fontFamily="ui-monospace, monospace" fill={MUTED} letterSpacing="0.05em">
          剖切位置
        </text>
        {/* 剖切位置取自 model.plan.cutY —— 与平面图上的 A—A 严格同一条，
            不再各算一套（该位置已由引擎自动避开柱位） */}
        <rect x="8" y="98" width="150" height={Math.max(34, model.depth * s * 0.5)} fill="none" stroke={MUTED} strokeWidth={W('anno')} />
        <CutLine
          x1="8"
          y1={98 + Math.max(34, model.depth * s * 0.5) * (cutRatio)}
          x2="158"
          y2={98 + Math.max(34, model.depth * s * 0.5) * (cutRatio)}
          tag="A"
          fs={fs}
          sw={sw}
        />
        <text x="8" y={112 + Math.max(34, model.depth * s * 0.5)} fontSize={fs * 0.62} fontFamily="ui-monospace, monospace" fill={FAINT}>
          A—A @ y = {model.plan?.cutY ?? '—'} m · 已避开柱位
        </text>
        <text x="8" y={126 + Math.max(34, model.depth * s * 0.5)} fontSize={fs * 0.62} fontFamily="ui-monospace, monospace" fill={FAINT}>
          {hasStair ? '剖切经过楼梯间（人工声明）' : '剖切未经过楼梯间'}
        </text>
      </g>

      {/* 室内空间底色 */}
      <rect x={f(x0)} y={f(Y(totalH + PARA))} width={f(L * s)} height={f((totalH + PARA + DROP) * s)} fill={SHEET} />

      {/* ── 剖切面以外的远端内墙：0.25b 虚线，明确标注「未剖切」 ── */}
      {Array.from({ length: F }, (_, i) => (
        <g key={`bg${i}`}>
          <rect
            x={f(X(L * 0.86))}
            y={f(Y((i + 1) * FH - FIN - SLAB))}
            width={f(0.2 * s)}
            height={f(clear * s)}
            fill="none"
            stroke={MUTED}
            strokeWidth={W('seen')}
            strokeDasharray={`${sw * 3} ${sw * 1.5}`}
          />
          {i === 0 && (
            <text x={f(X(L * 0.86) + 0.2 * s + 4)} y={f(Y(FH - FIN - SLAB) - 3)} fontSize={fs * 0.58} fontFamily="ui-monospace, monospace" fill={FAINT}>
              剖切面以外
            </text>
          )}
        </g>
      ))}

      {/* ── 室内：未建模区域（细虚线框 + 声明，取代凭空的楼梯与隔墙） ── */}
      {!hasPartitions &&
        Array.from({ length: F }, (_, i) => (
          <rect
            key={`void${i}`}
            x={f(x0 + WALL * s)}
            y={f(Y((i + 1) * FH - FIN - SLAB))}
            width={f(L * s - 2 * WALL * s)}
            height={f(clear * s)}
            fill="none"
            stroke={ACCENT}
            strokeWidth={W('seen')}
            strokeDasharray={`${sw * 1.5} ${sw * 2}`}
            opacity="0.55"
          />
        ))}
      {!hasPartitions && (
        <text x={f(x0 + WALL * s + 6)} y={f(Y(FH - FIN - SLAB) + fs * 1.3)} fontSize={fs * 0.66} fontFamily="ui-monospace, monospace" fill={ACCENT}>
          室内无视觉证据 · 构件未建模
        </text>
      )}

      {/* ── 内隔墙（砌体 poché）—— 仅在人工声明后绘制 ── */}
      {hasPartitions &&
        Array.from({ length: F }, (_, i) => (
          <rect
            key={`pt${i}`}
            x={f(partX)}
            y={f(Y((i + 1) * FH - FIN - SLAB))}
            width={f(0.2 * s)}
            height={f(clear * s)}
            fill="url(#sec-mason)"
            stroke={INK}
            strokeWidth={W('minor')}
          />
        ))}

      {/* ── 架空层柱：自室外地坪下基础顶面直达首层楼板底（pilotis）── */}
      {isPilotis && (
        <Pilotis
          xs={colsM.map((c) => X(c))}
          groundY={f(groundY)}
          topY={f(Y(PAR - SLAB))}
          s={s}
          sw={sw}
          colW={COL}
          fillId="sec-conc"
        />
      )}

      {/* ── 柱（混凝土 poché）：按结构柱网排布，自下层完成面至上层板底 ── */}
      {Array.from({ length: F }, (_, i) =>
        colsM.map((c, k) => (
          <rect
            key={`cl${i}-${k}`}
            x={f(X(c) - (COL * s) / 2)}
            y={f(Y((i + 1) * FH - FIN - SLAB))}
            width={f(COL * s)}
            height={f(clear * s)}
            fill="url(#sec-conc)"
            stroke={INK}
            strokeWidth={W('cut')}
          />
        ))
      )}

      {/* ── 楼板 / 梁 / 屋面构造层次 ── */}
      {Array.from({ length: F + 1 }, (_, i) => i).map((i) => {
        const z = i * FH
        const isRoof = i === F
        return (
          <g key={`sl${i}`}>
            {!isRoof && <rect x={f(x0)} y={f(Y(z))} width={f(L * s)} height={f(FIN * s)} fill="url(#sec-screed)" />}
            <rect
              x={f(x0 - 4)}
              y={f(Y(z - FIN))}
              width={f(L * s + 8)}
              height={f(SLAB * s)}
              fill="url(#sec-conc)"
              stroke={INK}
              strokeWidth={W('cut')}
            />
            {!isRoof &&
              [colX, partX].map((cx, k) => (
                <rect
                  key={k}
                  x={f(cx - (COL * s) / 2)}
                  y={f(Y(z - FIN - SLAB))}
                  width={f(COL * s)}
                  height={f(BEAM * s)}
                  fill="url(#sec-conc)"
                  stroke={INK}
                  strokeWidth={W('cut')}
                />
              ))}
            {isRoof && (
              <>
                <rect
                  x={f(x0 - 4)}
                  y={f(Y(z - FIN - SLAB - 0.12))}
                  width={f(L * s + 8)}
                  height={f(0.12 * s)}
                  fill="url(#sec-insul)"
                  stroke={MUTED}
                  strokeWidth={W('minor')}
                />
                <line
                  x1={f(x0)}
                  y1={f(Y(z - FIN - SLAB - 0.15))}
                  x2={f(xEnd)}
                  y2={f(Y(z - FIN - SLAB - 0.15))}
                  stroke={MUTED}
                  strokeWidth={W('seen')}
                />
                <text x={f(x0 + 6)} y={f(Y(z - FIN - SLAB - 0.2))} fontSize={fs * 0.62} fontFamily="ui-monospace, monospace" fill={FAINT}>
                  保温 + 找坡
                </text>
              </>
            )}
          </g>
        )
      })}

      {/* ── 外墙 poché（含女儿墙，下伸至地坪以下） ── */}
      {[
        [x0, x0 + WALL * s],
        [xEnd - WALL * s, xEnd],
      ].map(([a, b], i) => (
        <rect
          key={`ew${i}`}
          x={f(a)}
          y={f(Y(totalH + PARA))}
          width={f(b - a)}
          /* 架空建筑的外墙只到首层楼板底，底层是柱不是墙 */
          height={f((totalH + PARA + (isPilotis ? SLAB : DROP + 0.3)) * s)}
          fill="url(#sec-conc)"
          stroke={INK}
          strokeWidth={W('cut')}
        />
      ))}
      {/* 屋面：栏板 / 屋顶花园弧形挡风墙 / 平板出挑 */}
      <RoofGarden
        x0={f(x0)}
        xEnd={f(xEnd)}
        roofY={f(Y(totalH))}
        parapet={PARA}
        s={s}
        sw={sw}
        fs={fs}
        kind={model.roof || 'parapet'}
        fillId="sec-conc"
      />
      {/* 自二层直达屋面的坡道（建筑漫步） */}
      {(model.roofFeatures || []).includes('ramp') && F > 1 && (
        <Ramp
          x0={f(X(L * 0.62))}
          y0={f(Y((F - 1) * FH))}
          x1={f(X(L * 0.9))}
          y1={f(Y(totalH))}
          w={6}
          sw={sw}
        />
      )}

      {/* ── 外墙上的窗：洞口上下缘与立面开口严格对齐 ── */}
      {Array.from({ length: F }, (_, i) => {
        const zSill = i * FH + sillH
        const zHead = zSill + winH
        return (
          <g key={`sw${i}`}>
            <rect x={f(x0)} y={f(Y(zHead))} width={f(WALL * s)} height={f(winH * s)} fill={SHEET} stroke={INK} strokeWidth={W('minor')} />
            <line x1={f(x0 - 2)} y1={f(Y(zHead))} x2={f(x0 + WALL * s + 2)} y2={f(Y(zHead))} stroke={INK} strokeWidth={W('minor')} />
            <line x1={f(x0 - 2)} y1={f(Y(zSill))} x2={f(x0 + WALL * s + 2)} y2={f(Y(zSill))} stroke={INK} strokeWidth={W('minor')} />
          </g>
        )
      })}

      {/* ── 楼梯：仅在人工声明「剖切经过楼梯间」时绘制 ── */}
      {hasStair &&
        Array.from({ length: F }, (_, i) => {
          const steps = stair.risersPerFlight
          const rx = x0 + WALL * s + 0.15 * s
          const run = Math.min(L * s * 0.24, steps * stair.tread * s)
          const topY = Y(i * FH)
          const botY = Y((i + 1) * FH)
          const treadPx = run / steps
          const riserPx = (botY - topY) / steps
          return (
            <g key={`st${i}`}>
              <path
                d={`M ${f(rx)} ${f(topY)} L ${f(rx + run)} ${f(botY)} L ${f(rx + run)} ${f(botY - 0.16 * s)} L ${f(rx)} ${f(topY - 0.16 * s)} Z`}
                fill="url(#sec-conc)"
                stroke={INK}
                strokeWidth={W('minor')}
              />
              {Array.from({ length: steps }, (_, k) => (
                <path
                  key={k}
                  d={`M ${f(rx + k * treadPx)} ${f(topY + k * riserPx)} l 0 ${f(riserPx)} l ${f(treadPx)} 0`}
                  fill="none"
                  stroke={MUTED}
                  strokeWidth={W('minor')}
                />
              ))}
              <line
                x1={f(rx + treadPx * 0.5)}
                y1={f(topY + riserPx * 0.5 - 1.05 * s)}
                x2={f(rx + run + treadPx * 0.5)}
                y2={f(botY + riserPx * 0.5 - 1.05 * s)}
                stroke={INK}
                strokeWidth={W('minor')}
              />
              {i === 0 && (
                <text x={f(rx)} y={f(topY + fs * 1.3)} fontSize={fs * 0.62} fontFamily="ui-monospace, monospace" fill={FAINT}>
                  踢面 {stair.riser} · 踏面 {stair.tread} · 人工声明
                </text>
              )}
            </g>
          )
        })}

      {/* ── 内门洞：同样只在声明隔墙后才有意义 ── */}
      {hasPartitions &&
        Array.from({ length: F }, (_, i) => (
          <rect
            key={`dr${i}`}
            x={f(partX)}
            y={f(Y(i * FH) - 2.1 * s)}
            width={f(0.2 * s)}
            height={f(2.1 * s)}
            fill={SHEET}
            stroke={MUTED}
            strokeWidth={W('seen')}
          />
        ))}

      {/* ── 家具 / 人形：仅在人工声明后绘制 ── */}
      {hasFurniture &&
        Array.from({ length: F }, (_, i) => {
          const gy = Y(i * FH)
          const fx = partX + (xEnd - partX) * 0.28
          return (
            <g key={`fu${i}`}>
              <Person x={f(fx)} groundY={f(gy)} h={1.75 * s} opacity={0.7} fill={MUTED} />
              <g stroke={MUTED} strokeWidth={W('seen')} fill="none" opacity="0.65">
                <rect x={f(fx + 1.4 * s)} y={f(gy - 0.75 * s)} width={f(1.5 * s)} height={f(0.75 * s)} />
                <line x1={f(fx + 1.4 * s)} y1={f(gy - 0.75 * s)} x2={f(fx + 2.9 * s)} y2={f(gy - 0.75 * s)} />
              </g>
              <line
                x1={f(x0 + WALL * s)}
                y1={f(gy - clear * s)}
                x2={f(xEnd - WALL * s)}
                y2={f(gy - clear * s)}
                stroke={FAINT}
                strokeWidth={W('anno')}
                strokeDasharray={`${sw * 4} ${sw * 2}`}
              />
              <text x={f(x0 + WALL * s + 6)} y={f(gy - clear * s + fs * 1.1)} fontSize={fs * 0.66} fontFamily="ui-monospace, monospace" fill={FAINT}>
                净高 {f(clear)}
              </text>
            </g>
          )
        })}

      {/* ── 地坪与基础（地坪线延伸至图框，但不越出画布） ── */}
      <rect x={f(gl)} y={f(groundY)} width={f(gr - gl)} height={30} fill="url(#sec-earth)" opacity="0.6" />
      <line x1={f(gl)} y1={f(groundY)} x2={f(gr)} y2={f(groundY)} stroke={INK} strokeWidth={sw * 1.4} />
      {[X(colsM[0]), X(colsM[colsM.length - 1])].map((cx, i) => (
        <g key={`fd${i}`}>
          <rect x={f(cx - 0.75 * s)} y={f(groundY + 30)} width={f(1.5 * s)} height={f(0.25 * s)} fill="url(#sec-conc)" opacity="0.8" />
          <path
            d={`M ${f(cx - 0.75 * s)} ${f(groundY)} L ${f(cx - 0.4 * s)} ${f(groundY + 30)} L ${f(cx + 0.4 * s)} ${f(groundY + 30)} L ${f(cx + 0.75 * s)} ${f(groundY)} Z`}
            fill="url(#sec-conc)"
            stroke={INK}
            strokeWidth={W('minor')}
          />
        </g>
      ))}

      {/* ── 右侧标高（三道尺寸在左，标高在右，互不干扰） ── */}
      {Array.from({ length: F + 1 }, (_, i) => {
        if (i % stride !== 0 && i !== F) return null
        const z = i * FH
        const y = Y(PAR + z)
        return (
          <g key={`lv${i}`}>
            <line x1={f(xEnd + 12)} y1={f(y)} x2={f(xEnd + 88)} y2={f(y)} stroke={MUTED} strokeWidth={W('anno')} />
            <path d={`M ${f(xEnd + 12)} ${f(y)} l 11 -5 l 0 10 Z`} fill={i === 0 ? ACCENT : INK} />
            <text x={f(xEnd + 92)} y={f(y) + 4} fontSize={fs * 0.78} fontFamily="ui-monospace, monospace" fill={i === 0 ? ACCENT : MUTED}>
              {i === 0 ? '±0.000' : `+${z.toFixed(3)}`}
            </text>
          </g>
        )
      })}
      <g>
        <line x1={f(xEnd + 12)} y1={f(groundY)} x2={f(xEnd + 88)} y2={f(groundY)} stroke={MUTED} strokeWidth={W('anno')} />
        <path d={`M ${f(xEnd + 12)} ${f(groundY)} l 11 -5 l 0 10 Z`} fill={INK} />
        <text x={f(xEnd + 92)} y={f(groundY + 4)} fontSize={fs * 0.78} fontFamily="ui-monospace, monospace" fill={MUTED}>
          -{DROP.toFixed(3)}
        </text>
      </g>
      <line x1={f(xEnd + 12)} y1={f(Y(PAR))} x2={f(xEnd + 12)} y2={f(Y(PAR + totalH))} stroke={MUTED} strokeWidth={W('anno')} />

      {/* ── 第一道：总高 ── */}
      <g>
        {[Y(PAR - DROP), Y(PAR + F * FH + PARA)].map((y) => (
          <line key={y} x1={f(x0 - 14)} y1={f(y)} x2={f(dxTotal - 6)} y2={f(y)} stroke={MUTED} strokeWidth={W('anno')} />
        ))}
        <line x1={f(dxTotal)} y1={f(Y(PAR - DROP))} x2={f(dxTotal)} y2={f(Y(PAR + F * FH + PARA))} stroke={INK} strokeWidth={W('cut')} />
        {[Y(PAR - DROP), Y(PAR + F * FH + PARA)].map((y) => (
          <line key={`a${y}`} x1={f(dxTotal - 5)} y1={f(y)} x2={f(dxTotal + 5)} y2={f(y)} stroke={INK} strokeWidth={W('cut')} />
        ))}
        <rect x={f(dxTotal - 34)} y={f((Y(PAR - DROP) + Y(PAR + F * FH + PARA)) / 2 - 7)} width={68} height={14} fill={SHEET} />
        <text
          x={f(dxTotal)}
          y={f((Y(PAR - DROP) + Y(PAR + F * FH + PARA)) / 2 + 4)}
          textAnchor="middle"
          fontSize={fs * 0.8}
          fontFamily="ui-monospace, monospace"
          fill={INK}
        >
          {f(F * FH + PARA + DROP)}
        </text>
      </g>

      {/* ── 第二道：层高 ── */}
      {Array.from({ length: F }, (_, i) => {
        if (i % stride !== 0) return null
        const yTop = Y(PAR + (i + 1) * FH)
        const yBot = Y(PAR + i * FH)
        return (
          <g key={`dm${i}`}>
            <line x1={f(x0 - 14)} y1={f(yTop)} x2={f(dxFloor - 6)} y2={f(yTop)} stroke={MUTED} strokeWidth={W('anno')} />
            <line x1={f(x0 - 14)} y1={f(yBot)} x2={f(dxFloor - 6)} y2={f(yBot)} stroke={MUTED} strokeWidth={W('anno')} />
            <line x1={f(dxFloor)} y1={f(yTop)} x2={f(dxFloor)} y2={f(yBot)} stroke={INK} strokeWidth={W('cut')} />
            {[yTop, yBot].map((y, k) => (
              <line key={k} x1={f(dxFloor - 5)} y1={f(y)} x2={f(dxFloor + 5)} y2={f(y)} stroke={INK} strokeWidth={W('cut')} />
            ))}
            <rect x={f(dxFloor - 26)} y={f((yTop + yBot) / 2 - 7)} width={52} height={14} fill={SHEET} />
            <text x={f(dxFloor)} y={f((yTop + yBot) / 2 + 4)} textAnchor="middle" fontSize={fs * 0.8} fontFamily="ui-monospace, monospace" fill={INK}>
              {f(FH)}
            </text>
          </g>
        )
      })}

      {/* ── 第三道：细部（室内外高差 + 净高） ── */}
      <g>
        <line x1={f(dxFine)} y1={f(Y(PAR))} x2={f(dxFine)} y2={f(groundY)} stroke={MUTED} strokeWidth={W('anno')} />
        {[Y(PAR), groundY].map((y) => (
          <line key={`b${y}`} x1={f(dxFine - 4)} y1={f(y)} x2={f(dxFine + 4)} y2={f(y)} stroke={MUTED} strokeWidth={W('anno')} />
        ))}
        <text x={f(dxFine - 6)} y={f((Y(PAR) + groundY) / 2 + 3.5)} textAnchor="end" fontSize={fs * 0.7} fontFamily="ui-monospace, monospace" fill={MUTED}>
          {f(DROP)}
        </text>
      </g>
      <g>
        <line x1={f(dxFine)} y1={f(Y(PAR + FH - FIN - SLAB))} x2={f(dxFine)} y2={f(Y(PAR + FH))} stroke={MUTED} strokeWidth={W('anno')} />
        {[Y(PAR + FH - FIN - SLAB), Y(PAR + FH)].map((y) => (
          <line key={`c${y}`} x1={f(dxFine - 4)} y1={f(y)} x2={f(dxFine + 4)} y2={f(y)} stroke={MUTED} strokeWidth={W('anno')} />
        ))}
        <text x={f(dxFine - 6)} y={f((Y(PAR + FH - FIN - SLAB) + Y(PAR + FH)) / 2 + 3.5)} textAnchor="end" fontSize={fs * 0.7} fontFamily="ui-monospace, monospace" fill={MUTED}>
          {f(clear)}
        </text>
      </g>

      {/* ── 底部轴线 ── */}
      {Array.from({ length: Math.min(model.bays, 12) + 1 }, (_, i) => (
        <Axis
          key={`ax${i}`}
          x={f(X(i * model.bay))}
          yTop={f(baseY + 58)}
          yBottom={f(baseY + 108)}
          label={String(i + 1)}
          fs={fs}
          sw={sw}
        />
      ))}

      <DimLine x1={f(x0)} x2={f(xEnd)} y={f(baseY + 128)} label={`${f(L)} m`} fs={fs} sw={sw} />
      <ScaleBar x={x0} y={VB_H - 24} fs={fs} sw={sw} meters={5} pxPerMeter={s} />
      <Stamp
        x={SHEET_W - 182}
        y={VB_H - 168}
        sw={sw}
        lines={[
          'SECTION A—A',
          '1 : 100 · VERTICAL CUT',
          `SLAB ${(SLAB * 1000) | 0} · BEAM ${(BEAM * 1000) | 0} · WALL ${(WALL * 1000) | 0}`,
          hasStair ? `STAIR ${stair.risersPerFlight}R ×${stair.flights}` : 'STAIR: NOT MODELLED',
        ]}
      />
    </svg>
  )
}
