import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 后台管理构建到 ../site/admin/（随主站一起部署）
// base 用相对路径 './'，保证挂载在任意域名 /admin/ 下都可用
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: '../site/admin',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5180,
    // 本地开发时把 /api 代理到 wrangler pages dev 起的本地 worker
    proxy: {
      '/api': 'http://localhost:8799',
    },
  },
});
