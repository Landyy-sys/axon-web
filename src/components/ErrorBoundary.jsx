import React from 'react'

/* ═══════════════════════════════════════════════════════════════
   全站唯一的一道"保险丝"：React 渲染错误边界（Error Boundary）
   ─────────────────────────────────────────────────────────────
   背景：之前任何一处图纸渲染抛错（如 SVG 坐标算出 NaN、某个
   导出名缺失、undefined 调 toFixed）都会让 React 19 直接卸载
   整棵组件树 —— 表现为「进度条走完 → 整页白屏、无任何提示」。

   有了这层边界，任何渲染错误都会被就地捕获：
   · 屏幕上出现醒目的红色提示卡（错误信息 + 重试按钮）
   · 其他区域照常可用，绝不白屏
   ═══════════════════════════════════════════════════════════════ */

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
    this.reset = this.reset.bind(this)
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    /* 控制台留档，便于排查；不弹任何阻塞式对话框 */
    console.error('[AXON] 渲染错误被边界捕获：', this.props.label || '未标注区域', error, info?.componentStack)
    if (this.props.onError) {
      try {
        this.props.onError(error)
      } catch { /* 上报失败不影响兜底 UI */ }
    }
  }

  reset() {
    this.setState({ error: null })
  }

  render() {
    if (this.state.error) {
      const msg = String(this.state.error?.message || this.state.error).slice(0, 160)
      return (
        <div
          role="alert"
          className="flex flex-1 flex-col items-center justify-center rounded-lg border border-[#b91c1c]/40 bg-[#fef2f2] px-6 py-8 text-center"
        >
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#b91c1c" strokeWidth="1.6">
            <path d="M12 3 22 20H2L12 3Z" strokeLinejoin="round" />
            <path d="M12 9.5v5M12 17.2v.2" strokeLinecap="round" />
          </svg>
          <p className="mt-3 text-[13.5px] font-medium text-[#7f1d1d]">
            图纸渲染出错了，但网站没有崩溃
          </p>
          <p className="mt-1 max-w-[420px] font-mono text-[11px] leading-relaxed text-[#b45309]">
            {this.props.label ? `出错区域：${this.props.label} · ` : ''}{msg}
          </p>
          <p className="mt-1.5 text-[11.5px] text-[#7f1d1d]/80">
            可以点下方按钮重试，或点「重新生成」换一版方案。
          </p>
          <button
            onClick={this.reset}
            className="mt-3.5 rounded-md bg-[#b91c1c] px-4 py-1.5 text-[12px] text-white transition-opacity hover:opacity-85"
          >
            重试渲染
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
