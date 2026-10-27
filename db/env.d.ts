/// <reference types="vite/client" />
/** True when built for a configured Sites project (see vite.config.ts). */
declare const __SITES_GATEWAY__: boolean;
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
  }
}
