import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'

export default [
  {
    ignores: [
      'node_modules/**',
      'server/public/**',
      'tray/**',
      'docs/**',
      'test-results/**',
      'playwright-report/**',
      'dev-data/**'
    ]
  },
  js.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node }
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-console': 'off',
      eqeqeq: ['error', 'smart']
    }
  },
  {
    files: ['web/**/*.js', 'web/**/*.vue'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser }
    }
  },
  {
    // Playwright 的 evaluate/waitForFunction 回调在浏览器上下文执行，需要 browser globals
    files: ['test/e2e/**/*.js'],
    languageOptions: {
      globals: { ...globals.browser }
    }
  },
  {
    files: ['web/**/*.vue'],
    rules: {
      'vue/multi-word-component-names': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-self-closing': 'off'
    }
  }
]
