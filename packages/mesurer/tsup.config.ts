import { copyFileSync } from "node:fs";
import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["index.ts"],
    format: ["cjs", "esm"],
    dts: true,
    target: "es2020",
    bundle: true,
    clean: true,
    external: ["@zumer/snapdom"],
    define: {
      __MESURER_SNAPDOM_CAPTURE__: "true",
      // Saving a review is left out of the published package until reviews are kept on the
      // platform: the Save button cannot be switched on, and what only saving needs is compiled
      // out. Builds made from source (the site's dev server, the extension with
      // `MESURER_REVIEW=1`) still have it.
      "globalThis.__MESURER_NO_REVIEW__": "true",
    },
  },
  // The dev-server bridge: Node only, never in the browser bundle.
  {
    entry: { vite: "bridge/vite.ts", server: "bridge/server.ts" },
    format: ["cjs", "esm"],
    dts: { compilerOptions: { types: ["node"] } },
    tsconfig: "tsconfig.node.json",
    platform: "node",
    target: "node18",
    bundle: true,
    clean: false,
  },
  {
    entry: { cli: "bridge/bin.ts" },
    format: ["esm"],
    tsconfig: "tsconfig.node.json",
    platform: "node",
    target: "node18",
    bundle: true,
    clean: false,
    onSuccess: async () => {
      copyFileSync("bridge/AGENT.md", "dist/AGENT.md");
    },
  },
]);
