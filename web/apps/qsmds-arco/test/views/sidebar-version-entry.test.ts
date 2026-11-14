import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 侧边栏版本入口使用 Node.js 内置 runner 校验源码契约。
import test from 'node:test'

function readRelativeSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

test('侧边栏版本入口以卡片整体链接到版本更新日志', () => {
  const entrySource = readRelativeSource('../../src/components/AppVersionEntry/index.vue')
  const subSidebarSource = readRelativeSource('../../src/layouts/components/SubSidebar/index.vue')

  assert.match(entrySource, /__SYSTEM_INFO__\.pkg\.version/u)
  assert.match(entrySource, /:to="\{ name: 'releaseNotes' \}"/u)
  assert.match(entrySource, /font-qs-data-mono/u)
  assert.match(entrySource, /v\{\{ version \}\}/u)
  // 浅色卡片：整块可点击、悬停加深，右侧只保留轻量箭头而不重复「详情」二字。
  assert.match(entrySource, /rounded-md/u)
  assert.match(entrySource, /bg-primary\/10/u)
  assert.match(entrySource, /hover-bg-primary\/20/u)
  assert.match(entrySource, /h-\[34px\]/u)
  assert.match(entrySource, /i-lucide:chevron-right/u)
  assert.doesNotMatch(entrySource, /versionEntry\.details/u)
  // 信息层级：说明文字用中灰色，版本号用绿色加粗；折叠态只保留小树苗图标。
  assert.match(entrySource, /<span class="text-muted-foreground truncate">/u)
  assert.match(entrySource, /font-semibold/u)
  assert.match(entrySource, /v-if="!collapsed"/u)
  assert.match(entrySource, /'justify-center px-0': collapsed/u)

  // 版本卡片与底部固定按钮共用 px-4 外边距，左右边缘严格对齐。
  assert.match(entrySource, /<div class="px-4 pt-2">/u)
  assert.match(subSidebarSource, /class="px-4 py-3 flex items-center relative"/u)

  // 版本入口固定在菜单滚动区之外，并位于底部固定按钮之前。
  assert.ok(
    subSidebarSource.indexOf('<AppVersionEntry') > subSidebarSource.indexOf('</FaScrollArea>'),
    '版本入口必须在菜单滚动区之后',
  )
  assert.ok(
    subSidebarSource.indexOf('<AppVersionEntry') < subSidebarSource.indexOf('subMenuCollapseButton'),
    '版本入口必须位于底部固定按钮之前',
  )
  assert.match(subSidebarSource, /<AppVersionEntry :collapsed="isCollapse" \/>/u)
})

test('存在新版本时版本入口展示红色 New 标记', () => {
  const entrySource = readRelativeSource('../../src/components/AppVersionEntry/index.vue')
  const updateCheckSource = readRelativeSource('../../src/components/AppCheckUpdates/index.vue')
  const storeSource = readRelativeSource('../../src/store/modules/app/release-update.ts')

  // Store 只记录“远端更高版本”这一结论，默认没有更新。
  assert.match(storeSource, /defineStore\('appReleaseUpdate'/u)
  assert.match(storeSource, /const latestVersion = ref<string \| null>\(null\)/u)
  assert.match(storeSource, /const hasUpdate = computed\(\(\) => latestVersion\.value !== null\)/u)

  // 版本入口读取共享状态，并把 New 放在版本号之后。
  assert.match(entrySource, /useAppReleaseUpdateStore\(\)/u)
  assert.match(entrySource, /v-if="hasUpdate"/u)
  assert.match(entrySource, /bg-destructive\/10/u)
  assert.match(entrySource, /text-destructive/u)
  assert.match(entrySource, /v\{\{ version \}\}<\/span>[\s\S]{0,300}?>\s*New\s*</u)
  // 折叠态没有文字空间，用红点保留提示且可被读屏识别。
  assert.match(entrySource, /v-if="collapsed && hasUpdate"/u)
  assert.match(entrySource, /aria-label="New"/u)

  // 检测侧先标记再弹窗；网络失败不清标记，清单未更高时必须撤销，避免回滚后残留 New。
  assert.match(updateCheckSource, /releaseUpdateStore\.setLatestVersion\(release\.version\)/u)
  const fetchIndex = updateCheckSource.indexOf('const release = await fetchReleaseManifest()')
  const nullGuardIndex = updateCheckSource.indexOf('if (release === null)')
  const clearIndex = updateCheckSource.indexOf('releaseUpdateStore.setLatestVersion(null)')
  const markIndex = updateCheckSource.indexOf('releaseUpdateStore.setLatestVersion(release.version)')
  const modalIndex = updateCheckSource.indexOf('updateNoticeVisible.value = true')
  assert.ok(fetchIndex !== -1 && nullGuardIndex > fetchIndex, '拉取失败必须先返回，不清除已有标记')
  assert.ok(clearIndex > nullGuardIndex, '版本未更高时必须撤销标记')
  assert.ok(markIndex > clearIndex, '更高版本必须在分支内标记')
  assert.ok(modalIndex > markIndex, '标记必须早于弹窗，稍后提醒关闭后仍保留 New')
})

test('版本更新日志路由对所有登录用户开放且不进入菜单', () => {
  const routeSource = readRelativeSource('../../src/router/modules/release.notes.ts')
  const routesSource = readRelativeSource('../../src/router/routes.ts')
  const pageSource = readRelativeSource('../../src/views/release-notes/index.vue')

  assert.match(routeSource, /name: 'releaseNotes'/u)
  assert.match(routeSource, /menu: false/u)
  assert.doesNotMatch(routeSource, /auth:/u)

  assert.match(routesSource, /import ReleaseNotes from '\.\/modules\/release\.notes'/u)
  // 登记在登录后布局的常量子路由中，不依赖任何工作台权限分组。
  assert.match(routesSource, /NotificationCenter,\s*ReleaseNotes,/u)

  assert.match(pageSource, /<FaPageHeader/u)
  assert.match(pageSource, /版本更新日志/u)
})

test('版本入口文案在三种语言下齐全', () => {
  const localeKeys = ['currentVersion'] as const
  for (const locale of ['zh-cn', 'zh-tw', 'en']) {
    const localeSource = readRelativeSource(
      `../../../../packages/locales/lang/app/components/version-entry/${locale}.json`,
    )
    const messages = JSON.parse(localeSource) as {
      app: { components: { versionEntry: Record<string, string> } }
    }
    for (const key of localeKeys) {
      assert.equal(
        typeof messages.app.components.versionEntry[key],
        'string',
        `${locale} 缺少 ${key}`,
      )
    }
  }
})
