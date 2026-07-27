import type {
  RegionDto,
  RegionNavigationNodeDto,
} from '../../src/api/generated/types.gen'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 地区页纯逻辑使用 Node.js 内置 runner 验证。
import test from 'node:test'

import {
  buildRegionListQuery,
  canApplyRegionResponse,
  childLevelForScope,
  createRegionQueryRefreshScheduler,
  createRegionScopeTree,
  createRootRegionScope,
  normalizeRegionFilters,
  normalizeRegionSorting,
  regionDisplayStatus,
  regionDisplayStatusLabel,
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
