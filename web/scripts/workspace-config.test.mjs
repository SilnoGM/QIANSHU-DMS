import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
// eslint-disable-next-line test/no-import-node-test -- 此脚本由 Node.js 内置 test runner 直接运行。
import test from 'node:test'
import { pathToFileURL } from 'node:url'

const webRoot = path.resolve(import.meta.dirname, '..')

async function loadDefaultExport(relativePath) {
  const moduleUrl = pathToFileURL(path.join(webRoot, relativePath)).href
  const loadedModule = await import(moduleUrl)
  return await loadedModule.default
}

test('ESLint 的 Vue 规则覆盖业务应用、参考应用和公共包', async () => {
  const configs = await loadDefaultExport('eslint.config.js')
  const blockOrderConfig = configs.find((config) => {
    const rule = config.rules?.['vue/block-order']
    return Array.isArray(rule) && rule[1]?.order?.[0] === 'i18n'
  })

  assert.ok(blockOrderConfig, '缺少 vue/block-order 配置')
  assert.deepEqual(blockOrderConfig.files, [
    'apps/qsmds-arco/**/*.vue',
    'examples/*/**/*.vue',
    'packages/**/*.vue',
  ])
})

test('ESLint i18n 路径同时覆盖 apps 和 examples 且不引用 docs', async () => {
  const configs = await loadDefaultExport('eslint.config.js')
  const i18nConfig = configs.find(config => config.settings?.['vue-i18n'])

  assert.ok(i18nConfig, '缺少 vue-i18n settings')
  assert.deepEqual(i18nConfig.settings['vue-i18n'].localeDir, [
    'packages/locales/lang/**/*.{json,json5,yaml,yml}',
    'apps/*/src/locales/lang/**/*.{json,json5,yaml,yml}',
    'examples/*/src/locales/lang/**/*.{json,json5,yaml,yml}',
  ])
  assert.equal(fs.readFileSync(path.join(webRoot, 'eslint.config.js'), 'utf8').includes('docs/'), false)
})

test('Stylelint 忽略业务、参考和公共包生成物且不引用 docs', async () => {
  const config = await loadDefaultExport('stylelint.config.js')

  assert.deepEqual(config.ignoreFiles, [
    'node_modules/**/*',
    'apps/*/dist*/**/*',
    'examples/*/dist*/**/*',
    'packages/*/dist*/**/*',
    'apps/*/src/assets/fonts/**/*',
    'examples/*/src/assets/fonts/**/*',
    'apps/*/public/tinymce/**/*',
    'examples/*/public/tinymce/**/*',
  ])
  assert.equal(JSON.stringify(config).includes('docs/'), false)
})
