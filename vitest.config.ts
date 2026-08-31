import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // cli.ts is exercised end-to-end by cli.test.ts, which spawns the CLI as a real
      // subprocess (the only way to catch module-load side effects such as `--help`
      // writing to $HOME). v8 cannot instrument across that process boundary, so the file
      // would always report 0% and drag the thresholds down.
      exclude: ["src/**/*.test.ts", "src/cli.ts"],
      reporter: ["text", "lcov"],
      thresholds: {
        statements: 95,
        branches: 90,
        functions: 95,
        lines: 95,
      },
    },
  },
});
