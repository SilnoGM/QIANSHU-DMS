import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 校验更新检测的版本比较与清单清洗。
import test from 'node:test'
import { isNewerVersion, normalizeReleaseManifest } from '../../src/components/AppCheckUpdates/logic'

test('只有严格更高的稳定版本才视为更新', () => {
  assert.equal(isNewerVersion('1.2.0', '1.1.9'), true)
  assert.equal(isNewerVersion('1.10.0', '1.9.9'), true)
  assert.equal(isNewerVersion('1.1.1', '1.1.1'), false)
  assert.equal(isNewerVersion('1.1.0', '1.1.1'), false)
  assert.equal(isNewerVersion('1.1.1-preview', '1.1.0'), false)
  assert.equal(isNewerVersion('', '1.1.0'), false)
})

test('发布清单只接受稳定版本与文本条目', () => {
  assert.deepEqual(normalizeReleaseManifest({
    version: '1.2.0',
    sections: [
      { title: '功能新增', items: ['【运营人员】新增筛选'] },
      { title: '空分类', items: ['  ', 1] },
    ],
  }), {
    version: '1.2.0',
    sections: [{ title: '功能新增', items: ['【运营人员】新增筛选'] }],
  })
  assert.equal(normalizeReleaseManifest({ version: '1.2.0-preview', sections: [] }), null)
  assert.equal(normalizeReleaseManifest({ version: '1.2.0', sections: 'bad' }), null)
  assert.equal(normalizeReleaseManifest(null), null)
})
