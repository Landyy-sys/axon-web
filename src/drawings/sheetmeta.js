/* ═══════════════════════════════════════════════════════════════
   A3 图签元数据（纯 JS，无 JSX —— Node 端测试脚本可直接导入）
   ═══════════════════════════════════════════════════════════════ */

/* 标准比例系列（GB/T 50001 常用） */
export const SCALE_SERIES = [50, 75, 100, 150, 200, 250, 500]

/* 比例自动计算：假定建筑主体约占 A3 内框有效宽度 273 mm
   （内框 390 mm × 70%），反算毫米比并向上吸附标准系列（保证画得下） */
export function pickScale(meters, contentMM = 273) {
  if (!(meters > 0)) return 100
  const denom = (meters * 1000) / contentMM
  return SCALE_SERIES.find((s) => s >= denom) ?? 500
}
