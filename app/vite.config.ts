import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [vue(), tailwindcss()],

  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },

  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // Windows 上 localhost 可能走 IPv6，与 Tauri devUrl 健康检查不一致；固定 127.0.0.1
    host: host || "127.0.0.1",
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
