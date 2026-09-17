import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // 内置数据在 src 外头：它随程序发布，Rust 侧也读同一批文件，
      // 放进 src 会让「这是前端资源」的印象盖掉这件事
      '@res': fileURLToPath(new URL('./resources', import.meta.url)),
    },
  },
  test: {
    environment: 'node',          // domain 层是纯逻辑，不需要 DOM
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
