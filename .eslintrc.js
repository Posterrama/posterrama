module.exports = {
    env: {
        browser: true,
        commonjs: true,
        es6: true,
        es2017: true,
        es2020: true,
        es2021: true,
        es2022: true,
        node: true,
        jest: true,
    },
    extends: ['eslint:recommended', 'plugin:prettier/recommended'],
    parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        allowImportExportEverywhere: true,
    },
    rules: {
        'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
        'no-console': ['warn', { allow: ['warn', 'error'] }],
        'prefer-const': 'error',
    },
    globals: {
        logger: 'readonly',
        defaults: 'readonly',
        enableDebug: 'readonly',
        disableDebug: 'readonly',
    },
};
