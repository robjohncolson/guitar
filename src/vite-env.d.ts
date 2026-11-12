/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** 'off' builds the static mirror (GitHub Pages) without the account features. */
  readonly VITE_ACCOUNTS?: string;
}
