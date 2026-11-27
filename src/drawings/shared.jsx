import React from 'react'

export const INK = '#1c1b19'
export const MUTED = '#8a8781'
export const FAINT = '#cfccc5'
export const ACCENT = '#9a3412'
export const SHEET = '#fdfcfa'

export const SHEET_W = 840

/* GB/T 50104 线宽分级与比例计算：纯 JS 模块（Node 测试可导入），此处转发 */
export { LINE_W, hatchW } from './lineweight.js'
export { SCALE_SERIES, pickScale } from './sheetmeta.js'

export const f = (n) => Number(n).toFixed(1)
export const pts = (arr) => arr.map(([x, y]) => `${f(x)},${f(y)}`).join(' ')

/* 人形比例尺 */
export function Person({ x, groundY, h, fill = INK, opacity = 1 }) {
  const headR = h * 0.082
  const headCy = groundY - h + headR
  const shoulder = headCy + headR * 2.1
  const hip = groundY - h * 0.44
  const w = h * 0.15
  return (
    <g fill={fill} opacity={opacity}>
      <circle cx={x} cy={headCy} r={headR} />
      <path
        d={`M ${x - w * 0.62} ${shoulder} L ${x + w * 0.62} ${shoulder}
            L ${x + w * 0.42} ${hip} L ${x + w * 0.30} ${groundY}
            L ${x + w * 0.06} ${groundY} L ${x} ${hip}
            L ${x - w * 0.06} ${groundY} L ${x - w * 0.30} ${groundY}
            L ${x - w * 0.42} ${hip} Z`}
      />
    </g>
  )
}

/* 图签 */
export function Stamp({ x, y, lines, sw }) {
  return (
    <g>
      <line x1={x} y1={y} x2={x + 168} y2={y} stroke={FAINT} strokeWidth={sw} />
      {lines.map((t, i) => (
        <text
          key={i}
          x={x}
          y={y + 14 + i * 12.5}
          fontSize={9}
          fill={i === 0 ? INK : MUTED}
          fontFamily="ui-monospace, monospace"
          letterSpacing="0.04em"
        >
          {t}
        </text>
      ))}
    </g>
  )
}

export function GroundHatch({ id, sw }) {
  return (
    <pattern id={id} width="9" height="9" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
      <line x1="0" y1="0" x2="0" y2="9" stroke={MUTED} strokeWidth={hatchW(sw * 0.7)} opacity="0.5" />
    </pattern>
  )
}

export function InferredHatch({ id, sw }) {
  return (
    <pattern id={id} width="8" height="8" patternTransform="rotate(-45)" patternUnits="userSpaceOnUse">
      <line x1="0" y1="0" x2="0" y2="8" stroke={ACCENT} strokeWidth={hatchW(sw * 0.9)} opacity="0.5" />
    </pattern>
  )
}

export function GlassHatch({ id, sw }) {
  return (
    <pattern id={id} width="7" height="7" patternUnits="userSpaceOnUse">
      <line x1="0" y1="7" x2="7" y2="0" stroke={MUTED} strokeWidth={hatchW(sw * 0.5)} opacity="0.35" />
    </pattern>
  )
}

/* 比例尺 */
export function ScaleBar({ x, y, fs, sw, meters, pxPerMeter }) {
  const seg = pxPerMeter / 2
  return (
    <g>
      {Array.from({ length: meters * 2 }, (_, i) => (
        <rect
          key={i}
          x={x + i * seg}
          y={y}
          width={seg}
          height={fs * 0.4}
          fill={i % 2 === 0 ? INK : SHEET}
          stroke={INK}
          strokeWidth={sw * 0.5}
        />
      ))}
      {[0, meters].map((m, i) => (
        <text
          key={i}
          x={x + m * pxPerMeter}
          y={y - fs * 0.42}
          textAnchor={i === 0 ? 'start' : 'end'}
          fontSize={fs * 0.78}
          fontFamily="ui-monospace, monospace"
          fill={MUTED}
        >
          {i === 0 ? '0' : `${m} m`}
        </text>
      ))}
    </g>
  )
}

