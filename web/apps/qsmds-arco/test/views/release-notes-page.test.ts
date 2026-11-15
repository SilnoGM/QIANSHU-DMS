import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 版本更新日志页使用 Node.js 内置 runner 校验解析与源码契约。
import test from 'node:test'
import {
  collectVersionRoles,
  countVersionItems,
  normalizeReleaseNotesHistory,
  resolveSelectedVersion,
  summarizeVersionSections,
} from '../../src/views/release-notes/logic'

function readRelativeSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

test('历史清单只接受稳定版本并按版本号倒序', () => {
  const history = normalizeReleaseNotesHistory({
    versions: [
      { version: '1.2.0', sections: [{ title: '功能新增', items: [' 新功能 '] }] },
      { version: '1.10.0', sections: [{ title: '功能优化', items: ['更快'] }] },
      { version: '1.10.0', sections: [{ title: '功能优化', items: ['重复'] }] },
      { version: '2.0.0-rc.1', sections: [{ title: '功能新增', items: ['预发布'] }] },
      { version: '1.3.0', sections: [] },
      { version: 'bad', sections: [{ title: '功能新增', items: ['非法'] }] },
    ],
  })

  assert.deepEqual(history.map(entry => entry.version), ['1.10.0', '1.2.0'])
  assert.deepEqual(history[1].sections, [{ title: '功能新增', items: ['新功能'] }])
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

test('版本摘要保留早期自定义分类并汇总角色与条目数', () => {
  const sections = [
    { title: '功能新增', items: ['【运营人员】A', '【采运人员】B'] },
    { title: '对账', items: ['【财务人员】C'] },
    { title: '功能优化', items: ['【运营人员、系统管理员】D'] },
  ]
  assert.equal(summarizeVersionSections(sections), '新增 2 · 对账 1 · 优化 1')
  assert.deepEqual(collectVersionRoles(sections), ['运营人员', '财务人员', '采运人员', '系统管理员'])
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

  assert.match(nginxSource, /location = \/release-notes\.json \{/u)
  const block = nginxSource.slice(
    nginxSource.indexOf('location = /release-notes.json'),
    nginxSource.indexOf('location /assets/'),
  )
  assert.match(block, /etag off;/u)
  assert.match(block, /add_header Cache-Control "no-store" always;/u)
})
