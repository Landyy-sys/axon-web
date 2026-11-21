import { useEffect, useRef, useState } from 'react'

/* ── 多轮对话反馈修改 · 交互区 ──
   位于图纸展示区下方。消息分两种：
   user —— 用户输入的原始意见
   bot  —— 引擎回复（成功说明 / 模糊拒绝），失败态用强调色区分 */
export default function FeedbackChat({ messages, onSend, busy }) {
  const [text, setText] = useState('')
  const listRef = useRef(null)

  const send = () => {
    const t = text.trim()
    if (!t || busy) return
    onSend(t)
    setText('')
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    }
  }

  /* 新消息到达时滚到底部 */
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages.length, busy])

  return (
    <div className="mt-4 rounded-lg border border-hair bg-white/70">
      <div className="flex items-center justify-between border-b border-hair px-3 py-2">
        <span className="font-mono text-[10.5px] tracking-wider text-muted">
          FEEDBACK · 多轮对话修改 <span className="ml-1 text-ink">最新意见 &gt; 基础参数</span>
        </span>
        <span className="font-mono text-[10px] text-muted">{messages.filter((m) => m.role === 'user').length} 轮</span>
      </div>

      <div ref={listRef} className="max-h-[190px] min-h-[44px] overflow-y-auto px-3 py-2">
        {messages.length === 0 ? (
          <p className="py-1 text-[11.5px] leading-relaxed text-muted">
            生成后可以继续用一句话改图 —— 例如「把窗户改大一点」「改成 5 层」「加个阳台」。
            引擎会解析你的意图、真正修改几何并说明改了什么；说不清楚时它会直接拒绝，不会糊弄。
          </p>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={`mb-1.5 flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <p
                className={[
                  'max-w-[86%] rounded-lg px-2.5 py-1.5 text-[12px] leading-relaxed',
                  m.role === 'user'
                    ? 'bg-ink text-white'
                    : m.rejected
                      ? 'border border-[#b45309]/40 bg-[#fffbeb] text-[#92400e]'
                      : 'bg-sheet text-ink',
                ].join(' ')}
              >
                {m.text}
              </p>
            </div>
          ))
        )}
        {busy && (
          <div className="flex items-center gap-2 py-1">
            <span className="block h-3 w-3 animate-spin rounded-full border-[1.5px] border-[#cfccc5] border-t-ink" />
            <span className="text-[11px] text-muted">正在按修改意见重新生成，请稍候…</span>
          </div>
        )}
      </div>

      <div className="flex items-end gap-2 border-t border-hair px-3 py-2.5">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          disabled={busy}
          placeholder="请提出修改意见，例如：把立面图的窗户改大一点，或者增加一个阳台"
          className="max-h-[96px] min-h-[36px] flex-1 resize-y rounded-md border border-hair bg-white px-2.5 py-2 text-[12.5px] leading-snug text-ink outline-none transition-colors placeholder:text-[#a8a49c] focus:border-ink disabled:bg-[#f3f2ef]"
        />
        <button
          onClick={send}
          disabled={busy || !text.trim()}
          className="shrink-0 rounded-md bg-ink px-4 py-2 text-[12.5px] text-white transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:bg-[#e8e6e1] disabled:text-muted"
        >
          {busy ? '生成中…' : '发送 / 重新生成'}
        </button>
      </div>
    </div>
  )
}
