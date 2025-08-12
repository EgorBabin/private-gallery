import js from '@eslint/js';
import globals from 'globals';
import { defineConfig } from 'eslint/config';
import prettierPlugin from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';

export default defineConfig([
    {
        files: ['**/*.{js,mjs,cjs}'],
        plugins: {
            js,
            prettier: prettierPlugin,
        },
        extends: ['js/recommended', prettierConfig],
        rules: {
            ...prettierPlugin.configs.recommended.rules,
            // 'no-console': 'warn', // // for local use
            eqeqeq: 'warn',
            curly: 'warn',
            'no-else-return': 'warn',
        },
        languageOptions: { globals: globals.node },
    },
]);
