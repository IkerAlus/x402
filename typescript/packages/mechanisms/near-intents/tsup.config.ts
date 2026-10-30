import { defineConfig } from "tsup";

const baseConfig = {
  entry: {
    index: "src/index.ts",
    "origins/evm": "src/origins/evm.ts",
    "exact/facilitator/index": "src/exact/facilitator/index.ts",
  },
  dts: {
    resolve: true,
  },
  sourcemap: true,
  target: "es2020",
};

export default defineConfig([
  {
    ...baseConfig,
    format: "esm",
    outDir: "dist/esm",
    clean: true,
  },
  {
    ...baseConfig,
    format: "cjs",
    outDir: "dist/cjs",
    clean: false,
    dts: false,
  },
]);
