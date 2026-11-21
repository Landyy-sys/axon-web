import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],

  /* 相对路径产物：dist/index.html 可以双击直接用 file:// 打开，
     不依赖任何服务器。部署到子目录 / 静态托管同样适用。 */
  base: './',

  /* dev：预打包 + 预热，避免首次打开时现场扫描依赖 */
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime'],
  },
  /* 局域网共享 —— 监听 0.0.0.0，允许任意 Host 头（IP 直连 / 域名反代均可） */
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    warmup: { clientFiles: ['./src/main.jsx', './src/App.jsx'] },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true,
    allowedHosts: true,
  },

  build: {
    target: 'es2020',
    cssCodeSplit: false,
    reportCompressedSize: false,
    /* 把 react 单独成组，首屏 JS 更小；
       图纸绘制层已通过 React.lazy 自动拆成另一个 chunk。 */
    rollupOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ }],
        },
      },
    },
  },
})
