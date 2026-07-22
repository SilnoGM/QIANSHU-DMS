import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 路由与页面骨架契约使用 Node.js 内置 runner。
import test from 'node:test'

import componentLibraryRoutes, {
  shouldEnableComponentLibrary,
} from '../../src/router/modules/component.library'

test('组件库在开发环境默认开启，其他环境必须显式启用', () => {
  assert.equal(shouldEnableComponentLibrary({ DEV: true }), true)
  assert.equal(shouldEnableComponentLibrary({
    DEV: true,
    VITE_ENABLE_COMPONENT_LIBRARY: false,
  }), true)
  assert.equal(shouldEnableComponentLibrary({ DEV: false }), false)
  assert.equal(shouldEnableComponentLibrary({
    DEV: false,
    VITE_ENABLE_COMPONENT_LIBRARY: false,
  }), false)
  assert.equal(shouldEnableComponentLibrary({
    DEV: false,
    VITE_ENABLE_COMPONENT_LIBRARY: true,
  }), true)
})

test('组件库提供三个稳定的次导航一级路由', () => {
  assert.deepEqual(
    componentLibraryRoutes.map(route => ({
      name: route.name,
      path: route.path,
      singleMenu: route.meta?.singleMenu,
      title: route.meta?.title,
    })),
    [
      {
        name: 'componentLibraryBasic',
        path: '/component-library/basic',
        singleMenu: true,
        title: '基础组件',
      },
      {
        name: 'componentLibraryBusiness',
        path: '/component-library/business',
        singleMenu: true,
        title: '业务组件',
      },
      {
        name: 'componentLibraryPageTemplates',
        path: '/component-library/page-templates',
        singleMenu: true,
        title: '页面模板',
      },
    ],
  )
})

test('组件库主导航只在环境策略允许时进入 asyncRoutes', () => {
  const routesSource = readFileSync(
    new URL('../../src/router/routes.ts', import.meta.url),
    'utf8',
  )

  assert.match(
    routesSource,
    /import ComponentLibraryRoutes, \{[\s\S]*?shouldEnableComponentLibrary,[\s\S]*?\} from '\.\/modules\/component\.library'/u,
  )
  assert.match(
    routesSource,
    /const componentLibraryMainRoute:[\s\S]*?title: '组件库',[\s\S]*?children: ComponentLibraryRoutes/u,
  )
  assert.match(
    routesSource,
    /shouldEnableComponentLibrary\(import\.meta\.env\)[\s\S]*?componentLibraryMainRoute/u,
  )
})

test('三个分类页面复用展示壳且不依赖业务 API 或 Store', () => {
  const pages = [
    {
      componentName: 'ComponentLibraryBasic',
      file: '../../src/views/component_library/basic/index.vue',
      title: '基础组件',
    },
    {
      componentName: 'ComponentLibraryBusiness',
      file: '../../src/views/component_library/business/index.vue',
      title: '业务组件',
    },
    {
      componentName: 'ComponentLibraryPageTemplates',
      file: '../../src/views/component_library/page_templates/index.vue',
      title: '页面模板',
    },
  ]

  pages.forEach((page) => {
    const source = readFileSync(new URL(page.file, import.meta.url), 'utf8')

    assert.match(source, new RegExp(`defineOptions\\(\\{ name: '${page.componentName}' \\}\\)`, 'u'))
    assert.match(source, /import ComponentCatalogPage from '\.\.\/shared\/ComponentCatalogPage\.vue'/u)
    assert.match(source, new RegExp(`title="${page.title}"`, 'u'))
    assert.doesNotMatch(source, /@\/api|useApp\w*Store/u)
  })
})

test('共享展示壳提供非对称桌面布局、窄屏回退和明确空状态', () => {
  const source = readFileSync(
    new URL('../../src/views/component_library/shared/ComponentCatalogPage.vue', import.meta.url),
    'utf8',
  )

  assert.match(source, /lg-grid-cols-\[minmax\(0,1\.6fr\)_minmax\(18rem,0\.8fr\)\]/u)
  assert.match(source, /<FaEmpty/u)
  assert.match(source, /当前分类暂时没有可验收资产/u)
  assert.match(source, /break-all/u)
})

test('环境模板和独立类型声明记录组件库的默认启用策略', () => {
  const environments = [
    {
      expected: 'VITE_ENABLE_COMPONENT_LIBRARY=true',
      file: '../../.env.development.example',
    },
    {
      expected: 'VITE_ENABLE_COMPONENT_LIBRARY=false',
      file: '../../.env.test.example',
    },
    {
      expected: 'VITE_ENABLE_COMPONENT_LIBRARY=false',
      file: '../../.env.production.example',
    },
  ]

  environments.forEach((environment) => {
    const source = readFileSync(new URL(environment.file, import.meta.url), 'utf8')
    assert.match(source, new RegExp(`^${environment.expected}$`, 'mu'))
  })

  const typeSource = readFileSync(
    new URL('../../src/types/component-library-env.d.ts', import.meta.url),
    'utf8',
  )
  assert.match(typeSource, /readonly VITE_ENABLE_COMPONENT_LIBRARY\?: boolean/u)
})
