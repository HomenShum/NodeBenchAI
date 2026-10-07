import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import storybook from "eslint-plugin-storybook";

const tsLanguageOptions = {
  ecmaVersion: 2020,
  globals: {
    ...globals.browser,
    ...globals.node,
  },
};

const tsPlugins = {
  "react-hooks": reactHooks,
  "react-refresh": reactRefresh,
};

const tsRules = {
  ...reactHooks.configs.recommended.rules,
  "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],

  // All of these overrides ease getting into
  // TypeScript, and can be removed for stricter
  // linting down the line.

  // Only warn on unused variables, and ignore variables starting with `_`
  "@typescript-eslint/no-unused-vars": [
    "warn",
    { varsIgnorePattern: "^_", argsIgnorePattern: "^_" },
  ],

  // Allow escaping the compiler
  "@typescript-eslint/ban-ts-comment": "error",

  // Allow explicit `any`s
  "@typescript-eslint/no-explicit-any": "off",

  // START: Allow implicit `any`s
  "@typescript-eslint/no-unsafe-argument": "off",
  "@typescript-eslint/no-unsafe-assignment": "off",
  "@typescript-eslint/no-unsafe-call": "off",
  "@typescript-eslint/no-unsafe-member-access": "off",
  "@typescript-eslint/no-unsafe-return": "off",
  // END: Allow implicit `any`s

  // Allow async functions without await
  // for consistency (esp. Convex `handler`s)
  "@typescript-eslint/require-await": "off",

  // Relax strict template expression checks for complex codebases
  "@typescript-eslint/restrict-template-expressions": "off",

  // Allow empty catch/block statements for intentional no-ops
  "no-empty": "off",

  // Allow object stringification in templates (common in logging)
  "@typescript-eslint/no-base-to-string": "off",

  // Allow case block declarations (common pattern)
  "no-case-declarations": "off",

  // Prevents referencing hook results before they are declared
  // Relaxed to allow common React patterns (helper functions, styled components defined after component)
  "no-use-before-define": "off",
  "@typescript-eslint/no-use-before-define": "off",

  // Prevent importing from src/shared/* - use shared/* instead
  "no-restricted-imports": [
    "error",
    {
      patterns: [
        {
          group: ["**/src/shared/*"],
          message:
            "Import from 'shared/*' instead of 'src/shared/*'. The canonical source is the root shared/ folder.",
        },
      ],
    },
  ],
};

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "build/**",
      "vendor/**",
      ".tmp/**",
      ".tmp-schema-dts/**",
      "eslint.config.js",
      "convex/_generated/**",
      "postcss.config.js",
      "tailwind.config.js",
      "vite.config.ts",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: tsLanguageOptions,
    plugins: tsPlugins,
    rules: tsRules,
  },
  {
    extends: [...tseslint.configs.recommendedTypeChecked],
    files: ["src/**/*.ts"],
    languageOptions: {
      ...tsLanguageOptions,
      parserOptions: {
        project: ["./tsconfig.app.json"],
      },
    },
    plugins: tsPlugins,
    rules: {
      ...tsRules,
    },
  },
  {
    extends: [...tseslint.configs.recommendedTypeChecked],
    files: ["convex/**/*.ts"],
    languageOptions: {
      ...tsLanguageOptions,
      parserOptions: {
        project: ["./convex/tsconfig.json"],
      },
    },
    plugins: tsPlugins,
    rules: {
      ...tsRules,
    },
  },
  // Storybook configuration
  ...storybook.configs["flat/recommended"],
);
