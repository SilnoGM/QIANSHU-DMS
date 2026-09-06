import type { MenuRecordRaw } from '@fantastic-admin/types'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 路由与空页面契约使用 Node.js 内置 runner。
import test from 'node:test'

import { matchesAuthorization } from '../../src/composables/app/auth'
import basicDataRoutes from '../../src/router/modules/basic.data'
import { filterAccessibleMenus } from '../../src/store/modules/app/menu.logic'

const basicDataPageContracts = [
  {
    auth: 'regions:read',
    file: '../../src/views/system/basic-data/regions/index.vue',
    name: 'systemBasicDataRegions',
    path: 'regions',
    title: '地区管理',
  },
  {
    auth: ['currencies:read', 'exchange-rates:read'],
    file: '../../src/views/system/basic-data/currency-exchange-rate/index.vue',
    name: 'systemBasicDataCurrencies',
    path: 'currencies',
    title: '货币汇率',
  },
  {
    auth: 'exchange-rates:read',
    file: undefined,
    menu: false,
    name: 'systemBasicDataExchangeRates',
    path: 'exchange-rates',
    title: '当前汇率',
  },
  {
    auth: 'numbering-rules:read',
    file: '../../src/views/system/basic-data/numbering/index.vue',
    name: 'systemBasicDataNumbering',
    path: 'numbering',
    title: '编号管理',
  },
  {
    auth: 'numbering-rules:read',
    file: '../../src/views/system/basic-data/numbering/create.vue',
    menu: false,
    name: 'systemBasicDataNumberingCreate',
    path: 'numbering/create',
    title: '新增编号规则',
  },
  {
    auth: 'dictionaries:read',
    file: '../../src/views/system/basic-data/dictionaries/index.vue',
    name: 'systemBasicDataDictionaries',
    path: 'dictionaries',
    title: '字典管理',
  },
] as const

test('基础数据父路由保持权限中立并由叶子路由独立鉴权', () => {
  assert.equal(basicDataRoutes.path, '/system/basic-data')
  assert.equal(basicDataRoutes.name, 'systemBasicData')
  assert.equal(basicDataRoutes.meta?.title, '基础数据')
  assert.equal(basicDataRoutes.meta?.auth, undefined)
  assert.equal(typeof basicDataRoutes.component, 'function')
  assert.equal(basicDataRoutes.redirect, undefined)

  assert.deepEqual(
    basicDataRoutes.children?.map(route => ({
      auth: route.meta?.auth,
      menu: route.meta?.menu,
      name: route.name,
      path: route.path,
      title: route.meta?.title,
    })),
    basicDataPageContracts.map(page => ({
      auth: page.auth,
      menu: 'menu' in page ? page.menu : undefined,
      name: page.name,
      path: page.path,
      title: page.title,
    })),
  )
  const pageRoutes = basicDataRoutes.children?.filter(
    route => route.name !== 'systemBasicDataExchangeRates',
  )
  assert.ok(pageRoutes?.every(route => typeof route.component === 'function'))
  const legacyExchangeRateRoute = basicDataRoutes.children?.find(
    route => route.name === 'systemBasicDataExchangeRates',
  )
  const currencyExchangeRateRoute = basicDataRoutes.children?.find(
    route => route.name === 'systemBasicDataCurrencies',
  )
  assert.deepEqual(currencyExchangeRateRoute?.meta?.auth, [
    'currencies:read',
    'exchange-rates:read',
  ])
  assert.equal(currencyExchangeRateRoute?.meta?.tabMerge, 'routeName')
  assert.equal(legacyExchangeRateRoute?.component, undefined)
  assert.equal(legacyExchangeRateRoute?.meta?.activeMenu, '/system/basic-data/currencies')
  assert.equal(legacyExchangeRateRoute?.meta?.menu, false)
  assert.deepEqual(legacyExchangeRateRoute?.redirect, {
    name: 'systemBasicDataCurrencies',
    query: {
      tab: 'exchange-rates',
    },
  })
  assert.equal(
    new Set(basicDataRoutes.children?.map(route => route.name)).size,
    basicDataPageContracts.length,
  )
})

test('无基础数据读取权限时隐藏空的基础数据父菜单', () => {
  const permissions = ['users:read']
  const menuFixture: MenuRecordRaw[] = [{
    path: basicDataRoutes.path,
    meta: {
      auth: basicDataRoutes.meta?.auth,
      title: basicDataRoutes.meta?.title,
    },
    children: (basicDataRoutes.children ?? []).map(route => ({
      path: route.path,
      meta: {
        auth: route.meta?.auth,
        menu: route.meta?.menu,
        title: route.meta?.title,
      },
    })),
  }]

  // 使用生产递归过滤函数验证所有受保护叶子隐藏后，空父项也会一并移除。
  const visibleMenus = filterAccessibleMenus(
    menuFixture,
    value => matchesAuthorization(permissions, value),
    () => true,
  )

  assert.deepEqual(visibleMenus, [])
})

