import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 校验构建期 Release 文案解析与缺失降级。
import test from 'node:test'
import { loadReleaseManifest, parseReleaseNotes } from '../../vite/release-manifest'

const SAMPLE = `本版影响角色：运营人员

功能新增
- 【运营人员】新增销售筛选
- 无

功能优化
- 【运营人员、财务人员】列表加载更快

缺陷修复
- 无

已知问题
- 【采运人员】旧图片需要重新生成
`

test('按四个分类解析 Release 文案并保留角色前缀', () => {
  assert.deepEqual(parseReleaseNotes(SAMPLE), [
    { title: '功能新增', items: ['【运营人员】新增销售筛选'] },
    { title: '功能优化', items: ['【运营人员、财务人员】列表加载更快'] },
    { title: '已知问题', items: ['【采运人员】旧图片需要重新生成'] },
  ])
})

test('文案缺失时降级为空分类而不是构建失败', () => {
  const warnings: string[] = []
  const manifest = loadReleaseManifest({
    version: '9.9.9',
    notesDirectory: '/definitely-not-a-release-notes-directory',
    warn: message => warnings.push(message),
  })
  assert.deepEqual(manifest, { version: '9.9.9', sections: [] })
  assert.deepEqual(warnings, ['Release notes not found: v9.9.9.md'])
})
