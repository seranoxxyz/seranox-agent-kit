import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  target: "es2022",
  outDir: "dist",
  platform: "node",
  // src/index.ts already starts with `#!/usr/bin/env node`; esbuild (via tsup)
  // detects and preserves a leading shebang in the entry file automatically,
  // so no separate `banner` is needed here (adding one too would duplicate it).
});
