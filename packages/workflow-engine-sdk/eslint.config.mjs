import { fixupPluginRules } from "@eslint/compat";
import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";
import noticePlugin from "eslint-plugin-notice";
import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    ignores: [
      "dist/**",
      "dist-esm/**",
      "coverage/**",
      "node_modules/**",
      "copyright.js",
      "eslint.config.mjs",
    ],
  },
  {
    files: ["**/*.{js,mjs,cjs,ts}"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } }
  },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended.map(config => ({
    ...config,
    rules: {
      ...config.rules,
      // Allow any type for flexibility in SDK development
      "@typescript-eslint/no-explicit-any": "off",
      // Allow empty object types for extensibility
      "@typescript-eslint/no-empty-object-type": "off",
      // Allow unused variables starting with _
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          "argsIgnorePattern": "^_",
          "varsIgnorePattern": "^_"
        }
      ],
    }
  })),
  {
    files: ["**/*.{js,mjs,cjs,ts}"],
    plugins: {
      notice: fixupPluginRules(noticePlugin),
    },
    rules: {
      // Copyright header enforcement
      "notice/notice": [
        "error",
        {
          templateFile: path.resolve(__dirname, "copyright.js"),
        },
      ],
    },
  }
];