import { createCommentsHandler, type CommentsHandlerOptions } from "./handler"

// `mesurer/vite`: the comments bridge in Vite's dev server (and so in Astro, SvelteKit, Remix
// and anything else built on it). It does nothing in a production build.
//
//   // astro.config.mjs
//   import mesurer from "mesurer/vite"
//   export default defineConfig({ vite: { plugins: [mesurer()] } })

export type MesurerViteOptions = Omit<CommentsHandlerOptions, "store">

// Only what this plugin uses of Vite's types, so the package does not depend on Vite.
type DevServer = {
  config: { root: string }
  middlewares: { use: (handler: CommentsHandlerFn) => void }
  httpServer?: { once: (event: "close", listener: () => void) => void } | null
}
type CommentsHandlerFn = ReturnType<typeof createCommentsHandler>["handle"]

export type MesurerVitePlugin = {
  name: string
  apply: "serve"
  configureServer: (server: DevServer) => void
}

export default function mesurer(options: MesurerViteOptions = {}): MesurerVitePlugin {
  return {
    name: "mesurer:comments-bridge",
    apply: "serve",
    configureServer(server) {
      const handler = createCommentsHandler({ ...options, root: options.root ?? server.config.root })
      server.middlewares.use(handler.handle)
      server.httpServer?.once("close", handler.close)
    },
  }
}

export { mesurer }
