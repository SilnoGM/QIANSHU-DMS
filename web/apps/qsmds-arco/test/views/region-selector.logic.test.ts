import type {
  RegionSelectorChange,
  RegionSelectorCountryPath,
  RegionSelectorNode,
  RegionSelectorPath,
  RegionSelectorProvincePath,
} from '../../src/components/business/QsRegionSelector/types'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 组件纯逻辑使用 Node.js 内置 runner。
import test from 'node:test'
import {
  createEmptyRegionSelectorValue,
  createRegionRequestVersion,
  createRegionSelectOptions,
  createRegionSelectorChange,
  formatRegionPathLabel,
  isCompleteRegionSelectorValue,
  mergeSelectedRegionNode,
  normalizeRegionSelectorValue,
  validateRegionChildren,
  validateRegionSelectorPath,
} from '../../src/components/business/QsRegionSelector/logic'

const IDS = {
  beijingCity: '00000000-0000-4000-8000-000000000113',
  beijingProvince: '00000000-0000-4000-8000-000000000112',
  china: '00000000-0000-4000-8000-000000000111',
  kaohsiung: '00000000-0000-4000-8000-000000000123',
  taiwan: '00000000-0000-4000-8000-000000000121',
  taiwanProvince: '00000000-0000-4000-8000-000000000122',
} as const

function node<L extends RegionSelectorNode['level']>(
  value: {
    readonly id: string
    readonly parentId: string | null
    readonly level: L
    readonly name: string
    readonly code: string
    readonly enabled?: boolean
    readonly effectiveEnabled?: boolean
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
  id: IDS.china,
  level: 'COUNTRY_REGION',
  name: '中国',
  parentId: null,
})
const beijingProvince = node({
  code: 'CN-11',
  id: IDS.beijingProvince,
  level: 'PROVINCE_STATE',
  name: '北京市',
  parentId: IDS.china,
})
const beijingCity = node({
  code: 'CN-110100',
  id: IDS.beijingCity,
  level: 'CITY',
  name: '北京市',
  parentId: IDS.beijingProvince,
})
const taiwan = node({
  code: 'TW',
  id: IDS.taiwan,
  level: 'COUNTRY_REGION',
  name: '中国台湾',
  parentId: null,
})
const taiwanProvince = node({
  code: 'TW-TAIWAN',
  id: IDS.taiwanProvince,
  level: 'PROVINCE_STATE',
  name: '台湾',
  parentId: IDS.taiwan,
})
const stoppedKaohsiung = node({
  code: 'TW-64000',
  effectiveEnabled: false,
  enabled: false,
  id: IDS.kaohsiung,
  level: 'CITY',
  name: '高雄市',
  parentId: IDS.taiwanProvince,
})
const taiwanPath = Object.freeze([
  taiwan,
  taiwanProvince,
  stoppedKaohsiung,
]) as RegionSelectorPath

/**
 * 公共 change 必须能按 source 收窄 path 与 complete，调用方无需再次检查数组长度。
 * 该函数同时由 Web typecheck 固定编译期契约，并在 Node 测试中覆盖四个运行时分支。
 */
function assertDiscriminatedChange(change: RegionSelectorChange): void {
  if (change.source === 'countryRegion') {
    const path: RegionSelectorCountryPath = change.path
    const complete: false = change.complete
    assert.equal(path.length, 1)
    assert.equal(complete, false)
  }
  else if (change.source === 'provinceState') {
    const path: RegionSelectorProvincePath = change.path
    const complete: false = change.complete
    assert.equal(path.length, 2)
    assert.equal(complete, false)
  }
  else if (change.source === 'city') {
    const path: RegionSelectorPath = change.path
    const complete: true = change.complete
    assert.equal(path.length, 3)
    assert.equal(complete, true)
  }
  else {
    const path: readonly [] = change.path
    const complete: false = change.complete
    assert.equal(path.length, 0)
    assert.equal(complete, false)
  }
}

test('结构化 value 使用稳定的三级字段并规范化运行时空值', () => {
  assert.deepEqual(createEmptyRegionSelectorValue(), {
    cityId: null,
    countryRegionId: null,
    provinceStateId: null,
  })
  assert.deepEqual(normalizeRegionSelectorValue(undefined), {
    cityId: null,
    countryRegionId: null,
    provinceStateId: null,
  })
  assert.deepEqual(normalizeRegionSelectorValue({
    cityId: '',
    countryRegionId: IDS.taiwan,
    provinceStateId: IDS.taiwanProvince,
  }), {
    cityId: null,
    countryRegionId: IDS.taiwan,
    provinceStateId: IDS.taiwanProvince,
  })
  assert.equal(
    isCompleteRegionSelectorValue({
      cityId: IDS.kaohsiung,
      countryRegionId: IDS.taiwan,
      provinceStateId: IDS.taiwanProvince,
    }),
    true,
  )
  assert.equal(
    isCompleteRegionSelectorValue({
      cityId: null,
      countryRegionId: IDS.taiwan,
      provinceStateId: IDS.taiwanProvince,
    }),
    false,
  )
})

