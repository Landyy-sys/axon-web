import React from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

/* 全局兜底错误边界：任何未在局部捕获的渲染错误，
   都会显示红色提示卡而不是整页白屏（v0.7.1 防白屏） */
createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary label="整页（全局兜底）">
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
