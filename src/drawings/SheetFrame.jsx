import React from 'react'
import { INK, MUTED, FAINT, SHEET, LINE_W } from './shared.jsx'
import { SCALE_SERIES, pickScale } from './sheetmeta.js'

export { SCALE_SERIES, pickScale }

/* ═══════════════════════════════════════════════════════════════
   A3 标准图框 + 图签栏（模块一 · 制图规范化）
   ─────────────────────────────────────────────────────────────
   按 GB/T 50001《房屋建筑制图统一标准》A3 幅面（420×297 mm）：
   · 图框 viewBox 0 0 840 594（2 px = 1 mm，与各视图 SHEET_W=840 同宽）
   · 外框：幅面边界细线 0.5
   · 内框：图框线粗实线 1.4，装订边 25 mm（50 px），其余边距 5 mm（10 px）
   · 图签栏：内框右下角，含项目名 / 图名 / 比例 / 日期 / 图号 / 绘制
   · 比例自动计算：假定建筑主体约占内框有效宽度的 70%，
     反算毫米比并向上取整到标准系列（1:50 起）

   用法：SheetFrame 包裹任意视图组件，屏幕显示与 PNG/PDF 导出走
   同一份包装（ResultPanel 中 renderView 统一出口）。
   ═══════════════════════════════════════════════════════════════ */

export const SHEET_A3_W = 840 // 420 mm × 2
export const SHEET_A3_H = 594 // 297 mm × 2
const BIND_EDGE = 50 // 装订边 25 mm
const EDGE = 10 // 非装订边 5 mm
const STAMP_W = 250 // 图签栏宽 125 mm
const STAMP_H = 92 // 图签栏高 46 mm

const today = () => {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`
}

/* 图签单元格：label 小字 + value 大字，右下角标准会签栏式排布 */
function Cell({ x, y, w, h, label, value, valueSize = 12, strong = false }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill="none" stroke={INK} strokeWidth={LINE_W.DIM} />
      <text x={x + 5} y={y + 11} fontSize={7.5} fill={MUTED} fontFamily="ui-monospace, monospace" letterSpacing="0.08em">
        {label}
      </text>
      <text
        x={x + 5}
        y={y + h - 5}
        fontSize={valueSize}
        fill={INK}
        fontFamily="ui-monospace, monospace"
        fontWeight={strong ? 600 : 400}
      >
        {value}
      </text>
    </g>
  )
}

export default function SheetFrame({ model, title = '建筑图纸', sheetNo = 'A-01', scaleBasis, children }) {
  /* 比例：以传入基准（立面=面宽，剖面=进深，平面=面宽，等轴测=最大边）反算 */
  const basis = scaleBasis ?? model?.length ?? 20
  const scale = pickScale(basis)
  const date = today()
  const project = model ? `AXON · ${model.type?.label || '建筑'}逆向重建` : 'AXON · AI 建筑逆向图纸生成'

  /* 内框绘图区：图签占掉右下角，视图放在剩余区域并保持比例居中 */
  const innerX = BIND_EDGE
  const innerY = EDGE
  const innerW = SHEET_A3_W - BIND_EDGE - EDGE
  const innerH = SHEET_A3_H - EDGE * 2
  const viewH = innerH - STAMP_H - 4

  return (
    <svg
      viewBox={`0 0 ${SHEET_A3_W} ${SHEET_A3_H}`}
      className="block h-full w-full"
      role="img"
      aria-label={`A3 图框 · ${title}`}
    >
      {/* 幅面底色 */}
      <rect x={0} y={0} width={SHEET_A3_W} height={SHEET_A3_H} fill={SHEET} />

      {/* 外框：幅面边界（细线 0.5） */}
      <rect
        x={1}
        y={1}
        width={SHEET_A3_W - 2}
        height={SHEET_A3_H - 2}
        fill="none"
        stroke={FAINT}
        strokeWidth={LINE_W.DIM}
      />

      {/* 内框：图框线（粗实线 1.4），装订边 25 mm */}
      <rect
        x={innerX}
        y={innerY}
        width={innerW}
        height={innerH}
        fill="none"
        stroke={INK}
        strokeWidth={LINE_W.FRAME}
      />

      {/* 视图内容：嵌套 svg —— 内层根 svg 自带 viewBox，
          外层不再叠 viewBox 以免双重坐标变换；保持比例缩放进内框上方区域 */}
      <svg
        x={innerX + 6}
        y={innerY + 4}
        width={innerW - 12}
        height={viewH}
        preserveAspectRatio="xMidYMid meet"
      >
        {children}
      </svg>

      {/* ══ 图签栏（右下角，紧贴内框）══ */}
      <g>
        {/* 左半：项目名 + 图名 */}
        <Cell x={innerX + innerW - STAMP_W} y={innerY + innerH - STAMP_H} w={STAMP_W * 0.62} h={STAMP_H * 0.62} label="项目 PROJECT" value={project} valueSize={9.5} />
        <Cell x={innerX + innerW - STAMP_W} y={innerY + innerH - STAMP_H * 0.38} w={STAMP_W * 0.62} h={STAMP_H * 0.38} label="图名 TITLE" value={title} valueSize={11.5} strong />
        {/* 右半上：比例 / 图号 */}
        <Cell x={innerX + innerW - STAMP_W * 0.38} y={innerY + innerH - STAMP_H} w={STAMP_W * 0.19} h={STAMP_H * 0.62} label="比例 SCALE" value={`1:${scale}`} valueSize={11} strong />
        <Cell x={innerX + innerW - STAMP_W * 0.19} y={innerY + innerH - STAMP_H} w={STAMP_W * 0.19} h={STAMP_H * 0.62} label="图号 NO." value={sheetNo} valueSize={11} />
        {/* 右半下：日期 / 绘制 */}
        <Cell x={innerX + innerW - STAMP_W * 0.38} y={innerY + innerH - STAMP_H * 0.38} w={STAMP_W * 0.19} h={STAMP_H * 0.38} label="日期 DATE" value={date} valueSize={9.5} />
        <Cell x={innerX + innerW - STAMP_W * 0.19} y={innerY + innerH - STAMP_H * 0.38} w={STAMP_W * 0.19} h={STAMP_H * 0.38} label="绘制 DRAWN" value="AXON" valueSize={9.5} />
      </g>
    </svg>
  )
}