test('FaSelect options 保持 Server 顺序、UUID 与停用语义', () => {
  assert.deepEqual(
    createRegionSelectOptions([taiwan, stoppedKaohsiung, china]),
    [
      {
        disabled: false,
        label: '中国台湾',
        value: IDS.taiwan,
      },
      {
        disabled: true,
        label: '高雄市',
        value: IDS.kaohsiung,
      },
      {
        disabled: false,
        label: '中国',
        value: IDS.china,
      },
    ],
  )
})

test('停用历史节点只在 Server 结果缺失时追加且不制造重复 UUID', () => {
  assert.deepEqual(
    mergeSelectedRegionNode([beijingCity], stoppedKaohsiung),
    [beijingCity, stoppedKaohsiung],
  )
  assert.deepEqual(
    mergeSelectedRegionNode([stoppedKaohsiung], stoppedKaohsiung),
    [stoppedKaohsiung],
  )
  assert.deepEqual(mergeSelectedRegionNode([beijingCity], null), [beijingCity])
})

test('同层响应必须严格符合 COUNTRY 到 PROVINCE、PROVINCE 到 CITY', () => {
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

test('外部完整 value 必须与连续 path 的三个 UUID 全部一致', () => {
  const value = {
    cityId: IDS.kaohsiung,
    countryRegionId: IDS.taiwan,
    provinceStateId: IDS.taiwanProvince,
  }
  assert.equal(validateRegionSelectorPath(taiwanPath, value), true)
  assert.equal(
    validateRegionSelectorPath(taiwanPath, {
      ...value,
      countryRegionId: IDS.china,
    }),
    false,
  )
  assert.equal(
    validateRegionSelectorPath([taiwan, stoppedKaohsiung], value),
    false,
  )
})

test('每一级用户选择发出原子 value、部分 path 与完成状态', () => {
  const countryChange = createRegionSelectorChange(
    'countryRegion',
    [taiwan],
  )
  const provinceChange = createRegionSelectorChange(
    'provinceState',
    [taiwan, taiwanProvince],
  )
  const cityChange = createRegionSelectorChange('city', taiwanPath)
  const clearChange = createRegionSelectorChange('clear', [])

  assertDiscriminatedChange(countryChange)
  assertDiscriminatedChange(provinceChange)
  assertDiscriminatedChange(cityChange)
  assertDiscriminatedChange(clearChange)

  assert.deepEqual(countryChange, {
    complete: false,
    path: [taiwan],
    source: 'countryRegion',
    value: {
      cityId: null,
      countryRegionId: IDS.taiwan,
      provinceStateId: null,
    },
  })
  assert.deepEqual(provinceChange, {
    complete: false,
    path: [taiwan, taiwanProvince],
    source: 'provinceState',
    value: {
      cityId: null,
      countryRegionId: IDS.taiwan,
      provinceStateId: IDS.taiwanProvince,
    },
  })
  assert.deepEqual(cityChange, {
    complete: true,
    path: taiwanPath,
    source: 'city',
    value: {
      cityId: IDS.kaohsiung,
      countryRegionId: IDS.taiwan,
      provinceStateId: IDS.taiwanProvince,
    },
  })
  assert.deepEqual(clearChange, {
    complete: false,
    path: [],
    source: 'clear',
    value: {
      cityId: null,
      countryRegionId: null,
      provinceStateId: null,
    },
  })
  assert.throws(
    () => createRegionSelectorChange('city', [taiwan]),
    /Invalid region selection path/u,
  )
})

test('完整地区以一个 ASCII 空格分隔并明确展示停用状态', () => {
  assert.equal(
    formatRegionPathLabel(taiwanPath),
    '中国台湾 台湾 高雄市（已停用）',
  )
  assert.doesNotMatch(formatRegionPathLabel(taiwanPath), /\s\/\s/u)
})

test('request version 只允许当前请求落地', () => {
  const version = createRegionRequestVersion()
  const first = version.next()
  const second = version.next()

  assert.equal(version.isCurrent(first), false)
  assert.equal(version.isCurrent(second), true)
  version.invalidate()
  assert.equal(version.isCurrent(second), false)
  assert.equal(version.next(), 4)
})
