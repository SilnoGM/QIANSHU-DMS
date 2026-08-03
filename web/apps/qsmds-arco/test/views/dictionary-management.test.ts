import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 页面骨架使用 Node.js 内置 runner 检查静态组合契约。
import test from 'node:test'

const pageSource = readFileSync(
  new URL(
    '../../src/views/system/basic-data/dictionaries/index.vue',
    import.meta.url,
  ),
  'utf8',
)

test('字典管理只使用一层 Fa 页面容器与非对称主从骨架', () => {
  assert.equal(pageSource.match(/<FaPageHeader\b/gu)?.length, 1)
  assert.equal(pageSource.match(/<FaPageMain\b/gu)?.length, 1)
  assert.match(pageSource, /md:grid-cols-\[18rem_minmax\(0,1fr\)\]/u)
  assert.match(pageSource, /Noto Sans SC|qs-type-/u)
  assert.doesNotMatch(pageSource, /(?:violet|purple|indigo|fuchsia)/iu)
  assert.doesNotMatch(pageSource, /\p{Extended_Pictographic}/gu)
  assert.match(pageSource, /<ul[^>]*aria-label="字典类型"/u)
  assert.doesNotMatch(pageSource, /<button[^>]+role="listitem"/u)
})

test('页面读取权限与身份 epoch 共同形成受保护数据边界', () => {
  assert.match(pageSource, /auth\('dictionaries:read'\)/u)
  assert.match(
    pageSource,
    /watch\(\s*\[\(\) => appAccountStore\.authEpoch, canRead\]/u,
  )
  assert.match(pageSource, /resolveDictionaryAccessTransition/u)
  assert.match(pageSource, /shouldAbortQueries/u)
  assert.match(pageSource, /shouldClearProtectedData/u)
  assert.match(pageSource, /shouldCloseOverlays/u)
})

test('Type 与 Item 使用独立 AbortController 和单调 request version', () => {
  for (const prefix of ['type', 'item']) {
    assert.match(pageSource, new RegExp(`let ${prefix}AbortController`, 'u'))
    assert.match(pageSource, new RegExp(`let ${prefix}RequestVersion`, 'u'))
    assert.match(pageSource, new RegExp(`${prefix}AbortController\\?\\.abort\\(\\)`, 'u'))
  }
  assert.match(pageSource, /canApplyDictionaryQueryResponse/u)
  assert.match(pageSource, /canApplyDictionaryItemResponse/u)
  assert.match(pageSource, /isDictionaryAbortError/u)
  assert.match(pageSource, /dictionariesApi\.types\.list\(/u)
  assert.match(pageSource, /dictionariesApi\.items\.list\(/u)
  assert.match(pageSource, /onBeforeUnmount/u)
})

test('切换 Type 先作废旧 Item 请求且选择只保存在页面本地状态', () => {
  assert.match(
    pageSource,
    /function selectDictionaryType[\s\S]{0,500}abortItemQuery\(\)[\s\S]{0,300}createDictionarySelection/u,
  )
  assert.doesNotMatch(pageSource, /\?code=/u)
  assert.doesNotMatch(pageSource, /route\.query|router\.(?:push|replace)/u)
})

test('撤权与身份切换会清空受保护数据并关闭真实底部 Drawer', () => {
  assert.match(pageSource, /function clearProtectedData/u)
  assert.match(pageSource, /dictionaryTypes\.value = \[\]/u)
  assert.match(pageSource, /dictionaryItems\.value = \[\]/u)
  assert.match(pageSource, /typeDrawerOpen\.value = false/u)
  assert.match(pageSource, /<QsGenericDrawer\b/u)
  assert.match(pageSource, /v-model="typeDrawerOpen"/u)
  assert.match(pageSource, /placement="bottom"/u)
})

test('页面骨架不越界实现后续表单、公共选择器或 QsGenericTable', () => {
  assert.doesNotMatch(pageSource, /DictionaryTypeFormModal/u)
  assert.doesNotMatch(pageSource, /DictionaryItemFormModal/u)
  assert.doesNotMatch(pageSource, /DictionaryStatusChangeModal/u)
  assert.doesNotMatch(pageSource, /QsDictionarySelect/u)
  assert.doesNotMatch(pageSource, /<QsGenericTable\b/u)
})
