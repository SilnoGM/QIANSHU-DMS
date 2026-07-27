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

test('组件库按分类提供九个独立组件路由', () => {
  const [basicRoute, businessRoute, pageTemplatesRoute] = componentLibraryRoutes

  assert.equal(basicRoute?.name, 'componentLibraryBasic')
  assert.equal(basicRoute?.path, '/component-library/basic')
  assert.equal(basicRoute?.meta?.title, '基础组件')
  assert.equal(basicRoute?.meta?.singleMenu, undefined)
  assert.deepEqual(basicRoute?.redirect, {
    name: 'componentLibraryAmountDisplay',
  })
  assert.deepEqual(
    basicRoute?.children?.map(route => ({
      name: route.name,
      path: route.path,
      title: route.meta?.title,
    })),
    [
      {
        name: 'componentLibraryAmountDisplay',
        path: 'amount-display',
        title: '金额显示',
      },
      {
        name: 'componentLibraryMoneyInput',
        path: 'money-input',
        title: '金额输入',
      },
      {
        name: 'componentLibraryDateTimeDisplay',
        path: 'date-time-display',
        title: '日期显示',
      },
      {
        name: 'componentLibraryQsToast',
        path: 'toast',
        title: '轻提示',
      },
      {
        name: 'componentLibraryImageGroup',
        path: 'image-group',
        title: '图片组',
      },
    ],
  )

  assert.equal(businessRoute?.name, 'componentLibraryBusiness')
  assert.equal(businessRoute?.path, '/component-library/business')
  assert.equal(businessRoute?.meta?.title, '业务组件')
  assert.equal(businessRoute?.meta?.singleMenu, undefined)
  assert.deepEqual(businessRoute?.redirect, {
    name: 'componentLibraryGenericTable',
  })
  assert.deepEqual(
    businessRoute?.children?.map(route => ({
      name: route.name,
      path: route.path,
      title: route.meta?.title,
    })),
    [
      {
        name: 'componentLibraryGenericTable',
        path: 'generic-table',
        title: '通用表格',
      },
      {
        name: 'componentLibraryGenericDrawer',
        path: 'generic-drawer',
        title: '通用抽屉',
      },
      {
        name: 'componentLibraryGenericModal',
        path: 'generic-modal',
        title: '通用模态框',
      },
      {
        name: 'componentLibraryQsGoodTooltip',
        path: 'good-tooltip',
        title: '产品提示',
      },
    ],
  )

  assert.equal(pageTemplatesRoute?.name, 'componentLibraryPageTemplates')
  assert.equal(pageTemplatesRoute?.path, '/component-library/page-templates')
  assert.equal(pageTemplatesRoute?.meta?.title, '页面模板')
  assert.equal(pageTemplatesRoute?.meta?.singleMenu, true)

  const componentRouteNames = [
    ...(basicRoute?.children ?? []),
    ...(businessRoute?.children ?? []),
  ].map(route => route.name)
  assert.equal(new Set(componentRouteNames).size, 9)
  assert.ok(
    [...(basicRoute?.children ?? []), ...(businessRoute?.children ?? [])]
      .every(route => !route.path.startsWith('/')),
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

test('九个组件页面与页面模板复用展示壳且不依赖业务 API 或 Store', () => {
  const pages = [
    {
      componentName: 'ComponentLibraryAmountDisplay',
      file: '../../src/views/component_library/basic/index.vue',
      title: '金额显示',
    },
    {
      componentName: 'ComponentLibraryDateTimeDisplay',
      file: '../../src/views/component_library/basic/date-time-display.vue',
      title: '日期显示',
    },
    {
      componentName: 'ComponentLibraryMoneyInput',
      file: '../../src/views/component_library/basic/money-input.vue',
      title: '金额输入',
    },
    {
      componentName: 'ComponentLibraryQsToast',
      file: '../../src/views/component_library/basic/toast.vue',
      title: '轻提示',
    },
    {
      componentName: 'ComponentLibraryImageGroup',
      file: '../../src/views/component_library/basic/image-group.vue',
      title: '图片组',
    },
    {
      componentName: 'ComponentLibraryGenericTable',
      file: '../../src/views/component_library/business/index.vue',
      title: '通用表格',
    },
    {
      componentName: 'ComponentLibraryGenericDrawer',
      file: '../../src/views/component_library/business/generic-drawer.vue',
      title: '通用抽屉',
    },
    {
      componentName: 'ComponentLibraryGenericModal',
      file: '../../src/views/component_library/business/generic-modal.vue',
      title: '通用模态框',
    },
    {
      componentName: 'ComponentLibraryQsGoodTooltip',
      file: '../../src/views/component_library/business/good-tooltip.vue',
      title: '产品提示',
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
