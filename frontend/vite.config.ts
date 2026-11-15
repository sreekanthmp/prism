import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The built dashboard goes straight into Prism's static folder and is served at /app, so Prism runs with Python only: node is needed to REBUILD it, never to run it.
export default defineConfig({
  plugins: [react()],
  base: "/app/",
  build: { outDir: "../app/static/app", emptyOutDir: true, sourcemap: false, target: "es2022" },
  test: { environment: "jsdom", setupFiles: ["./src/test/setup.ts"], include: ["src/**/*.test.{ts,tsx}"], css: false, env: { TZ: "America/New_York" } }, // (a PC in any zone must show IST: so the tests run in one that is not)
});
