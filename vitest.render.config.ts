// Vitest project for tests/render/: compiles .astro pages so their HTML can be checked.
// The Cloudflare adapter is left out (configFile: false); these tests only need the page markup.
import { getViteConfig } from "astro/config";

export default getViteConfig(
  { test: { name: "render", include: ["tests/render/**/*.test.ts"] } } as any,
  { configFile: false, site: "https://akt16.org", trailingSlash: "always", logLevel: "warn" },
);
