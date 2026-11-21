import React from 'react'
import {
  INK, MUTED, FAINT, ACCENT, SHEET, SHEET_W,
  f, Person, Stamp, ScaleBar, DimLine, LevelMark, GroundHatch, GlassHatch,
  WindowDetail, CutLine, RibbonWindow, Pilotis, RoofGarden, Ramp,
  PocheConcrete,
} from './shared.jsx'

/**
 * ORTHOGRAPHIC ELEVATION · 正交立面
 *
 * 依 GB/T 50001《房屋建筑制图统一标准》与 GB/T 50104《建筑制图标准》：
 *   · 正投影，与平面 / 剖面同比例
 *   · 线宽四级：1.4b 室外地坪线 / b 外轮廓 / 0.5b 门窗洞口·檐口·雨篷·台阶 / 0.25b 分格·雨水管·尺寸
 *   · 三道竖向尺寸：总高 → 层高 → 细部
 *   · 标高体系：±0.000 为首层完成面，室外地坪为负标高
 *   · 首尾轴线编号、外装修做法文字说明、详图索引、图名与比例
 */
export default function ElevationDrawing({ model, showOpenings = true, showLevels = true }) {
  const L = model.length
  const F = model.floors
  const FH = model.floorHeight
  /* 首层完成面（±0.000）：架空建筑被抬到 pilotiH，不再是 0.35 的勒脚 */
  const PAR = model.base ?? model.plinth
  const PARA = model.parapet ?? 0.6
  const isPilotis = model.structure === 'pilotis'
  /* 室外地坪相对 ±0.000：架空时下沉 pilotiH，常规时下沉室内外高差 */
  const DROP = isPilotis ? (model.pilotiH ?? 0) : (model.siteDrop ?? 0.45)
  const FINI = model.finishes || {}
  const isRibbon = model.fenestration === 'ribbon'
  const isCurtain = model.fenestration === 'curtain'

  const s = Math.min(460 / (L + 1.6), 320 / (F * FH + PARA + DROP + 0.5))
  const x0 = (SHEET_W - L * s) / 2
  /* ±0.000 首层完成面：固定高度，画布高度改由内容往下撑 */
  const baseY = 370

  const sw = 1.9 // b（基本线宽），四级线宽由此派生
  const fs = 11
  /* 线宽分级：b = sw */
  const LW = { ground: 1.4, outline: 1.0, major: 0.5, thin: 0.25 }
  const W = (k) => sw * LW[k]

  const X = (mx) => x0 + mx * s
  /* 传入 model 内部 z（首层地面 = PAR），换算成工程标高后投影 */
  const Y = (mz) => baseY - (mz - PAR) * s

  const ops = model.openings || []
  const stride = F > 8 ? 2 : 1
  const detail = !!model.detail && F <= 8
  const cutX = X(L * 0.58)
  const xEnd = x0 + L * s
  const groundY = Y(PAR - DROP)

  /* 门窗竖向尺寸：与剖面共用同一份 openings，保证视图一致 */
  const om = ops.find((o) => o.kind === 'window' || o.kind === 'curtain')
  const sillH = om ? Math.round((om.sill - PAR - om.fl * FH) * 100) / 100 : 0.9
  const winH = om ? Math.round((om.head - om.sill) * 100) / 100 : 1.5
  const doorOp = ops.find((o) => o.kind === 'door')

  const dxTotal = x0 - 152
  const dxFloor = x0 - 104
  const dxFine = x0 - 58
  /* 地坪线两端延伸，夹紧在图框内 */
  const gl = Math.max(2, x0 - 170)
  const gr = Math.min(SHEET_W - 2, xEnd + 170)

  /* 画布高度按内容定：架空建筑地坪低得多，写死 620 会把下方标注挤出画布 */
  const VB_H = Math.min(940, Math.round(groundY + 250))

  return (
    <svg viewBox={`0 0 ${SHEET_W} ${VB_H}`} className="block h-full w-full" role="img" aria-label="建筑正交立面图">
      <defs>
        <GroundHatch id="elv-g" sw={sw} />
        <GlassHatch id="elv-glass" sw={sw} />
        <PocheConcrete id="elv-conc" sw={sw} />
        <pattern id="elv-stone" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
          <line x1="0" y1="0" x2="0" y2="6" stroke={MUTED} strokeWidth="0.5" opacity="0.5" />
        </pattern>
      </defs>

      {/* 图名与比例 */}
      <g>
        <text x="8" y="22" fontSize="14" fontFamily="ui-monospace, monospace" letterSpacing="0.06em" fill={INK}>
          ①—{model.bays + 1} 立面
        </text>
        <text x="8" y="37" fontSize={fs * 0.72} fontFamily="ui-monospace, monospace" fill={MUTED}>
          SOUTH ELEVATION · 1 : 100 · ORTHOGRAPHIC
        </text>
        {/* 原型标注：让看图的人知道这套几何是按哪种真实体系画的 */}
        <text x="8" y="52" fontSize={fs * 0.68} fontFamily="ui-monospace, monospace" fill={FAINT}>
          {model.structureLabel || '框架填充'} · {model.fenestration === 'ribbon' ? '横向长窗' : model.fenestration === 'curtain' ? '通高幕墙' : '独立窗'} · {model.roofLabel || '平屋面'}
          {isPilotis && ` · 底层架空 ${model.pilotiH} m`}
          {model.grid && ` · 柱网 ${model.grid} m`}
        </text>
      </g>

      {/* ── 地坪土 + 室外地坪线（1.4b 特粗实线） ── */}
      <rect x={f(gl)} y={f(groundY)} width={f(gr - gl)} height={26} fill="url(#elv-g)" opacity="0.5" />
      <line x1={f(gl)} y1={f(groundY)} x2={f(gr)} y2={f(groundY)} stroke={INK} strokeWidth={W('ground')} />

      {/* ── 散水：0.25b 细实线，自勒脚外皮向外找坡 ── */}
      {[
        [x0, -1],
        [xEnd, 1],
      ].map(([px, dir], i) => (
        <g key={`ap${i}`}>
          <line
            x1={f(px + dir * 0.9 * s)}
            y1={f(groundY)}
            x2={f(px)}
            y2={f(groundY - 0.05 * s)}
            stroke={MUTED}
            strokeWidth={W('thin')}
          />
          <line
            x1={f(px + dir * 0.9 * s)}
            y1={f(groundY)}
            x2={f(px + dir * 0.9 * s)}
            y2={f(groundY + 5)}
            stroke={MUTED}
            strokeWidth={W('thin')}
          />
        </g>
      ))}

      {/* ── 主体墙面 + 女儿墙：b 粗实线外轮廓 ──
          架空建筑的墙面只到首层楼板底，底层透空由柱廊表达，
          不能把墙一路画到地坪（原引擎就是这么把架空层糊死的）。 */}
      <rect
        x={f(x0)}
        y={f(Y(PAR + F * FH + PARA))}
        width={f(L * s)}
        height={f((F * FH + PARA + (isPilotis ? model.slab : DROP)) * s)}
        fill={SHEET}
        stroke={INK}
        strokeWidth={W('outline')}
      />
      {/* 屋面：屋顶花园栏板 + 弧形挡风墙 / 平板出挑 / 常规女儿墙 */}
      <RoofGarden
        x0={f(x0)}
        xEnd={f(xEnd)}
        roofY={f(Y(PAR + F * FH))}
        parapet={PARA}
        s={s}
        sw={sw}
        fs={fs}
        kind={model.roof || 'parapet'}
      />
      {(model.roofFeatures || []).includes('curvedScreen') && (
        <text
          x={f(X(L * 0.5))}
          y={f(Y(PAR + F * FH + PARA) - PARA * s * 2.1 - 6)}
          textAnchor="middle"
          fontSize={fs * 0.62}
          fontFamily="ui-monospace, monospace"
          fill={FAINT}
        >
          弧形挡风墙 · 日光浴场
        </text>
      )}
      {/* 檐口线（屋面与女儿墙交接，0.5b 出挑） */}
      <line
        x1={f(x0 - 0.12 * s)}
        y1={f(Y(PAR + F * FH))}
        x2={f(xEnd + 0.12 * s)}
        y2={f(Y(PAR + F * FH))}
        stroke={INK}
        strokeWidth={W('major')}
      />

      {/* ══ 底层架空柱廊 pilotis（柯布五点之一）══
          柱自室外地坪直达首层楼板底，底层透空 —— 先画玻璃围合再压柱，
          因为萨伏伊 / 范斯沃斯的柱都在玻璃外侧。 */}
      {isPilotis && (
        <g>
          <rect
            x={f(x0)}
            y={f(Y(PAR - model.slab))}
            width={f(L * s)}
            height={f(Math.max(2, groundY - Y(PAR - model.slab)))}
            fill="url(#elv-glass)"
            stroke={INK}
            strokeWidth={W('major')}
          />
          <Pilotis
            xs={(model.columns || [0, L]).map((cx) => X(cx))}
            groundY={f(groundY)}
            topY={f(Y(PAR - model.slab))}
            s={s}
            sw={sw}
            colW={0.3}
            steel={model.type?.id === 'factory'}
            fillId="elv-conc"
          />
          {/* 架空层内的坡道起点（建筑漫步） */}
          {(model.roofFeatures || []).includes('ramp') && (
            <Ramp
              x0={f(X(L * 0.1))}
              y0={f(Y(PAR - model.slab) - 2)}
              x1={f(X(L * 0.42))}
              y1={f(groundY - 2)}
              w={7}
              sw={sw}
            />
          )}
          <text x={f(x0 + 5)} y={f(groundY - 6)} fontSize={fs * 0.62} fontFamily="ui-monospace, monospace" fill={FAINT}>
            架空层 {model.pilotiH} m · 柱网 {model.grid} m
          </text>
        </g>
      )}

      {/* ── 勒脚：石材饰面，0.5b 上口线 + 0.25b 分格（架空建筑无勒脚） ── */}
      {!isPilotis && (
        <>
          <rect
            x={f(x0)}
            y={f(Y(PAR + 0.45))}
        width={f(L * s)}
        height={f((0.45 + DROP) * s)}
        fill="url(#elv-stone)"
        stroke={INK}
        strokeWidth={W('major')}
      />
      {Array.from({ length: model.bays + 1 }, (_, i) => (
        <line
          key={`pl${i}`}
          x1={f(X(i * model.bay))}
          y1={f(Y(PAR + 0.45))}
          x2={f(X(i * model.bay))}
          y2={f(groundY)}
          stroke={MUTED}
          strokeWidth={W('thin')}
          opacity="0.7"
        />
      ))}
      <text x={f(x0 + 5)} y={f(groundY - 4)} fontSize={fs * 0.62} fontFamily="ui-monospace, monospace" fill={FAINT}>
          {FINI.base || '花岗岩勒脚'}
        </text>
        </>
      )}

      {/* ── 入口台阶 + 雨篷（0.5b 主要构配件；架空建筑靠坡道进入，无台阶） ── */}
      {doorOp && !isPilotis && (
        <g>
          {[0, 1, 2].map((k) => (
            <g key={`step${k}`}>
              <line
                x1={f(X(doorOp.x0 - 0.3) - k * 0.3 * s)}
                y1={f(groundY - ((k + 1) * DROP * s) / 3)}
                x2={f(X(doorOp.x1 + 0.3) + k * 0.3 * s)}
                y2={f(groundY - ((k + 1) * DROP * s) / 3)}
                stroke={INK}
                strokeWidth={W('major')}
              />
              <line
                x1={f(X(doorOp.x0 - 0.3) - k * 0.3 * s)}
                y1={f(groundY - (k * DROP * s) / 3)}
                x2={f(X(doorOp.x0 - 0.3) - k * 0.3 * s)}
                y2={f(groundY - ((k + 1) * DROP * s) / 3)}
                stroke={INK}
                strokeWidth={W('major')}
              />
              <line
                x1={f(X(doorOp.x1 + 0.3) + k * 0.3 * s)}
                y1={f(groundY - (k * DROP * s) / 3)}
                x2={f(X(doorOp.x1 + 0.3) + k * 0.3 * s)}
                y2={f(groundY - ((k + 1) * DROP * s) / 3)}
                stroke={INK}
                strokeWidth={W('major')}
              />
            </g>
          ))}
          {/* 雨篷 */}
          <rect
            x={f(X(doorOp.x0 - 0.9))}
            y={f(Y(doorOp.head + 0.15))}
            width={f((doorOp.x1 - doorOp.x0 + 1.8) * s)}
            height={f(0.15 * s)}
            fill={SHEET}
            stroke={INK}
            strokeWidth={W('major')}
          />
        </g>
      )}

      {/* ── 雨水管：0.25b 细实线 + 落水斗 ── */}
      {model.bays <= 10 &&
        Array.from({ length: model.bays - 1 }, (_, i) => {
          const px = X((i + 1) * model.bay)
          return (
            <g key={`rp${i}`}>
              <rect x={f(px - 0.09 * s)} y={f(Y(PAR + F * FH - 0.35))} width={f(0.18 * s)} height={f(0.35 * s)} fill="none" stroke={MUTED} strokeWidth={W('thin')} />
              <line x1={f(px)} y1={f(Y(PAR + F * FH - 0.35))} x2={f(px)} y2={f(groundY - 6)} stroke={MUTED} strokeWidth={W('thin')} />
            </g>
          )
        })}

      {/* ── 结构楼层线：0.5b 中实线（楼板边梁在外立面的投影） ── */}
      {showLevels &&
        model.levels.slice(1).map((z, i) => (
          <line key={`lv${i}`} x1={f(x0)} y1={f(Y(z))} x2={f(xEnd)} y2={f(Y(z))} stroke={INK} strokeWidth={W('major')} />
        ))}

      {/* ── 幕墙横向分格：0.25b 细实线，纯装饰，不得判为楼层 ── */}
      {(model.mullions || []).map((z, i) => (
        <line key={`mu${i}`} x1={f(X(0.05))} y1={f(Y(z))} x2={f(X(L - 0.05))} y2={f(Y(z))} stroke={FAINT} strokeWidth={W('thin')} />
      ))}

      {/* ── 门窗：洞口 0.5b，框料 / 分格 / 开启扇 0.25b ── */}
      {showOpenings &&
        ops.map((o, i) => {
          if (o.kind === 'solid') return null
          const isDoor = o.kind === 'door'
          /* 横向长窗 / 通高幕墙：贯通整条立面，竖向分格按柱位，不切断洞口 */
          const isRibbonOp = o.kind === 'ribbon' || o.kind === 'curtain'
          const divisions = (model.columns || [])
            .filter((cx) => cx > o.x0 + 0.25 && cx < o.x1 - 0.25)
            .map((cx) => X(cx))
          return (
            <g key={`op${i}`}>
              {isRibbonOp ? (
                <RibbonWindow
                  x0={f(X(o.x0))}
                  x1={f(X(o.x1))}
                  yTop={f(Y(o.head))}
                  yBot={f(Y(o.sill))}
                  glassId="elv-glass"
                  sw={sw}
                  detail={detail}
                  divisions={divisions}
                />
              ) : isDoor ? (
                <rect
                  x={f(X(o.x0))}
                  y={f(Y(o.head))}
                  width={f((o.x1 - o.x0) * s)}
                  height={f((o.head - o.sill) * s)}
                  fill={SHEET}
                  stroke={INK}
                  strokeWidth={W('major')}
                />
              ) : (
                <WindowDetail
                  x0={f(X(o.x0))}
                  x1={f(X(o.x1))}
                  yTop={f(Y(o.head))}
                  yBot={f(Y(o.sill))}
                  glassId="elv-glass"
                  fs={fs}
                  sw={sw}
                  detail={detail}
                  curtain={o.kind === 'curtain'}
                />
              )}
              {/* 窗台板 / 门中线（长窗的窗台板已在组件内画，避免重复加粗） */}
              {!isRibbonOp && (
                <line
                  x1={f(X(o.x0)) - 3}
                  y1={f(Y(o.sill))}
                  x2={f(X(o.x1)) + 3}
                  y2={f(Y(o.sill))}
                  stroke={INK}
                  strokeWidth={W('major')}
                />
              )}
              {isDoor && (
                <line
                  x1={f(X((o.x0 + o.x1) / 2))}
                  y1={f(Y(o.head))}
                  x2={f(X((o.x0 + o.x1) / 2))}
                  y2={f(Y(o.sill))}
                  stroke={MUTED}
                  strokeWidth={W('thin')}
                />
              )}
              {!isDoor && F <= 8 && (
                <text
                  x={f(X((o.x0 + o.x1) / 2))}
                  y={f(Y(o.head)) - 4}
                  textAnchor="middle"
                  fontSize={fs * 0.6}
                  fontFamily="ui-monospace, monospace"
                  fill={FAINT}
                >
                  C{o.bay + 1}
                </text>
              )}
              {isDoor && (
                <text
                  x={f(X((o.x0 + o.x1) / 2))}
                  y={f(Y(o.head)) - 4}
                  textAnchor="middle"
                  fontSize={fs * 0.6}
                  fontFamily="ui-monospace, monospace"
                  fill={FAINT}
                >
                  M1
                </text>
              )}
            </g>
          )
        })}

      {/* ── 多轮反馈：外挑阳台（挑板 0.5b + 栏杆 0.25b，挑出 1.4 m）──
          立面为正投影，挑板深度不可见，按制图惯例画挑板边线（双线）+ 栏杆竖条 + 编号 Bn。 */}
      {(model.feedback?.balconies || []).map((fl, i) => {
        if (fl < 0 || fl >= F) return null
        const z = PAR + (fl + 1) * FH // 挑板面 = 上一层层高
        const bw = Math.min(3.2, L * 0.32)
        const bx0 = X(L / 2 - bw / 2)
        const bx1 = X(L / 2 + bw / 2)
        const slabT = 0.16
        const ry = Y(z + 1.1)
        const sy = Y(z)
        const nBars = 9
        return (
          <g key={`blc${i}`}>
            {/* 栏杆竖条 */}
            {Array.from({ length: nBars }, (_, k) => {
              const bx = bx0 + ((bx1 - bx0) * (k + 1)) / (nBars + 1)
              return <line key={k} x1={f(bx)} y1={f(ry)} x2={f(bx)} y2={f(sy)} stroke={INK} strokeWidth={W('thin')} />
            })}
            {/* 栏杆扶手 + 挑板边线（双线表板厚） */}
            <line x1={f(bx0)} y1={f(ry)} x2={f(bx1)} y2={f(ry)} stroke={INK} strokeWidth={W('major')} />
            <line x1={f(bx0)} y1={f(sy)} x2={f(bx1)} y2={f(sy)} stroke={INK} strokeWidth={W('major')} />
            <line x1={f(bx0)} y1={f(sy + slabT * s)} x2={f(bx1)} y2={f(sy + slabT * s)} stroke={INK} strokeWidth={W('thin')} />
            <text
              x={f((bx0 + bx1) / 2)}
              y={f(ry) - 5}
              textAnchor="middle"
              fontSize={fs * 0.6}
              fontFamily="ui-monospace, monospace"
              fill={ACCENT}
            >
              B{i + 1}（用户要求增设）
            </text>
          </g>
        )
      })}

      {/* ── 柱在玻璃外侧（范斯沃斯：H 型钢柱立在幕墙之外，不被玻璃打断）── */}
      {model.columnsOutside && (
        <Pilotis
          xs={(model.columns || [0, L]).map((cx) => X(cx))}
          groundY={f(groundY)}
          topY={f(Y(PAR + F * FH))}
          s={s}
          sw={sw}
          colW={0.22}
          steel
          fillId="none"
        />
      )}

      {/* ── 剖切位置线 A—A（对应 SECTION A—A） ── */}
      <CutLine x1={f(cutX)} y1={f(Y(PAR + F * FH + PARA) - 26)} x2={f(cutX)} y2={f(groundY + 20)} tag="A" fs={fs} sw={sw} />

      {/* ── 详图索引：窗台节点 ① / 檐口节点 ② ── */}
      {[
        { x: X(L * 0.16), y: Y(PAR + (F > 1 ? FH : 0) + 0.45), n: '1' },
        { x: X(L * 0.84), y: Y(PAR + F * FH - 0.2), n: '2' },
      ].map((d, i) => (
        <g key={`dt${i}`}>
          <line x1={f(d.x)} y1={f(d.y)} x2={f(d.x + 26)} y2={f(d.y - 22)} stroke={MUTED} strokeWidth={W('thin')} />
          <circle cx={f(d.x + 32)} cy={f(d.y - 26)} r={9} fill={SHEET} stroke={INK} strokeWidth={W('thin')} />
          <line x1={f(d.x + 23)} y1={f(d.y - 26)} x2={f(d.x + 41)} y2={f(d.y - 26)} stroke={INK} strokeWidth={W('thin')} />
          <text x={f(d.x + 32)} y={f(d.y - 28.5)} textAnchor="middle" fontSize={fs * 0.6} fontFamily="ui-monospace, monospace" fill={INK}>
            {d.n}
          </text>
          <text x={f(d.x + 32)} y={f(d.y - 20.5)} textAnchor="middle" fontSize={fs * 0.55} fontFamily="ui-monospace, monospace" fill={MUTED}>
            A03
          </text>
        </g>
      ))}

      {/* 人形比例尺 */}
      <Person x={f(X(L * 0.94))} groundY={f(groundY)} h={1.75 * s} opacity={0.85} />

      {/* ── 右侧标高体系 ── */}
      {Array.from({ length: F + 1 }, (_, i) => {
        if (i % stride !== 0 && i !== F) return null
        const z = i * FH
        return (
          <LevelMark
            key={`lm${i}`}
            x={f(xEnd + 10)}
            y={f(Y(PAR + z))}
            text={i === 0 ? '±0.000' : `+${z.toFixed(3)}`}
            fs={fs}
            sw={sw}
            side="right"
            strong={i === 0}
          />
        )
      })}
      <LevelMark x={f(xEnd + 10)} y={f(Y(PAR + F * FH + PARA))} text={`+${(F * FH + PARA).toFixed(3)}`} fs={fs} sw={sw} side="right" />
      <LevelMark x={f(xEnd + 10)} y={f(groundY)} text={`-${DROP.toFixed(3)}`} fs={fs} sw={sw} side="right" />
      <line x1={f(xEnd + 10)} y1={f(Y(PAR))} x2={f(xEnd + 10)} y2={f(Y(PAR + F * FH + PARA))} stroke={MUTED} strokeWidth={W('thin')} />

      {/* ── 竖向三道尺寸 ── */}
      {/* 第一道：总高（室外地坪 → 女儿墙顶） */}
      <g>
        {[groundY, Y(PAR + F * FH + PARA)].map((y, i) => (
          <line key={`t${i}`} x1={f(x0 - 14)} y1={f(y)} x2={f(dxTotal - 6)} y2={f(y)} stroke={MUTED} strokeWidth={W('thin')} />
        ))}
        <line x1={f(dxTotal)} y1={f(groundY)} x2={f(dxTotal)} y2={f(Y(PAR + F * FH + PARA))} stroke={INK} strokeWidth={W('major')} />
        {[groundY, Y(PAR + F * FH + PARA)].map((y, i) => (
          <line key={`ta${i}`} x1={f(dxTotal - 5)} y1={f(y)} x2={f(dxTotal + 5)} y2={f(y)} stroke={INK} strokeWidth={W('major')} />
        ))}
        <rect x={f(dxTotal - 34)} y={f((groundY + Y(PAR + F * FH + PARA)) / 2 - 7)} width={68} height={14} fill={SHEET} />
        <text
          x={f(dxTotal)}
          y={f((groundY + Y(PAR + F * FH + PARA)) / 2 + 4)}
          textAnchor="middle"
          fontSize={fs * 0.8}
          fontFamily="ui-monospace, monospace"
          fill={INK}
        >
          {f(F * FH + PARA + DROP)}
        </text>
      </g>
      {/* 第二道：层高 */}
      {Array.from({ length: F }, (_, i) => {
        if (i % stride !== 0) return null
        const yTop = Y(PAR + (i + 1) * FH)
        const yBot = Y(PAR + i * FH)
        return (
          <g key={`dm${i}`}>
            <line x1={f(x0 - 14)} y1={f(yTop)} x2={f(dxFloor - 6)} y2={f(yTop)} stroke={MUTED} strokeWidth={W('thin')} />
            <line x1={f(x0 - 14)} y1={f(yBot)} x2={f(dxFloor - 6)} y2={f(yBot)} stroke={MUTED} strokeWidth={W('thin')} />
            <line x1={f(dxFloor)} y1={f(yTop)} x2={f(dxFloor)} y2={f(yBot)} stroke={INK} strokeWidth={W('major')} />
            {[yTop, yBot].map((y, k) => (
              <line key={k} x1={f(dxFloor - 5)} y1={f(y)} x2={f(dxFloor + 5)} y2={f(y)} stroke={INK} strokeWidth={W('major')} />
            ))}
            <rect x={f(dxFloor - 26)} y={f((yTop + yBot) / 2 - 7)} width={52} height={14} fill={SHEET} />
            <text x={f(dxFloor)} y={f((yTop + yBot) / 2 + 4)} textAnchor="middle" fontSize={fs * 0.8} fontFamily="ui-monospace, monospace" fill={INK}>
              {f(FH)}
            </text>
          </g>
        )
      })}
      {/* 第三道：细部（室内外高差 · 窗台高 · 窗高） */}
      <g>
        <line x1={f(dxFine)} y1={f(Y(PAR))} x2={f(dxFine)} y2={f(groundY)} stroke={MUTED} strokeWidth={W('thin')} />
        {[Y(PAR), groundY].map((y, i) => (
          <line key={`f${i}`} x1={f(dxFine - 4)} y1={f(y)} x2={f(dxFine + 4)} y2={f(y)} stroke={MUTED} strokeWidth={W('thin')} />
        ))}
        <text x={f(dxFine - 6)} y={f((Y(PAR) + groundY) / 2 + 3.5)} textAnchor="end" fontSize={fs * 0.7} fontFamily="ui-monospace, monospace" fill={MUTED}>
          {f(DROP)}
        </text>
      </g>
      <g>
        <line x1={f(dxFine)} y1={f(Y(PAR + sillH))} x2={f(dxFine)} y2={f(Y(PAR + sillH + winH))} stroke={MUTED} strokeWidth={W('thin')} />
        {[Y(PAR + sillH), Y(PAR + sillH + winH)].map((y, i) => (
          <line key={`g${i}`} x1={f(dxFine - 4)} y1={f(y)} x2={f(dxFine + 4)} y2={f(y)} stroke={MUTED} strokeWidth={W('thin')} />
        ))}
        <text
          x={f(dxFine - 6)}
          y={f((Y(PAR + sillH) + Y(PAR + sillH + winH)) / 2 + 3.5)}
          textAnchor="end"
          fontSize={fs * 0.7}
          fontFamily="ui-monospace, monospace"
          fill={MUTED}
        >
          {f(winH)}
        </text>
      </g>

      {/* ── 底部轴线：首尾编号 + 中间点划线 ── */}
      {Array.from({ length: model.bays + 1 }, (_, i) => {
        const ax = X(i * model.bay)
        const isEnd = i === 0 || i === model.bays
        return (
          <g key={`ax${i}`}>
            <line
              x1={f(ax)}
              y1={f(groundY + 30)}
              x2={f(ax)}
              y2={f(groundY + 100)}
              stroke={FAINT}
              strokeWidth={W('thin')}
              strokeDasharray={`${sw * 5} ${sw * 2} ${sw} ${sw * 2}`}
            />
            {isEnd && (
              <>
                <circle cx={f(ax)} cy={f(groundY + 88)} r={fs * 0.88} fill={SHEET} stroke={INK} strokeWidth={W('thin')} />
                <text
                  x={f(ax)}
                  y={f(groundY + 91.4)}
                  textAnchor="middle"
                  fontSize={fs * 0.74}
                  fontFamily="ui-monospace, monospace"
                  fill={INK}
                >
                  {i + 1}
                </text>
              </>
            )}
          </g>
        )
      })}

      {/* ── 底部尺寸链：开间 + 总宽 ── */}
      {model.bays <= 8 && (
        <g opacity="0.85">
          {Array.from({ length: model.bays }, (_, i) => (
            <DimLine
              key={i}
              x1={f(X(i * model.bay))}
              x2={f(X((i + 1) * model.bay))}
              y={f(groundY + 120)}
              label={`${f(model.bay)}`}
              fs={fs * 0.9}
              sw={sw * 0.8}
            />
          ))}
        </g>
      )}
      <DimLine x1={f(x0)} x2={f(xEnd)} y={f(groundY + 148)} label={`${f(L)} m`} fs={fs} sw={sw} />

      {/* ── 外装修做法文字说明（规范强制项） ── */}
      <text x="8" y={f(groundY + 172)} fontSize={fs * 0.74} fontFamily="ui-monospace, monospace" fill={MUTED}>
        外墙装修：{FINI.wall || '—'} · {FINI.base || '—'} · {FINI.frame || '—'}
      </text>

      {/* ── 线宽分级图例 ── */}
      <g transform={`translate(8, ${f(groundY + 190)})`} fontFamily="ui-monospace, monospace" fontSize={fs * 0.66} fill={MUTED}>
        {[
          ['1.4b', '室外地坪线', W('ground'), ''],
          ['b', '建筑外轮廓', W('outline'), ''],
          ['0.5b', '门窗洞口 · 檐口 · 雨篷 · 台阶', W('major'), ''],
          ['0.25b', '墙面分格 · 雨水管 · 尺寸', W('thin'), ''],
        ].map(([w, label, width], i) => (
          <g key={i} transform={`translate(${i * 208}, 0)`}>
            <line x1="0" y1="-3" x2="26" y2="-3" stroke={INK} strokeWidth={width} />
            <text x="33" y="0">{`${w} ${label}`}</text>
          </g>
        ))}
      </g>

      <ScaleBar x={x0} y={f(groundY + 214)} fs={fs} sw={sw} meters={5} pxPerMeter={s} />
      <Stamp
        x={SHEET_W - 182}
        y={VB_H - 168}
        sw={sw}
        lines={[
          `①—${model.bays + 1} 立面`,
          'SOUTH ELEVATION · 1 : 100',
          `H ${(F * FH + PARA).toFixed(3)} m · ${F}F × ${FH} m`,
          `BAYS ${model.bays} × ${model.bay} m`,
        ]}
      />
    </svg>
  )
}
