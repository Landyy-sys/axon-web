import React from 'react'
import {
  INK, MUTED, FAINT, ACCENT, SHEET, SHEET_W, LINE_W, safeDiv,
  f, Stamp, ScaleBar, DimLine, CutLine,
  PocheConcrete, PocheMasonry,
} from './shared.jsx'

/**
 * PLAN · 水平剖切平面图
 *
 * 制图红线（与剖面完全一致）：
 *   平面图只允许画「有视觉证据」或「人工给出真值」的东西 ——
 *   外墙、结构柱网、轴线、被观测立面上的洞口、剖切位置。
 *   房间划分 / 内门 / 家具 / 楼梯间在照片上完全不可见，
 *   只有用户在左侧人工声明后才建模；否则内部留白并在图纸上显式声明。
 *
 * 制图依据（GB/T 50001 · 50104）：
 *   · 剖切到的墙柱用 poché 填充并画 b 粗实线，未剖到的看线用 0.25b
 *   · 轴线用点划线 + 端部圆圈编号（纵轴数字 ① ② ③，横轴字母 A B C，跳过 I O Z）
 *   · 尺寸三道：最外总尺寸 / 中间轴线尺寸 / 最内细部尺寸
 *   · 剖切符号用粗短线 + 剖视方向箭头 + 端部大写字母，与 SECTION A—A 对应
 *   · 图名下方注比例，图面配指北针
 */
