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
