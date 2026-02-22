import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["cjs"],
  noExternal: [/.*/],
  clean: true,
  shims: true,
  banner: "#!/usr/bin/env node",
  minify: true,
});
