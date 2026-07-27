import type { RegionCascaderOption } from '../../src/components/business/QsRegionSelector/logic'
import type {
  RegionSelectorNode,
  RegionSelectorPath,
} from '../../src/components/business/QsRegionSelector/types'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 组件纯逻辑使用 Node.js 内置 runner，避免引入浏览器测试依赖。
import test from 'node:test'

import {
  createRegionInteractiveTree,
  createRegionOptions,
  createRegionPathTree,
  createRegionRequestVersion,
  createRegionSearchTree,
  filterRegionOption,
  findRegionPathByCityId,
  formatRegionPathLabel,
  mergeRegionTrees,
  normalizeRegionSearchText,
  replaceRegionChildren,
  resolveRegionSelection,
  validateRegionChildren,
} from '../../src/components/business/QsRegionSelector/logic'

const IDS = {
  beijingCity: '00000000-0000-4000-8000-000000000113',
  beijingProvince: '00000000-0000-4000-8000-000000000112',
  china: '00000000-0000-4000-8000-000000000111',
  kaohsiung: '00000000-0000-4000-8000-000000000123',
  kualaLumpur: '00000000-0000-4000-8000-000000000133',
  malaysia: '00000000-0000-4000-8000-000000000131',
  taiwan: '00000000-0000-4000-8000-000000000121',
  taiwanProvince: '00000000-0000-4000-8000-000000000122',
  wilayahPersekutuan: '00000000-0000-4000-8000-000000000132',
} as const

function node<L extends RegionSelectorNode['level']>(
  value: {
    readonly id: string
    readonly parentId: string | null
    readonly level: L
    readonly name: string
    readonly englishName?: string | null
    readonly code: string
    readonly enabled?: boolean
    readonly effectiveEnabled?: boolean
    readonly hasChildren?: boolean
  },
): RegionSelectorNode<L> {
  return Object.freeze({
    englishName: null,
    enabled: true,
    effectiveEnabled: true,
    hasChildren: value.level !== 'CITY',
    ...value,
  })
}

const china = node({
  code: 'CN',
  englishName: 'China',
  id: IDS.china,
  level: 'COUNTRY_REGION',
  name: '中国',
  parentId: null,
})
const beijingProvince = node({
  code: 'CN-11',
  englishName: 'Beijing',
  id: IDS.beijingProvince,
  level: 'PROVINCE_STATE',
  name: '北京市',
  parentId: IDS.china,
})
const beijingCity = node({
  code: 'CN-110100',
  englishName: 'Beijing City',
  id: IDS.beijingCity,
  level: 'CITY',
  name: '北京市',
  parentId: IDS.beijingProvince,
})
const taiwan = node({
  code: 'TW',
  englishName: 'Taiwan, China',
  id: IDS.taiwan,
  level: 'COUNTRY_REGION',
  name: '中国台湾',
  parentId: null,
})
const taiwanProvince = node({
  code: 'TW-TW',
  englishName: 'Taiwan',
  id: IDS.taiwanProvince,
  level: 'PROVINCE_STATE',
  name: '台湾',
  parentId: IDS.taiwan,
})
const stoppedKaohsiung = node({
  code: 'TW-64000',
  effectiveEnabled: false,
  enabled: true,
  englishName: 'Kaohsiung City',
  id: IDS.kaohsiung,
  level: 'CITY',
  name: '高雄市',
  parentId: IDS.taiwanProvince,
})
const malaysia = node({
  code: 'MY',
  englishName: 'Malaysia',
  id: IDS.malaysia,
  level: 'COUNTRY_REGION',
  name: '马来西亚',
  parentId: null,
})
const wilayahPersekutuan = node({
  code: 'MY-14',
  englishName: 'Wilayah Persekutuan',
  id: IDS.wilayahPersekutuan,
  level: 'PROVINCE_STATE',
  name: '联邦直辖区',
  parentId: IDS.malaysia,
})
const kualaLumpur = node({
  code: 'MY-14-KUL',
  englishName: 'Kuala Lumpur',
  id: IDS.kualaLumpur,
  level: 'CITY',
  name: '吉隆坡',
  parentId: IDS.wilayahPersekutuan,
})

const beijingPath = Object.freeze([
  china,
  beijingProvince,
  beijingCity,
]) as RegionSelectorPath
const stoppedTaiwanPath = Object.freeze([
  taiwan,
  taiwanProvince,
  stoppedKaohsiung,
]) as RegionSelectorPath
const malaysiaPath = Object.freeze([
  malaysia,
  wilayahPersekutuan,
  kualaLumpur,
]) as RegionSelectorPath

function values(options: readonly RegionCascaderOption[]): string[] {
  return options.map(option => option.value)
}

