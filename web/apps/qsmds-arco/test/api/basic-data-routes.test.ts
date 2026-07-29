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
    auth: 'currencies:read',
    file: '../../src/views/system/basic-data/currencies/index.vue',
    name: 'systemBasicDataCurrencies',
    path: 'currencies',
    title: '货币管理',
  },
  {
    auth: 'exchange-rates:read',
    file: '../../src/views/system/basic-data/exchange-rates/index.vue',
    name: 'systemBasicDataExchangeRates',
    path: 'exchange-rates',
    title: '汇率管理',
  },
  {
    auth: undefined,
    file: '../../src/views/system/basic-data/numbering/index.vue',
    name: 'systemBasicDataNumbering',
    path: 'numbering',
    title: '编号管理',
  },
  {
    auth: undefined,
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
      name: route.name,
      path: route.path,
      title: route.meta?.title,
    })),
    basicDataPageContracts.map(page => ({
      auth: page.auth,
      name: page.name,
      path: page.path,
      title: page.title,
    })),
  )
  assert.ok(
    basicDataRoutes.children?.every(route => typeof route.component === 'function'),
  )
  assert.equal(
    new Set(basicDataRoutes.children?.map(route => route.name)).size,
    basicDataPageContracts.length,
  )
})

test('无基础数据读取权限时仍保留两个权限中立菜单', () => {
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
        title: route.meta?.title,
      },
    })),
  }]

  // 使用生产递归过滤函数验证父项保留、三个受保护叶子隐藏及权限中立叶子的顺序。
  const [visibleBasicData] = filterAccessibleMenus(
    menuFixture,
    value => matchesAuthorization(permissions, value),
    () => true,
  )

  assert.equal(visibleBasicData?.path, '/system/basic-data')
  assert.deepEqual(
    visibleBasicData?.children?.map(menu => menu.path),
    ['numbering', 'dictionaries'],
  )
  assert.ok(
    visibleBasicData?.children?.every(
      menu => !['regions', 'currencies', 'exchange-rates'].includes(menu.path),
    ),
  )
})

test('货币与汇率菜单分别受各自读取权限保护', () => {
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
        title: route.meta?.title,
      },
    })),
  }]

  const visiblePaths = (permissions: string[]) => filterAccessibleMenus(
    menuFixture,
    value => matchesAuthorization(permissions, value),
    () => true,
  )[0]?.children?.map(menu => menu.path)

  assert.deepEqual(
    visiblePaths(['currencies:read']),
    ['currencies', 'numbering', 'dictionaries'],
  )
  assert.deepEqual(
    visiblePaths(['exchange-rates:read']),
    ['exchange-rates', 'numbering', 'dictionaries'],
  )
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

test('货币与汇率路由已承载真实管理页面', () => {
  for (const page of basicDataPageContracts.slice(1, 3)) {
    const source = readFileSync(new URL(page.file, import.meta.url), 'utf8')

    assert.match(source, /<script setup lang="ts">/u)
    assert.match(source, /currenciesApi\.(?:currencies|exchangeRates)\.list/u)
    assert.match(source, /<QsGenericTable\b/u)
  }
})

test('编号与字典两个未实施叶子路由仍只承载空页面', () => {
  for (const page of basicDataPageContracts.slice(3)) {
    const source = readFileSync(new URL(page.file, import.meta.url), 'utf8')
    const templateMatch = source.match(/<template>([\s\S]*?)<\/template>/u)

    assert.ok(templateMatch, `${page.title}必须保留 Vue template`)
    // 必须检查原始模板内容，不能先删除顶层注释；否则 Vue 会把空页面编译为
    // Fragment，离开该页面时会让外层 out-in Transition 永久停在占位节点。
    assert.equal(
      templateMatch[1]?.trim(),
      '<div />',
      `${page.title}只允许保留单一空根元素，说明注释必须位于 template 外部`,
    )
    assert.doesNotMatch(
      source,
      /<script\b|<style\b|@\/api|useApp\w*Store/u,
      `${page.title}当前不得包含脚本、样式、API 或 Store 依赖`,
    )
  }
})
