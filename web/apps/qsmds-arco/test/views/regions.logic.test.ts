import type {
  CreateRegionRequestDto,
  RegionDto,
  RegionNavigationNodeDto,
  UpdateRegionRequestDto,
} from '../../src/api/generated/types.gen'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 地区页纯逻辑使用 Node.js 内置 runner 验证。
import test from 'node:test'

import {
  administrativeTypeLabel,
  buildRegionListQuery,
  buildRegionReconciliationQuery,
  canApplyRegionResponse,
  childLevelForScope,
  createRegionQueryRefreshScheduler,
  createRegionScopeTree,
  createRootRegionScope,
  findMatchingCreatedRegion,
  getRegionMutationFailure,
  matchesRegionStatus,
  matchesRegionUpdate,
  normalizeRegionFilters,
  normalizeRegionSorting,
  regionDisplayStatus,
  regionDisplayStatusLabel,
  requiresRegionNavigationRefresh,
  resolveRegionAdminActions,
  ROOT_SCOPE_ID,
} from '../../src/views/system/basic-data/regions/regions.logic'

const country: RegionNavigationNodeDto = {
  id: 'country-cn',
  parentId: null,
  code: 'CN',
  name: '中国',
  englishName: 'China',
  level: 'COUNTRY_REGION',
  enabled: true,
  effectiveEnabled: true,
  children: [
    {
      id: 'province-tw',
      parentId: 'country-cn',
      code: 'TW',
      name: '台湾',
      englishName: 'Taiwan',
      level: 'PROVINCE_STATE',
      enabled: false,
      effectiveEnabled: false,
      children: [],
    },
  ],
}

test('scope 固定映射直属层级且城市不能成为导航 scope', () => {
  assert.equal(childLevelForScope(createRootRegionScope()), 'COUNTRY_REGION')
  assert.equal(childLevelForScope({
    kind: 'COUNTRY_REGION',
    id: 'country-cn',
    label: '中国',
    path: [],
  }), 'PROVINCE_STATE')
  assert.equal(childLevelForScope({
    kind: 'PROVINCE_STATE',
    id: 'province-tw',
    label: '台湾',
    path: [],
  }), 'CITY')
})

test('navigation 只生成虚拟根、国家和省州，停用节点仍可选择', () => {
  const [root] = createRegionScopeTree([country])

  assert.equal(root?.id, ROOT_SCOPE_ID)
  assert.equal(root?.disabled, false)
  assert.equal(root?.children?.[0]?.id, 'country-cn')
  assert.equal(root?.children?.[0]?.children?.[0]?.id, 'province-tw')
  assert.equal(root?.children?.[0]?.children?.[0]?.disabled, false)
  assert.equal(root?.children?.[0]?.children?.[0]?.status, 'SELF_DISABLED')
  assert.deepEqual(root?.children?.[0]?.children?.[0]?.scope.path.map(node => node.name), [
    '中国',
    '台湾',
  ])
})

test('根查询省略 parentId，并归一化搜索、状态、分页和排序', () => {
  assert.deepEqual(buildRegionListQuery({
    scope: createRootRegionScope(),
    page: 2,
    pageSize: 50,
    search: '  Kota　 Kinabalu  ',
    filters: {
      ownStatus: 'ENABLED',
    },
    sorting: [{ id: 'updatedAt', desc: true }],
  }), {
    page: 2,
    pageSize: 50,
    query: 'Kota Kinabalu',
    ownStatus: 'ENABLED',
    sortBy: 'updatedAt',
    sortOrder: 'desc',
  })
})

test('非根查询只提交当前 scope parentId，不泄露非法筛选或排序', () => {
  assert.deepEqual(buildRegionListQuery({
    scope: {
      kind: 'COUNTRY_REGION',
      id: 'country-cn',
      label: '中国',
      path: [],
    },
    page: 0,
    pageSize: 200,
    search: '   ',
    filters: {
      availability: 'BROKEN',
      ownStatus: 'BROKEN',
    },
    sorting: [
      { id: 'level', desc: true },
      { id: 'name', desc: false },
    ],
  }), {
    parentId: 'country-cn',
    page: 1,
    pageSize: 20,
    sortBy: 'name',
    sortOrder: 'asc',
  })
})

test('ownStatus 与 availability 互斥并按本次变化消解', () => {
  assert.deepEqual(normalizeRegionFilters({
    ownStatus: 'DISABLED',
    availability: 'ANCESTOR_DISABLED',
  }, 'ownStatus'), {
    ownStatus: 'DISABLED',
  })
  assert.deepEqual(normalizeRegionFilters({
    ownStatus: 'ENABLED',
    availability: 'EFFECTIVE',
  }, 'availability'), {
    availability: 'EFFECTIVE',
  })
  assert.deepEqual(normalizeRegionFilters({
    ownStatus: 'ENABLED',
    availability: 'EFFECTIVE',
  }), {
    ownStatus: 'ENABLED',
  })
})

