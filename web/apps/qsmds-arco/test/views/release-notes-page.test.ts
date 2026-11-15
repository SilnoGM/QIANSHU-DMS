import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 版本更新日志页使用 Node.js 内置 runner 校验解析与源码契约。
import test from 'node:test'
import {
  countVersionItems,
  normalizeReleaseNotesHistory,
  resolveSelectedVersion,
} from '../../src/views/release-notes/logic'

function readRelativeSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

test('历史清单只接受稳定版本并按版本号倒序', () => {
  const history = normalizeReleaseNotesHistory({
    versions: [
      { version: '1.2.0', sections: [{ title: '功能新增', items: [' 新功能 '] }], releasedAt: '2026-11-10' },
      { version: '1.10.0', sections: [{ title: '功能优化', items: ['更快'] }], releasedAt: 'bad-date' },
      { version: '1.10.0', sections: [{ title: '功能优化', items: ['重复'] }] },
      { version: '2.0.0-rc.1', sections: [{ title: '功能新增', items: ['预发布'] }] },
      { version: '1.3.0', sections: [] },
      { version: 'bad', sections: [{ title: '功能新增', items: ['非法'] }] },
    ],
  })

  assert.deepEqual(history.map(entry => entry.version), ['1.10.0', '1.2.0'])
  assert.deepEqual(history[1].sections, [{ title: '功能新增', items: ['新功能'] }])
  assert.equal(history[1].releasedAt, '2026-11-10')
  // 非法日期只丢弃日期，不能连版本一起丢。
  assert.equal(history[0].releasedAt, undefined)
  assert.deepEqual(normalizeReleaseNotesHistory(null), [])
  assert.deepEqual(normalizeReleaseNotesHistory({ versions: 'bad' }), [])
})

test('深链版本缺失时退回最新版本并接受 v 前缀', () => {
  const versions = normalizeReleaseNotesHistory({
    versions: [
      { version: '1.2.0', sections: [{ title: '功能新增', items: ['A'] }] },
      { version: '1.1.0', sections: [{ title: '功能新增', items: ['B'] }] },
    ],
  })
  assert.equal(resolveSelectedVersion(versions, '1.1.0'), '1.1.0')
  assert.equal(resolveSelectedVersion(versions, 'v1.2.0'), '1.2.0')
  assert.equal(resolveSelectedVersion(versions, '9.9.9'), '1.2.0')
  assert.equal(resolveSelectedVersion(versions, null), '1.2.0')
  assert.equal(resolveSelectedVersion([], '1.0.0'), null)
})

test('版本条目数用于详情摘要', () => {
  const sections = [
    { title: '功能新增', items: ['【运营人员】A', '【采运人员】B'] },
    { title: '对账', items: ['【财务人员】C'] },
    { title: '功能优化', items: ['【运营人员、系统管理员】D'] },
  ]
  assert.equal(countVersionItems(sections), 4)
})

test('版本更新日志在面包屑里显示页面标题而不是只剩主页', () => {
  const routeSource = readRelativeSource('../../src/router/modules/release.notes.ts')
  assert.match(routeSource, /title: '版本更新日志'/u)
  assert.match(routeSource, /menu: false/u)
  // breadcrumb: false 会让匹配链被跳过，面包屑只剩首页项；页面必须作为最后一级显示。
  assert.doesNotMatch(routeSource, /breadcrumb: false/u)
})

