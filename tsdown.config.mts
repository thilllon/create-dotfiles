import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["cjs"],
  // Everything is bundled on purpose: runtime deps are devDependencies so the published
  // package has none. onlyBundle: false turns off the "unintended bundling" check.
  deps: { alwaysBundle: [/.*/], onlyBundle: false },
  // tsconfig has declaration: true, which makes tsdown emit d.ts by default; a bin
  // entry has nothing to declare. The library entry enables it for itself.
  dts: false,
  clean: true,
  shims: true,
  banner: "#!/usr/bin/env node",
  minify: true,
});
