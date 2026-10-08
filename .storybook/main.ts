import type { StorybookConfig } from '@storybook/react-vite';
import { withoutVitePlugins } from '@storybook/builder-vite';

const config: StorybookConfig = {
  "stories": [
    "../apps/web/src/**/*.mdx",
    "../apps/web/src/**/*.stories.@(js|jsx|mjs|ts|tsx)"
  ],
  "addons": [
    "@chromatic-com/storybook",
    "@storybook/addon-docs",
    "@storybook/addon-onboarding",
    "@storybook/addon-a11y",
    "@storybook/addon-vitest"
  ],
  "framework": {
    "name": "@storybook/react-vite",
    "options": {}
  },
  // Keep Vite from loading app environment files into the component preview.
  async viteFinal(config) {
    return {
      ...config,
      envDir: false,
      // The component catalog must not register or precache the app's service worker.
      plugins: await withoutVitePlugins(config.plugins, [
        'vite-plugin-pwa',
        'vite-plugin-pwa:info',
        'vite-plugin-pwa:build',
        'vite-plugin-pwa:dev-sw',
        'vite-plugin-pwa:pwa-assets',
      ]),
    };
  }
};
export default config;