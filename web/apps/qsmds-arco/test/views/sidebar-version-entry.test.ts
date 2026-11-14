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
