import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// eslint-disable-next-line test/no-import-node-test -- 校验构建期 Release 文案解析与缺失降级。
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  compareReleaseVersions,
  loadReleaseManifest,
  loadReleaseNotesHistory,
  parseReleaseNotes,
  parseReleaseNotesHistory,
} from '../../vite/release-manifest'

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

test('历史清单容错解析早期自定义分类并跳过角色头行', () => {
  const source = `本版影响角色：财务人员

对账
- 对账流程做成完整闭环
- 无

账单管理
- 账单列表可以直接开始对账
`
  assert.deepEqual(parseReleaseNotesHistory(source), [
    { title: '对账', items: ['对账流程做成完整闭环'] },
    { title: '账单管理', items: ['账单列表可以直接开始对账'] },
  ])
  // 严格解析只认四个固定分类，早期文案会被整段丢弃。
  assert.deepEqual(parseReleaseNotes(source), [])
})

test('历史清单按版本号倒序并过滤非法文件名与空版本', () => {
  const directory = mkdtempSync(join(tmpdir(), 'qsmds-release-notes-'))
  try {
    writeFileSync(join(directory, 'v1.2.0.md'), '功能新增\n- 新功能\n')
    writeFileSync(join(directory, 'v1.10.0.md'), '功能优化\n- 更快\n')
    writeFileSync(join(directory, 'v1.9.0.md'), '功能优化\n- 更稳\n')
    writeFileSync(join(directory, 'v2.0.0-rc.1.md'), '功能新增\n- 预发布\n')
    writeFileSync(join(directory, 'notes.md'), '功能新增\n- 干扰\n')
    writeFileSync(join(directory, 'v1.0.0.md'), '功能新增\n- 无\n')

    const history = loadReleaseNotesHistory({ notesDirectory: directory })
    assert.deepEqual(history.map(entry => entry.version), ['1.10.0', '1.9.0', '1.2.0'])
    assert.equal(compareReleaseVersions('1.10.0', '1.9.0'), 1)
    assert.equal(compareReleaseVersions('1.1.0', '1.1.0'), 0)
  }
  finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('仓库内全部版本文案都能生成历史清单且覆盖早期版本', () => {
  const notesDirectory = fileURLToPath(new URL('../../../../../release/notes', import.meta.url))
  const history = loadReleaseNotesHistory({ notesDirectory })
  assert.ok(history.length >= 40, '历史清单应覆盖全部正式版本文案')
  for (let index = 0; index < history.length - 1; index += 1) {
    assert.ok(
      compareReleaseVersions(history[index].version, history[index + 1].version) > 0,
      `版本顺序必须严格倒序：${history[index].version} / ${history[index + 1].version}`,
    )
  }
  assert.ok(history.some(entry => entry.version === '1.6.5' && entry.sections.length > 0))
  // v0.4.0 使用的分类名不是四个固定分类，容错解析必须保留它。
  assert.equal(history.find(entry => entry.version === '0.4.0')?.sections[0]?.title, '问题修复')
  assert.ok(history.every(entry => entry.sections.every(section => section.items.length > 0)))
})
