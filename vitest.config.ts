import path from "node:path";
import { defineConfig } from "vitest/config";

// tsconfig.json maps "@/*" to the repo root; mirror that for vitest. This
// package is CommonJS (no "type": "module"), so __dirname is the right way
// to name the config's directory.
const rootDir = path.resolve(__dirname);

export default defineConfig({
  resolve: {
    alias: {
      "@": rootDir,
    },
  },
  test: {
    // Pure-logic tests only — plain node, no jsdom, no browser APIs.
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
