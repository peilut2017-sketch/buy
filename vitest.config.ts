import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: [
      "packages/**/*.test.ts",
      "packages/**/*.test.tsx",
      "apps/**/*.test.ts",
      "apps/**/*.test.tsx",
      "supabase/functions/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "**/.output/**", "**/.wxt/**"],
  },
  esbuild: { jsx: "automatic", jsxImportSource: "preact" },
});
