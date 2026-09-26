import antfu from '@antfu/eslint-config'
import vueI18n from '@intlify/eslint-plugin-vue-i18n'

export default antfu(
  {
    vue: true,
    unocss: true,
    markdown: false,
    ignores: [
      '**/public',
      '**/dist*',
      'apps/qsmds-arco/src/api/generated/**',
      // Mimosa 插件会把会话 hook 状态写进当前工作目录下的 .mimosa，它不是项目源码；
      // 未忽略时 apps/qsmds-arco 下会出现大量 jsonc 格式错误并让 lint 整体失败。
      // 忽略口径与根 .gitignore 的 .mimosa/ 保持一致。
      '**/.mimosa/**',
    ],
  },
  {
    rules: {
      'e18e/prefer-static-regex': 'off',
      'eslint-comments/no-unlimited-disable': 'off',
      'curly': ['error', 'all'],
      'ts/no-unused-expressions': ['error', {
        allowShortCircuit: true,
        allowTernary: true,
      }],
    },
  },
  {
    files: [
      'apps/qsmds-arco/**/*.vue',
      'examples/*/**/*.vue',
      'packages/**/*.vue',
    ],
    rules: {
      'vue/block-order': ['error', {
        order: ['i18n', 'script', 'template', 'style'],
      }],
    },
  },
  {
    files: [
      'pnpm-workspace.yaml',
    ],
    rules: {
      'pnpm/yaml-enforce-settings': 'off',
    },
  },
  ...vueI18n.configs['flat/recommended'],
  {
    rules: {
      '@intlify/vue-i18n/no-raw-text': 'off',
    },
    settings: {
      'vue-i18n': {
        localeDir: [
          'packages/locales/lang/**/*.{json,json5,yaml,yml}',
          'apps/*/src/locales/lang/**/*.{json,json5,yaml,yml}',
          'examples/*/src/locales/lang/**/*.{json,json5,yaml,yml}',
        ],
        messageSyntaxVersion: '^11.0.0',
      },
    },
  },
)