test('页面采用主从阅读布局并支持深链切换版本', () => {
  const pageSource = readRelativeSource('../../src/views/release-notes/index.vue')
  const logicSource = readRelativeSource('../../src/views/release-notes/logic.ts')

  assert.match(pageSource, /<FaPageHeader/u)
  assert.match(pageSource, /title="版本更新日志"/u)
  assert.match(pageSource, /<QsReleaseNotesContent :sections="selectedEntry\.sections" \/>/u)
  assert.match(pageSource, /aria-label="版本列表"/u)
  assert.match(pageSource, /<FaSelect/u)
  assert.match(pageSource, /route\.query\.version/u)
  assert.match(pageSource, /router\.replace\(\{ query: \{ \.\.\.route\.query, version: value \} \}\)/u)
  assert.match(pageSource, /data-testid="release-notes-detail"/u)
  assert.match(pageSource, /data-testid="release-notes-error"/u)
  assert.match(pageSource, /<FaEmpty/u)
  // 左栏日期行只显示浅灰日期，不再重复「发布时间」四个字。
  assert.match(pageSource, /row\.releasedAt/u)
  assert.doesNotMatch(pageSource, /发布时间/u)
  assert.match(pageSource, /row\.releasedAt === null \? row\.label : `\$\{row\.label\} · \$\{row\.releasedAt\}`/u)
  assert.match(pageSource, /selectedMeta/u)
  // 选中态是整行块状浅绿背景；静态样式不能再带 bg-transparent 覆盖它。
  assert.match(pageSource, /bg-primary\/10 text-primary/u)
  assert.doesNotMatch(pageSource, /bg-transparent/u)
  // 左侧列表带轻量时间轴：贯穿的细线加每行圆点，选中为实心绿点、未选中为空心灰点。
  assert.match(pageSource, /w-px/u)
  assert.match(pageSource, /bg-border/u)
  assert.match(pageSource, /rounded-full/u)
  assert.match(pageSource, /bg-primary border-primary/u)
  assert.match(pageSource, /bg-background border-border/u)
  // 滚动容器留出底部空隙，最后一项的日期不会被圆角切断；同时收紧左栏宽度。
  assert.match(pageSource, /pb-4/u)
  assert.match(pageSource, /lg:w-\[188px\]/u)
  // 最新版本在版本号后展示「最新版本」标签。
  assert.match(pageSource, /row\.version === latestVersion/u)
  assert.match(pageSource, />\s*最新版本\s*</u)
  // 左栏只保留版本号与时间，不再重复分类计数和适用角色。
  assert.doesNotMatch(pageSource, /row\.summary|row\.roles/u)
  // 页面吃满视口剩余高度：FaPageMain 作为内滚容器，左右两栏各自滚动。
  assert.match(pageSource, /class="release-notes-page flex flex-col min-h-0"/u)
  assert.match(pageSource, /height: calc\(/u)
  assert.match(pageSource, /100dvh/u)
  assert.match(pageSource, /var\(--g-header-actual-height/u)
  assert.match(pageSource, /var\(--g-topbar-actual-height/u)
  assert.match(pageSource, /<FaPageMain class="mt-0 flex-1 min-h-0" main-class="flex flex-col flex-1 min-h-0 h-auto">/u)
  assert.ok(
    (pageSource.match(/overflow-y-auto/gu) ?? []).length >= 2,
    '左栏版本列表与右侧详情内容都必须独立滚动',
  )
  // 左右两处滚动容器都隐藏滚动条，且不再用视口百分比限制高度。
  assert.ok(
    (pageSource.match(/\[scrollbar-width:none\]/gu) ?? []).length >= 2,
    '左右两处滚动容器都必须隐藏滚动条',
  )
  assert.ok(
    (pageSource.match(/\[&::-webkit-scrollbar\]:hidden/gu) ?? []).length >= 2,
    '左右两处滚动容器都必须隐藏 WebKit 滚动条',
  )
  assert.doesNotMatch(pageSource, /max-h-\[70vh\]/u)

  assert.match(logicSource, /RELEASE_NOTES_HISTORY_PATH = 'release-notes\.json'/u)
  assert.match(logicSource, /cache: 'no-store'/u)
})

test('构建产物与 nginx 都为历史清单提供 no-store 稳定路径', () => {
  const pluginSource = readRelativeSource('../../vite/release-manifest.ts')
  const nginxSource = readRelativeSource('../../../../../deploy/docker/nginx/qianshu-dms.conf')

  assert.match(pluginSource, /RELEASE_NOTES_HISTORY_FILE_NAME = 'release-notes\.json'/u)
  assert.match(pluginSource, /fileName: RELEASE_NOTES_HISTORY_FILE_NAME/u)
  assert.match(pluginSource, /configureServer/u)
  assert.match(pluginSource, /response\.setHeader\('Cache-Control', 'no-store'\)/u)
  // 发布日期来自本仓库 Tag；构建环境没有 Git 元数据时只省略日期。
  assert.match(pluginSource, /creatordate:short/u)
  assert.match(pluginSource, /loadReleaseDates/u)

  assert.match(nginxSource, /location = \/release-notes\.json \{/u)
  const block = nginxSource.slice(
    nginxSource.indexOf('location = /release-notes.json'),
    nginxSource.indexOf('location /assets/'),
  )
  assert.match(block, /etag off;/u)
  assert.match(block, /add_header Cache-Control "no-store" always;/u)
})
