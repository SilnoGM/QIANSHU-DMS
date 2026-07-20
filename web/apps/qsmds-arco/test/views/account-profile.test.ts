import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 账户资料组件契约使用 Node.js 内置 runner。
import test from 'node:test'

function readRelativeSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

test('个人资料组件使用 Fantastic Admin 组件、语义 token 与响应式双区布局', () => {
  const source = readRelativeSource(
    '../../src/components/AppAccountButton/profile.vue',
  )

  for (const component of [
    'FaAlert',
    'FaAvatar',
    'FaButton',
    'FaForm',
    'FaFormItem',
    'FaInput',
    'FaModal',
  ]) {
    assert.match(source, new RegExp(`<${component}\\b`, 'u'))
  }
  assert.doesNotMatch(source, /<A[A-Z][A-Za-z0-9]*\b/u)
  assert.doesNotMatch(
    source,
    /(?:#[\dA-Fa-f]{3,8}\b|rgba?\(\s*[\d.]+|hsla?\(\s*[\d.]+)/u,
  )
  assert.match(source, /(?:bg|text|border)-(?:background|foreground|card|muted|primary|secondary|accent|destructive|border)/u)
  assert.match(source, /grid-cols-1/u)
  assert.match(source, /md:grid-cols-\[160px_minmax\(0,1fr\)\]/u)
  assert.match(source, /max-w-\[calc\(100%-1\.5rem\)\]/u)
  assert.match(source, /sm:max-w-\[720px\]/u)
  assert.doesNotMatch(source, /overflow-x-(?:auto|scroll)/u)
})

test('普通用户资料组件只展示本人公开字段，不出现内部资料字段', () => {
  const source = readRelativeSource(
    '../../src/components/AppAccountButton/profile.vue',
  )

  assert.match(source, /appAccountStore\.displayName/u)
  assert.match(source, /appAccountStore\.account/u)
  assert.match(source, /model\.email/u)
  assert.match(source, /model\.mobileE164/u)
  assert.match(source, /model\.avatarUrl/u)
  assert.doesNotMatch(source, /\bremark\b/u)
  assert.doesNotMatch(source, /emailNormalized/u)
  assert.match(source, /resolveAvatarPreviewUrl/u)
  assert.match(
    source,
    /appAccountStore\.loadProfile\(\{\s*force:\s*true\s*\}\)/u,
  )
  assert.match(source, /appAccountStore\.updateProfile/u)
  assert.match(
    source,
    /validateCurrentUserProfileFields\(model,\s*\{[\s\S]*?t\('accountProfile\.validation\./u,
  )

  for (const model of ['email', 'mobileE164', 'avatarUrl']) {
    assert.match(
      source,
      new RegExp(
        `<FaInput\\b(?=[^>]*\\bv-model="model\\.${model}")(?=[^>]*\\bclearable\\b)(?=[^>]*@clear="model\\.${model} = ''")([^>]*>)`,
        'u',
      ),
    )
  }
})

test('账户菜单通过根 App 管理唯一的个人资料 Modal 生命周期', () => {
  const buttonSource = readRelativeSource(
    '../../src/components/AppAccountButton/index.vue',
  )
  const appSource = readRelativeSource('../../src/App.vue')

  assert.match(buttonSource, /global-profile-visible/u)
  assert.match(buttonSource, /accountProfile\.menu/u)
  assert.match(appSource, /AppAccountProfile/u)
  assert.match(appSource, /eventBus\.on\('global-profile-visible'/u)
  assert.match(appSource, /eventBus\.off\('global-profile-visible'/u)
  assert.match(
    appSource,
    /if \(state !== 'authenticated'\) \{[\s\S]*?profileVisible\.value = false/u,
  )
})

test('个人资料文案由应用级 zh-cn、zh-tw、en locale 提供', () => {
  for (const language of ['zh-cn', 'zh-tw', 'en']) {
    const source = readRelativeSource(
      `../../src/locales/lang/account-profile/${language}.json`,
    )
    const locale = JSON.parse(source) as Record<string, unknown>
    assert.equal(typeof locale.accountProfile, 'object')
  }
})
