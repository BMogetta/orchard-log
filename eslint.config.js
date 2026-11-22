import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import react from "eslint-plugin-react";

export default [
  {
    ignores: [
      "dist",
      "dev-dist",
      "node_modules",
      ".wrangler",
      "playwright-report",
      "test-results",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "react-hooks": reactHooks, react },
    rules: {
      // Only jsx-uses-vars from eslint-plugin-react: without it, components
      // referenced solely in JSX read as unused. Not extending its recommended
      // set on purpose — keep the rule surface small.
      "react/jsx-uses-vars": "error",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // The automatic JSX runtime means `import React` reads as unused; keep the
      // imports (some files use React.*) without erroring. `_`-prefixed args are
      // intentional throwaways (e.g. array filter index helpers).
      "no-unused-vars": [
        "error",
        { varsIgnorePattern: "^React$", argsIgnorePattern: "^_" },
      ],
    },
  },
  // Tests and Node-side config run under Node with framework globals.
  {
    files: ["**/*.test.{js,jsx}", "test/**/*.{js,jsx}"],
    languageOptions: { globals: { ...globals.node } },
    rules: { "no-undef": "off" },
  },
  {
    files: ["*.config.js"],
    languageOptions: { globals: { ...globals.node } },
  },
  // Browser tests: Node for the test code, browser for what runs in the page.
  {
    files: ["e2e/**/*.js"],
    languageOptions: { globals: { ...globals.node } },
  },
];