/* 水平尺寸链：尺寸线与尺寸界线统一 0.5（LINE_W.DIM，GB/T 50104 细线级） */
export function DimLine({ x1, x2, y, label, fs, sw }) {
  /* 调用方常传入已 toFixed 的字符串，必须先转数值再取中点 */
  const mid = (Number(x1) + Number(x2)) / 2
  const w = Math.max(52, String(label).length * 6.6 + 12)
  return (
    <g>
      <line x1={x1} y1={y} x2={x2} y2={y} stroke={INK} strokeWidth={LINE_W.DIM} />
      {[x1, x2].map((x, i) => (
        <line key={i} x1={x} y1={y - 6} x2={x} y2={y + 6} stroke={INK} strokeWidth={LINE_W.DIM} />
      ))}
      <rect x={mid - w / 2} y={y - 7} width={w} height={14} fill={SHEET} />
      <text
        x={mid}
        y={y + 4}
        textAnchor="middle"
        fontSize={fs * 0.84}
        fontFamily="ui-monospace, monospace"
        fill={INK}
      >
        {label}
      </text>
    </g>
  )
}

/* ══ 材料 poché 填充（剖面用） ══
   按制图惯例：混凝土=斜线+点，砌体=水平平行线，保温=交叉网，
   土壤=45°粗斜线，金属=密斜线。 */
export function PocheConcrete({ id, sw }) {
  return (
    <pattern id={id} width="10" height="10" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
      <line x1="0" y1="0" x2="0" y2="10" stroke={INK} strokeWidth={hatchW(sw * 0.55)} opacity="0.75" />
      <circle cx="5" cy="5" r={sw * 0.5} fill={INK} opacity="0.5" />
    </pattern>
  )
}

export function PocheMasonry({ id, sw }) {
  return (
    <pattern id={id} width="8" height="8" patternUnits="userSpaceOnUse">
      <line x1="0" y1="2" x2="8" y2="2" stroke={INK} strokeWidth={hatchW(sw * 0.5)} opacity="0.7" />
      <line x1="4" y1="2" x2="4" y2="8" stroke={INK} strokeWidth={hatchW(sw * 0.4)} opacity="0.45" />
    </pattern>
  )
}

export function PocheInsulation({ id, sw }) {
  return (
    <pattern id={id} width="7" height="7" patternUnits="userSpaceOnUse">
      <path d="M0 0 L7 7 M7 0 L0 7" stroke={MUTED} strokeWidth={hatchW(sw * 0.45)} opacity="0.6" />
    </pattern>
  )
}

export function PocheEarth({ id, sw }) {
  return (
    <pattern id={id} width="11" height="11" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
      <line x1="0" y1="0" x2="0" y2="11" stroke={MUTED} strokeWidth={hatchW(sw * 0.8)} opacity="0.55" />
    </pattern>
  )
}

export function PocheSteel({ id, sw }) {
  return (
    <pattern id={id} width="5" height="5" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
      <line x1="0" y1="0" x2="0" y2="5" stroke={INK} strokeWidth={hatchW(sw * 0.6)} opacity="0.8" />
    </pattern>
  )
}

/* ══ 剖切位置线 A—A ══
   粗短线 + 箭头指向剖视方向 + 端部大写字母 */
/* ══ 横向长窗 ribbon window ══
   柯布「新建筑五点」之四：长窗贯通整条立面、转过转角，
   竖向分格只是框料，绝不能把连续洞口切断成一颗颗独立窗。
   线宽：洞口与窗台板 0.5b，框料与竖向分格 0.25b。 */
export function RibbonWindow({ x0, x1, yTop, yBot, glassId, sw, divisions = [], detail = true }) {
  /* 调用方普遍传 toFixed 后的字符串，必须先转数值，否则加减会变成拼接 */
  const X0 = Number(x0)
  const X1 = Number(x1)
  const YT = Number(yTop)
  const YB = Number(yBot)
  const w = X1 - X0
  const h = YB - YT
  const MAJOR = sw * 0.5
  const THIN = sw * 0.25
  const bar = Math.min(2.6, Math.max(1, h * 0.075))
  return (
    <g>
      <rect x={f(X0)} y={f(YT)} width={f(w)} height={f(h)} fill={glassId ? `url(#${glassId})` : 'none'} stroke={INK} strokeWidth={MAJOR} />
      {/* 上下框料：0.25b，体现框料厚度 —— 长窗的「厚」就在这两道线上 */}
      <rect x={f(X0)} y={f(YT)} width={f(w)} height={f(bar)} fill="none" stroke={INK} strokeWidth={THIN} />
      <rect x={f(X0)} y={f(YB - bar)} width={f(w)} height={f(bar)} fill="none" stroke={INK} strokeWidth={THIN} />
      {/* 竖向分格：按柱位排布，细线，不打断洞口 */}
      {divisions.map((dx, i) => (
        <line key={i} x1={f(dx)} y1={f(YT)} x2={f(dx)} y2={f(YB)} stroke={INK} strokeWidth={THIN} />
      ))}
      {/* 窗台板通长出挑 0.5b */}
      <line x1={f(X0 - 3)} y1={f(YB)} x2={f(X1 + 3)} y2={f(YB)} stroke={INK} strokeWidth={MAJOR} />
      {detail && h > 1.15 && (
        <>
          {/* 开启扇：虚线扇框，只占一跨，其余为固定扇 */}
          <rect
            x={f(X0 + w * 0.02)}
            y={f(YT + bar)}
            width={f(w * 0.1)}
            height={f(h - bar * 2)}
            fill="none"
            stroke={MUTED}
            strokeWidth={THIN}
            strokeDasharray={`${sw * 2.4} ${sw * 1.6}`}
          />
        </>
      )}
    </g>
  )
}

