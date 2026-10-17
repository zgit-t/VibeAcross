import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import pkg from "./package.json" with { type: "json" };

// 前端单元测试配置（与 vite.config.ts 保持一致的版本注入）。
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.mjs"],
  },
});