test('排序只消费第一项合法白名单字段', () => {
  assert.deepEqual(normalizeRegionSorting([
    { id: 'effectiveEnabled', desc: true },
    { id: 'sortOrder', desc: false },
    { id: 'name', desc: true },
  ]), {
    sortBy: 'sortOrder',
    sortOrder: 'asc',
  })
  assert.equal(normalizeRegionSorting([{ id: 'level', desc: false }]), undefined)
})

test('自身和有效状态映射为三个互斥文字状态', () => {
  const base: RegionDto = {
    id: 'city',
    parentId: 'province',
    code: 'TW-64000',
    name: '高雄市',
    englishName: 'Kaohsiung City',
    sourceName: null,
    sourceCode: null,
    administrativeType: 'MUNICIPALITY',
    level: 'CITY',
    enabled: true,
    effectiveEnabled: true,
    sortOrder: 1,
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:00.000Z',
  }

  assert.equal(regionDisplayStatus({ ...base, enabled: false }), 'SELF_DISABLED')
  assert.equal(regionDisplayStatus({ ...base, effectiveEnabled: false }), 'ANCESTOR_DISABLED')
  assert.equal(regionDisplayStatus(base), 'EFFECTIVE')
  assert.equal(regionDisplayStatusLabel('SELF_DISABLED'), '自身停用')
  assert.equal(regionDisplayStatusLabel('ANCESTOR_DISABLED'), '继承停用')
  assert.equal(regionDisplayStatusLabel('EFFECTIVE'), '有效')
})

test('首期种子数据的全部行政类型均映射为中文标签', () => {
  const expectedLabels: Readonly<Record<string, string>> = {
    ADMINISTRATIVE_DISTRICT: '行政区',
    AUTONOMOUS_PREFECTURE: '自治州',
    AUTONOMOUS_REGION: '自治区',
    COUNTRY_REGION: '国家/地区',
    COUNTY_CITY: '县市',
    DIRECT_ADMIN_COUNTY_LEVEL: '省直辖县级行政区',
    FEDERAL_TERRITORY: '联邦直辖区',
    LEAGUE: '盟',
    MUNICIPALITY: '直辖市',
    MUNICIPALITY_CITY: '直辖市城市节点',
    PREFECTURE: '地区',
    PREFECTURE_LEVEL_CITY: '地级市',
    PROVINCE: '省',
    STATE: '州',
    SYNTHETIC_PROVINCE_STATE: '补齐省/州层',
  }

  for (const [value, label] of Object.entries(expectedLabels)) {
    assert.equal(administrativeTypeLabel(value), label)
    assert.notEqual(administrativeTypeLabel(value), value)
  }
})

test('未知行政类型显示中文缺失提示，避免与下方技术码重复', () => {
  assert.equal(
    administrativeTypeLabel('FUTURE_ADMINISTRATIVE_TYPE'),
    '未配置中文名称',
  )
})

test('迟到响应必须同时通过 version、scope、authEpoch 和 abort 保护', () => {
  const current = {
    authorized: true,
    requestVersion: 3,
    latestRequestVersion: 3,
    scopeId: 'province-tw',
    currentScopeId: 'province-tw',
    authEpoch: 7,
    currentAuthEpoch: 7,
    aborted: false,
  }

  assert.equal(canApplyRegionResponse(current), true)
  assert.equal(canApplyRegionResponse({ ...current, latestRequestVersion: 4 }), false)
  assert.equal(canApplyRegionResponse({ ...current, currentScopeId: 'country-cn' }), false)
  assert.equal(canApplyRegionResponse({ ...current, currentAuthEpoch: 8 }), false)
  assert.equal(canApplyRegionResponse({ ...current, aborted: true }), false)
  assert.equal(canApplyRegionResponse({ ...current, authorized: false }), false)
})

test('连续查询事件在同一 microtask 合并为一次刷新', async () => {
  let refreshCount = 0
  const scheduler = createRegionQueryRefreshScheduler(() => {
    refreshCount += 1
  })

  scheduler.schedule()
  scheduler.schedule()
  scheduler.schedule()
  assert.equal(refreshCount, 0)

  await Promise.resolve()
  assert.equal(refreshCount, 1)

  scheduler.dispose()
  scheduler.schedule()
  await Promise.resolve()
  assert.equal(refreshCount, 1)
})

const kaohsiung: RegionDto = {
  id: 'city-kaohsiung',
  parentId: 'province-tw',
  code: 'TW-64000',
  name: '高雄市',
  englishName: 'Kaohsiung City',
  sourceName: '高雄市',
  sourceCode: 'E/64000',
  administrativeType: 'MUNICIPALITY',
  level: 'CITY',
  enabled: true,
  effectiveEnabled: true,
  sortOrder: 1,
  createdAt: '2026-07-27T00:00:00.000Z',
  updatedAt: '2026-07-27T00:00:00.000Z',
}

