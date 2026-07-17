import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      // "server-only" throws outside a React Server environment; tests run
      // the pure logic, so stub it out.
      "server-only": path.resolve(__dirname, "tests/server-only-stub.ts"),
      "@": path.resolve(__dirname),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
