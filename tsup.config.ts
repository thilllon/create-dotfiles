import { defineConfig } from 'tsup';

export default defineConfig({
  dts: true,
  minify: true,
  entry: ['src/index.ts'],
  cjsInterop: true,
});
