/// <reference types="vite/client" />

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
