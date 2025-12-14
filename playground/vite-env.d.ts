/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_COMPONENT_PATH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
