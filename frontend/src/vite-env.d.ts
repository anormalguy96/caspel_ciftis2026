/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PUBLIC_CIFTIS_URL?: string;
  readonly VITE_DISPLAY_RESET_SECONDS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
