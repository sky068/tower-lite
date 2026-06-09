import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const clientPort = Number(process.env.VITE_PORT ?? 5173);
const apiTarget = process.env.VITE_API_TARGET ?? "http://127.0.0.1:4000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: clientPort,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
        ws: true
      }
    }
  }
});
