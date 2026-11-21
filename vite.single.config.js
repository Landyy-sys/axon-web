import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * 单文件构建配置 —— 产出可直接双击打开的一个 HTML。
 * 与常规构建（vite.config.js）的区别：
 *   · format: 'iife'            → 不用 ES module，file:// 下不会被 CORS 拦
 *   · inlineDynamicImports      → React.lazy 的图纸Chunk 也合进主包，只出一个 JS
 *   · 不做 code splitting       → IIFE 下拆包无意义
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',

  build: {
    target: 'es2020',
    cssCodeSplit: false,
    reportCompressedSize: false,
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
})