test('只有 network mutation 失败进入结果未知，HTTP 500 仍是已知失败', () => {
  assert.deepEqual(getRegionMutationFailure({
    kind: 'network',
    code: 'NETWORK_ERROR',
    message: '网络连接失败，请稍后重试',
  }), {
    code: undefined,
    fieldErrors: {},
    message: '网络连接失败，请稍后重试',
    requestId: undefined,
    unknownResult: true,
  })

  assert.deepEqual(getRegionMutationFailure({
    kind: 'http',
    status: 500,
    body: {
      code: 'INTERNAL_ERROR',
      message: '系统繁忙',
      requestId: 'request-http-500',
    },
  }), {
    code: 'INTERNAL_ERROR',
    fieldErrors: {},
    message: '系统繁忙',
    requestId: 'request-http-500',
    unknownResult: false,
  })
})

test('mutation 字段错误只读取白名单并将地区冲突定位到对应字段', () => {
  assert.deepEqual(getRegionMutationFailure({
    kind: 'http',
    status: 422,
    body: {
      code: 'VALIDATION_FAILED',
      message: '请求参数校验失败',
      requestId: 'request-validation',
      fieldErrors: {
        name: ['名称不能为空'],
        parentId: ['不应泄露为可编辑字段'],
        unknown: ['忽略未知字段'],
      },
    },
  }).fieldErrors, {
    name: '名称不能为空',
  })

  assert.deepEqual(getRegionMutationFailure({
    kind: 'http',
    status: 409,
    body: {
      code: 'REGION_CODE_ALREADY_EXISTS',
      message: '地区 Code 已存在',
      requestId: 'request-conflict',
    },
  }).fieldErrors, {
    code: '地区 Code 已存在',
  })
})

test('创建结果未知按当前父级和 exact code 查询，根级必须省略 parentId', () => {
  assert.deepEqual(
    buildRegionReconciliationQuery(createRootRegionScope(), '  cn  '),
    {
      code: 'CN',
      page: 1,
      pageSize: 20,
    },
  )
  assert.deepEqual(buildRegionReconciliationQuery({
    kind: 'PROVINCE_STATE',
    id: 'province-tw',
    label: '台湾',
    path: [],
  }, ' tw-64000 '), {
    code: 'TW-64000',
    page: 1,
    pageSize: 20,
    parentId: 'province-tw',
  })
})

test('创建对账必须完整匹配 parent、层级及全部提交字段', () => {
  const scope = {
    kind: 'PROVINCE_STATE' as const,
    id: 'province-tw',
    label: '台湾',
    path: [],
  }
  const request: CreateRegionRequestDto = {
    parentId: 'province-tw',
    code: 'TW-64000',
    name: '高雄市',
    englishName: 'Kaohsiung City',
    sortOrder: 1,
    enabled: true,
  }

  assert.equal(findMatchingCreatedRegion([kaohsiung], scope, request)?.id, kaohsiung.id)
  assert.equal(findMatchingCreatedRegion([
    { ...kaohsiung, name: '高雄' },
  ], scope, request), undefined)
  assert.equal(findMatchingCreatedRegion([
    kaohsiung,
    { ...kaohsiung, id: 'duplicate' },
  ], scope, request), undefined)
})

test('编辑与启停对账只在提交字段或目标状态最终匹配时成功', () => {
  const update: UpdateRegionRequestDto = {
    name: '高雄',
    englishName: null,
    sortOrder: 2,
  }
  assert.equal(matchesRegionUpdate({
    ...kaohsiung,
    name: '高雄',
    englishName: null,
    sortOrder: 2,
  }, update), true)
  assert.equal(matchesRegionUpdate(kaohsiung, update), false)
  assert.equal(matchesRegionStatus(kaohsiung, true), true)
  assert.equal(matchesRegionStatus(kaohsiung, false), false)
})

test('地区动作按四项权限与当前状态分别收敛且不会产生删除动作', () => {
  assert.deepEqual(resolveRegionAdminActions({
    canDisable: true,
    canEnable: true,
    canUpdate: true,
    enabled: true,
  }), {
    canDisable: true,
    canEdit: true,
    canEnable: false,
    hasAny: true,
  })
  assert.deepEqual(resolveRegionAdminActions({
    canDisable: false,
    canEnable: false,
    canUpdate: false,
    enabled: false,
  }), {
    canDisable: false,
    canEdit: false,
    canEnable: false,
    hasAny: false,
  })
})

test('国家与省州 mutation 需要刷新 navigation，城市只刷新当前列表', () => {
  assert.equal(requiresRegionNavigationRefresh('COUNTRY_REGION'), true)
  assert.equal(requiresRegionNavigationRefresh('PROVINCE_STATE'), true)
  assert.equal(requiresRegionNavigationRefresh('CITY'), false)
})
