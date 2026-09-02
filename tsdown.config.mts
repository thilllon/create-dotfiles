import { defineConfig, type UserConfig } from "tsdown";

const shared: UserConfig = {
  format: ["cjs"],
  // Everything is bundled on purpose: runtime deps are devDependencies so the published
  // package has none. onlyBundle: false turns off the "unintended bundling" check.
  deps: { alwaysBundle: [/.*/], onlyBundle: false },
  // tsdown runs the clean step once for all configs before the first build starts.
  clean: true,
  shims: true,
  minify: true,
};

export default defineConfig([
  {
    ...shared,
    entry: { cli: "src/cli.ts" },
    // tsconfig has declaration: true, which makes tsdown emit d.ts by default; a bin
    // entry has nothing to declare.
    dts: false,
    banner: "#!/usr/bin/env node",
  },
  {
    ...shared,
    // The library entry: `main`/`types`/`exports` in package.json point here. tsconfig's
    // declarationMap would add a .d.cts.map that points at src/, which is not published.
    entry: { index: "src/index.ts" },
    dts: { sourcemap: false },
  },
]);
