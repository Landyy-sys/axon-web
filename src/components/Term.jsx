import { GLOSSARY_MAP } from '../glossary.js'

/**
 * 专业名词的就地解读。
 *
 * 网站面向大众：任何一个专业名词都必须能被当场看懂，而不是让人自己去搜。
 * 鼠标悬停或键盘聚焦即可展开，卡片里必须同时给三样东西：
 *   ① 大白话（含生活类比）  ② 规范里的准确定义  ③ 在这套图纸上到哪儿看
 * 纯 CSS group-hover / group-focus-within 实现，SSR 不依赖任何浏览器 API。
 */
export default function Term({ id, children, className = '' }) {
  const t = GLOSSARY_MAP[id]
  if (!t) return <span className={className}>{children}</span>
  return (
    <span className={`group relative inline-block ${className}`}>
      <span
        tabIndex={0}
        title={t.plain}
        className="cursor-help border-b border-dotted border-ink/45 outline-none transition-colors group-hover:border-accent group-focus-visible:border-accent"
      >
        {children ?? t.term}
      </span>
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute left-0 top-[calc(100%+6px)] z-50 w-[268px] rounded-md border border-hair bg-white p-2.5 opacity-0 shadow-xl transition-opacity duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
      >
        <span className="flex items-baseline gap-1.5">
          <span className="text-[12.5px] text-ink">{t.term}</span>
          {t.alias && <span className="font-mono text-[9.5px] text-muted">{t.alias}</span>}
          {t.unit && <span className="ml-auto font-mono text-[9.5px] text-muted">单位 {t.unit}</span>}
        </span>
        <span className="mt-1.5 block border-l-2 border-accent/60 pl-2 text-[11.5px] leading-relaxed text-ink">
          {t.plain}
        </span>
        <span className="mt-1.5 block text-[10.5px] leading-relaxed text-muted">
          <span className="font-mono text-[9.5px] tracking-wider">释义 </span>
          {t.pro}
        </span>
        <span className="mt-1 block text-[10.5px] leading-relaxed text-muted">
          <span className="font-mono text-[9.5px] tracking-wider">图上 </span>
          {t.see}
        </span>
      </span>
    </span>
  )
}