test('货币汇率单一菜单使用任一读取权限并隐藏兼容路由', () => {
  const menuFixture: MenuRecordRaw[] = [{
    path: basicDataRoutes.path,
    meta: {
      auth: basicDataRoutes.meta?.auth,
      title: basicDataRoutes.meta?.title,
    },
    children: (basicDataRoutes.children ?? []).map(route => ({
      path: route.path,
      meta: {
        auth: route.meta?.auth,
        menu: route.meta?.menu,
        title: route.meta?.title,
      },
    })),
  }]

  const visiblePaths = (permissions: string[]) => {
    return filterAccessibleMenus(
      menuFixture,
      value => matchesAuthorization(permissions, value),
      () => true,
    )[0]?.children
      ?.filter(menu => menu.meta?.menu !== false)
      .map(menu => menu.path)
  }

  assert.deepEqual(
    visiblePaths(['currencies:read']),
    ['currencies'],
  )
  assert.deepEqual(
    visiblePaths(['exchange-rates:read']),
    ['currencies'],
  )
  assert.deepEqual(
    visiblePaths(['currencies:read', 'dictionaries:read']),
    ['currencies', 'dictionaries'],
  )
})

test('字典菜单与直接访问都精确要求 dictionaries:read', () => {
  const dictionaryRoute = basicDataRoutes.children?.find(
    route => route.name === 'systemBasicDataDictionaries',
  )

  assert.equal(dictionaryRoute?.meta?.auth, 'dictionaries:read')
  assert.equal(
    matchesAuthorization(['dictionaries:read'], dictionaryRoute?.meta?.auth ?? ''),
    true,
  )
  assert.equal(
    matchesAuthorization([], dictionaryRoute?.meta?.auth ?? ''),
    false,
  )

  const appSource = readFileSync(
    new URL('../../src/App.vue', import.meta.url),
    'utf8',
  )
  assert.match(appSource, /route\.matched\.every/u)
  assert.match(appSource, /<AppNotAllowed v-else\s*\/>/u)
})

test('编号管理菜单与页面都要求 numbering-rules:read', () => {
  const numberingRoute = basicDataRoutes.children?.find(
    route => route.name === 'systemBasicDataNumbering',
  )

  assert.equal(numberingRoute?.meta?.auth, 'numbering-rules:read')
  assert.equal(
    matchesAuthorization(['numbering-rules:read'], numberingRoute?.meta?.auth),
    true,
  )
  assert.equal(matchesAuthorization([], numberingRoute?.meta?.auth), false)
})

test('基础数据作为一级菜单注册在系统管理顶部主路由内', () => {
  const routesSource = readFileSync(
    new URL('../../src/router/routes.ts', import.meta.url),
    'utf8',
  )

  assert.match(
    routesSource,
    /import BasicData from '\.\/modules\/basic\.data'/u,
  )
  assert.match(
    routesSource,
    /title: '系统管理'[\s\S]*?children: \[[\s\S]*?SystemManagement,[\s\S]*?BasicData,[\s\S]*?ApplicationSettings/u,
  )
})

test('地区管理是受权限保护的真实业务页面', () => {
  const source = readFileSync(
    new URL('../../src/views/system/basic-data/regions/index.vue', import.meta.url),
    'utf8',
  )

  assert.match(source, /<script setup lang="ts">/u)
  assert.match(source, /regionsApi\.management\.(?:navigation|list)/u)
  assert.match(source, /<RegionScopeTree\b/u)
  assert.match(source, /<QsGenericTable\b/u)
})

test('货币汇率单页组合两个真实管理面板', () => {
  const pageSource = readFileSync(
    new URL(
      '../../src/views/system/basic-data/currency-exchange-rate/index.vue',
      import.meta.url,
    ),
    'utf8',
  )
  assert.match(pageSource, /<FaTabs\b/u)

  for (const file of [
    '../../src/views/system/basic-data/currencies/index.vue',
    '../../src/views/system/basic-data/exchange-rates/index.vue',
  ]) {
    const panelSource = readFileSync(new URL(file, import.meta.url), 'utf8')
    assert.match(panelSource, /<script setup lang="ts">/u)
    assert.match(panelSource, /currenciesApi\.(?:currencies|exchangeRates)\.list/u)
    assert.match(panelSource, /<QsGenericTable\b/u)
  }
})

test('编号管理已升级为真实业务页面', () => {
  const source = readFileSync(
    new URL('../../src/views/system/basic-data/numbering/index.vue', import.meta.url),
    'utf8',
  )

  assert.match(source, /<script setup lang="ts">/u)
  assert.match(source, /numberingApi\.rules\.list/u)
  assert.match(source, /<QsGenericTable\b/u)
})

test('字典管理叶子已升级为受权限保护的三面板单页骨架', () => {
  for (const page of basicDataPageContracts.filter(page => page.name === 'systemBasicDataDictionaries')) {
    const source = readFileSync(new URL(page.file, import.meta.url), 'utf8')

    assert.match(source, /<script setup lang="ts">/u)
    assert.match(source, /auth\('dictionaries:read'\)/u)
    assert.equal(source.match(/<FaPageHeader\b/gu)?.length, 1)
    // 无权态单独一个面板，正常态为目录、摘要和条目表格三个面板。
    assert.equal(source.match(/<FaPageMain\b/gu)?.length, 4)
    assert.match(source, /data-testid="dictionary-type-panel"/u)
    assert.match(source, /data-testid="dictionary-type-summary-panel"/u)
    assert.match(source, /data-testid="dictionary-item-table-panel"/u)
  }
})
