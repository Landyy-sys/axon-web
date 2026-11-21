export default function StageProgress({ stages, stageIdx, frac, pct, phase }) {
  return (
    <div className="pt-5">
      {/* 进度条 */}
      <div className="mb-4 flex items-baseline justify-between">
        <span className="flex items-center gap-2 text-[13px] text-ink">
          <span
            className={[
              'inline-block h-1.5 w-1.5 rounded-full bg-accent',
              phase === 'running' ? 'pulse-soft' : '',
            ].join(' ')}
          />
          {phase === 'running' ? 'AI 正在生成中' : '生成完成'}
        </span>
        <span className="font-mono text-[12px] text-muted">{Math.round(pct * 100)}%</span>
      </div>
      <div className="h-[3px] w-full overflow-hidden rounded-full bg-hair">
        <div
          className="h-full rounded-full bg-ink transition-[width] duration-150 ease-out"
          style={{ width: `${pct * 100}%` }}
        />
      </div>

      {/* 阶段列表 */}
      <ol className="mt-5 space-y-0">
        {stages.map((s, i) => {
          const done = i < stageIdx || phase === 'done'
          const active = phase === 'running' && i === stageIdx
          return (
            <li key={s.id} className="flex gap-3">
              {/* 时间轴线 */}
              <div className="flex flex-col items-center pt-[7px]">
                <span
                  className={[
                    'grid h-4 w-4 shrink-0 place-items-center rounded-full border transition-all duration-300',
                    done ? 'border-ink bg-ink' : active ? 'border-accent' : 'border-[#cfccc5]',
                  ].join(' ')}
                >
                  {done ? (
                    <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="1.8">
                      <path d="M2 6.4 4.6 9 10 3.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : active ? (
                    <span className="pulse-soft h-1.5 w-1.5 rounded-full bg-accent" />
                  ) : null}
                </span>
                {i < stages.length - 1 && (
                  <span className={`w-px flex-1 transition-colors duration-300 ${done ? 'bg-hair' : 'bg-hair/40'}`} style={{ minHeight: 18 }} />
                )}
              </div>

              {/* 文本 */}
              <div className={['pb-3.5 transition-opacity duration-300', active ? 'opacity-100' : done ? 'opacity-70' : 'opacity-35'].join(' ')}>
                <p className={['text-[13px]', active ? 'text-ink' : 'text-ink'].join('')}>{s.label}</p>
                <p className="mt-0.5 font-mono text-[11px] leading-relaxed text-muted">{s.hint}</p>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
