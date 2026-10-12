import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
  test: {
    include: ["lib/**/*.test.ts", "fleet/**/*.test.ts", "supabase/test/**/*.test.ts"],
    exclude: ["node_modules", ".next", "e2e"],
    environment: "node",
  },
});