/* ══ 底层架空柱廊 pilotis ══
   柯布五点之一。柱自室外地坪直达首层楼板底，底层透空。
   steel=true 时画密斯式外露钢柱（柱腹板线 + 柱在玻璃外侧）。 */
export function Pilotis({ xs, groundY, topY, s, sw, colW = 0.3, steel = false, fillId = 'none' }) {
  const w = Math.max(2.5, colW * s)
  const GY = Number(groundY)
  const TY = Number(topY)
  return (
    <g>
      {xs.map((cx0, i) => {
        const cx = Number(cx0)
        return (
          <g key={i}>
            <rect
              x={f(cx - w / 2)}
              y={f(TY)}
              width={f(w)}
              height={f(Math.max(1, GY - TY))}
              fill={fillId === 'none' ? SHEET : `url(#${fillId})`}
              stroke={INK}
              strokeWidth={steel ? sw * 0.5 : sw * 0.7}
            />
            {steel && (
              <>
                <line x1={f(cx)} y1={f(TY)} x2={f(cx)} y2={f(GY)} stroke={MUTED} strokeWidth={sw * 0.25} />
                <line x1={f(cx - w * 0.28)} y1={f(TY)} x2={f(cx - w * 0.28)} y2={f(GY)} stroke={MUTED} strokeWidth={sw * 0.25} />
              </>
            )}
          </g>
        )
      })}
    </g>
  )
}

/* ══ 屋顶花园 ══
   柯布五点之二：平屋面做花园，栏板兼挡风，弧形墙围合日光浴场。
   kind='flatSlab' 时不画栏板，改为屋面板出挑（密斯）。 */
export function RoofGarden({ x0, xEnd, roofY, parapet, s, sw, fs, kind = 'roofGarden', fillId = 'none' }) {
  const W = (k) => sw * { outline: 1.0, major: 0.5, thin: 0.25 }[k]
  const FILL = fillId === 'none' ? SHEET : `url(#${fillId})`
  const X0 = Number(x0)
  const XE = Number(xEnd)
  const RY = Number(roofY)
  const SPAN = XE - X0
  /* flatSlab 本无栏板；但用户在参数面板勾选「包含女儿墙」并给定高度后
     （v0.5 独立参数），平板屋面同样要画出女儿墙 —— 高度 > 0 即服从用户 */
  if (kind === 'flatSlab' && !(parapet > 0)) {
    /* 平板屋面：无栏板，板向外出挑 */
    return (
      <g>
        <rect x={f(X0 - 0.45 * s)} y={f(RY - 0.22 * s)} width={f(SPAN + 0.9 * s)} height={f(0.22 * s)} fill={FILL} stroke={INK} strokeWidth={W('outline')} />
      </g>
    )
  }
  if (!(parapet > 0)) {
    /* 无女儿墙（用户取消勾选）：只画屋面完成线，不画栏板与压顶 */
    return (
      <g>
        <line x1={f(X0 + 8)} y1={f(RY - 2)} x2={f(XE - 8)} y2={f(RY - 2)} stroke={MUTED} strokeWidth={W('thin')} strokeDasharray={`${sw * 1.5} ${sw * 1.5}`} />
      </g>
    )
  }
  const topY = RY - parapet * s
  return (
    <g>
      {/* 栏板（女儿墙）：剖面上是被切到的实体，填 poché */}
      <rect x={f(X0)} y={f(topY)} width={f(SPAN)} height={f(parapet * s)} fill={FILL} stroke={INK} strokeWidth={W('major')} />
      {/* 压顶：0.5b 加粗，两端各出挑一点点 */}
      <line x1={f(X0 - 6)} y1={f(topY)} x2={f(XE + 6)} y2={f(topY)} stroke={INK} strokeWidth={W('outline')} />
      {/* 女儿墙高度标注（用户要求独立尺寸表达）：紧贴栏板上缘 */}
      <text
        x={f(XE + 14)}
        y={f(topY + (parapet * s) / 2 + 3.5)}
        fontSize={fs * 0.62}
        fontFamily="ui-monospace, monospace"
        fill={MUTED}
      >
        女儿墙 {parapet} m
      </text>
      {/* 弧形挡风墙（solarium）—— 萨伏伊屋顶最具辨识度的雕塑化构件 */}
      {kind === 'roofGarden' && (
        <path
          d={`M ${f(X0 + SPAN * 0.26)} ${f(topY)} Q ${f(X0 + SPAN * 0.5)} ${f(topY - parapet * s * 2.1)} ${f(X0 + SPAN * 0.74)} ${f(topY)}`}
          fill={FILL}
          stroke={INK}
          strokeWidth={W('major')}
        />
      )}
      {/* 屋面绿化填充示意 */}
      <line x1={f(X0 + 8)} y1={f(RY - 2)} x2={f(XE - 8)} y2={f(RY - 2)} stroke={MUTED} strokeWidth={W('thin')} strokeDasharray={`${sw * 1.5} ${sw * 1.5}`} />
    </g>
  )
}

