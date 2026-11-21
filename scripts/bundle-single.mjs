/**
 * 把 vite build 产物内联成单个 HTML 文件。
 * 目标：双击即可打开（file:// 也能跑），不依赖任何服务器。
 *
 * 用法：node scripts/bundle-single.mjs
 * 输出：dist-standalone/AXON.html
 */
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const dist = path.join(root, 'dist')
const outDir = path.join(root, 'dist-standalone')
const outFile = path.join(outDir, 'AXON.html')

if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error('找不到 dist/index.html，请先执行 npm run build')
  process.exit(1)
}

let html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8')

/* ① <link rel="stylesheet" href="./assets/x.css"> → <style>…</style> */
html = html.replace(/<link[^>]+rel="stylesheet"[^>]*>/g, (tag) => {
  const m = tag.match(/href="([^"]+)"/)
  if (!m) return ''
  const p = path.join(dist, m[1].replace(/^\.?\//, ''))
  if (!fs.existsSync(p)) return ''
  return `<style>${fs.readFileSync(p, 'utf8')}</style>`
})

/* ② <script type="module" src="./assets/x.js"> → <script>…</script>（去掉 type=module，
      因为 file:// 下 module 脚本会被 CORS 拦；产物已是 IIFE 格式，可直接执行） */
html = html.replace(/<script[^>]+src="([^"]+)"[^>]*>\s*<\/script>/g, (tag, src) => {
  const p = path.join(dist, src.replace(/^\.?\//, ''))
  if (!fs.existsSync(p)) return ''
  return `<script>${fs.readFileSync(p, 'utf8')}</script>`
})

/* ③ modulepreload 已无意义，移除 */
html = html.replace(/<link[^>]+rel="modulepreload"[^>]*>/g, '')

/* ④ 兜底错误钩子：任何未捕获异常都在页面顶部红字显示，绝不白屏。
      必须插在最前面（<head> 一打开就执行），早于一切业务脚本。 */
html = html.replace(/<head([^>]*)>/i, (m, attrs) => `${m}
<script>
(function () {
  function show (msg) {
    try {
      var bar = document.getElementById('axon-fatal');
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'axon-fatal';
        bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;'
          + 'background:#b91c1c;color:#fff;font:14px/1.5 sans-serif;padding:10px 16px;'
          + 'white-space:pre-wrap;max-height:40%;overflow:auto';
        (document.body || document.documentElement).appendChild(bar);
      }
      bar.textContent = '页面脚本出错（已拦截，页面不会白屏）：\\n' + msg;
    } catch (e) { /* 连 DOM 都不可用时只能静默 */ }
  }
  window.onerror = function (m, s, l, c) { show(m + ' @' + (s || '?') + ':' + l + ':' + c) };
  window.addEventListener('unhandledrejection', function (e) { show('Promise: ' + (e.reason && e.reason.message || e.reason)) });
})();
</script>`)

fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(outFile, html, 'utf8')

const kb = (fs.statSync(outFile).size / 1024).toFixed(0)
console.log(`✓ ${path.relative(root, outFile)}  ${kb} KB`)
