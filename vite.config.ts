import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import pkg from "./package.json" with { type: "json" };

// VibeAcross 前端构建配置。
// Tauri 在开发模式下会加载 devUrl，因此固定端口并禁止自动切换。
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  // 版本号来自 package.json，避免在界面中硬编码导致与实际版本不一致。
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // src-tauri 由 Rust 侧监听，避免前端监视重复触发。
      ignored: ["**/src-tauri/**"],
    },
  },
});
