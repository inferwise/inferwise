import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: true,
    clean: true,
    banner: {
      js: "#!/usr/bin/env node",
    },
  },
  {
    entry: ["src/sdk.ts"],
    format: ["esm"],
    dts: true,
    clean: false,
  },
]);
