/// <reference types="vite/client" />

// Injected by vite.config.ts → define. Always equals package.json#version.
declare const __APP_VERSION__: string

// Allow `import url from './foo.webp'` style imports for static assets.
declare module '*.webp' {
  const src: string
  export default src
}
declare module '*.png' {
  const src: string
  export default src
}
declare module '*.svg' {
  const src: string
  export default src
}
