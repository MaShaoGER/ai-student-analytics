import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  // Operational CLI fixtures run separately with node --test.
  test: {
    exclude: [...configDefaults.exclude, "scripts/recovery.test.mjs"],
    env: { DEMO_DATA_DIR: "data/fixtures/golden" },
  },
});
