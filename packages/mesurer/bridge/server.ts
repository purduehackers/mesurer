// `mesurer/server`: the comments bridge for servers other than Vite's. Mount `handle` as
// middleware (Express, Connect), or call it from any Node request handler.
export { createCommentsHandler } from "./handler"
export type { CommentsHandler, CommentsHandlerOptions } from "./handler"
export { createCommentsStore } from "./store"
export type { CommentsStore, CommentsStoreOptions } from "./store"
export {
  applyBridgePush,
  BRIDGE_ENDPOINT,
  BRIDGE_FILE,
  normalizeBridgeDocument,
} from "./protocol"
export type { BridgeDocument, BridgePush, BridgeThread } from "./protocol"