/* ══ 坡道 ramp ══
   柯布的「建筑漫步」：坡道自底层直通屋面，剖面与立面都要看得见。 */
export function Ramp({ x0, y0, x1, y1, w = 5, sw }) {
  const X0 = Number(x0)
  const Y0 = Number(y0)
  const X1 = Number(x1)
  const Y1 = Number(y1)
  const dx = X1 - X0
  const dy = Y1 - Y0
  const len = Math.hypot(dx, dy) || 1
  const nx = (-dy / len) * w
  const ny = (dx / len) * w
  return (
    <g>
      <path
        d={`M ${f(X0)} ${f(Y0)} L ${f(X1)} ${f(Y1)} L ${f(X1 + nx)} ${f(Y1 + ny)} L ${f(X0 + nx)} ${f(Y0 + ny)} Z`}
        fill={SHEET}
        stroke={INK}
        strokeWidth={sw * 0.5}
      />
      {/* 坡度方向箭头 */}
      <line
        x1={f(X0 + dx * 0.5)}
        y1={f(Y0 + dy * 0.5)}
        x2={f(X0 + dx * 0.5 + nx * 0.5 + dx * 0.06)}
        y2={f(Y0 + dy * 0.5 + ny * 0.5 + dy * 0.06)}
        stroke={ACCENT}
        strokeWidth={sw * 0.5}
      />
    </g>
  )
}

export function CutLine({ x1, y1, x2, y2, tag = 'A', fs, sw, flip = false }) {
  /* 调用方常传入 toFixed 后的字符串：必须先转数值，否则 x + n 会变成字符串拼接 */
  const X1 = Number(x1)
  const Y1 = Number(y1)
  const X2 = Number(x2)
  const Y2 = Number(y2)
  const dx = X2 - X1
  const dy = Y2 - Y1
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const px = -uy
  const py = ux
  const s = flip ? -1 : 1
  const arrow = 9
  return (
    <g>
      <line x1={X1} y1={Y1} x2={X2} y2={Y2} stroke={ACCENT} strokeWidth={Math.min(sw * 1.6, 2)} strokeDasharray={`${sw * 7} ${sw * 3}`} />
      {[
        [X1, Y1],
        [X2, Y2],
      ].map(([x, y], i) => (
        <g key={i}>
          <line
            x1={f(x - px * arrow * s)}
            y1={f(y - py * arrow * s)}
            x2={f(x + px * arrow * s)}
            y2={f(y + py * arrow * s)}
            stroke={ACCENT}
            strokeWidth={Math.min(sw * 1.6, 2)}
          />
          <text
            x={f(x + px * (arrow + 6) * s)}
            y={f(y + py * (arrow + 6) * s + fs * 0.3)}
            textAnchor="middle"
            fontSize={fs * 0.95}
            fontFamily="ui-monospace, monospace"
            fill={ACCENT}
          >
            {tag}
          </text>
        </g>
      ))}
    </g>
  )
}

