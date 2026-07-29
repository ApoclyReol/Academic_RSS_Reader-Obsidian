import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig(
  globalIgnores([
    "node_modules",
    "build",
    "main.js",
    "scripts/*.mjs",
    "esbuild.config.mjs",
    "version-bump.mjs",
    "versions.json",
  ]),
  {
    languageOptions: {
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.mts", "manifest.json"],
        },
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: [".json"],
      },
    },
  },
  ...obsidianmd.configs.recommended,
  {
    files: ["src/settings/rss-reader-setting-tab.ts"],
    rules: {
      // Keep PluginSettingTab.display() while minAppVersion supports Obsidian <1.13.
      "@typescript-eslint/no-deprecated": "off",
      "obsidianmd/settings-tab/prefer-setting-definitions": "off",
    },
  },
  {
    files: ["tests/dom-ui.test.ts"],
    rules: {
      "obsidianmd/prefer-create-el": "off",
    },
  },
);
