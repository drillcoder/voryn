import path from "node:path";
import { fileURLToPath } from "node:url";
import importNewlinesPlugin from "eslint-plugin-import-newlines";
import nPlugin from "eslint-plugin-n";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
    {
        ignores: ["dist/**", "node_modules/**", "coverage/**", "examples/**"],
    },
    {
        extends: [
            ...tseslint.configs.strictTypeChecked,
            ...tseslint.configs.stylisticTypeChecked,
        ],
    },
    {
        ...tseslint.configs.disableTypeChecked,
        files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
    },
    nPlugin.configs["flat/recommended-module"],
    {
        files: ["src/**/*.ts", "test/**/*.ts", "dev/**/*.ts"],
        plugins: {
            "import-newlines": importNewlinesPlugin,
        },
        languageOptions: {
            parserOptions: {
                project: ["./tsconfig.eslint.json"],
                tsconfigRootDir: path.dirname(fileURLToPath(import.meta.url)),
            },
        },
        rules: {
            "@typescript-eslint/consistent-type-imports": "error",
        },
    },
    eslintConfigPrettier,
    {
        files: ["src/**/*.ts", "test/**/*.ts"],
        rules: {
            "no-console": "error",
            "no-multiple-empty-lines": [
                "error",
                {
                    max: 1,
                    maxBOF: 0,
                    maxEOF: 1,
                },
            ],
            "max-len": [
                "error",
                {
                    code: 120,
                    tabWidth: 4,
                },
            ],
            "multiline-comment-style": ["error", "starred-block"],
            "no-param-reassign": [
                "error",
                {
                    props: true,
                },
            ],
            "@typescript-eslint/no-shadow": "error",
            "no-restricted-exports": [
                "error",
                {
                    restrictDefaultExports: {
                        direct: true,
                        named: true,
                        defaultFrom: true,
                        namedFrom: true,
                        namespaceFrom: true,
                    },
                },
            ],
            "import-newlines/enforce": [
                "error",
                {
                    "max-len": 120,
                },
            ],
        },
    },
    {
        files: ["test/**/*.ts"],
        rules: {
            "@typescript-eslint/require-await": "off",
            "@typescript-eslint/array-type": "off",
            "@typescript-eslint/no-unused-vars": "off",
        },
    }
);
