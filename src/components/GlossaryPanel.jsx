import { useMemo, useState } from 'react'
import { searchGlossary, GLOSSARY_GROUPS } from '../glossary.js'

/**
 * 名词速查：把所有专业名词按「尺寸 / 构件 / 制图 / 方法」分组列出来，支持搜索。
 * 默认折叠，点开才能看到，避免把常用操作挤出屏幕。
 */
export default function GlossaryPanel({ defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  const [q, setQ] = useState('')
  const list = useMemo(() => searchGlossary(q), [q])

  return (
    <div className="mt-3 rounded-lg border border-hair bg-sheet/60 p-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2"
      >
        <span className="font-mono text-[10.5px] tracking-wider text-muted">
          名词速查 · GLOSSARY {open ? '▾' : '▸'}
        </span>
        <span className="font-mono text-[9.5px] text-muted">面向非专业用户</span>
      </button>

      {open && (
        <>
          <p className="mt-2 text-[11px] leading-snug text-muted">
            凡带虚线下划线的词都可就地展开解读。下面这张表可以搜：
            <span className="text-ink">面宽 / 开间 / 进深 / 层高 / 女儿墙 / 柱网…</span>
          </p>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索名词或解释…"
            className="mt-2 w-full rounded-md border border-hair bg-white px-2 py-1.5 text-[12px] text-ink outline-none transition-colors focus:border-ink"
          />
          <div className="mt-2.5 max-h-[340px] overflow-y-auto pr-1">
            {GLOSSARY_GROUPS.map((g) => {
              const items = list.filter((t) => t.group === g)
              if (!items.length) return null
              return (
                <div key={g} className="mb-3">
                  <p className="mb-1 font-mono text-[9.5px] tracking-wider text-accent">{g}</p>
                  {items.map((t) => (
                    <div key={t.id} className="border-b border-[#e8e6e1] py-1.5 last:border-0">
                      <p className="flex items-baseline gap-1.5">
                        <span className="text-[12px] text-ink">{t.term}</span>
                        {t.alias && <span className="font-mono text-[9.5px] text-muted">{t.alias}</span>}
                        {t.unit && (
                          <span className="ml-auto font-mono text-[9.5px] text-muted">{t.unit}</span>
                        )}
                      </p>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{t.plain}</p>
                      <p className="mt-0.5 text-[10.5px] leading-relaxed text-muted">
                        <span className="font-mono text-[9px] tracking-wider">释义 </span>
                        {t.pro}
                      </p>
                      <p className="mt-0.5 text-[10.5px] leading-relaxed text-muted">
                        <span className="font-mono text-[9px] tracking-wider">图上 </span>
                        {t.see}
                      </p>
                    </div>
                  ))}
                </div>
              )
            })}
            {!list.length && (
              <p className="py-3 text-center text-[11px] text-muted">没有匹配的名词</p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
