/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Where the SPA is mounted: "/" for a dedicated subdomain, "/ciftis/" when
   * served beneath the corporate site. Vite exposes the validated, normalised
   * value as BASE_URL; see src/config/paths.ts.
   */
  readonly VITE_APP_BASE_PATH?: string;
  /** Absolute public address of this deployment, no trailing slash. */
  readonly VITE_PUBLIC_URL?: string;
  readonly VITE_DISPLAY_RESET_SECONDS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module 'lucide-react';

// Vite emits imported media as a content-hashed URL under the configured base,
// which is what keeps the video working in both deployment modes.
declare module "*.mp4" {
  const src: string;
  export default src;
}

// Same reasoning for the first-slide previews: imported as modules so Vite
// hashes them and resolves them against the deployment's base path, rather than
// hardcoding a root-relative URL that would break under the corporate subpath.
declare module "*.webp" {
  const src: string;
  export default src;
}
