import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["cjs"],
  // Everything is bundled on purpose: runtime deps are devDependencies so the published
  // package has none. inlineOnly: false silences tsdown's "unintended bundling" check,
  // which is escalated from a warning to an error when CI=true.
  noExternal: [/.*/],
  inlineOnly: false,
  clean: true,
  shims: true,
  banner: "#!/usr/bin/env node",
  minify: true,
});
