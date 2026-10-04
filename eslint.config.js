import js from "@eslint/js";
import globals from "globals";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      "dist/**",
      ".output/**",
      ".wxt/**",
      "coverage/**",
      "node_modules/**",
      ".venv/**",
      "vendor/**",
      "dsb/**",
      "tests/**",
      // 真机抓下来的站点证据（page-action.py capture），本机产物不进 lint
      "captures/**",
      // Trellis 生成的平台插件与脚本，升级会重生成 → 不进本仓库的 lint
      ".opencode/**",
      ".trellis/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.js", "**/*.mjs", "**/*.cjs", "**/*.ts", "**/*.tsx"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // src/ 是纯逻辑层，输出请走返回值或 logger；console 留给 entrypoints，
    // 浏览器控制台就是那里的调试通道。
    files: ["src/**/*.ts"],
    rules: {
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  {
    files: ["**/*.test.ts", "tests/**/*.ts", "scripts/**/*.mjs", "*.config.ts"],
    rules: {
      "no-console": "off",
    },
  },
  prettier,
];
