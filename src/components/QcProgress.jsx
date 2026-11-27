/* ── AI 质检 · 三步进度展示（v0.4 Self-Review & Retry）──
   生成期间右侧图纸区不再直接出图，而是按用户可读的三步推进：
   [步骤 1/3] 解析图像与约束参数（对应左侧完整管线）
   [步骤 2/3] 生成初步图纸 + AI 质量自检（不合格会静默重试）
   [步骤 3/3] 校验通过，渲染最终图纸 */
const QC_STEPS = [
  { label: '正在解析图像与约束参数...', hint: '视觉证据提取 · 尺度标定 · 多轮采样求解' },
  { label: '正在生成初步图纸并进行 AI 质量自检...', hint: '独立校验：洞口越界 / 层高失配 / 门悬空 / 几何倒置' },
  { label: '校验通过，正在渲染最终图纸...', hint: '平 / 立 / 剖 / 等轴测 四视图矢量出图' },
]

export default function QcProgress({ step, retry }) {
  return (
    <div className="grid-bg flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-[#cfccc5] px-8 py-16">
      <div className="flex items-center gap-2.5">
        <span className="block h-4 w-4 animate-spin rounded-full border-[1.5px] border-[#cfccc5] border-t-ink" />
        <span className="font-mono text-[12px] tracking-wider text-muted">AI QUALITY GATE · 自检中</span>
      </div>

      <ol className="mt-6 w-full max-w-[340px] space-y-3">
        {QC_STEPS.map((s, i) => {
          const done = i < step
          const active = i === step
          return (
            <li
              key={i}
              className={[
                'rounded-lg border px-3 py-2.5 transition-all duration-300',
                active
                  ? 'border-ink bg-white shadow-sm'
                  : done
                    ? 'border-[#8aa66f]/40 bg-[#f4f7ef] opacity-80'
                    : 'border-hair bg-white/50 opacity-45',
              ].join(' ')}
            >
              <p className="font-mono text-[11px] tracking-wider text-muted">
                [步骤 {i + 1}/3]
                {done && <span className="ml-2 text-[#5c7a3f]">✓ 完成</span>}
              </p>
              <p className={['mt-1 text-[13px] leading-snug', active ? 'text-ink' : 'text-ink/80'].join(' ')}>
                {s.label}
              </p>
              <p className="mt-0.5 font-mono text-[10.5px] leading-relaxed text-muted">{s.hint}</p>
            </li>
          )
        })}
      </ol>

      {retry > 0 && (
        <p className="mt-4 rounded-md border border-[#b45309]/40 bg-[#fffbeb] px-3 py-1.5 text-[11.5px] text-[#92400e]">
          第 {retry} 版自检未通过，已自动调整参数重新生成…（最多重试 2 次，不影响结果）
        </p>
      )}
    </div>
  )
}
