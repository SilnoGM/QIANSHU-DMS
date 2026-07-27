import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 页面复用边界使用 Node.js 内置 runner。
import test from 'node:test'

function readRelativeSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

test('应用配置弹窗和独立页面复用同一个配置面板', () => {
  const modalSource = readRelativeSource(
    '../../src/layouts/components/AppSetting/index.vue',
  )
  const actionsSource = readRelativeSource(
    '../../src/components/business/AppSettingsPanel/AppSettingsActions.vue',
  )
  const panelSource = readRelativeSource(
    '../../src/components/business/AppSettingsPanel/index.vue',
  )
  const pageSource = readRelativeSource(
    '../../src/views/system/application-settings/index.vue',
  )

  assert.match(modalSource, /<FaModal/u)
  assert.match(modalSource, /<AppSettingsPanel[\s\S]*?:active="isShow"[\s\S]*?:mode="mode"/u)
  assert.match(modalSource, /<AppSettingsActions :mode="mode"/u)
  assert.match(modalSource, /global-app-setting-toggle/u)
  assert.doesNotMatch(panelSource, /<FaModal|global-app-setting-toggle/u)

  assert.match(pageSource, /name: 'SystemApplicationSettings'/u)
  assert.match(pageSource, /<FaPageHeader/u)
  assert.match(pageSource, /<AppSettingsPanel[\s\S]*?active[\s\S]*?mode="settings"/u)
  assert.match(pageSource, /<AppSettingsActions mode="settings"/u)
  assert.doesNotMatch(pageSource, /import\.meta\.env|VITE_APP_SETTING/u)
  assert.doesNotMatch(actionsSource, /import\.meta\.env|VITE_APP_SETTING/u)
})

test('共享配置面板保留临时配置、复制配置和多实例会话契约', () => {
  const actionsSource = readRelativeSource(
    '../../src/components/business/AppSettingsPanel/AppSettingsActions.vue',
  )
  const panelSource = readRelativeSource(
    '../../src/components/business/AppSettingsPanel/index.vue',
  )
  const layoutSource = readRelativeSource('../../src/layouts/index.vue')

  assert.match(actionsSource, /diffTwoObj\(settingsDefault, appSettingsStore\.settings\)/u)
  assert.match(actionsSource, /src\/settings\.ts/u)
  assert.match(actionsSource, /app\.layouts\.appSetting\.warning/u)
  assert.match(actionsSource, /app\.layouts\.appSetting\.copy/u)
  assert.match(panelSource, /activeSettingsPanels/u)
  assert.match(panelSource, /immediateUpdate: activeSettingsPanels\.size === 0/u)

  assert.match(layoutSource, /const enableAppSetting = import\.meta\.env\.VITE_APP_SETTING/u)
  assert.match(layoutSource, /v-if="enableAppSetting"[\s\S]*?global-app-setting-toggle/u)
  assert.match(layoutSource, /<AppSetting \/>/u)
})