test('navigation options 只使用领域字段并保持 Server 顺序与固定叶子语义', () => {
  const options = createRegionOptions([malaysia, china, taiwan])

  assert.deepEqual(values(options), [IDS.malaysia, IDS.china, IDS.taiwan])
  assert.deepEqual(options.map(option => option.isLeaf), [false, false, false])
  assert.equal(options[0]?.region, malaysia)
  assert.equal(options[0]?.disabled, false)
  assert.equal(options[0]?.children, undefined)

  const cityOptions = createRegionOptions([beijingCity])
  assert.equal(cityOptions[0]?.isLeaf, true)
  assert.equal(cityOptions[0]?.disabled, false)
})

test('resolved path 转成完整树、完整 label 与可解释的停用状态', () => {
  const tree = createRegionPathTree(stoppedTaiwanPath)
  const province = tree[0]?.children?.[0]
  const city = province?.children?.[0]

  assert.equal(tree[0]?.value, IDS.taiwan)
  assert.equal(province?.value, IDS.taiwanProvince)
  assert.equal(city?.value, IDS.kaohsiung)
  assert.equal(city?.isLeaf, true)
  assert.equal(city?.disabled, true)
  assert.equal(
    formatRegionPathLabel([tree[0]!, province!, city!]),
    '中国台湾 / 台湾 / 高雄市（已停用）',
  )
  assert.match(city?.searchText ?? '', /taiwan, china/u)
  assert.match(city?.searchText ?? '', /kaohsiung city/u)
  assert.match(city?.searchText ?? '', /tw-64000/u)
})

test('navigation 与 search 按 UUID 合并并保持各自 Server 顺序', () => {
  const navigation = createRegionOptions([china, taiwan, malaysia])
  const navigationWithChina = replaceRegionChildren(
    navigation,
    IDS.china,
    [beijingProvince],
  )
  const navigationWithBeijing = replaceRegionChildren(
    navigationWithChina,
    IDS.beijingProvince,
    [beijingCity],
  )
  const resolved = createRegionPathTree(stoppedTaiwanPath)
  const search = createRegionSearchTree([malaysiaPath, beijingPath])

  const merged = mergeRegionTrees(
    navigationWithBeijing,
    resolved,
    search,
  )

  assert.deepEqual(values(merged), [IDS.china, IDS.taiwan, IDS.malaysia])
  assert.equal(merged.filter(option => option.value === IDS.china).length, 1)
  assert.deepEqual(values(merged[0]?.children ?? []), [IDS.beijingProvince])
  assert.deepEqual(
    values(merged[0]?.children?.[0]?.children ?? []),
    [IDS.beijingCity],
  )
  assert.deepEqual(
    values(merged[1]?.children?.[0]?.children ?? []),
    [IDS.kaohsiung],
  )
  assert.deepEqual(
    values(merged[2]?.children?.[0]?.children ?? []),
    [IDS.kualaLumpur],
  )
})

test('普通交互树不采纳 resolved 的部分 children，搜索分支只在搜索态出现', () => {
  const navigation = createRegionOptions([china, taiwan, malaysia])
  const resolved = createRegionPathTree(stoppedTaiwanPath)
  const search = createRegionSearchTree([malaysiaPath])

  const normalTree = createRegionInteractiveTree(
    navigation,
    search,
    false,
  )
  assert.equal(normalTree[1]?.value, resolved[0]?.value)
  assert.equal(
    normalTree[1]?.children,
    undefined,
    '已有高雄回显不能让中国台湾被误判为已完整加载',
  )

  const searchTree = createRegionInteractiveTree(
    navigation,
    search,
    true,
  )
  assert.deepEqual(
    values(searchTree[2]?.children?.[0]?.children ?? []),
    [IDS.kualaLumpur],
  )

  const afterSearchTree = createRegionInteractiveTree(
    navigation,
    search,
    false,
  )
  assert.equal(
    afterSearchTree[2]?.children,
    undefined,
    '清空搜索后必须恢复 navigation 的 lazy 未加载语义',
  )
})

test('search paths 以本次 Server 顺序重建整棵树，不保留上次搜索分支', () => {
  const firstTree = createRegionSearchTree([beijingPath, malaysiaPath])
  const replacementTree = createRegionSearchTree([malaysiaPath])

  assert.deepEqual(values(firstTree), [IDS.china, IDS.malaysia])
  assert.deepEqual(values(replacementTree), [IDS.malaysia])
  assert.equal(
    findRegionPathByCityId(replacementTree, IDS.beijingCity),
    null,
  )
  assert.deepEqual(
    findRegionPathByCityId(replacementTree, IDS.kualaLumpur),
    malaysiaPath,
  )
})