export default function PlanDrawing({ model }) {
  const P = model.plan
  const L = model.length
  const D = model.depth
  const T = P.wallT
  const sw = LINE_W.CUT // 剖切墙体 3.0（GB/T 50104），0.5b=1.5 恰为未剖切轮廓级
  const fs = 11
  const LW = { cut: 1.0, major: 0.5, seen: 0.25, anno: 0.25 }
  const W = (k) => sw * LW[k]

  const detail = !!model.detail
  const isPilotis = model.structure === 'pilotis'
  const hasStair = !!model.interior?.stair?.on && !!P.stairBox
  const hasPartitions = !!model.interior?.partitions?.on
  const unobserved = P.unobserved || []

  /* ── 画布与比例 ──
     左侧留出竖向轴号 + 竖向尺寸，上方留出横向轴号，下方留三道尺寸。 */
  const VB_H = 640
  /* v0.7.1 防白屏：分母带 +1 保护之外再走 safeDiv，异常尺寸退回兜底比例 */
  const s = Math.min(safeDiv(SHEET_W - 250, L + 1, 20), safeDiv(VB_H - 330, D + 1, 20))
  const x0 = 150
  const yTop = 158
  const X = (mx) => x0 + mx * s
  const Y = (my) => yTop + my * s
  const xEnd = X(L)
  const yEnd = Y(D)

  /* ── 尺寸链：总尺寸最外，轴线尺寸居中，细部最内 ── */
  const dimTotal = yEnd + 44
  const dimAxis = yEnd + 76
  const dimFine = yEnd + 108
  const vdimX = x0 - 62

  /* ── 南墙洞口（与立面 openings 共用同一份数据） ── */
  const wins = P.southOpenings.filter((o) => !o.door)
  const doorOp = P.southOpenings.find((o) => o.door)

  return (
    <svg viewBox={`0 0 ${SHEET_W} ${VB_H}`} className="block h-full w-full" role="img" aria-label="建筑平面图 PLAN">
      <defs>
        <PocheConcrete id="plan-conc" sw={sw} />
        <PocheMasonry id="plan-mason" sw={sw} />
      </defs>

      {/* ══ 图名 + 比例 + 未建模声明 ══ */}
      <g>
        <text x="8" y="22" fontSize="14" fontFamily="ui-monospace, monospace" letterSpacing="0.06em" fill={INK}>
          PLAN · {P.levelLabel}
        </text>
        <text x="8" y="37" fontSize={fs * 0.72} fontFamily="ui-monospace, monospace" fill={MUTED}>
          1 : 100 · 水平剖切（窗台以上）· 正投影
        </text>
        <text x="8" y="52" fontSize={fs * 0.68} fontFamily="ui-monospace, monospace" fill={FAINT}>
          {model.structureLabel} · 柱网 {model.grid} m · {model.fenestration === 'ribbon' ? '横向长窗' : model.fenestration === 'curtain' ? '通高幕墙' : '独立窗'}
          {isPilotis && ` · 底层架空 ${model.pilotiH} m`}
        </text>
        {model.omissions.length > 0 && (
          <>
            <text x="8" y="72" fontSize={fs * 0.68} fontFamily="ui-monospace, monospace" fill={ACCENT}>
              未建模（照片中不可见 · 无视觉证据）
            </text>
            <text x="8" y="86" fontSize={fs * 0.68} fontFamily="ui-monospace, monospace" fill={ACCENT}>
              {model.omissions.map((o) => o.label).join(' · ')}
            </text>
          </>
        )}
      </g>

      {/* ══ 指北针 ══ */}
      <g>
        <circle cx={SHEET_W - 46} cy="54" r="21" fill={SHEET} stroke={MUTED} strokeWidth={W('anno')} />
        <path
          d={`M ${SHEET_W - 46} ${f(54 - 15)} L ${SHEET_W - 39} ${f(54 + 11)} L ${SHEET_W - 46} ${f(54 + 6)} L ${SHEET_W - 53} ${f(54 + 11)} Z`}
          fill={INK}
        />
        <text
          x={SHEET_W - 46}
          y="34"
          textAnchor="middle"
          fontSize={fs * 0.8}
          fontFamily="ui-monospace, monospace"
          fill={INK}
        >
          N
        </text>
      </g>

      {/* ══ 轴线：横向（数字，在上）══ */}
      {P.axisX.map((a, i) => (
        <g key={`ax${i}`}>
          <line
            x1={f(X(a.x))}
            y1={f(yTop - 26)}
            x2={f(X(a.x))}
            y2={f(yEnd + 20)}
            stroke={FAINT}
            strokeWidth={W('anno') * 0.9}
            strokeDasharray={`${sw * 5} ${sw * 2} ${sw} ${sw * 2}`}
          />
          <circle cx={f(X(a.x))} cy={f(yTop - 40)} r={fs * 0.88} fill={SHEET} stroke={MUTED} strokeWidth={W('anno')} />
          <text
            x={f(X(a.x))}
            y={f(yTop - 40 + fs * 0.34)}
            textAnchor="middle"
            fontSize={fs * 0.78}
            fontFamily="ui-monospace, monospace"
            fill={MUTED}
          >
            {a.label}
          </text>
        </g>
      ))}

      {/* ══ 轴线：纵向（字母，在左）══ */}
      {P.axisY.map((a, i) => (
        <g key={`ay${i}`}>
          <line
            x1={f(x0 - 26)}
            y1={f(Y(a.y))}
            x2={f(xEnd + 20)}
            y2={f(Y(a.y))}
            stroke={FAINT}
            strokeWidth={W('anno') * 0.9}
            strokeDasharray={`${sw * 5} ${sw * 2} ${sw} ${sw * 2}`}
          />
          <circle cx={f(x0 - 40)} cy={f(Y(a.y))} r={fs * 0.88} fill={SHEET} stroke={MUTED} strokeWidth={W('anno')} />
          <text
            x={f(x0 - 40)}
            y={f(Y(a.y) + fs * 0.34)}
            textAnchor="middle"
            fontSize={fs * 0.78}
            fontFamily="ui-monospace, monospace"
            fill={MUTED}
          >
            {a.label}
          </text>
        </g>
      ))}

      {/* ══ 室内底 ══ */}
      <rect x={f(x0)} y={f(yTop)} width={f(L * s)} height={f(D * s)} fill={SHEET} />

      {/* ══ 外墙：双线 + poché（剖切到的实体）══
         用 evenodd 一次画出「外轮廓 − 内轮廓」的环，避免两条矩形叠出双线。 */}
      <path
        d={`M ${f(x0)} ${f(yTop)} H ${f(xEnd)} V ${f(yEnd)} H ${f(x0)} Z
            M ${f(X(T))} ${f(Y(T))} H ${f(X(L - T))} V ${f(Y(D - T))} H ${f(X(T))} Z`}
        fillRule="evenodd"
        fill={model.structure === 'bearing' ? 'url(#plan-mason)' : 'url(#plan-conc)'}
        stroke={INK}
        strokeWidth={W('cut')}
      />

      {/* ══ 结构柱：按柱网交点排布（与立面、剖面同一套 columns）══ */}
      {P.columns.map((c, i) => (
        <rect
          key={`pc${i}`}
          x={f(X(c.x) - (c.w * s) / 2)}
          y={f(Y(c.y) - (c.d * s) / 2)}
          width={f(c.w * s)}
          height={f(c.d * s)}
          fill="url(#plan-conc)"
          stroke={INK}
          strokeWidth={W('cut') * 0.8}
        />
      ))}

      {/* ══ 南墙洞口：窗 ══
         平面画法：洞口处墙不填 poché，画 4 条平行细线（窗框 + 玻璃）。 */}
      {wins.map((o, i) => {
        const a = X(o.x0)
        const b = X(o.x1)
        const yIn = Y(D - T)
        const yOut = Y(D)
        const n = o.kind === 'curtain' ? 2 : 4
        return (
          <g key={`pw${i}`}>
            <rect x={f(a)} y={f(yIn)} width={f(b - a)} height={f(yOut - yIn)} fill={SHEET} />
            {Array.from({ length: n }, (_, k) => {
              const y = yIn + ((yOut - yIn) * (k + 1)) / (n + 1)
              return (
                <line
                  key={k}
                  x1={f(a)}
                  y1={f(y)}
                  x2={f(b)}
                  y2={f(y)}
                  stroke={INK}
                  strokeWidth={W('major')}
                />
              )
            })}
            <line x1={f(a)} y1={f(yIn)} x2={f(a)} y2={f(yOut)} stroke={INK} strokeWidth={W('major')} />
            <line x1={f(b)} y1={f(yIn)} x2={f(b)} y2={f(yOut)} stroke={INK} strokeWidth={W('major')} />
            {i === 0 && detail && (
              <text
                x={f((a + b) / 2)}
                y={f(yOut + 16)}
                textAnchor="middle"
                fontSize={fs * 0.6}
                fontFamily="ui-monospace, monospace"
                fill={FAINT}
              >
                C1
              </text>
            )}
          </g>
        )
      })}

      {/* ══ 主入口：常规建筑画门 + 开启弧线 + 台阶 ══ */}
      {!isPilotis && P.entry.kind === 'door' && (
        <g>
          <rect
            x={f(X(P.entry.x - P.entry.w / 2))}
            y={f(Y(D - T))}
            width={f(P.entry.w * s)}
            height={f(T * s)}
            fill={SHEET}
          />
          {/* 门扇 + 90° 开启弧线（平面图标准表达） */}
          <line
            x1={f(X(P.entry.x - P.entry.w / 2))}
            y1={f(Y(D - T))}
            x2={f(X(P.entry.x - P.entry.w / 2))}
            y2={f(Y(D - T) - P.entry.w * s)}
            stroke={INK}
            strokeWidth={W('major')}
          />
          <path
            d={`M ${f(X(P.entry.x + P.entry.w / 2))} ${f(Y(D - T))}
                A ${f(P.entry.w * s)} ${f(P.entry.w * s)} 0 0 0
                ${f(X(P.entry.x - P.entry.w / 2))} ${f(Y(D - T) - P.entry.w * s)}`}
            fill="none"
            stroke={MUTED}
            strokeWidth={W('anno')}
          />
          {/* 室外台阶三级 */}
          {[1, 2, 3].map((k) => (
            <line
              key={k}
              x1={f(X(P.entry.x - P.entry.w / 2 - 0.15))}
              y1={f(Y(D) + k * 5)}
              x2={f(X(P.entry.x + P.entry.w / 2 + 0.15))}
              y2={f(Y(D) + k * 5)}
              stroke={INK}
              strokeWidth={W('major')}
            />
          ))}
          <text
            x={f(X(P.entry.x))}
            y={f(Y(D) + 26)}
            textAnchor="middle"
            fontSize={fs * 0.62}
            fontFamily="ui-monospace, monospace"
            fill={FAINT}
          >
            M1 · 主入口
          </text>
        </g>
      )}

      {/* ══ 通高幕墙没有独立门洞：明确标注入口未观测，不脑补 ══ */}
      {!isPilotis && P.entry.kind !== 'door' && (
        <text
          x={f(x0 + (L * s) / 2)}
          y={f(Y(D) + 18)}
          textAnchor="middle"
          fontSize={fs * 0.6}
          fontFamily="ui-monospace, monospace"
          fill={ACCENT}
        >
          入口位置未观测 · 通高幕墙无独立门洞
        </text>
      )}

      {/* ══ 架空层入口：坡道（萨伏伊的「建筑漫步」）══ */}
      {isPilotis && P.entry.kind === 'ramp' && (
        <g>
          <rect
            x={f(X(P.entry.x0))}
            y={f(Y(P.entry.y0))}
            width={f(X(P.entry.x1) - X(P.entry.x0))}
            height={f(Math.max(3, P.entry.w * s))}
            fill="none"
            stroke={INK}
            strokeWidth={W('major')}
          />
          {/* 坡道坡度线 */}
          <line
            x1={f(X(P.entry.x0))}
            y1={f(Y(P.entry.y0) + Math.max(3, P.entry.w * s) / 2)}
            x2={f(X(P.entry.x1))}
            y2={f(Y(P.entry.y0) + Math.max(3, P.entry.w * s) / 2)}
            stroke={ACCENT}
            strokeWidth={W('major')}
            strokeDasharray={`${sw * 3} ${sw * 2}`}
          />
          <text
            x={f(X(P.entry.x0))}
            y={f(Y(P.entry.y0) - 6)}
            fontSize={fs * 0.62}
            fontFamily="ui-monospace, monospace"
            fill={ACCENT}
          >
            坡道 · 建筑漫步
          </text>
        </g>
      )}

      {/* ══ 内隔墙与房间：仅在人工声明「内隔墙」后绘制 ══ */}
      {hasPartitions && P.rooms.map((r, i) => (
        <g key={`rm${i}`}>
          {r.door && (
            <>
              <rect
                x={f(X(r.door.x))}
                y={f(Y(r.y1))}
                width={f(r.door.w * s)}
                height={f(0.12 * s)}
                fill={SHEET}
              />
              <path
                d={`M ${f(X(r.door.x + r.door.w))} ${f(Y(r.y1))}
                    A ${f(r.door.w * s)} ${f(r.door.w * s)} 0 0 0
                    ${f(X(r.door.x))} ${f(Y(r.y1) - r.door.w * s)}`}
                fill="none"
                stroke={MUTED}
                strokeWidth={W('anno')}
              />
            </>
          )}
          <text
            x={f((X(r.x0) + X(r.x1)) / 2)}
            y={f((Y(r.y0) + Y(r.y1)) / 2)}
            textAnchor="middle"
            fontSize={fs * 0.72}
            fontFamily="ui-monospace, monospace"
            fill={MUTED}
          >
            {r.name}
          </text>
          <text
            x={f((X(r.x0) + X(r.x1)) / 2)}
            y={f((Y(r.y0) + Y(r.y1)) / 2 + 13)}
            textAnchor="middle"
            fontSize={fs * 0.58}
            fontFamily="ui-monospace, monospace"
            fill={FAINT}
          >
            {r.name === '走道' || r.name === '走廊' ? '' : `${((r.x1 - r.x0) * (r.y1 - r.y0)).toFixed(1)} m²`}
          </text>
        </g>
      ))}

      {/* ══ 楼梯间：仅在人工声明后绘制 ══ */}
      {hasStair && P.stairBox && (
        <g>
          <rect
            x={f(X(P.stairBox.x0))}
            y={f(Y(P.stairBox.y0))}
            width={f(P.stairBox.w * s)}
            height={f(P.stairBox.l * s)}
            fill="none"
            stroke={INK}
            strokeWidth={W('major')}
          />
          {/* 踏步线 */}
          {Array.from({ length: Math.min(18, P.stairBox.treads) }, (_, k) => {
            const y = Y(P.stairBox.y0) + (k + 1) * ((P.stairBox.l * s) / (P.stairBox.treads + 1))
            return (
              <line
                key={k}
                x1={f(X(P.stairBox.x0))}
                y1={f(y)}
                x2={f(X(P.stairBox.x0) + P.stairBox.w * s)}
                y2={f(y)}
                stroke={INK}
                strokeWidth={W('anno')}
              />
            )
          })}
          {/* 上下方向箭头 */}
          <line
            x1={f(X(P.stairBox.x0) + P.stairBox.w * s * 0.5)}
            y1={f(Y(P.stairBox.y0) + P.stairBox.l * s * 0.92)}
            x2={f(X(P.stairBox.x0) + P.stairBox.w * s * 0.5)}
            y2={f(Y(P.stairBox.y0) + P.stairBox.l * s * 0.1)}
            stroke={ACCENT}
            strokeWidth={W('major')}
          />
          <path
            d={`M ${f(X(P.stairBox.x0) + P.stairBox.w * s * 0.5)} ${f(Y(P.stairBox.y0) + P.stairBox.l * s * 0.08)}
                l -5 9 l 10 0 Z`}
            fill={ACCENT}
          />
          <text
            x={f(X(P.stairBox.x0))}
            y={f(Y(P.stairBox.y0) - 6)}
            fontSize={fs * 0.62}
            fontFamily="ui-monospace, monospace"
            fill={MUTED}
          >
            楼梯间 {P.stairBox.treads}R × {P.stairBox.flights}
          </text>
        </g>
      )}

      {/* ══ 内部无视觉证据：用橙色细线框出「未建模区」══ */}
      {!hasPartitions && (
        <g>
          <rect
            x={f(X(T) + 6)}
            y={f(Y(T) + 6)}
            width={f(Math.max(2, (L - 2 * T) * s - 12))}
            height={f(Math.max(2, (D - 2 * T) * s - 12))}
            fill="none"
            stroke={ACCENT}
            strokeWidth={W('anno')}
            strokeDasharray={`${sw * 4} ${sw * 3}`}
          />
          <text
            x={f(x0 + (L * s) / 2)}
            y={f(yTop + (D * s) / 2)}
            textAnchor="middle"
            fontSize={fs * 0.72}
            fontFamily="ui-monospace, monospace"
            fill={ACCENT}
          >
            室内无视觉证据 · 房间划分未建模
          </text>
          <text
            x={f(x0 + (L * s) / 2)}
            y={f(yTop + (D * s) / 2 + 15)}
            textAnchor="middle"
            fontSize={fs * 0.6}
            fontFamily="ui-monospace, monospace"
            fill={MUTED}
          >
            勾选左侧「内隔墙」后按类型划分房间（人工声明）
          </text>
        </g>
      )}

      {/* ══ 未观测立面：明确标注，不做推断 ══ */}
      <text
        x={f(x0 + (L * s) / 2)}
        y={f(yTop - 8)}
        textAnchor="middle"
        fontSize={fs * 0.62}
        fontFamily="ui-monospace, monospace"
        fill={ACCENT}
      >
        北立面 / 山墙无观测数据 · 洞口不做推断（{unobserved.join(' / ')}）
      </text>

      {/* ══ 剖切符号 A—A：对应 SECTION A—A ══ */}
      <CutLine
        x1={f(x0 - 96)}
        y1={f(Y(P.cutY))}
        x2={f(xEnd + 40)}
        y2={f(Y(P.cutY))}
        tag="A"
        fs={fs}
        sw={sw}
      />

      {/* ══ 尺寸链：总尺寸（最外）══ */}
      <DimLine x1={f(x0)} x2={f(xEnd)} y={f(dimTotal)} label={`${L.toFixed(2)} m`} fs={fs} sw={sw} />
      {/* ══ 轴线尺寸（中间）══ */}
      {Array.from({ length: P.axisX.length - 1 }, (_, i) => (
        <DimLine
          key={`da${i}`}
          x1={f(X(P.axisX[i].x))}
          x2={f(X(P.axisX[i + 1].x))}
          y={f(dimAxis)}
          label={`${(P.axisX[i + 1].x - P.axisX[i].x).toFixed(2)}`}
          fs={fs}
          sw={sw}
        />
      ))}
      {/* ══ 细部尺寸（最内）：洞口定位 ══ */}
      {wins.slice(0, 6).map((o, i) => (
        <DimLine
          key={`df${i}`}
          x1={f(X(o.x0))}
          x2={f(X(o.x1))}
          y={f(dimFine)}
          label={`${(o.x1 - o.x0).toFixed(2)}`}
          fs={fs}
          sw={sw}
        />
      ))}

      {/* ══ 竖向尺寸：总进深 ══ */}
      <g>
        <line x1={f(vdimX)} y1={f(yTop)} x2={f(vdimX)} y2={f(yEnd)} stroke={INK} strokeWidth={W('anno')} />
        {[yTop, yEnd].map((y, i) => (
          <line key={i} x1={f(vdimX - 6)} y1={f(y)} x2={f(vdimX + 6)} y2={f(y)} stroke={INK} strokeWidth={W('major')} />
        ))}
        <rect x={f(vdimX - 26)} y={f((yTop + yEnd) / 2 - 7)} width="52" height="14" fill={SHEET} />
        <text
          x={f(vdimX)}
          y={f((yTop + yEnd) / 2 + 4)}
          textAnchor="middle"
          fontSize={fs * 0.84}
          fontFamily="ui-monospace, monospace"
          fill={INK}
        >
          {D.toFixed(2)}
        </text>
      </g>

      {/* ══ 图例 ══ */}
      <g>
        <text x="8" y={VB_H - 96} fontSize={fs * 0.68} fontFamily="ui-monospace, monospace" fill={MUTED} letterSpacing="0.05em">
          图例
        </text>
        <rect x="8" y={VB_H - 88} width="26" height="12" fill="url(#plan-conc)" stroke={INK} strokeWidth={W('anno')} />
        <text x="40" y={VB_H - 79} fontSize={fs * 0.62} fontFamily="ui-monospace, monospace" fill={MUTED}>
          钢筋混凝土柱 / 墙（剖切到）
        </text>
        <line x1="8" y1={VB_H - 62} x2="34" y2={VB_H - 62} stroke={FAINT} strokeWidth={W('anno')} strokeDasharray={`${sw * 5} ${sw * 2} ${sw} ${sw * 2}`} />
        <text x="40" y={VB_H - 58} fontSize={fs * 0.62} fontFamily="ui-monospace, monospace" fill={MUTED}>
          轴线（点划线）
        </text>
        <line x1="8" y1={VB_H - 42} x2="34" y2={VB_H - 42} stroke={ACCENT} strokeWidth={W('major')} strokeDasharray={`${sw * 7} ${sw * 3}`} />
        <text x="40" y={VB_H - 38} fontSize={fs * 0.62} fontFamily="ui-monospace, monospace" fill={MUTED}>
          剖切位置线 A—A
        </text>
        <line x1="8" y1={VB_H - 22} x2="34" y2={VB_H - 22} stroke={ACCENT} strokeWidth={W('anno')} strokeDasharray={`${sw * 4} ${sw * 3}`} />
        <text x="40" y={VB_H - 18} fontSize={fs * 0.62} fontFamily="ui-monospace, monospace" fill={MUTED}>
          未建模区（无视觉证据）
        </text>
      </g>

      {/* ══ 图签 ══ */}
      <Stamp
        x={SHEET_W - 190}
        y={VB_H - 92}
        sw={sw * 0.7}
        lines={[
          `PLAN · ${P.levelLabel}`,
          `SCALE 1:100  SEED ${model.seed}`,
          `GRID ${model.grid} m  COLS ${P.columns.length}`,
          `CUT A—A @ y = ${P.cutY} m`,
          hasStair ? 'STAIR: 人工声明' : 'STAIR: NOT MODELLED',
          `REFINE ${model.refine ? `${model.refine.passes} 轮 · ${Math.round(model.refine.agreement * 100)}%` : 'single pass'}`,
        ]}
      />

      {/* 比例尺长度自适应：建筑小的时候 10 m 长 + 高倍率会把比例尺顶出图框，
          所以按可用宽度反算段数（10 → 5 → 2 → 1 m）。 */}
      <ScaleBar
        x={SHEET_W - 300}
        y={VB_H - 30}
        fs={fs}
        sw={sw}
        meters={Math.max(1, Math.min(10, Math.floor(292 / s)))}
        pxPerMeter={s}
      />
    </svg>
  )
}