/* ══ 轴线：端部圆圈编号 + 点划线（线宽 0.5，GB/T 50104 细线级） ══ */
export function Axis({ x, yTop, yBottom, label, fs, sw }) {
  const r = fs * 0.88
  return (
    <g>
      <line x1={x} y1={yTop} x2={x} y2={yBottom} stroke={FAINT} strokeWidth={LINE_W.DIM} strokeDasharray={`${sw * 5} ${sw * 2} ${sw} ${sw * 2}`} />
      <circle cx={x} cy={yTop - r * 1.6} r={r} fill={SHEET} stroke={MUTED} strokeWidth={LINE_W.DIM} />
      <text
        x={x}
        y={yTop - r * 1.6 + fs * 0.34}
        textAnchor="middle"
        fontSize={fs * 0.74}
        fontFamily="ui-monospace, monospace"
        fill={MUTED}
      >
        {label}
      </text>
    </g>
  )
}

/* ══ 窗构造层次 ══
   线宽：洞口 0.5b，框料 / 分格 / 开启扇 0.25b（GB/T 50104）。
   detail=false 时退化为单线矩形（约束不可信的保守模式）。 */
export function WindowDetail({ x0, x1, yTop, yBot, glassId, fs, sw, detail = true, curtain = false }) {
  const w = x1 - x0
  const h = yBot - yTop
  const MAJOR = sw * 0.5
  const THIN = sw * 0.25
  if (!detail) {
    return <rect x={x0} y={yTop} width={w} height={h} fill="none" stroke={INK} strokeWidth={MAJOR} />
  }
  const frame = Math.max(1.1, Math.min(w, h) * 0.075)
  const mull = w > 1.6 ? w / 2 : null
  return (
    <g>
      {/* 洞口（墙体留洞）0.5b */}
      <rect x={x0} y={yTop} width={w} height={h} fill="url(#none)" stroke={INK} strokeWidth={MAJOR} />
      {/* 玻璃面 0.25b */}
      <rect
        x={x0 + frame}
        y={yTop + frame}
        width={w - frame * 2}
        height={h - frame * 2}
        fill={`url(#${glassId})`}
        stroke={MUTED}
        strokeWidth={THIN}
      />
      {/* 外框线（第二道，体现框料厚度）0.25b */}
      <rect
        x={x0 + frame * 0.42}
        y={yTop + frame * 0.42}
        width={w - frame * 0.84}
        height={h - frame * 0.84}
        fill="none"
        stroke={INK}
        strokeWidth={THIN}
      />
      {/* 中竖框 0.25b */}
      {mull != null && !curtain && (
        <line x1={x0 + mull} y1={yTop} x2={x0 + mull} y2={yBot} stroke={INK} strokeWidth={THIN} />
      )}
      {/* 开启扇：虚线表示扇框，弧线表示开启方向 */}
      {h > 1.2 && (
        <>
          <rect
            x={x0 + frame}
            y={yTop + frame}
            width={(w - frame * 2) / 2}
            height={h - frame * 2}
            fill="none"
            stroke={MUTED}
            strokeWidth={THIN}
            strokeDasharray={`${sw * 2.4} ${sw * 1.6}`}
          />
          <path
            d={`M ${x0 + frame} ${yTop + frame} A ${(w - frame * 2) / 2} ${h - frame * 2} 0 0 1 ${x0 + w / 2} ${yBot - frame}`}
            fill="none"
            stroke={FAINT}
            strokeWidth={THIN}
          />
        </>
      )}
      {/* 窗台板出挑 0.5b */}
      <line x1={x0 - 2} y1={yBot} x2={x1 + 2} y2={yBot} stroke={INK} strokeWidth={MAJOR} />
    </g>
  )
}

/* 标高端头（三角 + 引出线 + 文字） */
export function LevelMark({ x, y, text, fs, sw, side = 'left', strong = false }) {
  const dir = side === 'left' ? -1 : 1
  const col = strong ? ACCENT : MUTED
  return (
    <g>
      <path d={`M ${x} ${y} l ${dir * 11} -5 l 0 10 Z`} fill={col} />
      <text
        x={x + dir * 14}
        y={y - 5}
        textAnchor={side === 'left' ? 'end' : 'start'}
        fontSize={fs * 0.8}
        fontFamily="ui-monospace, monospace"
        fill={col}
      >
        {text}
      </text>
    </g>
  )
}