test('lazy children 按父级整批替换，root 替换不会残留旧 Server 结果', () => {
  const roots = createRegionOptions([china, taiwan])
  const withInitialChildren = replaceRegionChildren(
    roots,
    IDS.china,
    [beijingProvince],
  )
  const replacedChildren = replaceRegionChildren(
    withInitialChildren,
    IDS.china,
    [taiwanProvince],
  )

  assert.deepEqual(
    values(replacedChildren[0]?.children ?? []),
    [IDS.taiwanProvince],
  )
  assert.equal(withInitialChildren[0]?.children?.[0]?.value, IDS.beijingProvince)

  const replacedRoots = replaceRegionChildren(
    replacedChildren,
    null,
    [malaysia, china],
  )
  assert.deepEqual(values(replacedRoots), [IDS.malaysia, IDS.china])
})

test('lazy children 必须严格符合 COUNTRY 到 PROVINCE、PROVINCE 到 CITY', () => {
  assert.equal(
    validateRegionChildren(china, [beijingProvince])[0],
    beijingProvince,
  )
  assert.equal(
    validateRegionChildren(beijingProvince, [beijingCity])[0],
    beijingCity,
  )

  assert.throws(
    () => validateRegionChildren(china, [beijingCity]),
    /Invalid region child hierarchy/u,
  )
  assert.throws(
    () => validateRegionChildren(beijingProvince, [taiwanProvince]),
    /Invalid region child hierarchy/u,
  )
  assert.throws(
    () => validateRegionChildren(beijingCity, []),
    /Invalid region child hierarchy/u,
  )
})

test('搜索文本统一 NFC、Unicode 空白、en-US 小写并只匹配已加载 option', () => {
  assert.equal(
    normalizeRegionSearchText('  İSTANBUL\u3000A\u030A  '),
    'i\u0307stanbul å',
  )
  assert.equal(normalizeRegionSearchText('\u3000\n\t'), '')

  const city = createRegionPathTree(malaysiaPath)[0]!
    .children![0]!
    .children![0]!
  assert.equal(filterRegionOption('  KUALA\u3000LUMPUR ', city), true)
  assert.equal(filterRegionOption('MY-14-KUL', city), true)
  assert.equal(filterRegionOption('未加载城市', city), false)

  const stoppedCity = createRegionPathTree(stoppedTaiwanPath)[0]!
    .children![0]!
    .children![0]!
  assert.equal(
    filterRegionOption('高雄', stoppedCity),
    false,
    '历史停用路径只能回显，不能进入普通搜索结果',
  )
})

test('request version 只允许当前请求落地，next 与 invalidate 都使旧响应 stale', () => {
  const version = createRegionRequestVersion()
  const first = version.next()
  const second = version.next()

  assert.equal(first, 1)
  assert.equal(second, 2)
  assert.equal(version.isCurrent(first), false)
  assert.equal(version.isCurrent(second), true)

  version.invalidate()
  assert.equal(version.isCurrent(second), false)
  assert.equal(version.next(), 4)
})

test('只把完整、连续、有效的 CITY 转成 typed change', () => {
  const tree = createRegionPathTree(beijingPath)

  assert.deepEqual(resolveRegionSelection(IDS.beijingCity, tree), {
    path: beijingPath,
    source: 'select',
    value: IDS.beijingCity,
  })
  assert.equal(resolveRegionSelection(IDS.beijingProvince, tree), null)
  assert.equal(resolveRegionSelection('not-a-city', tree), null)
  assert.equal(resolveRegionSelection(123, tree), null)

  const stoppedTree = createRegionPathTree(stoppedTaiwanPath)
  assert.equal(resolveRegionSelection(IDS.kaohsiung, stoppedTree), null)
})

test('畸形 tree 即使包含同 ID CITY 也不能绕过完整三级校验', () => {
  const malformedCity: RegionCascaderOption = {
    ...createRegionOptions([beijingCity])[0]!,
  }
  const malformedTree: readonly RegionCascaderOption[] = [{
    ...createRegionOptions([china])[0]!,
    children: [malformedCity],
  }]

  assert.equal(
    findRegionPathByCityId(malformedTree, IDS.beijingCity),
    null,
  )
  assert.equal(
    resolveRegionSelection(IDS.beijingCity, malformedTree),
    null,
  )
})

test('Arco 清空值统一映射为公共 null，其他非法内核值不向外泄露', () => {
  const tree = createRegionPathTree(beijingPath)

  for (const value of ['', null, undefined]) {
    assert.deepEqual(resolveRegionSelection(value, tree), {
      path: null,
      source: 'clear',
      value: null,
    })
  }

  for (const value of [[], {}, [IDS.beijingCity]]) {
    assert.equal(resolveRegionSelection(value, tree), null)
  }
})
