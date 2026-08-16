/// <reference types="vite/client" />

/** Stylesheets are handled by Vite, not by TypeScript. */
declare module '*.css' {
  const content: string
  export default content
}

declare module '*.svg' {
  const src: string
  export default src
}

declare module '*.png' {
  const src: string
  export default src
}
