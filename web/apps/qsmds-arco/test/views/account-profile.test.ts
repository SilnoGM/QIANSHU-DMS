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
    'FaButton',
    'FaForm',
    'FaFormItem',
    'FaInput',
    'QsGenericModal',
  ]) {
    assert.match(source, new RegExp(`<${component}\\b`, 'u'))
  }
  assert.match(source, /<QsAvatarUploader\b/u)
  assert.match(
    source,
    /import QsGenericModal from '@\/components\/business\/QsGenericModal\/index\.vue'/u,
  )
  assert.match(
    source,
    /import QsAvatarUploader from '@\/components\/business\/QsAvatarUploader\/index\.vue'/u,
  )
  assert.match(source, /<QsGenericModal[\s\S]+?size="lg"/u)
  assert.match(source, /:submitting="submitting"/u)
  assert.doesNotMatch(source, /<FaModal\b/u)
  assert.doesNotMatch(source, /<A[A-Z][A-Za-z0-9]*\b/u)
  assert.doesNotMatch(
    source,
    /(?:#[\dA-Fa-f]{3,8}\b|rgba?\(\s*[\d.]+|hsla?\(\s*[\d.]+)/u,
  )
  assert.match(source, /(?:bg|text|border)-(?:background|foreground|card|muted|primary|secondary|accent|destructive|border)/u)
  assert.match(source, /grid-cols-1/u)
  assert.match(source, /md:grid-cols-\[160px_minmax\(0,1fr\)\]/u)
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
  assert.match(source, /model\.issuerPrefix/u)
  assert.doesNotMatch(source, /\bremark\b/u)
  assert.doesNotMatch(source, /emailNormalized/u)
  assert.match(
    source,
    /appAccountStore\.loadProfile\(\{\s*force:\s*true\s*\}\)/u,
  )
  assert.match(source, /appAccountStore\.updateProfile/u)
  assert.match(
    source,
    /validateCurrentUserProfileFields\(model,\s*\{[\s\S]*?t\('accountProfile\.validation\./u,
  )
  assert.match(source, /requireChinaMainland:\s*true/u)
  assert.match(source, /preserveUnsupportedMobile:\s*mobileUnsupported\.value/u)

  assert.match(source, /v-model="model\.email"/u)
  assert.match(source, /@clear="model\.email = ''"/u)
  assert.match(source, /:model-value="mobileNational"/u)
  assert.match(source, /:auto-bind="false"/u)
  assert.match(source, /@update:model-value="handleMobileInput"/u)
  assert.match(source, /@clear="clearMobile"/u)
  assert.match(source, /<template #start>[\s\S]*?\+86/u)
  assert.doesNotMatch(source, /name="avatarUrl"/u)
  assert.match(source, /v-model="model\.avatarUrl"/u)
  assert.match(source, /v-model:uploading="avatarUploading"/u)
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

test('顶栏身份胶囊与菜单身份块按空间互补显示', () => {
  const buttonSource = readRelativeSource(
    '../../src/components/AppAccountButton/index.vue',
  )
  const headerSource = readRelativeSource(
    '../../src/layouts/components/Header/index.vue',
  )

  assert.match(buttonSource, /identity\?: boolean/u)
  assert.match(buttonSource, /showMenuIdentity\?: boolean/u)
  assert.match(buttonSource, /v-if="showMenuIdentity" #header/u)
  assert.match(buttonSource, /v-if="identity"[\s\S]*?accountDisplayName/u)
  assert.match(headerSource, /useMediaQuery\('\(max-width: 1365px\)'\)/u)
  assert.match(headerSource, /:identity="!compactAccount"/u)
  assert.match(headerSource, /:show-menu-identity="compactAccount"/u)
})

test('账户头像缺失时统一使用用户图标，不再生成文字头像', () => {
  const profileSource = readRelativeSource(
    '../../src/components/AppAccountButton/profile.vue',
  )
  const buttonSource = readRelativeSource(
    '../../src/components/AppAccountButton/index.vue',
  )

  assert.doesNotMatch(profileSource, /fallbackText|\.slice\(0,\s*2\)/u)
  assert.match(buttonSource, /<FaIcon name="i-carbon:user-avatar-filled"/u)
  assert.doesNotMatch(buttonSource, /:fallback="appAccountStore\.account"/u)
  assert.doesNotMatch(buttonSource, /\.slice\(0,\s*2\)/u)
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

test('头像上传复用 FaImageUpload，压缩后再走 profile 上传接口', () => {
  const source = readRelativeSource(
    '../../src/components/business/QsAvatarUploader/index.vue',
  )

  for (const token of [
    'FaImageUpload',
    'FaAvatar',
    'compressAvatarFile',
    'validateUploadImage',
    'profileApi.uploadAvatar',
    'avatarRetry',
    'avatarRemove',
    'avatarFormatHint',
  ]) {
    assert.match(source, new RegExp(token, 'u'))
  }
  assert.match(source, /layout === 'stacked'/u)
  assert.doesNotMatch(source, /\.exec\(/u)
})

test('locale 提供大陆手机号与头像上传文案', () => {
  for (const language of ['zh-cn', 'zh-tw', 'en']) {
    const source = readRelativeSource(
      `../../src/locales/lang/account-profile/${language}.json`,
    )
    const locale = JSON.parse(source) as {
      accountProfile: Record<string, unknown>
    }
    for (const key of [
      'mobile',
      'mobileHint',
      'mobileUnsupportedHint',
      'issuerPrefix',
      'issuerPrefixHint',
      'avatarUploadHint',
      'avatarFormatHint',
      'avatarRetry',
    ]) {
      assert.equal(
        typeof locale.accountProfile[key],
        'string',
        `${language}.${key}`,
      )
    }
    const validation = locale.accountProfile.validation as Record<string, unknown>
    for (const key of [
      'mobileLengthInvalid',
      'mobileSegmentInvalid',
      'mobileDigitsInvalid',
      'mobileForeignInvalid',
      'issuerPrefixInvalid',
    ]) {
      assert.equal(
        typeof validation[key],
        'string',
        `${language}.validation.${key}`,
      )
    }
  }
})
