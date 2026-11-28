import React from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

/* 全局兜底错误边界：任何未在局部捕获的渲染错误，
   都会显示红色提示卡而不是整页白屏（v0.7.1 防白屏） */

/* v0.7.2 防卡死 · 全局异常监听：
   未处理的 Promise 异常 / 全局错误只记录到控制台（带 AXON 前缀便于检索），
   绝不让页面"无声挂死"且无任何痕迹可查 */
window.addEventListener('unhandledrejection', (e) => {
  console.error('[AXON] 未处理的 Promise 异常：', e.reason)
})
window.addEventListener('error', (e) => {
  console.error('[AXON] 全局错误：', e.message)
})

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary label="整页（全局兜底）">
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
