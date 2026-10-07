/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare module "*?raw" {
  const content: string;
  export default content;
}
