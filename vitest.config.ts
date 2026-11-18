import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { test: { name: "unit", include: ["tests/*.test.{ts,mjs}"] } },
      // Renders .astro pages with the Astro container (vitest.render.config.ts).
      "./vitest.render.config.ts",
    ],
  },
});
