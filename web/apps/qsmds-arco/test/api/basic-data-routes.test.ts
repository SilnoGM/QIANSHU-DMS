import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 路由与空页面契约使用 Node.js 内置 runner。
import test from 'node:test'

import basicDataRoutes, {
  BASIC_DATA_READ_PERMISSIONS,
} from '../../src/router/modules/basic.data'

const basicDataPageContracts = [
  {
    file: '../../src/views/system/basic-data/regions/index.vue',
    name: 'systemBasicDataRegions',
    path: 'regions',
    title: '地区管理',
  },
  {
    file: '../../src/views/system/basic-data/currencies/index.vue',
    name: 'systemBasicDataCurrencies',
    path: 'currencies',
    title: '货币管理',
  },
  {
    file: '../../src/views/system/basic-data/exchange-rates/index.vue',
    name: 'systemBasicDataExchangeRates',
    path: 'exchange-rates',
    title: '汇率管理',
  },
  {
    file: '../../src/views/system/basic-data/numbering/index.vue',
    name: 'systemBasicDataNumbering',
    path: 'numbering',
    title: '编号管理',
  },
  {
    file: '../../src/views/system/basic-data/dictionaries/index.vue',
    name: 'systemBasicDataDictionaries',
    path: 'dictionaries',
    title: '字典管理',
  },
] as const

test('基础数据父路由按读取权限进入第一个可访问子页', () => {
  assert.equal(basicDataRoutes.path, '/system/basic-data')
  assert.equal(basicDataRoutes.name, 'systemBasicData')
  assert.equal(basicDataRoutes.meta?.title, '基础数据')
  assert.deepEqual(BASIC_DATA_READ_PERMISSIONS, ['regions:read'])
  assert.deepEqual(basicDataRoutes.meta?.auth, ['regions:read'])
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
      auth: page.name === 'systemBasicDataRegions' ? 'regions:read' : undefined,
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

test('地区以外的四个基础数据叶子路由仍只承载空页面', () => {
  for (const page of basicDataPageContracts.slice(1)) {
    const source = readFileSync(new URL(page.file, import.meta.url), 'utf8')
    const renderedMarkup = source
      .replaceAll(/<\/?template>/gu, '')
      .replaceAll(/<!--[\s\S]*?-->/gu, '')
      .trim()

    assert.equal(
      renderedMarkup,
      '<div />',
      `${page.title}只允许保留满足 Vue 模板约束的空根元素`,
    )
    assert.doesNotMatch(
      source,
      /<script\b|<style\b|@\/api|useApp\w*Store/u,
      `${page.title}当前不得包含脚本、样式、API 或 Store 依赖`,
    )
  }
})
