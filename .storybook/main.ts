import type { StorybookConfig } from '@storybook/react-vite';

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
  viteFinal(config) {
    return { ...config, envDir: false };
  }
};
export default config;