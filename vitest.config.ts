import { defineConfig } from "vitest/config";

// Standalone vitest config: vite.config.ts is scoped to the ui/ card bundle
// (root: "ui"), so tests declare their own root/include here — vitest prefers
// vitest.config.ts over vite.config.ts.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
