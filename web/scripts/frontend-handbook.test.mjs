/* eslint-disable test/no-import-node-test */

import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const handbookPath = fileURLToPath(new URL('../../docs/前端文档/前端开发手册/README.md', import.meta.url))
const handbookDirectoryPath = dirname(handbookPath)
const qsmdsArcoManifestPath = fileURLToPath(new URL('../apps/qsmds-arco/package.json', import.meta.url))
const requireFromQsmdsArco = createRequire(qsmdsArcoManifestPath)
const {
  compileScript: compileVueScript,
  compileTemplate: compileVueTemplate,
  parse: parseVueSfc,
} = requireFromQsmdsArco('vue/compiler-sfc')
const fantasticAdminHandbookPaths = {
  index: fileURLToPath(new URL('../../docs/前端文档/前端开发手册/Fantastic-admin/README.md', import.meta.url)),
  guide: fileURLToPath(new URL('../../docs/前端文档/前端开发手册/Fantastic-admin/指引与开发准备.md', import.meta.url)),
  skills: fileURLToPath(new URL('../../docs/前端文档/前端开发手册/Fantastic-admin/AI技能.md', import.meta.url)),
  foundation: fileURLToPath(new URL('../../docs/前端文档/前端开发手册/Fantastic-admin/工程基础.md', import.meta.url)),
  apiAndLogin: fileURLToPath(new URL('../../docs/前端文档/前端开发手册/Fantastic-admin/服务端交互与登录.md', import.meta.url)),
  routingAndState: fileURLToPath(new URL('../../docs/前端文档/前端开发手册/Fantastic-admin/路由导航与状态管理.md', import.meta.url)),
  settings: fileURLToPath(new URL('../../docs/前端文档/前端开发手册/Fantastic-admin/应用配置.md', import.meta.url)),
  authKeepAliveAndI18n: fileURLToPath(new URL('../../docs/前端文档/前端开发手册/Fantastic-admin/权限保活与国际化.md', import.meta.url)),
  advanced: fileURLToPath(new URL('../../docs/前端文档/前端开发手册/Fantastic-admin/高级能力构建与升级.md', import.meta.url)),
}
const fantasticAdminComponentHandbookPaths = {
  index: fileURLToPath(new URL('../../docs/前端文档/前端开发手册/Fantastic-admin内置组件/README.md', import.meta.url)),
  selection: fileURLToPath(new URL('../../docs/前端文档/前端开发手册/Fantastic-admin内置组件/选型与使用规则.md', import.meta.url)),
  basic: fileURLToPath(new URL('../../docs/前端文档/前端开发手册/Fantastic-admin内置组件/基础版组件.md', import.meta.url)),
  pro: fileURLToPath(new URL('../../docs/前端文档/前端开发手册/Fantastic-admin内置组件/专业版组件.md', import.meta.url)),
}
const arcoDesignVueHandbookPaths = {
  index: fileURLToPath(new URL('../../docs/前端文档/前端开发手册/Arco-Design-Vue/README.md', import.meta.url)),
  integration: fileURLToPath(new URL('../../docs/前端文档/前端开发手册/Arco-Design-Vue/接入基础与全局配置.md', import.meta.url)),
  commonAndLayout: fileURLToPath(new URL('../../docs/前端文档/前端开发手册/Arco-Design-Vue/通用与布局组件.md', import.meta.url)),
  dataEntry: fileURLToPath(new URL('../../docs/前端文档/前端开发手册/Arco-Design-Vue/数据录入组件.md', import.meta.url)),
  dataDisplay: fileURLToPath(new URL('../../docs/前端文档/前端开发手册/Arco-Design-Vue/数据展示组件.md', import.meta.url)),
  feedback: fileURLToPath(new URL('../../docs/前端文档/前端开发手册/Arco-Design-Vue/反馈组件.md', import.meta.url)),
  navigationAndOther: fileURLToPath(new URL('../../docs/前端文档/前端开发手册/Arco-Design-Vue/导航与其他组件.md', import.meta.url)),
}
const arcoDesignVueIntegrationSourcePaths = {
  componentTypes: fileURLToPath(new URL('../node_modules/@arco-design/web-vue/es/components.d.ts', import.meta.url)),
  main: fileURLToPath(new URL('../apps/qsmds-arco/src/main.ts', import.meta.url)),
  message: fileURLToPath(new URL('../node_modules/@arco-design/web-vue/es/message/index.js', import.meta.url)),
  modal: fileURLToPath(new URL('../node_modules/@arco-design/web-vue/es/modal/index.js', import.meta.url)),
  notification: fileURLToPath(new URL('../node_modules/@arco-design/web-vue/es/notification/index.js', import.meta.url)),
  providerPlugin: fileURLToPath(new URL('../apps/qsmds-arco/src/ui/provider/index.ts', import.meta.url)),
  providerComponent: fileURLToPath(new URL('../apps/qsmds-arco/src/ui/provider/index.vue', import.meta.url)),
  vitePlugins: fileURLToPath(new URL('../apps/qsmds-arco/vite/plugins.ts', import.meta.url)),
}
const arcoDesignVueTask6SourcePaths = {
  timePickerTypes: fileURLToPath(new URL('../node_modules/@arco-design/web-vue/es/time-picker/time-picker.d.ts', import.meta.url)),
  uploadTypes: fileURLToPath(new URL('../node_modules/@arco-design/web-vue/es/upload/upload.d.ts', import.meta.url)),
}
const arcoDesignVueTask7SourcePaths = {
  alert: fileURLToPath(new URL('../node_modules/@arco-design/web-vue/es/alert/alert.js', import.meta.url)),
  anchor: fileURLToPath(new URL('../node_modules/@arco-design/web-vue/es/anchor/anchor.js', import.meta.url)),
  arcoVue: fileURLToPath(new URL('../node_modules/@arco-design/web-vue/es/arco-vue.js', import.meta.url)),
  avatar: fileURLToPath(new URL('../node_modules/@arco-design/web-vue/es/avatar/avatar.js', import.meta.url)),
  calendar: fileURLToPath(new URL('../node_modules/@arco-design/web-vue/es/calendar/calendar.js', import.meta.url)),
  collapseItem: fileURLToPath(new URL('../node_modules/@arco-design/web-vue/es/collapse/collapse-item.js', import.meta.url)),
  collapseTypes: fileURLToPath(new URL('../node_modules/@arco-design/web-vue/es/collapse/collapse.d.ts', import.meta.url)),
  configProvider: fileURLToPath(new URL('../node_modules/@arco-design/web-vue/es/config-provider/config-provider.js', import.meta.url)),
  drawer: fileURLToPath(new URL('../node_modules/@arco-design/web-vue/es/drawer/index.js', import.meta.url)),
  drawerComponent: fileURLToPath(new URL('../node_modules/@arco-design/web-vue/es/drawer/drawer.js', import.meta.url)),
  empty: fileURLToPath(new URL('../node_modules/@arco-design/web-vue/es/empty/empty.js', import.meta.url)),
  faPageHeader: fileURLToPath(new URL('../packages/components/src/basic/page-header/index.vue', import.meta.url)),
  faTabs: fileURLToPath(new URL('../packages/components/src/basic/tabs/index.vue', import.meta.url)),
  icon: fileURLToPath(new URL('../node_modules/@arco-design/web-vue/es/icon-component/icon.js', import.meta.url)),
  image: fileURLToPath(new URL('../node_modules/@arco-design/web-vue/es/image/image.js', import.meta.url)),
  imagePreview: fileURLToPath(new URL('../node_modules/@arco-design/web-vue/es/image/preview.vue_vue_type_script_lang.js', import.meta.url)),
  imagePreviewAction: fileURLToPath(new URL('../node_modules/@arco-design/web-vue/es/image/preview-action.js', import.meta.url)),
  imagePreviewGroup: fileURLToPath(new URL('../node_modules/@arco-design/web-vue/es/image/preview-group.vue_vue_type_script_lang.js', import.meta.url)),
  notificationTypes: fileURLToPath(new URL('../node_modules/@arco-design/web-vue/es/notification/index.d.ts', import.meta.url)),
  overflowList: fileURLToPath(new URL('../node_modules/@arco-design/web-vue/es/overflow-list/overflow-list.js', import.meta.url)),
  pageHeader: fileURLToPath(new URL('../node_modules/@arco-design/web-vue/es/page-header/page-header.js', import.meta.url)),
  popconfirm: fileURLToPath(new URL('../node_modules/@arco-design/web-vue/es/popconfirm/popconfirm.js', import.meta.url)),
  resizeBoxTypes: fileURLToPath(new URL('../node_modules/@arco-design/web-vue/es/resize-box/resize-box.d.ts', import.meta.url)),
  scrollbar: fileURLToPath(new URL('../node_modules/@arco-design/web-vue/es/scrollbar/scrollbar.js', import.meta.url)),
  scrollbarTypes: fileURLToPath(new URL('../node_modules/@arco-design/web-vue/es/scrollbar/scrollbar.d.ts', import.meta.url)),
  skeleton: fileURLToPath(new URL('../node_modules/@arco-design/web-vue/es/skeleton/skeleton.js', import.meta.url)),
  splitTypes: fileURLToPath(new URL('../node_modules/@arco-design/web-vue/es/split/split.d.ts', import.meta.url)),
  spin: fileURLToPath(new URL('../node_modules/@arco-design/web-vue/es/spin/spin.js', import.meta.url)),
  table: fileURLToPath(new URL('../node_modules/@arco-design/web-vue/es/table/table.js', import.meta.url)),
  tableColumn: fileURLToPath(new URL('../node_modules/@arco-design/web-vue/es/table/table-column.js', import.meta.url)),
  tableColumnSorter: fileURLToPath(new URL('../node_modules/@arco-design/web-vue/es/table/hooks/use-column-sorter.js', import.meta.url)),
  tableTypes: fileURLToPath(new URL('../node_modules/@arco-design/web-vue/es/table/interface.d.ts', import.meta.url)),
  tabsTypes: fileURLToPath(new URL('../node_modules/@arco-design/web-vue/es/tabs/tabs.d.ts', import.meta.url)),
  topbarTabbar: fileURLToPath(new URL('../apps/qsmds-arco/src/layouts/components/Topbar/Tabbar/index.vue', import.meta.url)),
  topbarTabbarStore: fileURLToPath(new URL('../apps/qsmds-arco/src/store/modules/app/tabbar.ts', import.meta.url)),
  tree: fileURLToPath(new URL('../node_modules/@arco-design/web-vue/es/tree/tree.js', import.meta.url)),
  treeBaseNode: fileURLToPath(new URL('../node_modules/@arco-design/web-vue/es/tree/base-node.js', import.meta.url)),
  treeCheckUtils: fileURLToPath(new URL('../node_modules/@arco-design/web-vue/es/tree/utils/check-utils.js', import.meta.url)),
  trigger: fileURLToPath(new URL('../node_modules/@arco-design/web-vue/es/trigger/trigger.js', import.meta.url)),
}
const documentIndexPath = fileURLToPath(new URL('../../docs/文档索引.md', import.meta.url))
const serverOpenApiPath = fileURLToPath(new URL('../../server/openapi/openapi.json', import.meta.url))
const webManifestPath = fileURLToPath(new URL('../package.json', import.meta.url))
const repositoryRootPath = resolve(dirname(webManifestPath), '..')
const webLockfilePath = fileURLToPath(new URL('../pnpm-lock.yaml', import.meta.url))
const contractApiEndpointPaths = new Set(
  Object.keys(JSON.parse(readFileSync(serverOpenApiPath, 'utf8')).paths ?? {}),
)
const fantasticAdminComponentsIndexPath = fileURLToPath(new URL('../packages/components/src/index.ts', import.meta.url))
const fantasticAdminProSourcePaths = {
  codePreview: fileURLToPath(new URL('../packages/components/src/pro/code-preview/index.vue', import.meta.url)),
  loading: fileURLToPath(new URL('../packages/components/src/pro/loading/useLoading.ts', import.meta.url)),
  mention: fileURLToPath(new URL('../packages/components/src/pro/mention/mention/index.ts', import.meta.url)),
  multiStepLoader: fileURLToPath(new URL('../packages/components/src/pro/multi-step-loader/index.vue', import.meta.url)),
  patternBgVariants: fileURLToPath(new URL('../packages/components/src/pro/pattern-bg/variants.ts', import.meta.url)),
  steps: fileURLToPath(new URL('../packages/components/src/pro/steps/index.vue', import.meta.url)),
}
const pageOptimizerGovernancePaths = {
  skill: fileURLToPath(new URL('../skills/fa-page-optimizer/SKILL.md', import.meta.url)),
  catalog: fileURLToPath(new URL('../skills/fa-page-optimizer/references/components-catalog.md', import.meta.url)),
  basicReadme: fileURLToPath(new URL('../packages/components/src/basic/form/README.md', import.meta.url)),
  proReadme: fileURLToPath(new URL('../packages/components/src/pro/icon-picker/README.md', import.meta.url)),
}

const fantasticAdminCoverage = [
  ['指引 / 文档说明', 'https://fantastic-admin.hurui.me/guide/intro.md', './指引与开发准备.md#文档说明'],
  ['指引 / 为什么选择我们', 'https://fantastic-admin.hurui.me/guide/why.md', './指引与开发准备.md#为什么选择-fantastic-admin'],
  ['指引 / 更新日志', 'https://fantastic-admin.hurui.me/guide/changelog.md', './指引与开发准备.md#更新日志的阅读方法'],
  ['AI 技能 / 介绍', 'https://fantastic-admin.hurui.me/guide/skills.md', './AI技能.md#介绍'],
  ['AI 技能 / fa-crud-page-generator', 'https://fantastic-admin.hurui.me/guide/skills/fa-crud-page-generator.md', './AI技能.md#fa-crud-page-generator'],
  ['AI 技能 / fa-form-builder', 'https://fantastic-admin.hurui.me/guide/skills/fa-form-builder.md', './AI技能.md#fa-form-builder'],
  ['AI 技能 / fa-framework-settings', 'https://fantastic-admin.hurui.me/guide/skills/fa-framework-settings.md', './AI技能.md#fa-framework-settings'],
  ['AI 技能 / fa-i18n-manager', 'https://fantastic-admin.hurui.me/guide/skills/fa-i18n-manager.md', './AI技能.md#fa-i18n-manager'],
  ['AI 技能 / fa-page-optimizer', 'https://fantastic-admin.hurui.me/guide/skills/fa-page-optimizer.md', './AI技能.md#fa-page-optimizer'],
  ['AI 技能 / fa-route-generator', 'https://fantastic-admin.hurui.me/guide/skills/fa-route-generator.md', './AI技能.md#fa-route-generator'],
  ['AI 技能 / fa-slot-creator', 'https://fantastic-admin.hurui.me/guide/skills/fa-slot-creator.md', './AI技能.md#fa-slot-creator'],
  ['AI 技能 / fa-store-generator', 'https://fantastic-admin.hurui.me/guide/skills/fa-store-generator.md', './AI技能.md#fa-store-generator'],
  ['AI 技能 / fa-theme-customizer', 'https://fantastic-admin.hurui.me/guide/skills/fa-theme-customizer.md', './AI技能.md#fa-theme-customizer'],
  ['入门 / 准备工作', 'https://fantastic-admin.hurui.me/guide/ready.md', './指引与开发准备.md#开发前提'],
  ['入门 / 开始', 'https://fantastic-admin.hurui.me/guide/start.md', './指引与开发准备.md#工作区启动与检查'],
  ['入门 / 代码规范', 'https://fantastic-admin.hurui.me/guide/coding-standard.md', './指引与开发准备.md#代码规范'],
  ['入门 / 术语', 'https://fantastic-admin.hurui.me/guide/term.md', './指引与开发准备.md#项目术语'],
  ['入门 / 环境变量', 'https://fantastic-admin.hurui.me/guide/env.md', './工程基础.md#环境变量'],
  ['入门 / 资源', 'https://fantastic-admin.hurui.me/guide/resources.md', './工程基础.md#资源'],
  ['入门 / 图标', 'https://fantastic-admin.hurui.me/guide/icon.md', './工程基础.md#图标'],
  ['入门 / 构建与预览', 'https://fantastic-admin.hurui.me/guide/build.md', './工程基础.md#构建与预览'],
  ['高级 / Composition API', 'https://fantastic-admin.hurui.me/guide/composition-api.md', './工程基础.md#composition-api'],
  ['高级 / JSX', 'https://fantastic-admin.hurui.me/guide/jsx.md', './工程基础.md#jsx'],
  ['入门 / 与服务端交互', 'https://fantastic-admin.hurui.me/guide/axios.md', './服务端交互与登录.md#与服务端交互'],
  ['入门 / 登录相关', 'https://fantastic-admin.hurui.me/guide/login.md', './服务端交互与登录.md#登录相关'],
  ['入门 / 路由 (导航菜单)', 'https://fantastic-admin.hurui.me/guide/router.md', './路由导航与状态管理.md#路由导航菜单'],
  ['入门 / 全局状态管理', 'https://fantastic-admin.hurui.me/guide/store.md', './路由导航与状态管理.md#全局状态管理'],
  ['应用配置 / 介绍', 'https://fantastic-admin.hurui.me/guide/settings.md', './应用配置.md#应用配置介绍'],
  ['应用配置 / 应用', 'https://fantastic-admin.hurui.me/guide/settings/app.md', './应用配置.md#应用'],
  ['应用配置 / 主题', 'https://fantastic-admin.hurui.me/guide/settings/theme.md', './应用配置.md#主题'],
  ['应用配置 / 导航菜单', 'https://fantastic-admin.hurui.me/guide/settings/menu.md', './应用配置.md#导航菜单'],
  ['应用配置 / 顶栏', 'https://fantastic-admin.hurui.me/guide/settings/topbar.md', './应用配置.md#顶栏'],
  ['应用配置 / 标签栏', 'https://fantastic-admin.hurui.me/guide/settings/tabbar.md', './应用配置.md#标签栏'],
  ['应用配置 / 工具栏', 'https://fantastic-admin.hurui.me/guide/settings/toolbar.md', './应用配置.md#工具栏'],
  ['应用配置 / 页面', 'https://fantastic-admin.hurui.me/guide/settings/page.md', './应用配置.md#页面'],
  ['高级 / 权限验证', 'https://fantastic-admin.hurui.me/guide/auth.md', './权限保活与国际化.md#权限验证'],
  ['高级 / 页面保活', 'https://fantastic-admin.hurui.me/guide/keep-alive.md', './权限保活与国际化.md#页面保活'],
  ['高级 / 国际化', 'https://fantastic-admin.hurui.me/guide/i18n.md', './权限保活与国际化.md#国际化'],
  ['高级 / 内置 API', 'https://fantastic-admin.hurui.me/guide/api.md', './高级能力构建与升级.md#内置-api'],
  ['高级 / 预留插槽', 'https://fantastic-admin.hurui.me/guide/slots.md', './高级能力构建与升级.md#预留插槽'],
  ['高级 / 快捷键', 'https://fantastic-admin.hurui.me/guide/hotkeys.md', './权限保活与国际化.md#快捷键'],
  ['高级 / 私有 Storage 数据', 'https://fantastic-admin.hurui.me/guide/storage.md', './权限保活与国际化.md#私有-storage-数据'],
  ['高级 / 开发者工具', 'https://fantastic-admin.hurui.me/guide/devtools.md', './高级能力构建与升级.md#开发者工具'],
  ['高级 / 自定义字体', 'https://fantastic-admin.hurui.me/guide/font.md', './高级能力构建与升级.md#自定义字体'],
  ['高级 / 首屏 Loading', 'https://fantastic-admin.hurui.me/guide/loading.md', './高级能力构建与升级.md#首屏-loading'],
  ['高级 / 搭配 UI 组件库', 'https://fantastic-admin.hurui.me/guide/with-ui-libraries.md', './高级能力构建与升级.md#搭配-ui-组件库'],
  ['其他 / 框架更新', 'https://fantastic-admin.hurui.me/guide/upgrade.md', './高级能力构建与升级.md#框架更新'],
  ['其他 / 常见问题', 'https://fantastic-admin.hurui.me/guide/q-a.md', './高级能力构建与升级.md#常见问题'],
  ['其他 / 从 v5 迁移', 'https://fantastic-admin.hurui.me/guide/migration-from-v5.md', './高级能力构建与升级.md#从-v5-迁移'],
]

const fantasticAdminReadingOrder = [
  ['Fantastic-admin 开发手册', './README.md'],
  ['指引与开发准备', './指引与开发准备.md'],
  ['工程基础', './工程基础.md'],
  ['服务端交互与登录', './服务端交互与登录.md'],
  ['路由导航与状态管理', './路由导航与状态管理.md'],
  ['应用配置', './应用配置.md'],
  ['权限、保活与国际化', './权限保活与国际化.md'],
  ['高级能力、构建与升级', './高级能力构建与升级.md'],
  ['AI 技能', './AI技能.md'],
]

const arcoDesignVueCoverage = [
  ['Button', '通用', 'commonAndLayout', 'button'],
  ['Link', '通用', 'commonAndLayout', 'link'],
  ['Typography', '通用', 'commonAndLayout', 'typography'],
  ['Divider', '布局', 'commonAndLayout', 'divider'],
  ['Grid', '布局', 'commonAndLayout', 'grid'],
  ['Layout', '布局', 'commonAndLayout', 'layout'],
  ['Space', '布局', 'commonAndLayout', 'space'],
  ['AutoComplete', '数据录入', 'dataEntry', 'auto-complete'],
  ['Cascader', '数据录入', 'dataEntry', 'cascader'],
  ['Checkbox', '数据录入', 'dataEntry', 'checkbox'],
  ['ColorPicker', '数据录入', 'dataEntry', 'color-picker'],
  ['DatePicker', '数据录入', 'dataEntry', 'date-picker'],
  ['Form', '数据录入', 'dataEntry', 'form'],
  ['Input', '数据录入', 'dataEntry', 'input'],
  ['InputNumber', '数据录入', 'dataEntry', 'input-number'],
  ['InputTag', '数据录入', 'dataEntry', 'input-tag'],
  ['Mention', '数据录入', 'dataEntry', 'mention'],
  ['Radio', '数据录入', 'dataEntry', 'radio'],
  ['Rate', '数据录入', 'dataEntry', 'rate'],
  ['Select', '数据录入', 'dataEntry', 'select'],
  ['Slider', '数据录入', 'dataEntry', 'slider'],
  ['Switch', '数据录入', 'dataEntry', 'switch'],
  ['Textarea', '数据录入', 'dataEntry', 'textarea'],
  ['TimePicker', '数据录入', 'dataEntry', 'time-picker'],
  ['Transfer', '数据录入', 'dataEntry', 'transfer'],
  ['TreeSelect', '数据录入', 'dataEntry', 'tree-select'],
  ['Upload', '数据录入', 'dataEntry', 'upload'],
  ['VerificationCode', '数据录入', 'dataEntry', 'verification-code'],
  ['Avatar', '数据展示', 'dataDisplay', 'avatar'],
  ['Badge', '数据展示', 'dataDisplay', 'badge'],
  ['Calendar', '数据展示', 'dataDisplay', 'calendar'],
  ['Card', '数据展示', 'dataDisplay', 'card'],
  ['Carousel', '数据展示', 'dataDisplay', 'carousel'],
  ['Collapse', '数据展示', 'dataDisplay', 'collapse'],
  ['Comment', '数据展示', 'dataDisplay', 'comment'],
  ['Descriptions', '数据展示', 'dataDisplay', 'descriptions'],
  ['Empty', '数据展示', 'dataDisplay', 'empty'],
  ['Image', '数据展示', 'dataDisplay', 'image'],
  ['List', '数据展示', 'dataDisplay', 'list'],
  ['Popover', '数据展示', 'dataDisplay', 'popover'],
  ['Progress', '数据展示', 'dataDisplay', 'progress'],
  ['Statistic', '数据展示', 'dataDisplay', 'statistic'],
  ['Table', '数据展示', 'dataDisplay', 'table'],
  ['Tag', '数据展示', 'dataDisplay', 'tag'],
  ['Timeline', '数据展示', 'dataDisplay', 'timeline'],
  ['Tooltip', '数据展示', 'dataDisplay', 'tooltip'],
  ['Tree', '数据展示', 'dataDisplay', 'tree'],
  ['Alert', '反馈', 'feedback', 'alert'],
  ['Drawer', '反馈', 'feedback', 'drawer'],
  ['Message', '反馈', 'feedback', 'message'],
  ['Modal', '反馈', 'feedback', 'modal'],
  ['Notification', '反馈', 'feedback', 'notification'],
  ['Popconfirm', '反馈', 'feedback', 'popconfirm'],
  ['Result', '反馈', 'feedback', 'result'],
  ['Skeleton', '反馈', 'feedback', 'skeleton'],
  ['Spin', '反馈', 'feedback', 'spin'],
  ['Affix', '导航', 'navigationAndOther', 'affix'],
  ['Anchor', '导航', 'navigationAndOther', 'anchor'],
  ['BackTop', '导航', 'navigationAndOther', 'back-top'],
  ['Breadcrumb', '导航', 'navigationAndOther', 'breadcrumb'],
  ['Dropdown', '导航', 'navigationAndOther', 'dropdown'],
  ['Menu', '导航', 'navigationAndOther', 'menu'],
  ['PageHeader', '导航', 'navigationAndOther', 'page-header'],
  ['Pagination', '导航', 'navigationAndOther', 'pagination'],
  ['Steps', '导航', 'navigationAndOther', 'steps'],
  ['Tabs', '导航', 'navigationAndOther', 'tabs'],
  ['ConfigProvider', '其他', 'navigationAndOther', 'config-provider'],
  ['Icon', '其他', 'navigationAndOther', 'icon-component'],
  ['OverflowList', '其他', 'navigationAndOther', 'overflow-list'],
  ['ResizeBox', '其他', 'navigationAndOther', 'resize-box'],
  ['Scrollbar', '其他', 'navigationAndOther', 'scrollbar'],
  ['Split', '其他', 'navigationAndOther', 'split'],
  ['Trigger', '其他', 'navigationAndOther', 'trigger'],
  ['Watermark', '其他', 'navigationAndOther', 'watermark'],
]

const arcoTask6DocumentKeys = new Set(['commonAndLayout', 'dataEntry'])
const arcoTask6Coverage = arcoDesignVueCoverage.filter(([, , documentKey]) => arcoTask6DocumentKeys.has(documentKey))
const arcoTask7Coverage = arcoDesignVueCoverage.filter(([, , documentKey]) => !arcoTask6DocumentKeys.has(documentKey))

const handbookTaskNavigation = [
  ['新增页面', './Fantastic-admin/路由导航与状态管理.md#路由导航菜单'],
  ['配置路由', './Fantastic-admin/路由导航与状态管理.md#路由导航菜单'],
  ['接入登录', './Fantastic-admin/服务端交互与登录.md#登录相关'],
  ['实现权限', './Fantastic-admin/权限保活与国际化.md#权限验证'],
  ['选择表单', './Fantastic-admin内置组件/选型与使用规则.md#4-与-arco-重叠能力的选择'],
  ['选择表格', './Fantastic-admin内置组件/选型与使用规则.md#4-与-arco-重叠能力的选择'],
  ['上传文件', './Fantastic-admin内置组件/选型与使用规则.md#4-与-arco-重叠能力的选择'],
  ['反馈状态', './Fantastic-admin内置组件/选型与使用规则.md#4-与-arco-重叠能力的选择'],
  ['主题配置', './Fantastic-admin/应用配置.md#主题'],
  ['构建升级', './Fantastic-admin/高级能力构建与升级.md#框架更新'],
]

const fantasticAdminArcoOverlapContracts = [
  ['Button', ['`FaButton`', '`FaButtonGroup`'], ['`AButton`', '`AButtonGroup`'], '标准业务操作优先 Fantastic-admin；`FaButton` 无法满足已确认交互时才回退 Arco，单一操作区不混用组件族。'],
  ['Card', ['`FaCard`'], ['`ACard`', '`ACardMeta`', '`ACardGrid`'], '标准业务内容卡片优先 Fantastic-admin；`FaCard` 缺少已确认结构能力时才回退 Arco，不为局部外观混用组件族。'],
  ['Form', ['`FaForm`', '`FaFormItem`'], ['`AForm`', '`AFormItem`'], '标准业务表单优先 Fantastic-admin；无法满足校验或字段契约时才回退 Arco，并完整迁移校验、提交、disabled 与 slot 语义。'],
  ['Input', ['`FaInput`', '`FaTextarea`'], ['`AInput`', '`ATextarea`'], '业务录入优先 Fantastic-admin；Fa 输入能力无法满足已确认交互时才回退 Arco，同一表单只保留一套值、错误、焦点和尺寸契约。'],
  ['Select', ['`FaSelect`', '`FaCombobox`', '`FaCascader`', '`FaCheckboxGroup`', '`FaRadioGroup`'], ['`ASelect`', '`ACascader`', '`ATreeSelect`', '`ACheckboxGroup`', '`ARadioGroup`'], '业务选择优先 Fantastic-admin；搜索单选先核对 `FaCombobox`，层级单选先核对 `FaCascader`；Fa 选择能力仍无法满足多选、树选择或大数据契约时才按需求回退 Arco。'],
  ['Table', ['`FaTable`', '`FaDescriptions`'], ['`ATable`', '`ADescriptions`'], '标准业务数据展示优先 Fantastic-admin；`FaTable` 无法满足已确认表格能力时才回退 Arco，TanStack columns 与 Arco 声明式列契约不得混写。'],
  ['Pagination', ['`FaPagination`'], ['`APagination`'], '业务列表优先 Fantastic-admin；`FaPagination` 无法满足已确认分页能力时才回退 Arco，并与查询的 page、pageSize、total 保持单一受控状态。'],
  ['Modal/Drawer', ['`FaModal`', '`FaDrawer`', '`useFaModal`', '`useFaDrawer`'], ['`AModal`', '`ADrawer`', '`$modal`', '`$drawer`'], '业务编辑与确认优先 Fantastic-admin；Fa 浮层无法满足已确认交互时才回退 Arco，并统一异步关闭、错误反馈和焦点恢复。'],
  ['Toast/Message', ['`FaToast`', '`useFaToast`'], ['`Message`', '`Notification`', '`$message`', '`$notification`'], '业务反馈优先 Fantastic-admin；Fa 反馈无法满足已确认上下文或交互时才回退 Arco，静态方法与实例注入的 context 不跨层冒充。'],
  ['Tooltip/Popover', ['`FaTooltip`', '`FaPopover`'], ['`ATooltip`', '`APopover`', '`ATrigger`'], '业务说明浮层优先 Fantastic-admin；Fa 浮层无法满足触发、碰撞或内容契约时才回退 Arco，并验证键盘与触屏。'],
  ['Tabs', ['`FaTabs`'], ['`ATabs`'], '业务内容切换优先 Fantastic-admin；`FaTabs` 无法满足已确认切换契约时才回退 Arco，二者都不能替代 Fantastic-admin 的路由 Tabbar。'],
  ['Tag/Badge', ['`FaTag`', '`FaBadge`'], ['`ATag`', '`ABadge`'], '业务状态与计数优先 Fantastic-admin；Fa 变体无法满足已确认语义时才回退 Arco，颜色之外必须保留文字、数值或可读状态。'],
  ['Upload', ['`FaFileUpload`', '`FaImageUpload`'], ['`AUpload`'], '标准业务上传优先 Fantastic-admin；Fa request 或进度契约无法满足需求时才回退 Arco，二者都必须接入受控 HTTP client。'],
  ['ImagePreview', ['`FaImagePreview`', '`useFaImagePreview`'], ['`AImage`', '`AImagePreview`', '`AImagePreviewGroup`'], '标准业务图片预览优先 Fantastic-admin；需要 `alt` 等 Fa 未提供的契约时才回退 Arco 或原生语义元素，不伪造不存在的 prop。'],
  ['Tree', ['`FaTree`'], ['`ATree`', '`ATreeSelect`'], '标准业务树优先 Fantastic-admin；`FaTree` 无法满足选择、搜索或无障碍契约时才回退 Arco，并按真实层级数据建模。'],
  ['Steps', ['`FaSteps`'], ['`ASteps`'], '标准业务流程优先 Fantastic-admin；`FaSteps` 无法满足交互或无障碍契约时才回退 Arco，不能把只读展示冒充可操作步骤。'],
  ['PageHeader', ['`FaPageHeader`', '`FaPageMain`'], ['`APageHeader`'], '框架页面标题默认 Fantastic-admin，使用 `FaPageHeader` 与 `FaPageMain` 维持壳层布局；业务区域内部需要 Arco 返回/面包屑语义时才局部使用 `APageHeader`。'],
]

/**
 * 入口文档是正式开发依据，缺失时必须直接失败，不能用空内容继续断言。
 * 明确报告绝对路径可以让本地开发与 CI 都快速定位文档搬移或漏提交问题。
 */
function readRequiredFile(filePath) {
  assert.equal(existsSync(filePath), true, `缺少前端手册治理所需文件：${filePath}`)
  return readFileSync(filePath, 'utf8')
}

function readStaticPropertyName(name) {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined
}

function createCheckedSourceFile(source, filename, scriptKind) {
  const sourceFile = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, scriptKind)
  const parseDiagnostics = sourceFile.parseDiagnostics ?? []
  const diagnosticText = parseDiagnostics
    .map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
    .join('\n')
  assert.equal(parseDiagnostics.length, 0, `${filename} 语法解析失败：\n${diagnosticText}`)
  return sourceFile
}

function findObjectPropertyInitializer(objectLiteral, propertyName) {
  for (const property of objectLiteral.properties) {
    if (ts.isPropertyAssignment(property) && readStaticPropertyName(property.name) === propertyName) {
      return property.initializer
    }
  }
  return undefined
}

/**
 * 从已安装包的 `defineComponent()` 选项读取 prop 与 slot 名称。
 * 使用 AST 而不是锁定编译器生成的变量名，确保等价重编译不会制造假红。
 */
function readInstalledComponentContract(source, expectedComponentName) {
  const sourceFile = createCheckedSourceFile(source, `${expectedComponentName}.js`, ts.ScriptKind.JS)
  let componentOptions

  function visitComponent(node) {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'defineComponent'
      && node.arguments.length > 0
      && ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      const options = node.arguments[0]
      const name = findObjectPropertyInitializer(options, 'name')
      if (name && ts.isStringLiteral(name) && name.text === expectedComponentName) {
        componentOptions = options
      }
    }
    ts.forEachChild(node, visitComponent)
  }
  visitComponent(sourceFile)
  assert.ok(componentOptions, `无法从已安装源码解析 ${expectedComponentName} defineComponent 选项`)

  const props = new Set()
  const propsInitializer = findObjectPropertyInitializer(componentOptions, 'props')
  if (propsInitializer && ts.isObjectLiteralExpression(propsInitializer)) {
    for (const property of propsInitializer.properties) {
      const name = readStaticPropertyName(property.name)
      if (name) {
        props.add(name)
      }
    }
  }

  const slots = new Set()
  function isSlotsExpression(node) {
    return (ts.isIdentifier(node) && node.text === 'slots')
      || (ts.isPropertyAccessExpression(node) && node.name.text === '$slots')
  }
  function visitSlots(node) {
    if (ts.isPropertyAccessExpression(node) && isSlotsExpression(node.expression)) {
      slots.add(node.name.text)
    }
    if (
      ts.isElementAccessExpression(node)
      && isSlotsExpression(node.expression)
      && node.argumentExpression
      && ts.isStringLiteral(node.argumentExpression)
    ) {
      slots.add(node.argumentExpression.text)
    }
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'renderSlot'
      && node.arguments[1]
      && ts.isStringLiteral(node.arguments[1])
    ) {
      slots.add(node.arguments[1].text)
    }
    ts.forEachChild(node, visitSlots)
  }
  visitSlots(sourceFile)

  return { props, slots }
}

/**
 * `arco-vue.js` 的主 components 对象是 74 个家族的运行时安装真相源。
 * 同时解析默认 import 的目录，避免手写 coverage 与 sourceSlug 一起漂移后仍假绿。
 */
function readArcoRuntimeInventory(source) {
  const sourceFile = createCheckedSourceFile(source, 'arco-vue.js', ts.ScriptKind.JS)
  const importSlugs = new Map()
  let componentsInitializer

  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement)
      && statement.importClause?.name
      && ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      const moduleSegments = statement.moduleSpecifier.text.split('/')
      if (moduleSegments.length === 3 && moduleSegments[0] === '.' && moduleSegments[2] === 'index.js') {
        const localName = statement.importClause.name.text
        assert.equal(importSlugs.has(localName), false, `arco-vue.js 默认 import 重复：${localName}`)
        importSlugs.set(localName, moduleSegments[1])
      }
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === 'components') {
          assert.equal(componentsInitializer, undefined, 'arco-vue.js 只能声明一个 components 变量')
          assert.ok(
            declaration.initializer && ts.isObjectLiteralExpression(declaration.initializer),
            'arco-vue.js components 必须使用静态对象字面量',
          )
          componentsInitializer = declaration.initializer
        }
      }
    }
  }

  assert.ok(componentsInitializer, '无法从 arco-vue.js 解析主 components 安装对象')
  const inventory = new Map()
  for (const property of componentsInitializer.properties) {
    assert.ok(ts.isShorthandPropertyAssignment(property), 'arco-vue.js components 只能使用静态简写属性')
    const family = property.name.text
    assert.equal(inventory.has(family), false, `arco-vue.js components 家族重复：${family}`)
    assert.equal(importSlugs.has(family), true, `${family} 必须来自组件目录的 index.js`)
    inventory.set(family, importSlugs.get(family))
  }
  return inventory
}

function readNamedFunctionSource(source, functionName) {
  const sourceFile = createCheckedSourceFile(source, `${functionName}.js`, ts.ScriptKind.JS)
  let functionSource

  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === functionName) {
      functionSource = node.getText(sourceFile)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  assert.ok(functionSource, `无法从已安装源码解析函数：${functionName}`)
  return functionSource
}

function readFantasticAdminVersion() {
  const manifestContent = readRequiredFile(webManifestPath)
  let manifest

  try {
    manifest = JSON.parse(manifestContent)
  }
  catch (error) {
    assert.fail(`无法从 web/package.json 解析 Fantastic-admin version：${error.message}`)
  }

  assert.equal(
    typeof manifest.version,
    'string',
    '无法从 web/package.json 解析 Fantastic-admin version：缺少字符串 version',
  )
  assert.notEqual(
    manifest.version.trim(),
    '',
    '无法从 web/package.json 解析 Fantastic-admin version：version 不能为空',
  )

  return manifest.version
}

/**
 * 治理测试不能为了读取 lockfile 引入新的 YAML 依赖，因此只解析 pnpm 已生成的
 * `catalogs.arco-design-vue.@arco-design/web-vue.version` 层级。每一级单独报错，
 * 避免 catalog 被移动、改名或丢失时只得到模糊的正则匹配失败。
 */
function readArcoCatalogResolvedVersion() {
  const lockfileLines = readRequiredFile(webLockfilePath).split(/\r?\n/u)

  function findChildLineIndex(parentIndex, parentIndent, matcher) {
    const childIndent = parentIndent + 2

    for (let index = parentIndex + 1; index < lockfileLines.length; index += 1) {
      const line = lockfileLines[index]
      if (line.trim() === '') {
        continue
      }

      const indent = line.match(/^ */u)[0].length
      if (indent <= parentIndent) {
        break
      }
      if (indent === childIndent && matcher(line.trim())) {
        return index
      }
    }

    return -1
  }

  const catalogsIndex = lockfileLines.findIndex(line => line === 'catalogs:')
  assert.notEqual(
    catalogsIndex,
    -1,
    '无法从 web/pnpm-lock.yaml 解析 Arco Design Vue resolved version：缺少 catalogs',
  )

  const arcoCatalogIndex = findChildLineIndex(
    catalogsIndex,
    0,
    line => line === 'arco-design-vue:',
  )
  assert.notEqual(
    arcoCatalogIndex,
    -1,
    '无法从 web/pnpm-lock.yaml 解析 Arco Design Vue resolved version：缺少 arco-design-vue catalog',
  )

  const arcoPackageIndex = findChildLineIndex(
    arcoCatalogIndex,
    2,
    line => /^(?:'@arco-design\/web-vue'|"@arco-design\/web-vue"|@arco-design\/web-vue):$/u.test(line),
  )
  assert.notEqual(
    arcoPackageIndex,
    -1,
    '无法从 web/pnpm-lock.yaml 解析 Arco Design Vue resolved version：catalog 缺少 @arco-design/web-vue',
  )

  const versionIndex = findChildLineIndex(
    arcoPackageIndex,
    4,
    line => line.startsWith('version:'),
  )
  assert.notEqual(
    versionIndex,
    -1,
    '无法从 web/pnpm-lock.yaml 解析 Arco Design Vue resolved version：catalog 缺少 version',
  )

  const versionMatch = lockfileLines[versionIndex].trim().match(
    /^version:\s+(?:'([^']+)'|"([^"]+)"|([^#\s]+))(?:\s+#.*)?$/u,
  )
  assert.ok(
    versionMatch,
    '无法从 web/pnpm-lock.yaml 解析 Arco Design Vue resolved version：version 值无效',
  )

  return versionMatch[1] ?? versionMatch[2] ?? versionMatch[3]
}

function findListRule(content, requiredPhrases) {
  return content
    .split(/\r?\n/u)
    .map(line => line.replaceAll('`', ''))
    .find(line => line.startsWith('- ') && requiredPhrases.every(phrase => line.includes(phrase)))
}

function findTableRow(content, firstCell) {
  return content
    .split(/\r?\n/u)
    .filter(line => line.startsWith('|') && line.endsWith('|'))
    .map(line => line.slice(1, -1).split('|').map(cell => cell.trim()))
    .find(cells => cells[0] === firstCell)
}

function readMarkdownTableBodyRows(content, expectedFirstHeader) {
  const tableRows = content
    .split(/\r?\n/u)
    .filter(line => line.startsWith('|') && line.endsWith('|'))
    .map(line => line.slice(1, -1).split('|').map(cell => cell.trim()))

  assert.ok(tableRows.length >= 2, `Markdown 表格缺少表头或分隔行：${expectedFirstHeader}`)
  assert.equal(tableRows[0][0], expectedFirstHeader, `Markdown 表格首列表头必须为：${expectedFirstHeader}`)
  assert.ok(
    tableRows[1].every(cell => /^:?-+:?$/u.test(cell)),
    `Markdown 表格分隔行无效：${expectedFirstHeader}`,
  )
  return tableRows.slice(2)
}

function readMarkdownFilesRecursively(directoryPath) {
  return readdirSync(directoryPath, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
    .flatMap((entry) => {
      const entryPath = resolve(directoryPath, entry.name)
      if (entry.isDirectory()) {
        return readMarkdownFilesRecursively(entryPath)
      }
      return entry.isFile() && entry.name.endsWith('.md') ? [entryPath] : []
    })
}

function removeMarkdownInlineCode(line) {
  let output = ''
  let index = 0

  while (index < line.length) {
    if (line[index] !== '`') {
      output += line[index]
      index += 1
      continue
    }

    let delimiterLength = 1
    while (line[index + delimiterLength] === '`') {
      delimiterLength += 1
    }
    const delimiter = '`'.repeat(delimiterLength)
    const closingIndex = line.indexOf(delimiter, index + delimiterLength)
    if (closingIndex === -1) {
      output += delimiter
      index += delimiterLength
      continue
    }

    output += ' '.repeat(closingIndex + delimiterLength - index)
    index = closingIndex + delimiterLength
  }

  return output
}

function readMarkdownInlineCodeValues(content) {
  return [...content.matchAll(/`([^`\r\n]+)`/gu)].map(match => match[1])
}

function readArcoComponentTypeMemberNames(content) {
  return new Set(
    [...content.matchAll(/^\s+(A[A-Za-z0-9]+|\$[a-z][A-Za-z0-9]*):/gmu)]
      .map(match => match[1]),
  )
}

/**
 * 扫描 fenced code 和 inline code 之外的 Markdown inline link。
 * 目标里的括号按嵌套层级闭合，因此 `guide_(draft).md` 不会被截断；
 * 发现 `[label](target` 这类未闭合语法时显式返回诊断，不允许坏链因正则未命中而假绿。
 */
function scanMarkdownLinks(content) {
  const destinations = []
  const diagnostics = []
  const lines = readMarkdownLinesOutsideFences(content).map(removeMarkdownInlineCode)

  for (const [lineIndex, line] of lines.entries()) {
    let searchIndex = 0

    while (searchIndex < line.length) {
      const linkOpeningIndex = line.indexOf('](', searchIndex)
      if (linkOpeningIndex === -1) {
        break
      }

      const labelOpeningIndex = line.lastIndexOf('[', linkOpeningIndex)
      if (labelOpeningIndex === -1) {
        searchIndex = linkOpeningIndex + 2
        continue
      }

      let cursor = linkOpeningIndex + 2
      let nestedParentheses = 0
      let linkClosingIndex = -1
      while (cursor < line.length) {
        if (line[cursor] === '\\') {
          cursor += 2
          continue
        }
        if (line[cursor] === '(') {
          nestedParentheses += 1
        }
        else if (line[cursor] === ')') {
          if (nestedParentheses === 0) {
            linkClosingIndex = cursor
            break
          }
          nestedParentheses -= 1
        }
        cursor += 1
      }

      if (linkClosingIndex === -1) {
        diagnostics.push(`第 ${lineIndex + 1} 个可见文本行 Markdown 链接未闭合：${line.slice(labelOpeningIndex)}`)
        break
      }

      const linkBody = line.slice(linkOpeningIndex + 2, linkClosingIndex).trim()
      if (linkBody === '') {
        diagnostics.push(`第 ${lineIndex + 1} 个可见文本行 Markdown 链接缺少目标：${line.slice(labelOpeningIndex, linkClosingIndex + 1)}`)
        searchIndex = linkClosingIndex + 1
        continue
      }

      let rawDestination
      if (linkBody.startsWith('<')) {
        const angleClosingIndex = linkBody.indexOf('>')
        if (angleClosingIndex === -1) {
          diagnostics.push(`第 ${lineIndex + 1} 个可见文本行 Markdown 链接目标未闭合：${line.slice(labelOpeningIndex, linkClosingIndex + 1)}`)
          searchIndex = linkClosingIndex + 1
          continue
        }
        rawDestination = linkBody.slice(1, angleClosingIndex)
      }
      else {
        let destinationEnd = linkBody.length
        let destinationParentheses = 0
        for (let index = 0; index < linkBody.length; index += 1) {
          if (linkBody[index] === '\\') {
            index += 1
            continue
          }
          if (linkBody[index] === '(') {
            destinationParentheses += 1
          }
          else if (linkBody[index] === ')') {
            destinationParentheses -= 1
          }
          else if (/\s/u.test(linkBody[index]) && destinationParentheses === 0) {
            destinationEnd = index
            break
          }
        }
        rawDestination = linkBody.slice(0, destinationEnd)
      }

      destinations.push(rawDestination)
      searchIndex = linkClosingIndex + 1
    }
  }

  return { destinations, diagnostics }
}

/**
 * 相对链接可以跨目录、指向非 Markdown 资源并携带 fragment；
 * 协议链接与纯页内锚点不属于本地文件契约。
 */
function readRelativeMarkdownLinks(content) {
  return scanMarkdownLinks(content).destinations.filter((rawDestination) => {
    if (
      rawDestination.startsWith('#')
      || rawDestination.startsWith('//')
      || /^[A-Za-z][A-Za-z\d+.-]*:/u.test(rawDestination)
    ) {
      return false
    }
    return true
  })
}

function assertRelativeMarkdownLinkExists(sourcePath, rawDestination) {
  const hashIndex = rawDestination.indexOf('#')
  const rawPathAndQuery = hashIndex === -1 ? rawDestination : rawDestination.slice(0, hashIndex)
  const rawFragment = hashIndex === -1 ? undefined : rawDestination.slice(hashIndex + 1)
  const rawPath = rawPathAndQuery.split('?')[0]
  let decodedPath
  let decodedFragment

  try {
    decodedPath = decodeURIComponent(rawPath)
    decodedFragment = rawFragment ? decodeURIComponent(rawFragment) : undefined
  }
  catch (error) {
    assert.fail(`Markdown 相对链接 URL 编码无效：source=${sourcePath}; target=${rawDestination}; error=${error.message}`)
  }

  assert.notEqual(decodedPath, '', `Markdown 相对链接缺少文件目标：source=${sourcePath}; target=${rawDestination}`)
  const targetPath = resolve(dirname(sourcePath), decodedPath)
  assert.equal(
    existsSync(targetPath),
    true,
    `Markdown 相对链接目标不存在：source=${sourcePath}; target=${rawDestination}; resolved=${targetPath}`,
  )

  if (decodedFragment && targetPath.endsWith('.md')) {
    const headingAnchors = readMarkdownHeadingAnchors(readRequiredFile(targetPath))
    assert.equal(
      headingAnchors.has(decodedFragment),
      true,
      `Markdown 相对链接锚点不存在：source=${sourcePath}; target=${rawDestination}; anchor=${decodedFragment}`,
    )
  }
}

function assertRepositoryPathTokenExists(pathToken, context) {
  assert.ok(
    pathToken.startsWith('web/'),
    `${context} 不得使用脱离仓库根的缩写路径：${pathToken}`,
  )

  const wildcardIndex = pathToken.indexOf('*')
  if (wildcardIndex !== -1) {
    assert.equal(wildcardIndex, pathToken.length - 1, `${context} 只允许路径末尾使用 *：${pathToken}`)
  }
  const concretePathToken = wildcardIndex === -1 ? pathToken : pathToken.slice(0, wildcardIndex)
  const targetPath = resolve(repositoryRootPath, concretePathToken)
  assert.ok(
    targetPath === repositoryRootPath || targetPath.startsWith(`${repositoryRootPath}/`),
    `${context} 路径不得越出仓库：${pathToken}`,
  )
  assert.equal(existsSync(targetPath), true, `${context} 路径不存在：${pathToken} -> ${targetPath}`)
}

/**
 * 分类索引的覆盖契约只读取 Markdown 表格“公开能力”列。表格后的解释文字可能
 * 合理地再次提到组件名，不能让这些重复文字掩盖表格自身漏项。
 */
function assertPublicNameIndexTable(content, expectedPublicNames, context) {
  const lines = content.split(/\r?\n/u)
  const tableHeaders = lines
    .map((line, index) => ({ cells: line.startsWith('|') && line.endsWith('|')
      ? line.slice(1, -1).split('|').map(cell => cell.trim())
      : [], index }))
    .filter(item => item.cells.includes('公开能力'))

  assert.equal(tableHeaders.length, 1, `${context}必须且只能包含一个“公开能力”表格`)
  const [{ cells: headerCells, index: headerIndex }] = tableHeaders
  const publicNameColumnIndex = headerCells.indexOf('公开能力')
  assert.match(
    lines[headerIndex + 1] ?? '',
    /^\|(?:\s*:?-+:?\s*\|)+$/u,
    `${context}的“公开能力”表格缺少合法分隔行`,
  )

  const indexedPublicNames = []
  for (let index = headerIndex + 2; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line.startsWith('|') || !line.endsWith('|')) {
      break
    }

    const cells = line.slice(1, -1).split('|').map(cell => cell.trim())
    assert.equal(cells.length, headerCells.length, `${context}表格列数漂移：${line}`)
    indexedPublicNames.push(
      ...[...cells[publicNameColumnIndex].matchAll(/`((?:Fa|useFa)[A-Z][A-Za-z0-9]+)`/gu)]
        .map(match => match[1]),
    )
  }

  const sortedPublicNames = indexedPublicNames.sort()
  assert.equal(
    new Set(sortedPublicNames).size,
    sortedPublicNames.length,
    `${context}的“公开能力”列中每个 Fa*/useFa* 必须恰好出现一次`,
  )
  assert.deepEqual(
    sortedPublicNames,
    expectedPublicNames,
    `${context}的“公开能力”列必须与对应运行时公开名集合完全一致`,
  )
}

/**
 * 选型契约只读取指定二级章节中的表格行，并把职责、组件族和项目决策
 * 固定到对应单元格；这样其他段落中的正确关键词不能掩盖矩阵漂移。
 */
function assertFantasticAdminSelectionContracts(content) {
  const responsibilityMatrix = readSecondLevelSection(content, '2. 组件职责矩阵')
  for (const [responsibility, expectedTarget] of [
    ['框架壳、导航、页面容器、框架内部交互', 'Fantastic-admin 内置组件'],
    ['标准业务交互：表单、数据录入、数据展示、反馈、企业后台交互', 'Fantastic-admin 内置组件'],
    ['领域组件', '`web/apps/qsmds-arco/src/components/`'],
  ]) {
    const row = findTableRow(responsibilityMatrix, responsibility)
    const context = `组件职责矩阵：${responsibility}`

    assert.ok(row, `${context} 行不存在`)
    assert.equal(row.length, 4, `${context} 必须保持四个表格单元格`)
    assert.equal(row[1], expectedTarget, `${context} 默认落点错误：期望 ${expectedTarget}，实际 ${row[1]}`)
  }

  for (const [level, expectedImplementation] of [
    ['1', 'Fantastic-admin 内置组件'],
    ['2', 'Arco Design Vue 组件'],
    ['3', '基于 Arco Design Vue 的应用级自定义组件'],
    ['4', '基于原生 Vue 的自定义组件'],
  ]) {
    const row = findTableRow(responsibilityMatrix, level)
    const context = `组件实现优先级：${level}`

    assert.ok(row, `${context} 行不存在`)
    assert.equal(row.length, 3, `${context} 必须保持三个表格单元格`)
    assert.equal(row[1], expectedImplementation, `${context} 实现落点错误`)
  }

  const overlapMatrix = readSecondLevelSection(content, '4. 与 Arco 重叠能力的选择')
  const overlapRows = readMarkdownTableBodyRows(overlapMatrix, '能力')
  assert.deepEqual(
    overlapRows.map(row => row[0]),
    fantasticAdminArcoOverlapContracts.map(([capability]) => capability),
    '重叠能力选择矩阵必须按约定顺序完整收录 17 组能力，且不得使用宽泛合并行掩盖漏项',
  )

  const fantasticAdminPublicNames = new Set([
    ...readFantasticAdminBasicPublicNames(),
    ...readFantasticAdminProPublicExports().publicNames,
  ])
  const arcoComponentTypeMemberNames = readArcoComponentTypeMemberNames(
    readRequiredFile(arcoDesignVueIntegrationSourcePaths.componentTypes),
  )
  const arcoRuntimeInventory = readArcoRuntimeInventory(
    readRequiredFile(arcoDesignVueTask7SourcePaths.arcoVue),
  )

  for (const [index, [capability, fantasticAdminNames, arcoNames, decisionText]] of fantasticAdminArcoOverlapContracts.entries()) {
    const row = overlapRows[index]
    const context = `重叠能力选择矩阵：${capability}`
    assert.equal(row.length, 4, `${context} 必须保持四个表格单元格`)
    const expectedFantasticAdminNames = fantasticAdminNames.map(name => name.slice(1, -1))
    const expectedArcoNames = arcoNames.map(name => name.slice(1, -1))

    assert.deepEqual(
      readMarkdownInlineCodeValues(row[1]),
      expectedFantasticAdminNames,
      `${context} 的 Fantastic-admin 名称必须与约定精确一致，不得漏项或混入虚构名称`,
    )
    assert.deepEqual(
      readMarkdownInlineCodeValues(row[2]),
      expectedArcoNames,
      `${context} 的 Arco 名称必须与约定精确一致，不得漏项或混入虚构名称`,
    )
    assert.doesNotMatch(
      removeMarkdownInlineCode(row[1]),
      /\b(?:Fa|useFa)[A-Z][A-Za-z0-9]*\b/u,
      `${context} 的 Fantastic-admin 名称必须全部使用 inline code，避免非结构化文本绕过精确集合校验`,
    )
    assert.doesNotMatch(
      removeMarkdownInlineCode(row[2]),
      /\bA[A-Z][A-Za-z0-9]*\b|\b(?:Message|Notification)\b|\$[a-z][A-Za-z0-9]*/u,
      `${context} 的 Arco 名称必须全部使用 inline code，避免非结构化文本绕过精确集合校验`,
    )

    for (const publicName of expectedFantasticAdminNames) {
      assert.equal(
        fantasticAdminPublicNames.has(publicName),
        true,
        `${context} 的 Fantastic-admin 名称必须存在于当前公开导出：${publicName}`,
      )
    }
    for (const publicName of expectedArcoNames) {
      if (publicName.startsWith('A') || publicName.startsWith('$')) {
        assert.equal(
          arcoComponentTypeMemberNames.has(publicName),
          true,
          `${context} 的 Arco 名称必须存在于当前 components.d.ts：${publicName}`,
        )
      }
      else {
        assert.equal(
          arcoRuntimeInventory.has(publicName),
          true,
          `${context} 的 Arco 命令式能力必须存在于当前运行时安装对象：${publicName}`,
        )
      }
    }
    assert.equal(
      row[3],
      decisionText,
      `${context} 的项目决策必须与已审定语义精确一致，不得追加否定或模糊化表述`,
    )
  }

  const styleSection = readSecondLevelSection(content, '9. 样式、无障碍与响应式')
  for (const requiredPhrase of [
    '当前主题 token',
    '`web/packages/themes/index.ts`',
    '`web/uno.config.ts`',
    '`bg-background`',
    '`text-foreground`',
    '`text-muted-foreground`',
    '`border-border`',
    '不得默认硬编码颜色',
    '亮色',
    '暗色',
  ]) {
    assert.ok(styleSection.includes(requiredPhrase), `主题 token 选型契约缺少：${requiredPhrase}`)
  }
}

function assertHandbookTaskNavigation(content) {
  const taskSection = readSecondLevelSection(content, '6. 按任务阅读')
  const rows = readMarkdownTableBodyRows(taskSection, '任务')

  assert.deepEqual(
    rows.map(row => row[0]),
    handbookTaskNavigation.map(([task]) => task),
    '按任务阅读必须按约定顺序完整收录十类任务，不能用宽泛任务合并漏项',
  )
  for (const [index, [task, requiredTarget]] of handbookTaskNavigation.entries()) {
    const row = rows[index]
    const linkScan = scanMarkdownLinks(row[1])
    assert.equal(row.length, 3, `任务导航必须包含任务、阅读入口、正式应用核对点三列：${task}`)
    assert.deepEqual(linkScan.diagnostics, [], `任务导航存在无法解析的 Markdown 链接：${task}`)
    assert.ok(
      linkScan.destinations.includes(requiredTarget),
      `任务导航缺少可点击的约定本地入口：${task} -> ${requiredTarget}`,
    )
    assert.ok(
      row[2].includes('`web/apps/qsmds-arco'),
      `任务导航必须写明正式应用中的核对位置或实施边界：${task}`,
    )
    const repositoryPathTokens = readMarkdownInlineCodeValues(row[2])
      .filter(value => value.includes('/') && !contractApiEndpointPaths.has(value))
    assert.notEqual(repositoryPathTokens.length, 0, `任务导航必须提供可复制的仓库路径：${task}`)
    for (const pathToken of repositoryPathTokens) {
      assertRepositoryPathTokenExists(pathToken, `任务导航：${task}`)
    }
  }
  assert.doesNotMatch(content, /其余知识域文档纳入仓库后/u, '根入口不得保留“其余知识域以后纳入”的过时说明')
}

/**
 * 版本治理必须定位到指定二级章节，避免其他章节的正确文字
 * 掩盖固定基线表遗漏或漂移。
 */
function readSecondLevelSection(content, heading) {
  const lines = content.split(/\r?\n/u)
  const sectionHeading = `## ${heading}`
  const startIndex = lines.findIndex(line => line.trim() === sectionHeading)

  assert.notEqual(startIndex, -1, `前端手册缺少二级章节：${sectionHeading}`)

  const relativeEndIndex = lines
    .slice(startIndex + 1)
    .findIndex(line => /^##\s+/u.test(line))
  const endIndex = relativeEndIndex === -1
    ? lines.length
    : startIndex + 1 + relativeEndIndex

  return lines.slice(startIndex + 1, endIndex).join('\n')
}

/**
 * 解析二级章节中的 Markdown 有序链接，并固定连续编号与相对 `.md` 目标。
 * 调用方先用 `readSecondLevelSection()` 隔离章节，避免其他列表掩盖阅读顺序漂移。
 */
function readMarkdownOrderedLinks(content) {
  const orderedLines = content
    .split(/\r?\n/u)
    .filter(line => /^\s*\d+\.\s+/u.test(line))

  assert.notEqual(orderedLines.length, 0, 'Fantastic-admin 阅读顺序章节必须包含 Markdown 有序列表')

  return orderedLines.map((line, index) => {
    const match = line.match(/^\s*(\d+)\.\s+\[([^\]]+)\]\((\.\/[^)\s]+\.md)\)/u)

    assert.ok(match, `Fantastic-admin 阅读顺序第 ${index + 1} 项格式无效：${line}`)
    const suffix = line.slice(match[0].length).trim()
    assert.ok(
      suffix === '' || suffix.startsWith('：'),
      `Fantastic-admin 阅读顺序第 ${index + 1} 项链接后的说明格式无效：${line}`,
    )
    assert.equal(
      Number(match[1]),
      index + 1,
      `Fantastic-admin 阅读顺序编号必须连续：期望 ${index + 1}，实际 ${match[1]}`,
    )

    return [match[2], match[3]]
  })
}

/**
 * 覆盖矩阵只以“覆盖键”作为稳定身份，不锁定整段说明文案。
 * 这样可以让维护者调整项目化说明，同时防止主题遗漏、重复或链接漂移。
 */
function readCoverageMatrix(content) {
  const header = '| 覆盖键 | 官方来源 | 本地落点 | 当前项目状态 |'
  const lines = content.split(/\r?\n/u)
  const headerIndex = lines.findIndex(line => line.trim() === header)

  assert.notEqual(headerIndex, -1, `Fantastic-admin 覆盖矩阵必须包含表头：${header}`)

  const rows = []
  for (let index = headerIndex + 2; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (!line.startsWith('|') || !line.endsWith('|')) {
      break
    }

    const cells = line.slice(1, -1).split('|').map(cell => cell.trim())
    assert.equal(cells.length, 4, `Fantastic-admin 覆盖矩阵行必须有 4 列：${line}`)

    const officialLink = cells[1].match(/^\[[^\]]+\]\((https:\/\/fantastic-admin\.hurui\.me\/[^)]+)\)$/u)
    const localLink = cells[2].match(/^\[[^\]]+\]\((\.\/[^)]+)\)$/u)
    assert.ok(officialLink, `Fantastic-admin 覆盖矩阵必须使用直接官方链接：${cells[0]}`)
    assert.ok(localLink, `Fantastic-admin 覆盖矩阵必须使用分册内本地落点：${cells[0]}`)
    assert.doesNotMatch(cells[3], /^\s*$|TODO|TBD|待补充|占位/u, `Fantastic-admin 覆盖矩阵缺少当前项目状态：${cells[0]}`)

    rows.push({
      key: cells[0],
      officialUrl: officialLink[1],
      localTarget: localLink[1],
    })
  }

  return rows
}

/**
 * Arco 覆盖矩阵以组件家族为稳定身份，并把当前已成册与下一任务待成册状态
 * 分开解析。测试只锁字段、顺序、版本来源和真实导航，不锁说明性文案。
 */
function readArcoDesignVueCoverageMatrix(content) {
  const header = '| 英文家族 | 分类 | 分册 | 官方版本来源 | 接入状态 | 核对日期 |'
  const lines = content.split(/\r?\n/u)
  const headerIndex = lines.findIndex(line => line.trim() === header)

  assert.notEqual(headerIndex, -1, `Arco Design Vue 覆盖矩阵必须包含表头：${header}`)
  assert.match(
    lines[headerIndex + 1] ?? '',
    /^\|(?:\s*:?-+:?\s*\|)+$/u,
    'Arco Design Vue 覆盖矩阵缺少合法分隔行',
  )

  const rows = []
  for (let index = headerIndex + 2; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (!line.startsWith('|') || !line.endsWith('|')) {
      break
    }

    const cells = line.slice(1, -1).split('|').map(cell => cell.trim())
    assert.equal(cells.length, 6, `Arco Design Vue 覆盖矩阵行必须有 6 列：${line}`)
    const sourceLink = cells[3].match(/^\[[^\]]+\]\((https:\/\/github\.com\/arco-design\/arco-design-vue\/tree\/2\.58\.0\/packages\/web-vue\/components\/[^)]+)\)$/u)
    assert.ok(sourceLink, `Arco Design Vue 官方版本来源必须固定到 2.58.0 tag 组件目录：${cells[0]}`)
    assert.doesNotMatch(cells[4], /^\s*$|TODO|TBD|待补充|占位/u, `Arco Design Vue 覆盖矩阵缺少真实接入状态：${cells[0]}`)

    rows.push({
      family: cells[0],
      category: cells[1],
      volume: cells[2],
      sourceUrl: sourceLink[1],
      status: cells[4],
      checkedAt: cells[5],
    })
  }

  return rows
}

/**
 * 将本分册使用的普通 Markdown 标题转换为 VitePress/GitHub 风格锚点。
 * 当前标题不依赖自定义 id；保留中英文、数字和连字符，移除 Markdown 装饰与标点。
 */
function createHeadingAnchor(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, '$1')
    .replace(/[`*_~]/gu, '')
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
    .replace(/\s+/gu, '-')
}

function readMarkdownHeading(line) {
  let headingLevel = 0
  while (headingLevel < 6 && line[headingLevel] === '#') {
    headingLevel += 1
  }
  if (headingLevel === 0 || ![' ', '\t'].includes(line[headingLevel])) {
    return undefined
  }

  let contentStart = headingLevel
  while ([' ', '\t'].includes(line[contentStart])) {
    contentStart += 1
  }

  let heading = line.slice(contentStart).trim()
  while (heading.endsWith('#')) {
    heading = heading.slice(0, -1).trimEnd()
  }
  return heading || undefined
}

/**
 * 读取 Markdown fenced code 的起始标记。Fence 必须由至少 3 个相同的
 * backtick 或 tilde 构成；backtick info string 不能再包含 backtick。
 */
function readMarkdownFenceOpening(line) {
  const content = line.replace(/^ {0,3}/u, '')
  const character = content[0]
  if (!['`', '~'].includes(character)) {
    return undefined
  }

  let length = 0
  while (content[length] === character) {
    length += 1
  }
  if (length < 3) {
    return undefined
  }
  if (character === '`' && content.slice(length).includes('`')) {
    return undefined
  }

  return {
    character,
    infoString: content.slice(length).trim(),
    length,
  }
}

/**
 * 关闭 fence 必须使用与起始 fence 相同的字符，长度不得更短，且行尾只能有空白。
 * 这样 fence 内较短或异种标记不会提前恢复标题扫描。
 */
function isMarkdownFenceClosing(line, opening) {
  const content = line.replace(/^ {0,3}/u, '')
  let length = 0
  while (content[length] === opening.character) {
    length += 1
  }

  return length >= opening.length
    && /^[ \t]*$/u.test(content.slice(length))
}

/**
 * 统一移除 fenced code，供锚点与真实标题覆盖扫描共享。
 * 这样示例代码里的伪标题不能冒充文档条目。
 */
function readMarkdownLinesOutsideFences(content) {
  const lines = []
  let openingFence

  for (const line of content.split(/\r?\n/u)) {
    if (openingFence) {
      if (isMarkdownFenceClosing(line, openingFence)) {
        openingFence = undefined
      }
      continue
    }

    openingFence = readMarkdownFenceOpening(line)
    if (openingFence) {
      continue
    }

    lines.push(line)
  }

  return lines
}

/**
 * 底层扫描同时保留闭合的 Vue fence 与 EOF 未闭合诊断。
 * opening line 使用 1-based Markdown 行号，供编译错误定位原文。
 */
function scanVueFences(content) {
  const diagnostics = []
  const fences = []
  let openingFence
  let openingLine = 0
  let sourceLines = []

  for (const [index, line] of content.split(/\r?\n/u).entries()) {
    if (openingFence) {
      if (isMarkdownFenceClosing(line, openingFence)) {
        if (openingFence.infoString === 'vue') {
          fences.push({
            line: openingLine,
            source: sourceLines.join('\n'),
          })
        }
        openingFence = undefined
        sourceLines = []
      }
      else {
        sourceLines.push(line)
      }
      continue
    }

    openingFence = readMarkdownFenceOpening(line)
    if (openingFence) {
      openingLine = index + 1
    }
  }

  if (openingFence) {
    diagnostics.push({
      infoString: openingFence.infoString,
      line: openingLine,
    })
  }

  return { diagnostics, fences }
}

/**
 * 章节覆盖检查继续只消费真正闭合且 info string 精确为 vue 的示例，
 * 未闭合诊断由 collectVueFenceSyntaxErrors 通过底层扫描结果统一报告。
 */
function extractVueFences(content) {
  return scanVueFences(content).fences
}

function countTextOccurrences(content, expectedText) {
  return content.split(expectedText).length - 1
}

/**
 * 每个家族只保留一个可复制示例，并要求示例具有非空 template。
 * 结构检查与后续语法编译分开报错，缺 template 时能直接定位到家族章节。
 */
function assertSingleVueFenceWithTemplate(section, family) {
  const { diagnostics, fences } = scanVueFences(section)
  assert.deepEqual(diagnostics, [], `${family} 章节不得包含未闭合 fence`)
  assert.equal(fences.length, 1, `${family} 章节必须恰好包含一个 vue fence`)

  const filename = `${family}.vue`
  const parsed = parseVueSfc(fences[0].source, { filename })
  assert.deepEqual(parsed.errors, [], `${family} Vue SFC 解析失败`)
  assert.ok(parsed.descriptor.template, `${family} Vue SFC 必须包含 template`)
  assert.notEqual(parsed.descriptor.template.content.trim(), '', `${family} Vue SFC template 不能为空`)
}

/**
 * 语义 probe 直接读取文档示例的 script setup，禁止用手写摘录替代被展示的代码。
 */
function readTypeScriptScriptSetup(vueSource, filename) {
  const parsed = parseVueSfc(vueSource, { filename })
  assert.deepEqual(parsed.errors, [], `${filename} Vue SFC 解析失败`)
  assert.ok(parsed.descriptor.scriptSetup, `${filename} 必须包含 script setup`)
  assert.equal(parsed.descriptor.scriptSetup.lang, 'ts', `${filename} script setup 必须使用 lang="ts"`)
  return parsed.descriptor.scriptSetup.content
}

/**
 * 使用内存虚拟文件运行完整 TypeScript Program，让模块解析继续读取工作区真实的
 * `@arco-design/web-vue` 与 Vue 声明文件，同时不在仓库落下临时产物。
 */
function collectTypeScriptSemanticDiagnostics(source, filename) {
  const virtualFilePath = resolve(dirname(qsmdsArcoManifestPath), `.frontend-handbook-${filename}`)
  const compilerOptions = {
    lib: ['lib.esnext.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ESNext,
    types: [],
  }
  const compilerHost = ts.createCompilerHost(compilerOptions, true)
  const defaultFileExists = compilerHost.fileExists.bind(compilerHost)
  const defaultGetSourceFile = compilerHost.getSourceFile.bind(compilerHost)
  const defaultReadFile = compilerHost.readFile.bind(compilerHost)

  compilerHost.fileExists = filePath => filePath === virtualFilePath || defaultFileExists(filePath)
  compilerHost.readFile = filePath => filePath === virtualFilePath ? source : defaultReadFile(filePath)
  compilerHost.getSourceFile = (filePath, languageVersion, onError, shouldCreateNewSourceFile) => {
    if (filePath === virtualFilePath) {
      return ts.createSourceFile(filePath, source, languageVersion, true, ts.ScriptKind.TS)
    }
    return defaultGetSourceFile(filePath, languageVersion, onError, shouldCreateNewSourceFile)
  }

  const program = ts.createProgram({
    host: compilerHost,
    options: compilerOptions,
    rootNames: [virtualFilePath],
  })
  return ts.getPreEmitDiagnostics(program)
}

function unwrapTypeScriptExpression(node) {
  let current = node
  while (
    ts.isAsExpression(current)
    || ts.isNonNullExpression(current)
    || ts.isParenthesizedExpression(current)
    || ts.isSatisfiesExpression(current)
    || ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression
  }
  return current
}

/**
 * 只定位 `columns` 数组中 `sortable.sorter === true` 的远端排序列，避免把其他
 * 对象上的同名属性误当成 Table 契约或变异目标。
 */
function readRemoteTableSorterTarget(source, filename) {
  const sourceFile = createCheckedSourceFile(source, filename, ts.ScriptKind.TS)
  const columnsDeclarations = []
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue
    }
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === 'columns') {
        columnsDeclarations.push(declaration)
      }
    }
  }
  assert.equal(columnsDeclarations.length, 1, `${filename} 必须恰好声明一个 columns`)

  const columnsInitializer = columnsDeclarations[0].initializer
  assert.ok(columnsInitializer, `${filename} columns 必须有初始化值`)
  const columns = unwrapTypeScriptExpression(columnsInitializer)
  assert.ok(ts.isArrayLiteralExpression(columns), `${filename} columns 必须使用数组字面量`)

  const remoteSorterTargets = []
  for (const element of columns.elements) {
    const column = unwrapTypeScriptExpression(element)
    if (!ts.isObjectLiteralExpression(column)) {
      continue
    }
    const sortableInitializer = findObjectPropertyInitializer(column, 'sortable')
    if (!sortableInitializer) {
      continue
    }
    const sortable = unwrapTypeScriptExpression(sortableInitializer)
    if (!ts.isObjectLiteralExpression(sortable)) {
      continue
    }
    const sorterInitializer = findObjectPropertyInitializer(sortable, 'sorter')
    if (sorterInitializer && unwrapTypeScriptExpression(sorterInitializer).kind === ts.SyntaxKind.TrueKeyword) {
      remoteSorterTargets.push(sortable)
    }
  }
  assert.equal(remoteSorterTargets.length, 1, `${filename} 必须恰好包含一个 sortable.sorter === true 的远端排序列`)

  const sortDirectionsInitializer = findObjectPropertyInitializer(remoteSorterTargets[0], 'sortDirections')
  assert.ok(sortDirectionsInitializer, `${filename} 远端排序列必须声明 sortDirections`)
  const sortDirections = unwrapTypeScriptExpression(sortDirectionsInitializer)
  assert.ok(ts.isArrayLiteralExpression(sortDirections), `${filename} sortDirections 必须使用数组字面量`)
  return { sortDirections, sourceFile }
}

function assertRemoteTableSortDirections(source, filename) {
  const { sortDirections } = readRemoteTableSorterTarget(source, filename)
  assert.notEqual(sortDirections.elements.length, 0, `${filename} sortDirections 不能为空`)
  for (const element of sortDirections.elements) {
    const direction = unwrapTypeScriptExpression(element)
    assert.ok(
      ts.isStringLiteral(direction) && (direction.text === 'ascend' || direction.text === 'descend'),
      `${filename} sortDirections 只允许 ascend 或 descend 字面量`,
    )
  }
}

function emptyRemoteTableSortDirections(source, filename) {
  const { sortDirections, sourceFile } = readRemoteTableSorterTarget(source, filename)
  const start = sortDirections.getStart(sourceFile)
  return `${source.slice(0, start)}[]${source.slice(sortDirections.end)}`
}

function hasRuntimeSortDirectionsLengthGuard(source) {
  const sourceFile = createCheckedSourceFile(source, 'use-column-sorter.js', ts.ScriptKind.JS)
  const hasSorterInitializers = []
  function findHasSorter(node) {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === 'hasSorter'
      && node.initializer
    ) {
      hasSorterInitializers.push(node.initializer)
    }
    ts.forEachChild(node, findHasSorter)
  }
  findHasSorter(sourceFile)
  assert.equal(hasSorterInitializers.length, 1, 'Table sorter hook 必须恰好声明一个 hasSorter')

  let hasLengthGuard = false
  function findLengthGuard(node) {
    if (
      ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.GreaterThanToken
      && ts.isNumericLiteral(node.right)
      && node.right.text === '0'
      && ts.isPropertyAccessExpression(node.left)
      && node.left.name.text === 'length'
      && ts.isPropertyAccessExpression(node.left.expression)
      && node.left.expression.name.text === 'value'
      && ts.isIdentifier(node.left.expression.expression)
      && node.left.expression.expression.text === 'sortDirections'
    ) {
      hasLengthGuard = true
    }
    ts.forEachChild(node, findLengthGuard)
  }
  findLengthGuard(hasSorterInitializers[0])
  return hasLengthGuard
}

function readBeforeOkCatchMessageErrorStatement(source, filename) {
  const sourceFile = createCheckedSourceFile(source, filename, ts.ScriptKind.TS)
  const beforeOkFunctions = sourceFile.statements.filter(statement => (
    ts.isFunctionDeclaration(statement) && statement.name?.text === 'beforeOk'
  ))
  assert.equal(beforeOkFunctions.length, 1, `${filename} 必须恰好声明一个 beforeOk 函数`)
  const beforeOk = beforeOkFunctions[0]
  assert.ok(beforeOk.body, `${filename} beforeOk 必须包含函数体`)

  const catchBlocks = beforeOk.body.statements
    .filter(ts.isTryStatement)
    .flatMap(statement => statement.catchClause ? [statement.catchClause.block] : [])
  assert.equal(catchBlocks.length, 1, `${filename} beforeOk 必须恰好包含一个 catch block`)

  const messageErrorCalls = []
  function findMessageError(node) {
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression)
      && node.expression.expression.text === 'Message'
      && node.expression.name.text === 'error'
    ) {
      messageErrorCalls.push(node)
      return
    }
    if (node !== catchBlocks[0] && ts.isFunctionLike(node)) {
      return
    }
    ts.forEachChild(node, findMessageError)
  }
  findMessageError(catchBlocks[0])
  assert.equal(messageErrorCalls.length, 1, `${filename} beforeOk catch 必须调用 Message.error`)

  let statement = messageErrorCalls[0]
  while (statement.parent && !ts.isExpressionStatement(statement)) {
    statement = statement.parent
  }
  assert.ok(ts.isExpressionStatement(statement), `${filename} Message.error 必须作为活动表达式语句执行`)
  return { sourceFile, statement }
}

function assertBeforeOkCatchMessageError(source, filename) {
  readBeforeOkCatchMessageErrorStatement(source, filename)
}

function mutateBeforeOkCatchMessageError(source, filename, mutation) {
  assert.ok(mutation === 'comment' || mutation === 'delete', `不支持的 Message.error 变异：${mutation}`)
  const { sourceFile, statement } = readBeforeOkCatchMessageErrorStatement(source, filename)
  const start = statement.getStart(sourceFile)
  const originalStatement = source.slice(start, statement.end)
  const replacement = mutation === 'comment'
    ? `// ${originalStatement.replaceAll('\n', '\n// ')}`
    : ''
  return `${source.slice(0, start)}${replacement}${source.slice(statement.end)}`
}

function formatVueCompilerError(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 对每个 Vue SFC 先解析结构，再分别编译 script 与 template 的语法。
 * 这不是语义 typecheck；目标是补上 parse-only 无法发现的语法假绿。
 */
function collectVueFenceSyntaxErrors(content, documentName) {
  const errors = []
  const { diagnostics, fences } = scanVueFences(content)

  if (fences.length === 0 && diagnostics.length === 0) {
    errors.push(`${documentName} 未找到 vue fence`)
  }
  for (const diagnostic of diagnostics) {
    errors.push(
      `${documentName} 第 ${diagnostic.line} 行 fence 未闭合（info string: ${diagnostic.infoString || '<empty>'}）`,
    )
  }
  for (const [index, fence] of fences.entries()) {
    const fenceNumber = index + 1
    const fenceContext = `${documentName} 第 ${fence.line} 行（第 ${fenceNumber} 个 vue fence）`
    const filename = `${documentName}#vue-fence-${fenceNumber}.vue`
    const id = `task6-vue-fence-${fenceNumber}`
    let descriptor

    try {
      const result = parseVueSfc(fence.source, { filename })
      descriptor = result.descriptor
      for (const error of result.errors) {
        errors.push(`${fenceContext}解析失败：${formatVueCompilerError(error)}`)
      }
      if (result.errors.length > 0) {
        continue
      }
    }
    catch (error) {
      errors.push(`${fenceContext}解析抛错：${formatVueCompilerError(error)}`)
      continue
    }

    let bindingMetadata
    if (descriptor.script || descriptor.scriptSetup) {
      try {
        bindingMetadata = compileVueScript(descriptor, { id }).bindings
      }
      catch (error) {
        errors.push(`${fenceContext}脚本语法编译失败：${formatVueCompilerError(error)}`)
      }
    }

    if (descriptor.template) {
      try {
        const result = compileVueTemplate({
          compilerOptions: bindingMetadata ? { bindingMetadata } : undefined,
          filename,
          id,
          scoped: descriptor.styles.some(style => style.scoped),
          source: descriptor.template.content,
        })
        for (const error of result.errors) {
          errors.push(`${fenceContext}模板语法编译失败：${formatVueCompilerError(error)}`)
        }
      }
      catch (error) {
        errors.push(`${fenceContext}模板语法编译抛错：${formatVueCompilerError(error)}`)
      }
    }
  }

  return errors
}

function assertVueFencesSyntaxCompile(content, documentName) {
  const errors = collectVueFenceSyntaxErrors(content, documentName)
  assert.equal(errors.length, 0, `${documentName} Vue SFC 语法编译失败：\n${errors.join('\n')}`)
}

/**
 * 一般双花括号只扫描 fence 外说明文字；代码 fence 内另抓典型的大写占位名，
 * 避免把 Vue 合法插值误判为占位。endpoint、Bearer 与敏感赋值覆盖全部示例。
 */
function findArcoDocPolicyViolations(content) {
  const violations = []
  let openingFence

  const collectMatches = (line, lineNumber, pattern, label) => {
    for (const match of line.matchAll(pattern)) {
      violations.push(`第 ${lineNumber} 行 ${label}：${match[0]}`)
    }
  }

  for (const [index, line] of content.split(/\r?\n/u).entries()) {
    const lineNumber = index + 1
    let insideFence = Boolean(openingFence)

    if (openingFence && isMarkdownFenceClosing(line, openingFence)) {
      openingFence = undefined
      continue
    }
    if (!openingFence) {
      openingFence = readMarkdownFenceOpening(line)
      if (openingFence) {
        continue
      }
      insideFence = false
    }

    collectMatches(
      line,
      lineNumber,
      /^[ \t]*(?:TODO|TBD|待补充|后续补充)(?:[ \t]*(?::|：)[^\r\n]*|[ \t]*)$/gu,
      '占位行',
    )
    collectMatches(
      line,
      lineNumber,
      insideFence ? /\{\{[A-Z][A-Z0-9_]*\}\}/gu : /\{\{[^{}\r\n]+\}\}/gu,
      '占位标记',
    )
    collectMatches(line, lineNumber, /<PLACEHOLDER>/gu, '占位标记')
    for (const match of line.matchAll(
      /(['"`])((?:https?:\/\/[^/'"`\s]+)?\/api\/[\w./{}$?=&%-]+)\1/gu,
    )) {
      const apiIndex = match[2].indexOf('/api/')
      const endpointPath = match[2].slice(apiIndex).split(/[?#]/u)[0]
      if (!contractApiEndpointPaths.has(endpointPath)) {
        violations.push(`第 ${lineNumber} 行 虚构 endpoint：${match[0]}`)
      }
    }
    collectMatches(line, lineNumber, /Bearer\s+[\w.~-]+/gu, '硬编码 Bearer')
    for (const match of line.matchAll(/\b(?:password|token|secret|cookie|api[_-]?key)\s*[:=]\s*(['"`])([^'"`\r\n]*)\1/giu)) {
      const value = match[2]
      const isSafePlaceholder = value === '' || /^<[A-Z][A-Z0-9_]*>$/u.test(value)
      if (!isSafePlaceholder) {
        violations.push(`第 ${lineNumber} 行 硬编码敏感值：${match[0]}`)
      }
    }
    collectMatches(
      line,
      lineNumber,
      /\b(?:set-cookie|cookie)\s*:\s*(?!['"`<])\S+/giu,
      '未加引号的 Cookie header',
    )
    collectMatches(
      line,
      lineNumber,
      /\bcookie\s*=\s*(?!['"`<])\S+/giu,
      '未加引号的 Cookie 值',
    )
  }

  return violations
}

function readMarkdownHeadingAnchors(content) {
  const anchors = new Set()

  for (const line of readMarkdownLinesOutsideFences(content)) {
    const heading = readMarkdownHeading(line)
    if (heading) {
      anchors.add(createHeadingAnchor(heading))
    }
  }

  return anchors
}

function readMarkdownSecondLevelHeadings(content) {
  return readMarkdownLinesOutsideFences(content)
    .filter(line => /^##[ \t]+[^#]/u.test(line))
    .map(line => readMarkdownHeading(line))
}

const fantasticAdminProRuntimeStarExports = [
  './pro/mention/mention',
  './pro/pattern-bg/variants',
]
const fantasticAdminProStarExportInventories = {
  './pro/mention/mention': {
    runtimeNames: [
      'MentionContent',
      'MentionInput',
      'MentionItem',
      'MentionLabel',
      'MentionPortal',
      'MentionRoot',
    ],
    typeNames: [
      'MentionAlign',
      'MentionClassName',
      'MentionCollisionPadding',
      'MentionDirection',
      'MentionItemRegistration',
      'MentionOption',
      'MentionRange',
      'MentionSide',
    ],
  },
  './pro/pattern-bg/variants': {
    runtimeNames: ['patternBgMaskVariants', 'patternBgVariants'],
    typeNames: ['BaseProps', 'PatternBgMaskVariants', 'PatternBgVariants'],
  },
}

function hasTypeScriptModifier(node, modifierKind) {
  return ts.canHaveModifiers(node)
    && (ts.getModifiers(node)?.some(modifier => modifier.kind === modifierKind) ?? false)
}

/**
 * 受控 star export 的目标模块必须公开透明。这里读取模块自身的顶层 export，
 * 分开记录运行时值与类型；遇到嵌套 star、namespace 或绑定模式就直接失败，
 * 迫使维护者在源码形态变化后人工确认，而不是让治理测试猜测公开面。
 */
function readFantasticAdminModulePublicSymbols(source, moduleName) {
  const sourceFile = ts.createSourceFile(
    `fantastic-admin-star-${moduleName.replaceAll('/', '-')}.ts`,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const runtimeNames = []
  const typeNames = []

  function addIdentifierName(name, targetNames, declarationKind) {
    assert.ok(
      name && ts.isIdentifier(name),
      `Fantastic-admin 专业 runtime export star 符号清单无法解析 ${declarationKind}：module=${moduleName}`,
    )
    targetNames.push(name.text)
  }

  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement)) {
      assert.ok(
        statement.exportClause && !ts.isNamespaceExport(statement.exportClause),
        `Fantastic-admin 专业 runtime export star 符号清单包含不透明 export：module=${moduleName}`,
      )

      for (const specifier of statement.exportClause.elements) {
        const targetNames = statement.isTypeOnly || specifier.isTypeOnly ? typeNames : runtimeNames
        targetNames.push(specifier.name.text)
      }
      continue
    }

    if (ts.isVariableStatement(statement) && hasTypeScriptModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      if (hasTypeScriptModifier(statement, ts.SyntaxKind.DeclareKeyword)) {
        assert.fail(`Fantastic-admin 专业 runtime export star 符号清单包含 declare variable：module=${moduleName}`)
      }
      for (const declaration of statement.declarationList.declarations) {
        addIdentifierName(declaration.name, runtimeNames, 'variable binding')
      }
      continue
    }

    if (
      (ts.isFunctionDeclaration(statement)
        || ts.isClassDeclaration(statement)
        || ts.isEnumDeclaration(statement))
      && hasTypeScriptModifier(statement, ts.SyntaxKind.ExportKeyword)
    ) {
      if (hasTypeScriptModifier(statement, ts.SyntaxKind.DefaultKeyword)) {
        continue
      }
      if (hasTypeScriptModifier(statement, ts.SyntaxKind.DeclareKeyword)) {
        assert.fail(`Fantastic-admin 专业 runtime export star 符号清单包含 declare declaration：module=${moduleName}`)
      }
      addIdentifierName(statement.name, runtimeNames, 'runtime declaration')
      continue
    }

    if (
      (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement))
      && hasTypeScriptModifier(statement, ts.SyntaxKind.ExportKeyword)
    ) {
      addIdentifierName(statement.name, typeNames, 'type declaration')
      continue
    }

    if (
      (ts.isModuleDeclaration(statement)
        || ts.isImportEqualsDeclaration(statement)
        || ts.isExportAssignment(statement))
      && (ts.isExportAssignment(statement)
        || hasTypeScriptModifier(statement, ts.SyntaxKind.ExportKeyword))
    ) {
      if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
        continue
      }
      assert.fail(`Fantastic-admin 专业 runtime export star 符号清单包含不支持的 runtime export：module=${moduleName}`)
    }
  }

  for (const [symbolKind, names] of [['runtime', runtimeNames], ['type', typeNames]]) {
    assert.equal(
      names.length,
      new Set(names).size,
      `Fantastic-admin 专业 runtime export star ${symbolKind} 符号清单存在重复项：module=${moduleName}`,
    )
  }

  return {
    runtimeNames: [...runtimeNames].sort(),
    typeNames: [...typeNames].sort(),
  }
}

function assertFantasticAdminStarExportInventory(source, moduleName) {
  const expectedInventory = fantasticAdminProStarExportInventories[moduleName]
  assert.ok(expectedInventory, `Fantastic-admin 专业 runtime export star 缺少符号清单：module=${moduleName}`)
  assert.deepEqual(
    readFantasticAdminModulePublicSymbols(source, moduleName),
    expectedInventory,
    `Fantastic-admin 专业 runtime export star 符号清单漂移：module=${moduleName}`,
  )
}

/**
 * 公开能力只能来自 index.ts 指定注释后的 export 区段。先切区段再用
 * TypeScript AST 读取命名转发与直接运行时声明，排除注释、字符串、
 * type-only 与 default。命名导出在去重前拒绝同名；无法透明解析的运行时
 * export 形态一律失败；runtime export star 只允许调用方给出的精确清单。
 */
function readFantasticAdminPublicExports({
  allowedRuntimeStarModules = [],
  componentIndex = readRequiredFile(fantasticAdminComponentsIndexPath),
  endMarker,
  sectionName,
  startMarker,
}) {
  const sectionStart = componentIndex.indexOf(startMarker)
  assert.notEqual(sectionStart, -1, `Fantastic-admin 组件入口缺少区段标记：${startMarker}`)

  const sectionContentStart = sectionStart + startMarker.length
  const sectionEnd = endMarker
    ? componentIndex.indexOf(endMarker, sectionContentStart)
    : componentIndex.length

  if (endMarker) {
    assert.notEqual(sectionEnd, -1, `Fantastic-admin 组件入口缺少区段标记：${endMarker}`)
    assert.ok(sectionEnd > sectionStart, `Fantastic-admin 组件入口的 ${endMarker} 必须位于 ${startMarker} 之后`)
  }

  const section = componentIndex.slice(sectionContentStart, sectionEnd)
  const sourceFile = ts.createSourceFile(
    `fantastic-admin-${sectionName}-exports.ts`,
    section,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const publicNamePattern = /^(?:Fa|useFa)[A-Z][A-Za-z0-9]+$/u
  const rawPublicExports = []
  const runtimeStarModules = []

  function addRuntimePublicName(name, moduleName) {
    if (publicNamePattern.test(name)) {
      rawPublicExports.push({ moduleName, publicName: name })
    }
  }

  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
      const moduleName = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : '<unknown>'

      if (!statement.exportClause) {
        assert.ok(
          allowedRuntimeStarModules.includes(moduleName),
          `Fantastic-admin ${sectionName}公开覆盖无法静默解析 runtime export star：module=${moduleName}`,
        )
        runtimeStarModules.push(moduleName)
      }
      else if (ts.isNamespaceExport(statement.exportClause)) {
        assert.fail(
          `Fantastic-admin ${sectionName}公开覆盖无法静默解析 runtime namespace export：module=${moduleName}`,
        )
      }
      else {
        for (const specifier of statement.exportClause.elements) {
          if (!specifier.isTypeOnly) {
            addRuntimePublicName(specifier.name.text, moduleName)
          }
        }
      }
      continue
    }

    if (ts.isVariableStatement(statement) && hasTypeScriptModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      if (hasTypeScriptModifier(statement, ts.SyntaxKind.DeclareKeyword)) {
        continue
      }
      for (const declaration of statement.declarationList.declarations) {
        assert.ok(
          ts.isIdentifier(declaration.name),
          `Fantastic-admin ${sectionName}公开覆盖无法静默解析 runtime export variable binding`,
        )
        addRuntimePublicName(declaration.name.text, '<direct>')
      }
      continue
    }

    if (
      (ts.isFunctionDeclaration(statement)
        || ts.isClassDeclaration(statement)
        || ts.isEnumDeclaration(statement))
      && hasTypeScriptModifier(statement, ts.SyntaxKind.ExportKeyword)
    ) {
      if (
        hasTypeScriptModifier(statement, ts.SyntaxKind.DefaultKeyword)
        || hasTypeScriptModifier(statement, ts.SyntaxKind.DeclareKeyword)
      ) {
        continue
      }
      assert.ok(
        statement.name && ts.isIdentifier(statement.name),
        `Fantastic-admin ${sectionName}公开覆盖无法静默解析 runtime export declaration`,
      )
      addRuntimePublicName(statement.name.text, '<direct>')
      continue
    }

    if (
      (ts.isModuleDeclaration(statement) || ts.isImportEqualsDeclaration(statement))
      && hasTypeScriptModifier(statement, ts.SyntaxKind.ExportKeyword)
    ) {
      assert.fail(`Fantastic-admin ${sectionName}公开覆盖无法静默解析 runtime export declaration`)
    }

    if (ts.isExportAssignment(statement) && statement.isExportEquals) {
      assert.fail(`Fantastic-admin ${sectionName}公开覆盖无法静默解析 runtime export assignment`)
    }
  }

  assert.deepEqual(
    [...runtimeStarModules].sort(),
    [...allowedRuntimeStarModules].sort(),
    `Fantastic-admin ${sectionName}区段的受控 runtime export star 必须与已核对清单完全一致`,
  )

  const rawPublicNames = rawPublicExports.map(item => item.publicName)
  const uniquePublicNames = [...new Set(rawPublicNames)]
  const duplicatedPublicNames = [...new Set(
    rawPublicNames.filter((publicName, index) => rawPublicNames.indexOf(publicName) !== index),
  )]

  assert.equal(
    rawPublicNames.length,
    uniquePublicNames.length,
    `Fantastic-admin ${sectionName}区段存在重复公开名：${duplicatedPublicNames.join(', ')}`,
  )

  return {
    publicNames: uniquePublicNames.sort(),
    runtimeStarModules: [...runtimeStarModules].sort(),
    sourceModules: [...new Set(rawPublicExports.map(item => item.moduleName))].sort(),
  }
}

function readFantasticAdminBasicPublicNames(componentIndex = readRequiredFile(fantasticAdminComponentsIndexPath)) {
  return readFantasticAdminPublicExports({
    componentIndex,
    endMarker: '// 专业版组件',
    sectionName: '基础',
    startMarker: '// 基础版组件',
  }).publicNames
}

function readFantasticAdminProPublicExports(componentIndex = readRequiredFile(fantasticAdminComponentsIndexPath)) {
  assertFantasticAdminStarExportInventory(
    readRequiredFile(fantasticAdminProSourcePaths.mention),
    './pro/mention/mention',
  )
  assertFantasticAdminStarExportInventory(
    readRequiredFile(fantasticAdminProSourcePaths.patternBgVariants),
    './pro/pattern-bg/variants',
  )

  return readFantasticAdminPublicExports({
    allowedRuntimeStarModules: fantasticAdminProRuntimeStarExports,
    componentIndex,
    sectionName: '专业',
    startMarker: '// 专业版组件',
  })
}

function assertExistingMarkdownLinks(content, sourcePath) {
  const links = [...content.matchAll(/\[[^\]]+\]\((\.\/[^)#]+\.md)(?:#([^)]+))?\)/gu)]
    .map(match => ({ relativePath: match[1], rawFragment: match[2] }))

  assert.notEqual(links.length, 0, `Markdown 文档必须包含可验证的相对链接：${sourcePath}`)
  for (const { relativePath, rawFragment } of links) {
    const targetPath = resolve(dirname(sourcePath), relativePath)
    assert.equal(
      existsSync(targetPath),
      true,
      `Markdown 相对链接目标不存在：source=${sourcePath}; target=${relativePath}`,
    )

    if (rawFragment) {
      const fragment = decodeURIComponent(rawFragment)
      const headingAnchors = readMarkdownHeadingAnchors(readFileSync(targetPath, 'utf8'))
      assert.equal(
        headingAnchors.has(fragment),
        true,
        `Markdown 相对链接锚点不存在：source=${sourcePath}; target=${relativePath}; anchor=${fragment}`,
      )
    }
  }
}

/**
 * 覆盖矩阵的本地链接是离线 CI 可验证的导航契约。失败信息同时携带覆盖键、
 * 相对文件和锚点，避免维护者只能从通用的 ENOENT 或布尔断言反查来源。
 */
function assertCoverageLocalTarget(key, localTarget) {
  const [relativeFile, rawAnchor, ...unexpectedParts] = localTarget.split('#')
  const anchor = rawAnchor ? decodeURIComponent(rawAnchor) : '<missing>'
  const filePath = resolve(dirname(fantasticAdminHandbookPaths.index), relativeFile)
  const context = `coverage=${key}; file=${relativeFile}; anchor=${anchor}`

  assert.equal(unexpectedParts.length, 0, `Fantastic-admin 本地落点包含多个锚点分隔符：${context}`)
  assert.notEqual(anchor, '<missing>', `Fantastic-admin 本地落点必须包含章节锚点：${context}`)
  assert.equal(existsSync(filePath), true, `Fantastic-admin 本地落点文件不存在：${context}`)

  const headingAnchors = readMarkdownHeadingAnchors(readFileSync(filePath, 'utf8'))
  assert.equal(headingAnchors.has(anchor), true, `Fantastic-admin 本地落点锚点不存在：${context}`)
}

test('前端开发手册提供十类任务的可执行本地导航', () => {
  const handbook = readRequiredFile(handbookPath)
  assertHandbookTaskNavigation(handbook)
})

test('前端开发手册任务导航拒绝用 inline code 冒充可点击链接', () => {
  const handbook = readRequiredFile(handbookPath)
  const executableLink = '[路由（导航菜单）](./Fantastic-admin/路由导航与状态管理.md#路由导航菜单)'
  const mutatedHandbook = handbook.replace(
    executableLink,
    '`./Fantastic-admin/路由导航与状态管理.md#路由导航菜单`',
  )

  assert.notEqual(mutatedHandbook, handbook, '任务导航不可点击链接变异必须命中真实入口')
  assert.throws(
    () => assertHandbookTaskNavigation(mutatedHandbook),
    /任务导航缺少可点击的约定本地入口：新增页面/u,
    '任务导航中的路径文本或 inline code 不能冒充 Markdown link',
  )
})

test('前端开发手册任务导航拒绝脱离仓库根的缩写路径', () => {
  const handbook = readRequiredFile(handbookPath)
  const mutatedHandbook = handbook.replace(
    '`web/apps/qsmds-arco/src/router/guards.ts`',
    '`src/router/guards.ts`',
  )

  assert.notEqual(mutatedHandbook, handbook, '任务导航缩写路径变异必须命中真实行')
  assert.throws(
    () => assertHandbookTaskNavigation(mutatedHandbook),
    /不得使用脱离仓库根的缩写路径：src\/router\/guards\.ts/u,
    '任务导航中的 src/ 缩写不是从仓库根可直接复制的路径',
  )
})

test('前端开发手册任务导航检查同行的每一个路径候选', () => {
  const handbook = readRequiredFile(handbookPath)
  const mutatedHandbook = handbook.replace(
    '`web/apps/qsmds-arco/src/router/guards.ts`',
    '`apps/qsmds-arco/src/router/guards.ts`',
  )

  assert.notEqual(mutatedHandbook, handbook, '任务导航次要缩写路径变异必须命中真实行')
  assert.throws(
    () => assertHandbookTaskNavigation(mutatedHandbook),
    /不得使用脱离仓库根的缩写路径：apps\/qsmds-arco\/src\/router\/guards\.ts/u,
    '同行已有其他合法 web\/ 路径时，任何次要缩写路径仍必须失败',
  )
})

test('Markdown 链接扫描识别未闭合语法与平衡括号目标', () => {
  assert.deepEqual(
    scanMarkdownLinks('[合法](./guide_(draft).md)'),
    { destinations: ['./guide_(draft).md'], diagnostics: [] },
    '目标文件名中的平衡括号必须保留在完整 destination 中',
  )

  const malformedScan = scanMarkdownLinks('[坏链](./missing.md')
  assert.deepEqual(malformedScan.destinations, [], '未闭合链接不得产生可验证的 destination')
  assert.equal(malformedScan.diagnostics.length, 1, '未闭合链接必须产生一条显式诊断')
  assert.match(malformedScan.diagnostics[0], /Markdown 链接未闭合/u)

  assert.deepEqual(
    scanMarkdownLinks('`[代码](./missing.md`'),
    { destinations: [], diagnostics: [] },
    'inline code 中的链接形状文本不属于 Markdown 导航',
  )
})

test('前端开发手册全部相对链接与 Markdown 锚点可解析', () => {
  const markdownPaths = readMarkdownFilesRecursively(handbookDirectoryPath)
  let relativeLinkCount = 0

  assert.notEqual(markdownPaths.length, 0, `前端开发手册目录中必须存在 Markdown：${handbookDirectoryPath}`)
  for (const sourcePath of markdownPaths) {
    const content = readRequiredFile(sourcePath)
    const linkScan = scanMarkdownLinks(content)
    assert.deepEqual(
      linkScan.diagnostics,
      [],
      `Markdown 链接语法无法解析：source=${sourcePath}; diagnostics=${linkScan.diagnostics.join('; ')}`,
    )
    const relativeLinks = readRelativeMarkdownLinks(content)
    relativeLinkCount += relativeLinks.length
    for (const rawDestination of relativeLinks) {
      assertRelativeMarkdownLinkExists(sourcePath, rawDestination)
    }
  }
  assert.ok(relativeLinkCount > 0, '前端开发手册必须包含可验证的相对链接')
})

test('前端开发手册全部分册不包含占位、虚构端点或硬编码敏感值', () => {
  const violations = readMarkdownFilesRecursively(handbookDirectoryPath)
    .flatMap(filePath => findArcoDocPolicyViolations(readRequiredFile(filePath))
      .map(violation => `${filePath}: ${violation}`))

  assert.deepEqual(violations, [], `前端开发手册存在安全或占位策略违规：\n${violations.join('\n')}`)
})

test('前端开发手册入口固定正式应用、技术基线与组件职责', () => {
  const handbook = readRequiredFile(handbookPath)
  const documentIndex = readRequiredFile(documentIndexPath)
  const fantasticAdminVersion = readFantasticAdminVersion()
  const arcoVersion = readArcoCatalogResolvedVersion()
  const fixedBaselineSection = readSecondLevelSection(handbook, '2. 固定基线')

  assert.ok(
    documentIndex.includes('./前端文档/前端开发手册/README.md'),
    '根文档索引必须收录前端开发手册入口',
  )
  assert.ok(
    handbook.includes('./Fantastic-admin/README.md'),
    '前端开发手册必须收录 Fantastic-admin 分册真实入口',
  )
  assert.ok(
    handbook.includes(`Fantastic-admin 专业版 \`${fantasticAdminVersion}\``),
    `Fantastic-admin 代码真相源版本为 ${fantasticAdminVersion}，手册必须包含：Fantastic-admin 专业版 \`${fantasticAdminVersion}\``,
  )
  assert.ok(
    findTableRow(fixedBaselineSection, 'Arco Design Vue')?.[1] === `\`@arco-design/web-vue@${arcoVersion}\``,
    `Arco lockfile 真相源版本为 ${arcoVersion}，固定基线表必须精确记录：\`@arco-design/web-vue@${arcoVersion}\``,
  )

  const conflictingArcoVersions = [...handbook.matchAll(/@arco-design\/web-vue@(\d[\dA-Za-z.+-]*)/gu)]
    .map(match => match[1])
    .filter(version => version !== arcoVersion)
  assert.deepEqual(
    conflictingArcoVersions,
    [],
    `前端手册不得出现与 lockfile 冲突的 Arco Design Vue 版本：${conflictingArcoVersions.join(', ')}`,
  )
  assert.ok(
    handbook.includes('`web/apps/qsmds-arco` 是千树 DMS 唯一正式 Web 应用'),
    '手册必须明确 web/apps/qsmds-arco 是唯一正式 Web 应用',
  )
  assert.ok(
    handbook.includes('Fantastic-admin 内置组件是标准业务 UI 的第一优先级'),
    '手册必须明确 Fantastic-admin 内置组件是标准业务 UI 第一优先级',
  )
  assert.ok(
    handbook.includes('Arco Design Vue 是 Fantastic-admin 无法满足需求时的回退组件库'),
    '手册必须明确 Arco Design Vue 只在 Fantastic-admin 无法满足时回退使用',
  )
  assert.ok(
    handbook.includes('web/apps/qsmds-arco/src/router/'),
    '路由阅读路径必须使用完整项目路径',
  )
  assert.ok(
    handbook.includes('web/apps/qsmds-arco/src/settings.ts'),
    '应用设置阅读路径必须使用完整项目路径',
  )

  const sensitiveDataRule = findListRule(handbook, [
    '真实 token',
    '密码',
    '连接字符串',
    'Cookie',
    '真实 .env 内容',
    '专业版授权信息',
    '明显占位符',
  ])
  const projectFactRule = findListRule(handbook, [
    '禁止伪造',
    '业务 API',
    '路由',
    '字段',
    '项目事实',
  ])

  assert.ok(
    sensitiveDataRule,
    '手册必须单列敏感信息禁写规则，并要求示例只使用明显占位符',
  )
  assert.ok(
    projectFactRule,
    '手册必须单列禁止伪造业务 API、路由和字段等项目事实的规则',
  )
  assert.notEqual(
    sensitiveDataRule,
    projectFactRule,
    '敏感信息禁写与项目事实防伪必须拆成两条独立规则',
  )
})

test('Fantastic-admin 分册完整覆盖官方主题', () => {
  const documents = Object.fromEntries(
    Object.entries(fantasticAdminHandbookPaths).map(([name, filePath]) => [name, readRequiredFile(filePath)]),
  )

  for (const [name, content] of Object.entries(documents)) {
    assert.notEqual(content.trim(), '', `Fantastic-admin 分册不得为空：${name}`)
  }

  const readingOrderSection = readSecondLevelSection(documents.index, '3. 阅读顺序')
  assert.deepEqual(
    readMarkdownOrderedLinks(readingOrderSection),
    fantasticAdminReadingOrder,
    'Fantastic-admin 阅读顺序必须按约定标题、相对链接和顺序完整收录 9 册',
  )

  assert.equal(fantasticAdminCoverage.length, 49, 'Fantastic-admin 覆盖契约必须独立固定为 49 项')

  const coverageRows = readCoverageMatrix(documents.index)
  const actualKeys = coverageRows.map(row => row.key)
  const expectedKeys = fantasticAdminCoverage.map(([key]) => key)

  assert.equal(new Set(actualKeys).size, actualKeys.length, 'Fantastic-admin 覆盖矩阵不得包含重复覆盖键')
  assert.deepEqual(actualKeys, expectedKeys, 'Fantastic-admin 覆盖矩阵必须按约定顺序完整收录 49 个覆盖键')

  for (const [key, officialUrl, localTarget] of fantasticAdminCoverage) {
    const row = coverageRows.find(candidate => candidate.key === key)
    assert.equal(row?.officialUrl, officialUrl, `Fantastic-admin 覆盖键必须指向对应直接官方来源：${key}`)
    assert.equal(row?.localTarget, localTarget, `Fantastic-admin 覆盖键必须指向对应本地章节：${key}`)
    assertCoverageLocalTarget(key, localTarget)
  }

  for (const duplicateHeading of ['准备工作', '开始', '代码规范', '项目术语']) {
    assert.doesNotMatch(
      documents.foundation,
      new RegExp(`^## ${duplicateHeading}$`, 'mu'),
      `工程基础不得重复拥有由指引与开发准备维护的章节：${duplicateHeading}`,
    )
  }

  const maintenanceRules = readSecondLevelSection(documents.index, '5. 维护规则')
  assert.ok(
    maintenanceRules.includes('web/apps/qsmds-arco/vite.config.ts'),
    'Fantastic-admin 分册维护触发条件必须显式包含正式应用 vite.config.ts',
  )
})

test('Fantastic-admin Markdown 标题扫描忽略 fenced code', () => {
  const anchors = readMarkdownHeadingAnchors([
    '## Fence 外标题',
    '```md',
    '## 反引号 fence 内伪标题',
    '~~~',
    '## 异种关闭符后的伪标题',
    '```',
    '~~~~text',
    '## 波浪 fence 内伪标题',
    '~~~',
    '## 过短关闭符后的伪标题',
    '````',
    '## 异种关闭符后的第二个伪标题',
    '~~~~~',
    '## 关闭 Fence 后标题',
  ].join('\n'))

  assert.deepEqual(
    [...anchors],
    ['fence-外标题', '关闭-fence-后标题'],
    '标题扫描必须忽略 backtick/tilde fence 内的伪标题，并正确校验关闭 fence 的字符和长度',
  )
})

test('Fantastic-admin 相对 Markdown 链接拒绝真实文件中的不存在锚点', () => {
  assert.throws(
    () => assertExistingMarkdownLinks(
      '[错误锚点](./基础版组件.md#not-existing-anchor)',
      fantasticAdminComponentHandbookPaths.index,
    ),
    /Markdown 相对链接锚点不存在.*not-existing-anchor/u,
    '相对 Markdown 链接不能只验证文件存在而忽略 fragment',
  )
})

test('Fantastic-admin 基础公开名提取仅读取真实 export specifier', () => {
  const publicNames = readFantasticAdminBasicPublicNames([
    '// 基础版组件',
    '// FaCommentOnly',
    'const example = "useFaStringOnly"',
    'export { /* FaBlockCommentOnly */ Avatar as FaAvatar } from "./basic/avatar"',
    'export {',
    '  /* FaMultilineBlockCommentOnly */ Alert as FaAlert,',
    '  // useFaLineCommentOnly',
    '  useDrawer as useFaDrawer,',
    '} from "./basic/mixed"',
    'export type { Ghost as FaTypeOnly } from "./basic/type-only"',
    'export { type InlineGhost as FaInlineTypeOnly, Modal as FaModal } from "./basic/inline-type-only"',
    '// 专业版组件',
  ].join('\n'))

  assert.deepEqual(
    publicNames,
    ['FaAlert', 'FaAvatar', 'FaModal', 'useFaDrawer'],
    '基础公开名只能来自运行时 export specifier，必须忽略注释、字符串和 type-only 导出，并支持多行 alias',
  )
})

test('Fantastic-admin 公开名提取支持直接运行时声明并排除类型与 default', () => {
  const publicNames = readFantasticAdminBasicPublicNames([
    '// 基础版组件',
    'export const FaVariable = 1, FaSecondVariable = 2',
    'export function useFaFunction() {}',
    'export class FaClass {}',
    'export enum FaEnum { Ready }',
    'export interface FaInterface {}',
    'export type FaType = string',
    'export default class FaDefaultClass {}',
    '// 专业版组件',
  ].join('\n'))

  assert.deepEqual(
    publicNames,
    ['FaClass', 'FaEnum', 'FaSecondVariable', 'FaVariable', 'useFaFunction'],
    '直接 export 的 const/function/class/enum 是运行时公开名；type/interface/default 不得计入',
  )
})

test('Fantastic-admin 公开名提取拒绝可能承载运行时公开名的不支持 export 形态', () => {
  for (const [fixtureName, declaration] of [
    ['binding pattern', 'export const { FaDestructured } = registry'],
    ['namespace declaration', 'export namespace FaRuntimeNamespace {}'],
    ['export assignment', 'const FaAssigned = {}; export = FaAssigned'],
  ]) {
    const fixture = [
      '// 基础版组件',
      declaration,
      '// 专业版组件',
    ].join('\n')

    assert.throws(
      () => readFantasticAdminBasicPublicNames(fixture),
      /基础公开覆盖无法静默解析 runtime export/u,
      `不支持的 ${fixtureName} 必须显式失败，不能静默漏掉运行时公开名`,
    )
  }
})

test('Fantastic-admin 基础公开名提取拒绝 runtime export star', () => {
  const runtimeExportStarFixture = [
    '// 基础版组件',
    'export * from "./basic/runtime-star"',
    '// 专业版组件',
  ].join('\n')

  assert.throws(
    () => readFantasticAdminBasicPublicNames(runtimeExportStarFixture),
    /基础公开覆盖无法静默解析 runtime export star/u,
    'runtime export star 的公开名集合不透明，覆盖测试必须显式失败',
  )
})

test('Fantastic-admin 基础公开名提取拒绝 runtime namespace export', () => {
  const runtimeNamespaceExportFixture = [
    '// 基础版组件',
    'export * as FaNamespace from "./basic/runtime-namespace"',
    '// 专业版组件',
  ].join('\n')

  assert.throws(
    () => readFantasticAdminBasicPublicNames(runtimeNamespaceExportFixture),
    /基础公开覆盖无法静默解析 runtime namespace export/u,
    'runtime namespace export 不能被当作普通命名导出或静默忽略',
  )
})

test('Fantastic-admin 基础公开名提取拒绝重复导出名', () => {
  const duplicatedPublicNameFixture = [
    '// 基础版组件',
    'export { Alert as FaAlert } from "./basic/alert"',
    'export { Avatar as FaAlert } from "./basic/avatar"',
    '// 专业版组件',
  ].join('\n')

  assert.throws(
    () => readFantasticAdminBasicPublicNames(duplicatedPublicNameFixture),
    /Fantastic-admin 基础区段存在重复公开名：FaAlert/u,
    '重复公开名必须在去重前显式失败，不能被 Set 静默隐藏',
  )
})

test('Fantastic-admin 基础分类索引表漏项不能由表后说明掩盖', () => {
  const publicNames = readFantasticAdminBasicPublicNames()
  const basicIndex = readSecondLevelSection(
    readRequiredFile(fantasticAdminComponentHandbookPaths.index),
    '3. 基础组件分类索引',
  )
  const mutatedBasicIndex = basicIndex.replace(
    '| 按钮与选择控件 | `FaButton`、',
    '| 按钮与选择控件 | ',
  )

  assert.notEqual(mutatedBasicIndex, basicIndex, '基础分类索引漏项 fixture 必须从表格中删除 FaButton')
  assert.ok(
    mutatedBasicIndex.includes('`FaButton` 与 `FaButtonGroup`'),
    '基础分类索引漏项 fixture 必须保留表后说明里的 FaButton，证明它不能补足表格覆盖',
  )
  assert.throws(
    () => assertPublicNameIndexTable(mutatedBasicIndex, publicNames, '组件 README 基础分类索引'),
    /基础分类索引.*运行时公开名集合/u,
    '分类表格删除 FaButton 时，即使表后说明仍提及 FaButton，结构化覆盖契约也必须失败',
  )
})

test('Fantastic-admin 专业公开名提取只放行已核对的 runtime export star', () => {
  const proExports = readFantasticAdminProPublicExports([
    '// 专业版组件',
    '// FaCommentOnly',
    'const example = "useFaStringOnly"',
    'export { AnimatedBeam as FaAnimatedBeam } from "./pro/animated-beam"',
    'export { type Ghost as FaInlineTypeOnly, Loading as FaLoading } from "./pro/loading"',
    'export type { Ghost as FaTypeOnly } from "./pro/type-only"',
    'export * from "./pro/mention/mention"',
    'export * from "./pro/pattern-bg/variants"',
  ].join('\n'))

  assert.deepEqual(
    proExports.publicNames,
    ['FaAnimatedBeam', 'FaLoading'],
    '专业公开名只能来自运行时 export specifier，并继续忽略注释、字符串和 type-only 导出',
  )
  assert.deepEqual(
    proExports.runtimeStarModules,
    fantasticAdminProRuntimeStarExports,
    '专业区段只能精确放行本地已核对的两条 runtime export star',
  )
})

test('Fantastic-admin 专业公开名提取拒绝未知 runtime export star', () => {
  const unknownRuntimeExportStarFixture = [
    '// 专业版组件',
    'export * from "./pro/mention/mention"',
    'export * from "./pro/pattern-bg/variants"',
    'export * from "./pro/unknown-runtime-star"',
  ].join('\n')

  assert.throws(
    () => readFantasticAdminProPublicExports(unknownRuntimeExportStarFixture),
    /专业公开覆盖无法静默解析 runtime export star：module=\.\/pro\/unknown-runtime-star/u,
    '专业区段新增未知 runtime export star 时必须显式失败，不能扩大为任意 allowlist',
  )
})

test('Fantastic-admin 专业 runtime export star 固定精确运行时与类型符号清单', () => {
  for (const [moduleName, sourcePath] of [
    ['./pro/mention/mention', fantasticAdminProSourcePaths.mention],
    ['./pro/pattern-bg/variants', fantasticAdminProSourcePaths.patternBgVariants],
  ]) {
    assert.deepEqual(
      readFantasticAdminModulePublicSymbols(readRequiredFile(sourcePath), moduleName),
      fantasticAdminProStarExportInventories[moduleName],
      `Fantastic-admin 专业 runtime export star 符号清单漂移：module=${moduleName}`,
    )
  }
})

test('Fantastic-admin 专业 runtime export star 删除符号变异必须失败', () => {
  const moduleName = './pro/mention/mention'
  const source = readRequiredFile(fantasticAdminProSourcePaths.mention)
  const mutatedSource = source.replace(
    'export { default as MentionRoot } from \'./MentionRoot.vue\'\n',
    '',
  )

  assert.notEqual(mutatedSource, source, 'Mention runtime symbol 删除变异 fixture 必须命中真实源码')
  assert.throws(
    () => assertFantasticAdminStarExportInventory(mutatedSource, moduleName),
    /符号清单/u,
    '删除 MentionRoot 后，受控 star export 精确清单必须失败',
  )
})

test('Fantastic-admin 专业 runtime export star 新增符号变异必须失败', () => {
  const moduleName = './pro/pattern-bg/variants'
  const source = readRequiredFile(fantasticAdminProSourcePaths.patternBgVariants)
  const mutatedSource = `${source}\nexport const patternBgUnexpected = true\n`

  assert.throws(
    () => assertFantasticAdminStarExportInventory(mutatedSource, moduleName),
    /符号清单/u,
    '新增 patternBgUnexpected 后，受控 star export 精确清单必须失败',
  )
})

test('Fantastic-admin 基础组件文档记录 FaInput autocomplete 固定契约', () => {
  const basicHandbook = readRequiredFile(fantasticAdminComponentHandbookPaths.basic)
  const inputSection = readSecondLevelSection(basicHandbook, 'FaInput')

  assert.ok(
    inputSection.includes('`autocomplete="off"`')
    && inputSection.includes('调用方当前无法覆盖'),
    'FaInput 必须记录源码在 attrs 合并后固定 autocomplete="off"，调用方当前无法覆盖',
  )
  assert.doesNotMatch(
    basicHandbook,
    /<FaInput[^>]*\sautocomplete\s*=/u,
    'FaInput 示例不得再暗示调用方传入的 autocomplete 会生效',
  )
})

test('Fantastic-admin 基础组件文档记录 FaProgress 只读展示契约', () => {
  const basicHandbook = readRequiredFile(fantasticAdminComponentHandbookPaths.basic)
  const progressSection = readSecondLevelSection(basicHandbook, 'FaProgress')

  for (const requiredPhrase of ['默认值为 0', '只读展示输入', ':model-value="progress"']) {
    assert.ok(progressSection.includes(requiredPhrase), `FaProgress 只读展示契约缺少：${requiredPhrase}`)
  }
  assert.doesNotMatch(
    progressSection,
    /<FaProgress[^>]*\sv-model(?::[\w-]+)?\s*=/u,
    'FaProgress 示例不得声明运行时不存在的双向更新',
  )
  assert.equal(
    progressSection.includes('`update:modelValue`'),
    false,
    'FaProgress 不得宣称 wrapper 会发出 update:modelValue',
  )
})

test('Fantastic-admin 基础组件文档记录 FaTable 选择与 footer 运行时边界', () => {
  const basicHandbook = readRequiredFile(fantasticAdminComponentHandbookPaths.basic)
  const tableSection = readSecondLevelSection(basicHandbook, 'FaTable')

  for (const requiredPhrase of [
    '只有排序与展开状态可由调用方受控',
    '选择状态由组件内部 `rowSelection` 管理',
    '没有 selection prop 或 model',
    '`TableFooterSlotProps` 仍是根入口导出的类型',
    '当前运行时未接入 `footer-{columnId}`',
    '调用方不能传入该 slot',
  ]) {
    assert.ok(tableSection.includes(requiredPhrase), `FaTable 运行时边界缺少：${requiredPhrase}`)
  }
})

test('Fantastic-admin 组件选型契约拒绝标准业务默认回退到 Arco', () => {
  const selection = readRequiredFile(fantasticAdminComponentHandbookPaths.selection)
  const mutatedSelection = selection.replace(
    '| 标准业务交互：表单、数据录入、数据展示、反馈、企业后台交互 | Fantastic-admin 内置组件 |',
    '| 标准业务交互：表单、数据录入、数据展示、反馈、企业后台交互 | Arco Design Vue |',
  )

  assert.notEqual(mutatedSelection, selection, '标准业务默认落点变异 fixture 必须命中真实职责矩阵')
  assert.throws(
    () => assertFantasticAdminSelectionContracts(mutatedSelection),
    /组件职责矩阵.*标准业务交互/u,
    '标准业务默认落点改为 Arco 时，结构化职责矩阵契约必须失败',
  )
})

for (const [capability, originalDecision, mutatedDecision] of [
  ['Form', '标准业务表单优先 Fantastic-admin', '标准业务表单优先 Arco'],
  ['Table', '标准业务数据展示优先 Fantastic-admin', '标准业务数据展示优先 Arco'],
  ['Toast/Message', '业务反馈优先 Fantastic-admin', '业务反馈优先 Arco'],
]) {
  test(`Fantastic-admin 组件选型契约拒绝${capability}默认落点变异`, () => {
    const selection = readRequiredFile(fantasticAdminComponentHandbookPaths.selection)
    const mutatedSelection = selection.replace(originalDecision, mutatedDecision)

    assert.notEqual(mutatedSelection, selection, `${capability}变异 fixture 必须命中真实重叠能力矩阵`)
    assert.throws(
      () => assertFantasticAdminSelectionContracts(mutatedSelection),
      new RegExp(`重叠能力选择矩阵.*${capability}`, 'u'),
      `${capability}默认落点改为 Arco 时，结构化重叠能力契约必须失败`,
    )
  })
}

for (const [source, replacement, expectedMessage] of [
  [
    '`FaButton`、`FaButtonGroup`',
    '`FaButton`、`FaButtonGroup`、`FaImaginaryButton`',
    /Button.*Fantastic-admin 名称必须与约定精确一致/u,
  ],
  [
    '`AButton`、`AButtonGroup`',
    '`AButton`、`AButtonGroup`、`AImaginaryButton`',
    /Button.*Arco 名称必须与约定精确一致/u,
  ],
]) {
  test(`Fantastic-admin 组件选型契约拒绝虚构名称：${replacement}`, () => {
    const selection = readRequiredFile(fantasticAdminComponentHandbookPaths.selection)
    const mutatedSelection = selection.replace(source, replacement)

    assert.notEqual(mutatedSelection, selection, '虚构组件名变异 fixture 必须命中真实矩阵')
    assert.throws(
      () => assertFantasticAdminSelectionContracts(mutatedSelection),
      expectedMessage,
      '矩阵单元格中混入额外虚构名称时必须失败',
    )
  })
}

for (const [source, replacement, expectedMessage] of [
  [
    '`FaButton`、`FaButtonGroup`',
    '`FaButton`、`FaButtonGroup`、FaImaginaryButton',
    /Button.*Fantastic-admin 名称必须全部使用 inline code/u,
  ],
  [
    '`AButton`、`AButtonGroup`',
    '`AButton`、`AButtonGroup`、AImaginaryButton',
    /Button.*Arco 名称必须全部使用 inline code/u,
  ],
]) {
  test(`Fantastic-admin 组件选型契约拒绝非结构化虚构名称：${replacement}`, () => {
    const selection = readRequiredFile(fantasticAdminComponentHandbookPaths.selection)
    const mutatedSelection = selection.replace(source, replacement)

    assert.notEqual(mutatedSelection, selection, '非结构化虚构名称变异 fixture 必须命中真实矩阵')
    assert.throws(
      () => assertFantasticAdminSelectionContracts(mutatedSelection),
      expectedMessage,
      '不使用 inline code 的虚构名称也必须进入契约校验',
    )
  })
}

test('Fantastic-admin 组件选型契约拒绝在已审定决策后追加否定表述', () => {
  const selection = readRequiredFile(fantasticAdminComponentHandbookPaths.selection)
  const buttonDecision = fantasticAdminArcoOverlapContracts[0][3]
  const mutatedSelection = selection.replace(buttonDecision, `${buttonDecision}以上决策不成立。`)

  assert.notEqual(mutatedSelection, selection, '项目决策否定变异 fixture 必须命中真实矩阵')
  assert.throws(
    () => assertFantasticAdminSelectionContracts(mutatedSelection),
    /Button.*项目决策必须与已审定语义精确一致/u,
    '已审定句子后面追加否定文字时，选型契约必须失败',
  )
})

test('前端标准文档不得重新引入 Arco-first 业务默认值', () => {
  const violations = [
    ['前端手册入口', handbookPath],
    ['Fantastic-admin AI 技能', fantasticAdminHandbookPaths.skills],
    ['内置组件索引', fantasticAdminComponentHandbookPaths.index],
    ['内置组件选型', fantasticAdminComponentHandbookPaths.selection],
    ['基础版组件', fantasticAdminComponentHandbookPaths.basic],
    ['专业版组件', fantasticAdminComponentHandbookPaths.pro],
    ...Object.entries(arcoDesignVueHandbookPaths)
      .map(([documentName, filePath]) => [`Arco ${documentName}`, filePath]),
  ].flatMap(([documentName, filePath]) => readRequiredFile(filePath)
    .split(/(?<=[。！？])|\n/u)
    .map((sentence, index) => ({ documentName, index: index + 1, sentence: sentence.trim() }))
    .filter(({ sentence }) => {
      // 只拦截“优先/默认”直接指向 Arco 的选型句，避免把“优先 Fa，
      // 不足时回退 Arco”或 Arco 组件自身的默认 prop 描述误判为冲突。
      return /(?:默认(?:优先)?|优先|仍先|先(?:用|选|评估)|首选)\s*(?:使用|采用|选择|评估)?\s*(?:Arco|`A[A-Z])/u
        .test(sentence)
    }))

  assert.deepEqual(
    violations,
    [],
    `前端标准文档存在 Arco-first 业务默认值：${violations
      .map(({ documentName, index, sentence }) => `${documentName}:${index}:${sentence}`)
      .join(' | ')}`,
  )
})

test('Arco 手册先执行 Fantastic-admin 选型，再进入回退资料', () => {
  const content = readRequiredFile(arcoDesignVueHandbookPaths.index)
  const readingOrder = readSecondLevelSection(content, '阅读顺序')
  const items = [...readingOrder.matchAll(/^(\d+)\.\s+\[[^\]]+\]\(([^)]+)\)/gmu)]

  assert.deepEqual(
    items.map(([, number]) => Number(number)),
    items.map((_, index) => index + 1),
    'Arco 手册阅读顺序编号必须从 1 连续递增',
  )
  assert.equal(
    items[0]?.[2],
    '../Fantastic-admin内置组件/选型与使用规则.md#4-与-arco-重叠能力的选择',
    '进入 Arco 回退资料前必须先执行 Fantastic-admin 内置组件选型',
  )
})

test('Arco 分册引用的 Fa 名称必须来自当前公开导出', () => {
  const publicNames = new Set([
    ...readFantasticAdminBasicPublicNames(),
    ...readFantasticAdminProPublicExports().publicNames,
  ])
  const invalidReferences = Object.entries(arcoDesignVueHandbookPaths)
    .flatMap(([documentName, filePath]) => {
      const content = readRequiredFile(filePath)
      return [...content.matchAll(/`((?:Fa|useFa)[A-Z][A-Za-z0-9]*)`/gu)]
        .map(([, publicName]) => ({ documentName, publicName }))
        .filter(({ publicName }) => !publicNames.has(publicName))
    })

  assert.deepEqual(
    invalidReferences,
    [],
    `Arco 分册引用了不存在的 Fa 公开名：${invalidReferences
      .map(({ documentName, publicName }) => `${documentName}:${publicName}`)
      .join(' | ')}`,
  )
})

test('专业版粒子背景说明 hex 输入限制与主题 token 边界', () => {
  const proHandbook = readRequiredFile(fantasticAdminComponentHandbookPaths.pro)
  const section = readSecondLevelSection(proHandbook, 'FaParticlesBg')

  for (const requiredPhrase of [
    '`#RGB`',
    '`#RRGGBB`',
    '不能直接绑定当前 CSS token',
    '已确认业务数据或外部品牌契约',
  ]) {
    assert.ok(section.includes(requiredPhrase), `FaParticlesBg 主题边界缺少：${requiredPhrase}`)
  }
})

test('AI 技能共同规则编号连续且不重复', () => {
  const skills = readRequiredFile(fantasticAdminHandbookPaths.skills)
  const section = readSecondLevelSection(skills, '共同安全与执行规则').split(/\n### /u)[0]
  const numbers = [...section.matchAll(/^(\d+)\./gmu)].map(([, number]) => Number(number))

  assert.deepEqual(
    numbers,
    numbers.map((_, index) => index + 1),
    'AI 技能共同规则必须从 1 连续编号',
  )
})

test('Fantastic-admin 基础组件分册覆盖本地全部公开导出并固定选型边界', () => {
  const publicNames = readFantasticAdminBasicPublicNames()
  assert.equal(
    publicNames.length,
    52,
    `Fantastic-admin 基础区段公开名数量漂移：期望 52，实际 ${publicNames.length}；请核对 ${fantasticAdminComponentsIndexPath}`,
  )

  const documents = Object.fromEntries(
    Object.entries(fantasticAdminComponentHandbookPaths).map(([name, filePath]) => [name, readRequiredFile(filePath)]),
  )
  const readmeScope = readSecondLevelSection(documents.index, '1. 适用范围与真相源')
  for (const requiredPhrase of [
    'Fantastic-admin Pro `6.3.0`',
    '`web/apps/qsmds-arco`',
    '2026-07-15',
    '`web/packages/components/src/index.ts`',
    '本地公开导出',
    '官网分类仅作参考',
  ]) {
    assert.ok(readmeScope.includes(requiredPhrase), `内置组件 README 的适用范围与真相源缺少：${requiredPhrase}`)
  }
  assert.ok(
    documents.index.includes('[选型与使用规则](./选型与使用规则.md)'),
    '内置组件 README 必须链接真实的选型与使用规则分册',
  )
  assert.ok(
    documents.index.includes('[基础版组件](./基础版组件.md)'),
    '内置组件 README 必须链接真实的基础版组件分册',
  )
  assert.ok(
    documents.index.includes('源码导航')
    && documents.index.includes('不代表优先级')
    && documents.index.includes('专业版')
    && documents.index.includes('正式能力'),
    '内置组件 README 必须说明基础/专业分册只是源码导航，专业版属于正式能力',
  )
  assertExistingMarkdownLinks(documents.index, fantasticAdminComponentHandbookPaths.index)

  assertFantasticAdminSelectionContracts(documents.selection)
  const sharingBoundary = readSecondLevelSection(documents.selection, '3. 领域组件与共享边界')
  assert.ok(sharingBoundary.includes('YAGNI'), '领域组件与共享边界必须明确遵循 YAGNI')

  const publicNameSet = new Set(publicNames)
  const basicIndex = readSecondLevelSection(documents.index, '3. 基础组件分类索引')
  assertPublicNameIndexTable(
    basicIndex,
    publicNames,
    '组件 README 基础分类索引',
  )

  const documentedHeadings = readMarkdownSecondLevelHeadings(documents.basic)
    .map(heading => heading.match(/^((?:Fa|useFa)[A-Z][A-Za-z0-9]+)(?:[ \t]|$)/u)?.[1])
    .filter(Boolean)

  for (const publicName of publicNames) {
    const headingCount = documentedHeadings.filter(name => name === publicName).length
    assert.equal(
      headingCount,
      1,
      `基础版组件公开名必须恰好有一个真实二级 Markdown 标题：name=${publicName}; actual=${headingCount}; file=${fantasticAdminComponentHandbookPaths.basic}`,
    )
  }

  // 代码示例同样会向读者声明公共能力，因此额外名称扫描保留 fenced code；
  // 只移除不可见的 Markdown link destination，避免 URL 路径大小写被误判为组件名。
  const visibleBasicContent = documents.basic.replace(/(\[[^\]]*\])\([^)]+\)/gu, '$1')
  const claimedPublicNames = [...new Set(
    [...visibleBasicContent.matchAll(/\b(?:Fa|useFa)[A-Z][A-Za-z0-9]+/gu)].map(match => match[0]),
  )]
  const unexportedClaims = claimedPublicNames.filter(name => !publicNameSet.has(name))
  assert.deepEqual(
    unexportedClaims,
    [],
    `基础版组件文档不得宣称本地基础区段未导出的 Fa*/useFa* 能力：${unexportedClaims.join(', ')}`,
  )
})

test('Fantastic-admin 专业组件分册覆盖本地全部公开导出并固定选型边界', () => {
  const proExports = readFantasticAdminProPublicExports()
  const publicNames = proExports.publicNames
  assert.equal(
    publicNames.length,
    50,
    `Fantastic-admin 专业区段公开名数量漂移：期望 50，实际 ${publicNames.length}；请核对 ${fantasticAdminComponentsIndexPath}`,
  )
  assert.equal(
    proExports.sourceModules.length,
    47,
    `Fantastic-admin 专业区段运行时公开名的源码目录数量漂移：期望 47，实际 ${proExports.sourceModules.length}`,
  )
  assert.deepEqual(
    proExports.runtimeStarModules,
    fantasticAdminProRuntimeStarExports,
    'Fantastic-admin 专业区段 runtime export star 必须保持精确两条已核对路径',
  )

  const index = readRequiredFile(fantasticAdminComponentHandbookPaths.index)
  const proHandbook = readRequiredFile(fantasticAdminComponentHandbookPaths.pro)

  assert.ok(
    index.includes('[专业版组件](./专业版组件.md)'),
    '内置组件 README 必须链接真实的专业版组件分册',
  )
  assert.ok(
    index.includes('专业版是千树 DMS 正式能力'),
    '内置组件 README 必须明确专业版是千树 DMS 正式能力',
  )
  assertExistingMarkdownLinks(index, fantasticAdminComponentHandbookPaths.index)
  assertExistingMarkdownLinks(proHandbook, fantasticAdminComponentHandbookPaths.pro)

  const proIndex = readSecondLevelSection(index, '4. 专业组件分类索引')
  assertPublicNameIndexTable(
    proIndex,
    publicNames,
    '组件 README 专业分类索引',
  )

  for (const requiredPhrase of [
    'Fantastic-admin Pro `6.3.0`',
    '`web/apps/qsmds-arco`',
    '50 个运行时公开名',
    '47 个源码目录',
    '2026-07-15',
    '`web/packages/components/src/index.ts`',
    '官网仅用于解释与追溯',
  ]) {
    assert.ok(proHandbook.includes(requiredPhrase), `专业版组件分册的基线说明缺少：${requiredPhrase}`)
  }

  const documentedHeadings = readMarkdownSecondLevelHeadings(proHandbook)
    .map(heading => heading.match(/^((?:Fa|useFa)[A-Z][A-Za-z0-9]+)(?:[ \t]|$)/u)?.[1])
    .filter(Boolean)
  for (const publicName of publicNames) {
    const headingCount = documentedHeadings.filter(name => name === publicName).length
    assert.equal(
      headingCount,
      1,
      `专业版组件公开名必须恰好有一个真实二级 Markdown 标题：name=${publicName}; actual=${headingCount}; file=${fantasticAdminComponentHandbookPaths.pro}`,
    )
  }

  const publicNameSet = new Set(publicNames)
  const visibleProContent = proHandbook.replace(/(\[[^\]]*\])\([^)]+\)/gu, '$1')
  const claimedPublicNames = [...new Set(
    [...visibleProContent.matchAll(/\b(?:Fa|useFa)[A-Z][A-Za-z0-9]+/gu)].map(match => match[0]),
  )]
  const unexportedClaims = claimedPublicNames.filter(name => !publicNameSet.has(name))
  assert.deepEqual(
    unexportedClaims,
    [],
    `专业版组件文档不得宣称本地专业区段未导出的 Fa*/useFa* 能力：${unexportedClaims.join(', ')}`,
  )
})

test('Fantastic-admin 专业组件实现契约：useFaLoading 生命周期与并发边界', () => {
  const proHandbook = readRequiredFile(fantasticAdminComponentHandbookPaths.pro)
  const section = readSecondLevelSection(proHandbook, 'useFaLoading')
  const source = readRequiredFile(fantasticAdminProSourcePaths.loading)

  for (const requiredPhrase of [
    '`vnode` 与 `mountNode` 是 module-global',
    '`instance` 当前从未被赋值',
    '重复调用或并发调用不可靠',
    '`getCurrentInstance()`',
    '只有调用时存在活动组件实例',
    '`onUnmounted`',
    '无论在 `setup` 直接调用，还是在事件或 async 回调调用',
    '`finally`',
    '显式调用 `close()`',
  ]) {
    assert.ok(section.includes(requiredPhrase), `useFaLoading 实现级契约缺少：${requiredPhrase}`)
  }
  assert.doesNotMatch(
    section,
    /全局同时只保留一个内部实例|新调用会清理旧实例|组件卸载也会 cleanup/u,
    'useFaLoading 不得承诺当前源码没有可靠实现的单例或自动卸载清理',
  )
  for (const requiredSource of [
    'let instance: App<Element> | null = null',
    'let mountNode: HTMLElement | null = null',
    'let vnode: VNode | null = null',
    'const currentInstance = getCurrentInstance()',
    'if (instance && mountNode)',
    'if (currentInstance)',
    'onUnmounted(() =>',
  ]) {
    assert.ok(source.includes(requiredSource), `useFaLoading 真实源码 guard 缺少：${requiredSource}`)
  }
  assert.equal(
    source.match(/\binstance\s*=/gu)?.length,
    1,
    'useFaLoading 的 instance 当前只能在 cleanup 中归零；出现新的赋值后必须复核并发说明',
  )
  assert.ok(source.includes('instance = null'), 'useFaLoading 的 instance 唯一赋值必须仍是 cleanup 归零')
})

test('Fantastic-admin 专业组件实现契约：FaSteps 状态可访问性边界', () => {
  const proHandbook = readRequiredFile(fantasticAdminComponentHandbookPaths.pro)
  const section = readSecondLevelSection(proHandbook, 'FaSteps')
  const source = readRequiredFile(fantasticAdminProSourcePaths.steps)

  for (const requiredPhrase of [
    '颜色、图标和序号',
    '`title` / `description` 是步骤自身文案，不是状态文字',
    '没有状态 `aria-label`',
    '可读状态文本',
    '可访问名称',
    'Arco Steps',
  ]) {
    assert.ok(section.includes(requiredPhrase), `FaSteps 状态可访问性契约缺少：${requiredPhrase}`)
  }
  assert.equal(
    section.includes('错误/完成状态同时有图标和文字，不只用颜色'),
    false,
    'FaSteps 不得把普通 title/description 错写为状态文字',
  )
  for (const requiredSource of [
    '<StepperTrigger disabled>',
    'getStepStatus(index) === \'finish\'',
    'getStepStatus(index) === \'error\'',
    '<span v-else>{{ index + 1 }}</span>',
    '{{ step.title }}',
    '{{ step.description }}',
  ]) {
    assert.ok(source.includes(requiredSource), `FaSteps 真实源码 guard 缺少：${requiredSource}`)
  }
  assert.doesNotMatch(
    source,
    /aria-label|statusText/u,
    'FaSteps 源码新增状态可访问名称后必须复核手册边界，不能让 guard 静默放过',
  )
})

test('Fantastic-admin 专业组件实现契约：FaMultiStepLoader 显式启动与复位', () => {
  const proHandbook = readRequiredFile(fantasticAdminComponentHandbookPaths.pro)
  const section = readSecondLevelSection(proHandbook, 'FaMultiStepLoader')
  const source = readRequiredFile(fantasticAdminProSourcePaths.multiStepLoader)

  for (const requiredPhrase of [
    'watch 没有 `immediate`',
    'function run()',
    'running.value = true',
    'function reset()',
    '@complete="reset"',
    '@error="reset"',
    '@close="reset"',
    '@click="run"',
  ]) {
    assert.ok(section.includes(requiredPhrase), `FaMultiStepLoader 启动/复位契约缺少：${requiredPhrase}`)
  }
  assert.equal(
    section.includes('const running = ref(true)'),
    false,
    'FaMultiStepLoader 示例不得依赖初始 true 触发非 immediate watch',
  )
  assert.match(source, /watch\(\s*\(\) => props\.loading,/u, 'FaMultiStepLoader 真实源码必须继续监听 loading')
  assert.doesNotMatch(source, /immediate\s*:/u, 'FaMultiStepLoader watch 新增 immediate 后必须复核启动说明')
  for (const requiredSource of [
    'stateChange: [number]',
    'complete: []',
    'close: []',
    'error: [Error, number]',
    'emit(\'complete\')',
    'emit(\'close\')',
    'emit(\'error\'',
  ]) {
    assert.ok(source.includes(requiredSource), `FaMultiStepLoader 真实源码 guard 缺少：${requiredSource}`)
  }
})

test('Fantastic-admin 专业组件实现契约：FaCodePreview 真实组合结构', () => {
  const proHandbook = readRequiredFile(fantasticAdminComponentHandbookPaths.pro)
  const section = readSecondLevelSection(proHandbook, 'FaCodePreview')
  const source = readRequiredFile(fantasticAdminProSourcePaths.codePreview)

  for (const requiredPhrase of ['上方预览、下方按需源码', '`PageMain`', '`Button`', '`Icon`', '`FaCode`']) {
    assert.ok(section.includes(requiredPhrase), `FaCodePreview 真实组合结构缺少：${requiredPhrase}`)
  }
  assert.doesNotMatch(
    section,
    /并排|Collapsible/u,
    'FaCodePreview 不得写成并排布局或不存在的 Collapsible 组合',
  )
  for (const requiredSource of [
    'import Button from \'../../basic/button/index.vue\'',
    'import Icon from \'../../basic/icon/index.vue\'',
    'import PageMain from \'../../basic/page-main/index.vue\'',
    'import Code from \'../code/index.vue\'',
    '<PageMain :title main-class="p-0">',
    '<Code v-show="showSource"',
    '@click="showSource = !showSource"',
  ]) {
    assert.ok(source.includes(requiredSource), `FaCodePreview 真实源码 guard 缺少：${requiredSource}`)
  }
  assert.equal(source.includes('Collapsible'), false, 'FaCodePreview 新增 Collapsible 后必须复核组合结构说明')
})

test('Fantastic-admin 专业组件示例契约：FaCarousel 使用单个 v-for Fragment', () => {
  const section = readSecondLevelSection(
    readRequiredFile(fantasticAdminComponentHandbookPaths.pro),
    'FaCarousel',
  )
  const articleOpeningTags = section.match(/<article\b[^>]*>/gu) ?? []
  const generatedArticleTag = articleOpeningTags.find(tag => (
    /\bv-for="[^"]+"/u.test(tag) && /\s:key="[^"]+"/u.test(tag)
  ))

  assert.ok(section.includes('默认插槽第一个 VNode 的 `children`'), 'FaCarousel 必须记录默认插槽读取边界')
  assert.ok(generatedArticleTag, 'FaCarousel 示例必须由同一个 article opening tag 提供 v-for 与 :key')
})

test('Fantastic-admin 专业组件示例契约：FaTextHighlight 提供真实渐变背景', () => {
  const section = readSecondLevelSection(
    readRequiredFile(fantasticAdminComponentHandbookPaths.pro),
    'FaTextHighlight',
  )

  for (const requiredPhrase of ['bg-gradient-to-r', 'from-primary', 'to-accent', 'CSS keyframes']) {
    assert.ok(section.includes(requiredPhrase), `FaTextHighlight 渐变实现契约缺少：${requiredPhrase}`)
  }
  assert.equal(section.includes('Motion'), false, 'FaTextHighlight 不得再写成 Motion 实现')
})

test('Fantastic-admin 专业组件示例契约：FaGlowyCard 与 Wrapper 成对拥有页面唯一 main', () => {
  const proHandbook = readRequiredFile(fantasticAdminComponentHandbookPaths.pro)
  const cardSection = readSecondLevelSection(proHandbook, 'FaGlowyCard')
  const wrapperSection = readSecondLevelSection(proHandbook, 'FaGlowyCardWrapper')
  const sections = [cardSection, wrapperSection]
  const vueExamples = sections.flatMap(section => (
    [...section.matchAll(/```vue\n([\s\S]*?)```/gu)].map(match => match[1])
  ))

  for (const [heading, section] of [['FaGlowyCard', cardSection], ['FaGlowyCardWrapper', wrapperSection]]) {
    for (const requiredPhrase of [
      '不得裸用',
      '`--glowy-card-radius`',
      '`--glowy-card-backup-border`',
      '`--glowy-card-x`',
      '`FaGlowyCardWrapper` 注入',
      '页面唯一的 `main`',
      '已有 `main`',
      '`ACard`',
    ]) {
      assert.ok(section.includes(requiredPhrase), `${heading} 成对使用与静态降级契约缺少：${requiredPhrase}`)
    }
  }

  const pairedExample = vueExamples.find(example => /<FaGlowyCardWrapper(?:\s|>)/u.test(example))
  assert.ok(pairedExample, '必须提供 FaGlowyCardWrapper 与 FaGlowyCard 的合法成对示例')
  assert.ok(
    pairedExample.includes('页面没有其他 main；组件拥有页面唯一 main'),
    '成对示例必须明确页面没有其他 main，Wrapper 拥有唯一 main',
  )
  assert.match(
    pairedExample,
    /<FaGlowyCardWrapper(?:\s|>)[\s\S]*<FaGlowyCard(?:\s|>)/u,
    '唯一 main 示例必须让 Wrapper 包含 Card',
  )
  assert.ok(vueExamples.some(example => /<ACard(?:\s|>)/u.test(example)), '已有 main 的安全降级示例必须使用 ACard')

  for (const example of vueExamples) {
    const usesCard = /<FaGlowyCard(?:\s|>)/u.test(example)
    const usesWrapper = /<FaGlowyCardWrapper(?:\s|>)/u.test(example)
    assert.ok(!usesCard || usesWrapper, 'Vue 示例不得在 Wrapper 外裸用 FaGlowyCard')
  }
})

test('Fantastic-admin 专业组件示例契约：FaTimeline 仅严格合并相邻原始 datetime', () => {
  const section = readSecondLevelSection(
    readRequiredFile(fantasticAdminComponentHandbookPaths.pro),
    'FaTimeline',
  )

  for (const requiredPhrase of [
    '相邻项',
    '原始 `datetime`',
    '严格 `===`',
    '不同 `Date` 实例',
    '不同格式',
    '先排序',
    '同一种 `string` 或 `number`',
  ]) {
    assert.ok(section.includes(requiredPhrase), `FaTimeline 严格合并契约缺少：${requiredPhrase}`)
  }
})

test('Fantastic-admin 专业组件示例契约：FaSparkline 固定数据域与静态摘要', () => {
  const section = readSecondLevelSection(
    readRequiredFile(fantasticAdminComponentHandbookPaths.pro),
    'FaSparkline',
  )

  function assertMatchingSparklineSummaryIds(candidate) {
    const describedBy = candidate.match(/\baria-describedby="([^"]+)"/u)?.[1]
    const summaryOpeningTag = candidate.match(/<figcaption\b[^>]*>/u)?.[0]
    const summaryId = summaryOpeningTag?.match(/\sid="([^"]+)"/u)?.[1]

    assert.ok(describedBy, 'FaSparkline 示例必须通过 aria-describedby 关联静态摘要')
    assert.ok(summaryId, 'FaSparkline 示例必须为静态摘要提供 id')
    assert.equal(describedBy, summaryId, 'FaSparkline 的 aria-describedby 必须与静态摘要 id 一致')
  }

  for (const requiredPhrase of [
    '有限非负值',
    '至少一个值大于 0',
    '全零',
    '`NaN`',
    '负值',
    '最近五期',
  ]) {
    assert.ok(section.includes(requiredPhrase), `FaSparkline 数据与可访问性契约缺少：${requiredPhrase}`)
  }
  assertMatchingSparklineSummaryIds(section)
  assert.doesNotThrow(
    () => assertMatchingSparklineSummaryIds(section.replaceAll('sparkline-summary', 'trend-description')),
    'FaSparkline 摘要 id 等价改名不应触发假失败',
  )
  assert.ok(section.includes(':value="[12, 16, 14, 20, 18]"'), 'FaSparkline 示例必须保留合法正值序列')
})

test('Fantastic-admin 专业组件示例契约：FaFlipCard 正面保留关键数字', () => {
  const section = readSecondLevelSection(
    readRequiredFile(fantasticAdminComponentHandbookPaths.pro),
    'FaFlipCard',
  )
  const keyInformationIndex = section.indexOf('可用 1280 件')
  const backSlotIndex = section.indexOf('<template #back>')

  assert.notEqual(keyInformationIndex, -1, 'FaFlipCard 示例正面必须显示关键数字“可用 1280 件”')
  assert.notEqual(backSlotIndex, -1, 'FaFlipCard 示例必须明确背面 slot 的补充信息边界')
  assert.ok(keyInformationIndex < backSlotIndex, 'FaFlipCard 关键数字必须出现在背面 slot 之前的正面内容中')
  for (const requiredPhrase of ['背面只放补充信息', 'hover-only', '没有键盘', '没有触摸', '没有受控入口']) {
    assert.ok(section.includes(requiredPhrase), `FaFlipCard 交互边界缺少：${requiredPhrase}`)
  }
})

test('Fantastic-admin 专业组件示例契约：FaScratchOff 提供外部状态与原生按钮替代', () => {
  const section = readSecondLevelSection(
    readRequiredFile(fantasticAdminComponentHandbookPaths.pro),
    'FaScratchOff',
  )

  function assertScratchOffAlternative(candidate) {
    const stateName = candidate.match(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*ref\(false\)/u)?.[1]
    assert.ok(stateName, 'FaScratchOff 示例必须用 ref(false) 管理外部完成状态')

    const escapedStateName = stateName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    const buttonOpeningTag = candidate.match(/<button\b[^>]*>/u)?.[0]
    const scratchOffOpeningTag = candidate.match(/<FaScratchOff\b[^>]*>/u)?.[0]
    assert.ok(buttonOpeningTag, 'FaScratchOff 示例必须提供原生 button')
    assert.match(buttonOpeningTag, /\btype="button"/u, 'FaScratchOff 替代按钮必须显式使用 type="button"')
    assert.match(
      buttonOpeningTag,
      new RegExp(`@click="${escapedStateName}\\s*=\\s*true"`, 'u'),
      'FaScratchOff 替代按钮必须切换外部完成状态',
    )
    assert.ok(scratchOffOpeningTag, 'FaScratchOff 示例必须保留 canvas 交互组件')
    assert.match(scratchOffOpeningTag, /\bv-else\b/u, 'FaScratchOff canvas 必须与静态内容形成 v-if/v-else')
    assert.match(
      scratchOffOpeningTag,
      new RegExp(`@complete="${escapedStateName}\\s*=\\s*true"`, 'u'),
      'FaScratchOff complete 必须切换同一个外部完成状态',
    )
    assert.match(
      candidate,
      new RegExp(`\\bv-if="${escapedStateName}"`, 'u'),
      'FaScratchOff 完成后必须切换到静态内容',
    )
  }

  assert.ok(section.includes('直接显示内容'), 'FaScratchOff 原生替代按钮必须提供明确文案')
  assertScratchOffAlternative(section)
  assert.doesNotThrow(
    () => assertScratchOffAlternative(section.replaceAll('revealed', 'contentVisible')),
    'FaScratchOff 外部状态等价改名不应触发假失败',
  )
})

test('Fantastic-admin 专业组件示例契约：FaMarquee 只重复隐藏的装饰内容', () => {
  const section = readSecondLevelSection(
    readRequiredFile(fantasticAdminComponentHandbookPaths.pro),
    'FaMarquee',
  )
  const marqueeOpeningTag = section.match(/<FaMarquee\b[^>]*>/u)?.[0]

  assert.equal(section.match(/class="sr-only"/gu)?.length, 1, 'FaMarquee 静态语义文本必须且只能出现一次')
  assert.ok(marqueeOpeningTag, 'FaMarquee 示例必须包含组件 opening tag')
  assert.match(marqueeOpeningTag, /\baria-hidden="true"/u, '重复的 FaMarquee 动画 DOM 必须对辅助技术隐藏')
  for (const requiredPhrase of ['语义文本放在动画外', '不得放交互控件', '不得承载唯一信息']) {
    assert.ok(section.includes(requiredPhrase), `FaMarquee 重复内容边界缺少：${requiredPhrase}`)
  }
})

test('Fantastic-admin 专业组件实现术语与真实源码保持一致', () => {
  const proHandbook = readRequiredFile(fantasticAdminComponentHandbookPaths.pro)
  const contracts = [
    ['FaDigitalCard', ['`Card`、`Icon`、`Tooltip`', '`computed` 计算趋势图标'], /\bTrend\b/u],
    ['FaFlipCard', ['CSS/UnoCSS', '`group-hover` transition'], /\bMotion\b/u],
    ['FaScrollingText', ['inline `transform` / `opacity` transition'], /Vue Transition/u],
    ['FaSpotlightCard', ['`MouseEvent`', '`@mousemove`'], /PointerEvent/u],
    ['FaTextHighlight', ['CSS keyframes'], /\bMotion\b/u],
    ['FaTimeline', ['本地 `ScrollArea`', '`@on-scroll`'], /VueUse/u],
  ]

  for (const [heading, requiredPhrases, forbiddenPattern] of contracts) {
    const section = readSecondLevelSection(proHandbook, heading)
    for (const requiredPhrase of requiredPhrases) {
      assert.ok(section.includes(requiredPhrase), `${heading} 真实实现术语缺少：${requiredPhrase}`)
    }
    assert.doesNotMatch(section, forbiddenPattern, `${heading} 不得回退到错误的实现术语`)
  }
})

test('Fantastic-admin AI Skill 遵循应用定位与 Fa-first 业务 UI 契约', () => {
  const skills = readRequiredFile(fantasticAdminHandbookPaths.skills)
  const commonRules = readSecondLevelSection(skills, '共同安全与执行规则')

  assert.ok(
    commonRules.includes('七个')
    && commonRules.includes('fa-crud-page-generator')
    && commonRules.includes('fa-theme-customizer')
    && commonRules.includes('未指定')
    && commonRules.includes('确认'),
    '共同规则必须区分七个默认正式应用 Skill，以及两个未指定目标时需确认的例外 Skill',
  )

  for (const [from, to] of [
    ['FaForm / FaFormItem', 'AForm / AFormItem'],
    ['FaTable', 'ATable'],
    ['FaPagination', 'APagination'],
    ['FaButton', 'AButton'],
    ['FaToast / useFaToast', 'Message / Notification'],
  ]) {
    assert.ok(
      commonRules.includes(from) && commonRules.includes(to),
      `共同规则缺少 Fantastic-admin 能力不足时的 Arco 回退映射：${from} -> ${to}`,
    )
  }
  for (const requiredPhrase of [
    'Fantastic-admin 内置组件',
    '第一优先级',
    '无法满足',
    'Arco Design Vue',
    '当前主题 token',
  ]) {
    assert.ok(commonRules.includes(requiredPhrase), `共同规则缺少 Fa-first 执行契约：${requiredPhrase}`)
  }
  assert.ok(commonRules.includes('FaPageMain'), '共同规则必须明确框架页面壳 FaPageMain 可以保留')
  assert.ok(commonRules.includes('app.use(ArcoVue)'), '共同规则必须记录正式应用的 Arco 全局注册事实')

  for (const [sourceContract, arcoContract] of [
    ['validation-schema', 'rules'],
    ['name', 'field'],
    ['FormExpose.submit()', 'validate()'],
    ['componentField', '插槽参数'],
  ]) {
    assert.ok(
      commonRules.includes(sourceContract) && commonRules.includes(arcoContract),
      `共同规则缺少 Arco 表单语义适配：${sourceContract} -> ${arcoContract}`,
    )
  }
  for (const requiredPhrase of [
    '不得只替换组件名',
    'validator',
    'v-model',
    'html-type="submit"',
    '@submit-success',
    '@submit-failed',
    '重写',
  ]) {
    assert.ok(commonRules.includes(requiredPhrase), `共同规则缺少 Arco 表单适配要求：${requiredPhrase}`)
  }

  for (const skillName of [
    'fa-form-builder',
    'fa-framework-settings',
    'fa-i18n-manager',
    'fa-page-optimizer',
    'fa-route-generator',
    'fa-slot-creator',
    'fa-store-generator',
  ]) {
    const appTargetRow = findTableRow(readSecondLevelSection(skills, skillName), '应用定位')
    assert.ok(
      appTargetRow?.[1].includes('默认正式应用')
      && appTargetRow[1].includes('web/apps/qsmds-arco'),
      `${skillName} 必须明确默认正式应用定位`,
    )
  }

  for (const skillName of ['fa-crud-page-generator', 'fa-theme-customizer']) {
    const appTargetRow = findTableRow(readSecondLevelSection(skills, skillName), '应用定位')
    assert.ok(
      appTargetRow?.[1].includes('未指定')
      && appTargetRow[1].includes('确认'),
      `${skillName} 必须保留本地 Skill 的目标应用确认例外`,
    )
  }

  for (const skillName of ['fa-crud-page-generator', 'fa-form-builder', 'fa-page-optimizer']) {
    const section = readSecondLevelSection(skills, skillName)
    assert.ok(
      section.includes('优先')
      && section.includes('Fa* 业务 UI')
      && section.includes('无法满足')
      && section.includes('Arco'),
      `${skillName} 必须明确优先采用 Fa* 业务 UI，无法满足时才回退 Arco`,
    )
  }

  const formBuilderUiRule = findTableRow(readSecondLevelSection(skills, 'fa-form-builder'), 'UI 落地')?.[1] ?? ''
  for (const requiredPhrase of [
    '不得只替换组件名',
    'validation-schema',
    'rules',
    'validator',
    'name',
    'field',
    'v-model',
    'model',
    'FormExpose.submit()',
    'validate()',
    'html-type="submit"',
    'componentField',
    '插槽参数',
    '重写',
  ]) {
    assert.ok(formBuilderUiRule.includes(requiredPhrase), `fa-form-builder UI 落地缺少 Arco 语义适配：${requiredPhrase}`)
  }

  const crudUiRule = findTableRow(readSecondLevelSection(skills, 'fa-crud-page-generator'), 'UI 落地')?.[1] ?? ''
  for (const requiredPhrase of ['DetailForm.submit(): Promise<boolean>', '对外契约', '内部', 'validate()']) {
    assert.ok(crudUiRule.includes(requiredPhrase), `fa-crud-page-generator UI 落地缺少表单提交适配：${requiredPhrase}`)
  }
})

test('fa-page-optimizer 使用真实的 basic/pro 组件 README 路径', () => {
  readRequiredFile(pageOptimizerGovernancePaths.basicReadme)
  readRequiredFile(pageOptimizerGovernancePaths.proReadme)

  const wrongReadmeTemplate = /packages\/components\/src\/<component(?:-name)?>\/README\.md/u
  for (const [name, filePath] of Object.entries({
    skill: pageOptimizerGovernancePaths.skill,
    catalog: pageOptimizerGovernancePaths.catalog,
  })) {
    assert.doesNotMatch(
      readRequiredFile(filePath),
      wrongReadmeTemplate,
      `fa-page-optimizer ${name} 不得继续使用缺少 basic/pro 层级的 README 路径模板`,
    )
  }

  const skills = readRequiredFile(fantasticAdminHandbookPaths.skills)
  assert.ok(
    skills.includes('web/packages/components/src/basic/<component>/README.md')
    && skills.includes('web/packages/components/src/pro/<component>/README.md'),
    'AI 技能手册必须同时记录 basic 与 pro 组件 README 的真实路径模板',
  )
})

test('Arco Design Vue Task 7 runtime inventory 使用 AST 且不依赖生成格式', () => {
  const source = readRequiredFile(arcoDesignVueTask7SourcePaths.arcoVue)
  const expectedInventory = readArcoRuntimeInventory(source)
  const reformattedSource = [
    ...[...expectedInventory].map(([family, sourceSlug]) => `import ${family} from './${sourceSlug}/index.js'`),
    `const components={${[...expectedInventory.keys()].join(',')}}`,
  ].join('\n')

  assert.deepEqual(
    readArcoRuntimeInventory(reformattedSource),
    expectedInventory,
    'runtime inventory 不得依赖双引号、分号或 components 对象的换行格式',
  )
  assert.throws(
    () => readArcoRuntimeInventory('const components = {'),
    /语法解析失败/u,
    'runtime inventory AST helper 必须拒绝 parseDiagnostics',
  )
})

test('Arco Design Vue Task 7 Table 示例通过真实 TypeScript 语义检查', () => {
  const dataDisplay = readRequiredFile(arcoDesignVueHandbookPaths.dataDisplay)
  const tableSection = readSecondLevelSection(dataDisplay, 'Table')
  const tableExample = extractVueFences(tableSection)[0].source
  const scriptSetup = readTypeScriptScriptSetup(tableExample, 'Table.vue')
  const sorterHookSource = readRequiredFile(arcoDesignVueTask7SourcePaths.tableColumnSorter)

  assert.doesNotThrow(
    () => assertRemoteTableSortDirections(scriptSetup, 'TableExample.ts'),
    '远端排序列必须提供非空且合法的 sortDirections',
  )
  assert.equal(
    hasRuntimeSortDirectionsLengthGuard(sorterHookSource),
    true,
    'Table 运行时必须以 sortDirections.length > 0 决定是否展示排序入口',
  )

  const emptySortDirections = emptyRemoteTableSortDirections(scriptSetup, 'TableEmptySortDirections.ts')
  assert.deepEqual(
    collectTypeScriptSemanticDiagnostics(emptySortDirections, 'TableEmptySortDirections.ts'),
    [],
    '空 sortDirections 在严格 TypeScript 中仍合法，必须由运行时契约另行拦截',
  )
  assert.throws(
    () => assertRemoteTableSortDirections(emptySortDirections, 'TableEmptySortDirections.ts'),
    /sortDirections 不能为空/u,
    '空 sortDirections 虽通过 TypeScript，也必须被运行时契约测试拒绝',
  )
  assert.throws(
    () => assertRemoteTableSortDirections('const columns = [', 'TableMalformed.ts'),
    /语法解析失败/u,
    'Table AST helper 必须拒绝 parseDiagnostics',
  )

  assert.deepEqual(
    collectTypeScriptSemanticDiagnostics(scriptSetup, 'TableExample.ts'),
    [],
    'Table script setup 必须在 strict 模式下解析真实 Arco 与 Vue 类型且 diagnostics=0',
  )

  const brokenType = `${scriptSetup}\nconst broken: string = 1\n`
  assert.notEqual(
    collectTypeScriptSemanticDiagnostics(brokenType, 'TableBrokenType.ts').length,
    0,
    'semantic probe 必须识别普通 TypeScript 类型错误',
  )

  const missingSortDirections = `
import type { TableColumnData } from '@arco-design/web-vue'

const columns = [
  { title: '订单', dataIndex: 'name', sortable: { sorter: true } },
] satisfies TableColumnData[]
`
  const missingSortDirectionsDiagnostics = collectTypeScriptSemanticDiagnostics(
    missingSortDirections,
    'TableMissingSortDirections.ts',
  )
  assert.notEqual(
    missingSortDirectionsDiagnostics.length,
    0,
    'semantic probe 必须识别 sorter=true 缺少 sortDirections',
  )
  assert.equal(
    missingSortDirectionsDiagnostics.some(diagnostic => (
      ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n').includes('sortDirections')
    )),
    true,
    '缺失 sortDirections 的诊断必须来自真实 TableSortable 类型',
  )
})

test('Arco Design Vue Task 7 异步确认 catch 使用活动 Message.error 调用', () => {
  const feedback = readRequiredFile(arcoDesignVueHandbookPaths.feedback)

  for (const family of ['Drawer', 'Modal', 'Popconfirm']) {
    const section = readSecondLevelSection(feedback, family)
    const example = extractVueFences(section)[0].source
    const scriptSetup = readTypeScriptScriptSetup(example, `${family}.vue`)

    assert.doesNotThrow(
      () => assertBeforeOkCatchMessageError(scriptSetup, `${family}.ts`),
      `${family} beforeOk catch 必须包含活动 Message.error 调用`,
    )
    for (const mutation of ['comment', 'delete']) {
      const mutated = mutateBeforeOkCatchMessageError(scriptSetup, `${family}-${mutation}.ts`, mutation)
      assert.throws(
        () => assertBeforeOkCatchMessageError(mutated, `${family}-${mutation}.ts`),
        /catch 必须调用 Message\.error/u,
        `${family} Message.error 被${mutation === 'comment' ? '注释' : '删除'}后必须失败`,
      )
    }
  }

  assert.throws(
    () => assertBeforeOkCatchMessageError('async function beforeOk( {', 'MalformedBeforeOk.ts'),
    /语法解析失败/u,
    '异步反馈 AST helper 必须拒绝 parseDiagnostics',
  )
})

test('Arco Design Vue Task 7 补齐剩余 46 个家族并完成 74 个家族矩阵', () => {
  const documents = Object.fromEntries(
    Object.entries(arcoDesignVueHandbookPaths).map(([name, filePath]) => [name, readRequiredFile(filePath)]),
  )
  const arcoVersion = readArcoCatalogResolvedVersion()
  const runtimeInventory = readArcoRuntimeInventory(readRequiredFile(arcoDesignVueTask7SourcePaths.arcoVue))

  assert.equal(arcoVersion, '2.58.0', 'Arco 文档基线必须与 lockfile 锁定的 Arco Design Vue 2.58.0 一致')
  assert.equal(arcoDesignVueCoverage.length, 74, 'Arco Design Vue 覆盖契约必须独立固定为 74 个家族')
  assert.equal(runtimeInventory.size, 74, 'arco-vue.js 主 components 安装对象必须恰好包含 74 个家族')
  assert.deepEqual(
    [...runtimeInventory.keys()].sort(),
    arcoDesignVueCoverage.map(([family]) => family).sort(),
    '手册 74 家族必须与 arco-vue.js 运行时安装 inventory 精确一致',
  )
  assert.equal(arcoTask6Coverage.length, 28, 'Task 6 必须独立固定首批 28 个家族')
  assert.equal(arcoTask7Coverage.length, 46, 'Task 7 必须独立固定剩余 46 个家族')
  for (const requiredPhrase of [
    '`@arco-design/web-vue@2.58.0`',
    '`web/apps/qsmds-arco`',
    '唯一正式 Web 应用',
    '2026-07-15',
    '74',
    'https://arco.design/vue/docs/start',
    'https://github.com/arco-design/arco-design-vue/tree/2.58.0',
    '5a707cc60c1130d8dae3aefb2e93616541952a66',
  ]) {
    assert.ok(documents.index.includes(requiredPhrase), `Arco Design Vue 入口缺少基线信息：${requiredPhrase}`)
  }
  for (const relativeLink of [
    './接入基础与全局配置.md',
    './通用与布局组件.md',
    './数据录入组件.md',
    './数据展示组件.md',
    './反馈组件.md',
    './导航与其他组件.md',
  ]) {
    assert.ok(documents.index.includes(relativeLink), `Arco Design Vue 入口缺少现存分册链接：${relativeLink}`)
  }
  assert.ok(
    documents.index.includes('../Fantastic-admin内置组件/选型与使用规则.md#4-与-arco-重叠能力的选择'),
    'Arco Design Vue 入口必须回链 Fantastic-admin 内置组件选型规则',
  )
  assert.equal(
    readMarkdownHeadingAnchors(readRequiredFile(fantasticAdminComponentHandbookPaths.selection))
      .has('4-与-arco-重叠能力的选择'),
    true,
    'Arco Design Vue 入口回链的 Fantastic-admin 选型章节必须真实存在',
  )
  assert.doesNotMatch(documents.index, /Task 7 待纳入/u, 'Task 7 完成后覆盖矩阵不得继续保留待纳入状态')
  assertExistingMarkdownLinks(documents.index, arcoDesignVueHandbookPaths.index)

  const coverageRows = readArcoDesignVueCoverageMatrix(documents.index)
  assert.equal(coverageRows.length, 74, 'Arco Design Vue 覆盖矩阵必须恰好包含 74 行')
  assert.equal(
    new Set(coverageRows.map(row => row.family)).size,
    coverageRows.length,
    'Arco Design Vue 覆盖矩阵中的英文家族不得重复',
  )

  const volumeNames = {
    commonAndLayout: '通用与布局组件',
    dataEntry: '数据录入组件',
    dataDisplay: '数据展示组件',
    feedback: '反馈组件',
    navigationAndOther: '导航与其他组件',
  }
  for (const [index, [family, category, documentKey, sourceSlug]] of arcoDesignVueCoverage.entries()) {
    const row = coverageRows[index]
    assert.equal(runtimeInventory.get(family), sourceSlug, `${family} sourceSlug 必须匹配 arco-vue.js 默认 import`)
    assert.equal(
      existsSync(resolve(dirname(arcoDesignVueTask7SourcePaths.arcoVue), sourceSlug, 'index.js')),
      true,
      `${family} sourceSlug 必须落到本地已安装组件目录：${sourceSlug}`,
    )
    assert.equal(row.family, family, `Arco Design Vue 覆盖矩阵家族顺序漂移：index=${index}`)
    assert.equal(row.category, category, `Arco Design Vue 覆盖矩阵分类错误：${family}`)
    assert.equal(
      row.sourceUrl,
      `https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/${sourceSlug}`,
      `Arco Design Vue 覆盖矩阵版本源码目录错误：${family}`,
    )
    if (family === 'Message' || family === 'Notification') {
      const instanceApi = family === 'Message' ? '$message' : '$notification'
      assert.ok(row.status.includes(instanceApi), `${family} 接入状态必须记录实例注入 ${instanceApi}`)
      assert.ok(row.status.includes('静态 API'), `${family} 接入状态必须记录静态 API`)
      assert.doesNotMatch(row.status, /全局注册/u, `${family} 接入状态不得声称模板组件全局注册`)
    }
    else if (family === 'Drawer' || family === 'Modal') {
      const componentApi = family === 'Drawer' ? 'ADrawer' : 'AModal'
      const instanceApi = family === 'Drawer' ? '$drawer' : '$modal'
      for (const requiredPhrase of [componentApi, instanceApi, '静态 API']) {
        assert.ok(row.status.includes(requiredPhrase), `${family} 接入状态缺少：${requiredPhrase}`)
      }
    }
    else {
      assert.ok(row.status.includes('全局注册'), `${family} 接入状态必须包含全局注册事实`)
    }
    assert.equal(row.checkedAt, '2026-07-15', `Arco Design Vue 覆盖矩阵核对日期错误：${family}`)

    const expectedVolume = volumeNames[documentKey]
    assert.equal(
      row.volume,
      `[${expectedVolume}](./${expectedVolume}.md#${family.toLowerCase()})`,
      `Arco 家族必须链接到真实分册章节：${family}`,
    )
  }

  const expectedHeadings = {
    commonAndLayout: arcoDesignVueCoverage.filter(([, , key]) => key === 'commonAndLayout').map(([family]) => family),
    dataEntry: arcoDesignVueCoverage.filter(([, , key]) => key === 'dataEntry').map(([family]) => family),
    dataDisplay: arcoDesignVueCoverage.filter(([, , key]) => key === 'dataDisplay').map(([family]) => family),
    feedback: arcoDesignVueCoverage.filter(([, , key]) => key === 'feedback').map(([family]) => family),
    navigationAndOther: arcoDesignVueCoverage.filter(([, , key]) => key === 'navigationAndOther').map(([family]) => family),
  }
  for (const [documentKey, headings] of Object.entries(expectedHeadings)) {
    assert.deepEqual(
      readMarkdownSecondLevelHeadings(documents[documentKey]),
      headings,
      `${volumeNames[documentKey]}分册必须按契约顺序恰好包含 ${headings.length} 个家族 H2`,
    )
  }
  const allHeadings = Object.keys(expectedHeadings)
    .flatMap(documentKey => readMarkdownSecondLevelHeadings(documents[documentKey]))
  assert.equal(allHeadings.length, 74, 'Arco 五个组件分册必须恰好包含 74 个 fence 外 H2')
  assert.equal(new Set(allHeadings).size, 74, 'Arco 的 74 个家族 H2 必须唯一')

  for (const [family, , documentKey, sourceSlug] of arcoDesignVueCoverage) {
    const section = readSecondLevelSection(documents[documentKey], family)
    const prose = readMarkdownLinesOutsideFences(section).join('\n')
    for (const requiredLabel of ['当前接入：', '实际组件名：', '高频契约：', '可访问性与响应式：']) {
      assert.equal(
        countTextOccurrences(prose, requiredLabel),
        1,
        `${family} 章节 fence 外必须恰好出现一次统一说明字段：${requiredLabel}`,
      )
    }
    assertSingleVueFenceWithTemplate(section, family)
    assert.equal(
      countTextOccurrences(prose, `https://arco.design/vue/component/${sourceSlug}`),
      1,
      `${family} 章节 fence 外必须恰好链接一次当前官方组件页`,
    )
    assert.equal(
      countTextOccurrences(
        prose,
        `https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/${sourceSlug}`,
      ),
      1,
      `${family} 章节 fence 外必须恰好链接一次 2.58.0 tag 源码目录`,
    )
  }

  for (const documentKey of ['dataDisplay', 'feedback', 'navigationAndOther']) {
    const documentName = `${volumeNames[documentKey]}.md`
    assertVueFencesSyntaxCompile(documents[documentKey], documentName)
  }
  for (const documentKey of ['index', 'dataDisplay', 'feedback', 'navigationAndOther']) {
    const documentName = documentKey === 'index' ? 'README.md' : `${volumeNames[documentKey]}.md`
    assert.deepEqual(findArcoDocPolicyViolations(documents[documentKey]), [], `${documentName} 不得包含占位、虚构 endpoint 或硬编码敏感信息`)
  }
})

test('Arco Design Vue Task 7 数据展示分册固定复合组件、受控状态与大数据契约', () => {
  const dataDisplay = readRequiredFile(arcoDesignVueHandbookPaths.dataDisplay)
  const avatarSource = readRequiredFile(arcoDesignVueTask7SourcePaths.avatar)
  const calendarSource = readRequiredFile(arcoDesignVueTask7SourcePaths.calendar)
  const collapseItemSource = readRequiredFile(arcoDesignVueTask7SourcePaths.collapseItem)
  const collapseTypesSource = readRequiredFile(arcoDesignVueTask7SourcePaths.collapseTypes)
  const imageSource = readRequiredFile(arcoDesignVueTask7SourcePaths.image)
  const imagePreviewSource = readRequiredFile(arcoDesignVueTask7SourcePaths.imagePreview)
  const imagePreviewActionSource = readRequiredFile(arcoDesignVueTask7SourcePaths.imagePreviewAction)
  const imagePreviewGroupSource = readRequiredFile(arcoDesignVueTask7SourcePaths.imagePreviewGroup)
  const tableSource = readRequiredFile(arcoDesignVueTask7SourcePaths.table)
  const tableColumnSource = readRequiredFile(arcoDesignVueTask7SourcePaths.tableColumn)
  const tableTypesSource = readRequiredFile(arcoDesignVueTask7SourcePaths.tableTypes)
  const treeSource = readRequiredFile(arcoDesignVueTask7SourcePaths.tree)
  const treeBaseNodeSource = readRequiredFile(arcoDesignVueTask7SourcePaths.treeBaseNode)
  const treeCheckUtilsSource = readRequiredFile(arcoDesignVueTask7SourcePaths.treeCheckUtils)

  const calendarContract = readInstalledComponentContract(calendarSource, 'Calendar')
  assert.equal(calendarContract.props.has('isWeek'), true, 'Calendar 2.58.0 必须公开 isWeek')
  assert.equal(calendarContract.props.has('isWeekend'), false, 'Calendar 2.58.0 没有 isWeekend')
  assert.match(calendarSource, /"panelChange":\s*\([^)]*\)\s*=>\s*true/u, 'Calendar 必须公开 panelChange 日期面板事件')
  assert.doesNotMatch(calendarSource, /"update:mode"/u, 'Calendar mode 没有 update:mode 回写事件')
  assert.doesNotMatch(
    readNamedFunctionSource(calendarSource, 'changeMode'),
    /\bemit\s*\(/u,
    'Calendar 内部 mode 切换不得误判为 panelChange emit',
  )

  assert.match(collapseItemSource, /"role":\s*"button"/u, 'Collapse header 必须保留现有 button role')
  assert.match(collapseItemSource, /"tabindex":\s*"0"/u, 'Collapse header 必须保留现有 tabindex')
  assert.doesNotMatch(collapseItemSource, /onKey(?:down|up)/u, 'Collapse 2.58.0 header 没有键盘事件实现')

  const imageContract = readInstalledComponentContract(imageSource, 'Image')
  assert.equal(imageContract.props.has('lazyLoad'), false, 'Image 2.58.0 不得虚构 lazyLoad prop')
  assert.match(imagePreviewGroupSource, /emit\("change",\s*index\)/u, 'ImagePreviewGroup change 运行时必须只传 index 一个参数')
  assert.doesNotMatch(imagePreviewGroupSource, /emit\("change",[^,\n]+,/u, 'ImagePreviewGroup change 不得多传第二个参数')
  assert.match(imagePreviewActionSource, /\[`\$\{prefixCls\}-disabled`\]:\s*disabled/u, 'ImagePreviewAction disabled 只进入样式 class')
  assert.doesNotMatch(imagePreviewActionSource, /if\s*\(disabled\)\s*return/u, 'ImagePreviewAction disabled 没有阻止 attrs click handler')

  const tableColumnContract = readInstalledComponentContract(tableColumnSource, 'TableColumn')
  for (const unsupportedProp of ['render', 'slotName', 'titleSlotName']) {
    assert.equal(tableColumnContract.props.has(unsupportedProp), false, `ATableColumn 不得虚构 ${unsupportedProp} prop`)
  }
  assert.match(tableSource, /column\.sortable[\s\S]{0,100}\.sorter\)\s*!==\s*true/u, 'sortable.sorter=true 必须跳过本地排序')
  assert.match(tableSource, /rowSelection\.value[\s\S]{0,120}\.onlyCurrent/u, 'Table onlyCurrent 必须绑定运行时翻页选择逻辑')

  assert.match(treeSource, /defaultExpandAll:\s*\{[\s\S]*?default:\s*true/u, 'Tree defaultExpandAll 必须绑定默认 true')
  assert.match(readNamedFunctionSource(treeCheckUtilsSource, 'getCheckedStateByInitKeys'), /onlyCheckLeaf/u, 'onlyCheckLeaf 只参与受控 key 初始化')
  assert.doesNotMatch(readNamedFunctionSource(treeCheckUtilsSource, 'getCheckedStateByCheck'), /onlyCheckLeaf/u, 'onlyCheckLeaf 不参与用户点击勾选')
  assert.doesNotMatch(treeBaseNodeSource, /"role":\s*"treeitem"|"tabindex"|onKey(?:down|up)/u, 'Tree 节点没有完整 treeitem 或键盘实现')

  for (const [source, phrase, message] of [
    [avatarSource, 'alt: "avatar"', 'Avatar 2.58.0 图片 alt 固定为 avatar'],
    [collapseTypesSource, 'type: PropType<(string | number)[]>;', 'Collapse activeKey 必须保持数组类型'],
    [collapseTypesSource, 'accordion:', 'Collapse 必须保留 accordion 模式'],
    [imageSource, 'previewVisible:', 'Image 必须公开 previewVisible'],
    [imageSource, '"update:previewVisible"', 'Image 必须公开 update:previewVisible'],
    [imagePreviewSource, '"update:visible"', 'ImagePreview 必须公开 update:visible'],
    [imagePreviewGroupSource, '"update:current"', 'ImagePreviewGroup 必须公开 update:current'],
    [imagePreviewGroupSource, '"update:visible"', 'ImagePreviewGroup 必须公开 update:visible'],
    [tableSource, 'virtualListProps:', 'Table 必须支持 virtualListProps'],
    [tableSource, '"update:selectedKeys"', 'Table 必须支持受控 selectedKeys'],
    [tableSource, '"update:expandedKeys"', 'Table 必须支持受控 expandedKeys'],
    [tableTypesSource, 'type: \'pagination\' | \'sorter\' | \'filter\' | \'drag\';', 'Table change 类型必须保持完整'],
    [treeSource, 'virtualListProps:', 'Tree 必须支持 virtualListProps'],
    [treeSource, 'scrollIntoView(options)', 'Tree 必须公开 scrollIntoView'],
    [treeSource, 'getCheckedNodes(options = {})', 'Tree 必须公开 getCheckedNodes'],
    [treeSource, 'checkAll(checked = true)', 'Tree 必须公开 checkAll'],
    [treeSource, 'selectAll(selected = true)', 'Tree 必须公开 selectAll'],
    [treeSource, 'expandAll(expanded = true)', 'Tree 必须公开 expandAll'],
  ]) {
    assert.ok(source.includes(phrase), `Arco 2.58.0 源码事实漂移：${message}`)
  }

  const familyContracts = {
    Avatar: ['`AAvatar`', '`AAvatarGroup`'],
    Calendar: ['`is-week`', '`mode`', '不会回写', '`panel-change`', '日期面板'],
    Card: ['`ACard`', '`ACardGrid`', '`ACardMeta`'],
    Carousel: ['`ACarousel`', '`ACarouselItem`', '`current`', '从 1 开始'],
    Collapse: ['`ACollapse`', '`ACollapseItem`', '`activeKey`', '数组', '`accordion`', '`key`', '`keydown`', '业务补强'],
    Descriptions: ['`ADescriptions`', '`ADescriptionsItem`'],
    Image: [
      '`AImage`',
      '`AImagePreview`',
      '`AImagePreviewGroup`',
      '`AImagePreviewAction`',
      '`previewVisible`',
      '`visible`',
      '`current`',
      '从 0 开始',
      '`change(index)`',
      '只传一个参数',
      '`disabled` 只影响样式',
      '没有 `lazy-load`',
    ],
    List: ['`AList`', '`AListItem`', '`AListItemMeta`'],
    Statistic: ['`AStatistic`', '`ACountdown`'],
    Table: [
      '`ATable`',
      '`ATableColumn`',
      '`AThead`',
      '`ATbody`',
      '`ATr`',
      '`ATh`',
      '`ATd`',
      '`row-key`',
      '`pagination`',
      '`sortable`',
      '`filterable`',
      '`selectedKeys`',
      '`expandedKeys`',
      '`virtual-list-props`',
      '`height`',
      '`threshold`',
      '`fixedSize`',
      '`estimatedSize`',
      '`buffer`',
      '`sortable.sorter: true`',
      '`sortDirections`',
      '不能把 `filter` 写成 `true`',
      '`filter: () => true`',
      '避免二次本地过滤',
      '不接受数组配置专用的 `render` / `slotName`',
      '`onlyCurrent`',
      '`\'pagination\' | \'sorter\' | \'filter\' | \'drag\'`',
      '`selectAll()`',
      '`expandAll()`',
      '远端',
      '本地',
    ],
    Tag: ['`visible`', '`checked`'],
    Tree: [
      '`ATree`',
      '`selectedKeys`',
      '`checkedKeys`',
      '`halfCheckedKeys`',
      '`expandedKeys`',
      '`virtualListProps`',
      '`loadMore`',
      '`filterTreeNode`',
      '`scrollIntoView()`',
      '`getCheckedNodes()`',
      '`checkAll()`',
      '`selectAll()`',
      '`expandAll()`',
      '`checkStrictly`',
      '`checkedStrategy`',
      '`searchValue`',
      '`defaultExpandAll`',
      '默认 `true`',
      '`onlyCheckLeaf`',
      '不会禁止用户点击父节点',
      '`tree` / `treeitem`',
      '业务补强',
    ],
  }
  for (const [family, phrases] of Object.entries(familyContracts)) {
    const section = readSecondLevelSection(dataDisplay, family)
    for (const phrase of phrases) {
      assert.ok(section.includes(phrase), `${family} 高频契约缺少：${phrase}`)
    }
  }

  const calendarSection = readSecondLevelSection(dataDisplay, 'Calendar')
  assert.doesNotMatch(calendarSection, /`is-weekend`|\bis-weekend\b/u, 'Calendar 章节不得虚构 is-weekend prop')
  const imageSection = readSecondLevelSection(dataDisplay, 'Image')
  assert.doesNotMatch(extractVueFences(imageSection)[0].source, /\blazy-load(?==|\s)/u, 'Image 示例不得使用虚构 lazy-load prop')
  const collapseSection = readSecondLevelSection(dataDisplay, 'Collapse')
  assert.doesNotMatch(collapseSection, /键盘可切换/u, 'Collapse 章节不得暗示 2.58.0 自动支持键盘切换')
})

test('Arco Design Vue Task 7 反馈分册区分组件、静态方法、实例注入与异步关闭语义', () => {
  const feedback = readRequiredFile(arcoDesignVueHandbookPaths.feedback)
  const alertSource = readRequiredFile(arcoDesignVueTask7SourcePaths.alert)
  const drawerSource = readRequiredFile(arcoDesignVueTask7SourcePaths.drawer)
  const drawerComponentSource = readRequiredFile(arcoDesignVueTask7SourcePaths.drawerComponent)
  const messageSource = readRequiredFile(arcoDesignVueIntegrationSourcePaths.message)
  const modalSource = readRequiredFile(arcoDesignVueIntegrationSourcePaths.modal)
  const notificationSource = readRequiredFile(arcoDesignVueIntegrationSourcePaths.notification)
  const notificationTypesSource = readRequiredFile(arcoDesignVueTask7SourcePaths.notificationTypes)
  const popconfirmSource = readRequiredFile(arcoDesignVueTask7SourcePaths.popconfirm)
  const skeletonSource = readRequiredFile(arcoDesignVueTask7SourcePaths.skeleton)
  const spinSource = readRequiredFile(arcoDesignVueTask7SourcePaths.spin)

  const skeletonContract = readInstalledComponentContract(skeletonSource, 'Skeleton')
  assert.equal(skeletonContract.slots.has('default'), true, 'Skeleton loading 时必须使用 default 骨架 slot')
  assert.equal(skeletonContract.slots.has('content'), true, 'Skeleton 完成后必须使用 content slot')
  const spinContract = readInstalledComponentContract(spinSource, 'Spin')
  assert.equal(spinContract.props.has('delay'), false, 'Spin 2.58.0 没有 delay prop')
  assert.equal(spinContract.slots.has('default'), true, 'Spin 必须识别 default 内容区域')

  const asyncGuardPattern = /props\.onBeforeOk\(\(([\w$]+)\s*=\s*true\)\s*=>\s*resolve\(\1\)\)/u
  assert.match(drawerComponentSource, asyncGuardPattern, 'Drawer 必须支持 done callback 关闭语义')
  assert.match(popconfirmSource, asyncGuardPattern, 'Popconfirm 必须支持 done callback 关闭语义')

  for (const [source, phrase, message] of [
    [alertSource, 'emit("afterClose")', 'Alert 必须区分 close 与 afterClose'],
    [drawerSource, 'open: (config, appContext = app._context)', 'Drawer 实例注入必须携带 app context'],
    [drawerComponentSource, 'props.onBeforeCancel()', 'Drawer 必须支持同步取消守卫'],
    [messageSource, 'app.config.globalProperties.$message', 'Message 必须注入 $message'],
    [messageSource, 'appContext = app._context', 'Message 实例注入必须携带 app context'],
    [modalSource, 'app.config.globalProperties.$modal', 'Modal 必须注入 $modal'],
    [notificationSource, 'app.config.globalProperties.$notification', 'Notification 必须注入 $notification'],
    [notificationSource, 'notification.remove = (id)', 'Notification 静态入口必须支持 remove'],
    [notificationTypesSource, 'remove: (id: string) => void;', 'Notification 静态类型必须支持 remove'],
    [popconfirmSource, 'props.onBeforeCancel()', 'Popconfirm 必须支持同步取消守卫'],
  ]) {
    assert.ok(source.includes(phrase), `Arco 2.58.0 源码事实漂移：${message}`)
  }
  assert.match(
    notificationSource,
    /const _notification = \{\s*clear: notification\.clear/u,
    '$notification 当前实例包装只显式暴露 clear 与各级别方法',
  )
  assert.doesNotMatch(feedback, /\bA(?:Message|Notification)\b/u, '反馈分册不得虚构 Message / Notification 模板组件')
  assert.doesNotMatch(feedback, /\$notification\.remove/u, '$notification 当前实例包装没有 remove，必须使用静态 Notification.remove')

  const familyContracts = {
    Alert: ['`AAlert`', '`close`', '`afterClose`'],
    Drawer: ['`ADrawer`', '`Drawer.open()`', '`$drawer`', '`app._context`'],
    Message: ['`Message`', '`$message`', '`app._context`', '`duration`', '`0`', '`onClose`', '`clear()`'],
    Modal: ['`AModal`', '`Modal`', '`$modal`', '`app._context`'],
    Notification: [
      '`Notification`',
      '`$notification`',
      '`app._context`',
      '`Notification.remove(id)`',
      '`duration`',
      '`0`',
      '`onClose`',
      '`clear()`',
    ],
    Popconfirm: ['`APopconfirm`'],
    Skeleton: ['`ASkeleton`', '`loading=true`', '默认 slot', '`#content`', '真实内容'],
    Spin: ['`ASpin`', '`loading`', '没有 `delay`', '局部', '`Message.loading`', '`FaLoading`'],
  }
  for (const [family, phrases] of Object.entries(familyContracts)) {
    const section = readSecondLevelSection(feedback, family)
    for (const phrase of phrases) {
      assert.ok(section.includes(phrase), `${family} 高频契约缺少：${phrase}`)
    }
  }

  for (const family of ['Drawer', 'Modal', 'Popconfirm']) {
    const section = readSecondLevelSection(feedback, family)
    for (const phrase of [
      '`onBeforeOk(done)`',
      '`done(true)`',
      '`done(false)`',
      'Promise',
      '`true`',
      '`false`',
      '`undefined`',
      '`catch`',
      '`return false`',
      '`onBeforeCancel`',
      '同步',
    ]) {
      assert.ok(section.includes(phrase), `${family} 异步确认与关闭语义缺少：${phrase}`)
    }
  }

  assert.doesNotMatch(extractVueFences(readSecondLevelSection(feedback, 'Spin'))[0].source, /:delay=/u, 'Spin 示例不得使用虚构 delay prop')
})

test('Arco Design Vue Task 7 导航分册固定页面标题、内容标签与路由页签三层边界', () => {
  const navigationAndOther = readRequiredFile(arcoDesignVueHandbookPaths.navigationAndOther)
  const faPageHeaderSource = readRequiredFile(arcoDesignVueTask7SourcePaths.faPageHeader)
  const faTabsSource = readRequiredFile(arcoDesignVueTask7SourcePaths.faTabs)
  const pageHeaderSource = readRequiredFile(arcoDesignVueTask7SourcePaths.pageHeader)
  const tabsTypesSource = readRequiredFile(arcoDesignVueTask7SourcePaths.tabsTypes)
  const topbarTabbarSource = readRequiredFile(arcoDesignVueTask7SourcePaths.topbarTabbar)
  const topbarTabbarStoreSource = readRequiredFile(arcoDesignVueTask7SourcePaths.topbarTabbarStore)

  const pageHeaderContract = readInstalledComponentContract(pageHeaderSource, 'PageHeader')
  for (const slotName of ['back-icon', 'breadcrumb', 'default', 'extra', 'subtitle', 'title']) {
    assert.equal(pageHeaderContract.slots.has(slotName), true, `APageHeader 必须公开 ${slotName} slot`)
  }
  assert.equal(pageHeaderContract.slots.has('content'), false, 'APageHeader 2.58.0 没有 content slot')

  for (const [source, phrase, message] of [
    [faPageHeaderSource, 'title?: string', 'FaPageHeader 必须公开 title'],
    [faPageHeaderSource, 'description?: string', 'FaPageHeader 必须公开 description'],
    [faTabsSource, 'modelValue?: TabsRootProps[\'modelValue\']', 'FaTabs 必须公开 modelValue'],
    [faTabsSource, 'list:', 'FaTabs 必须由 list 描述内容标签'],
    [tabsTypesSource, 'editable:', 'ATabs 必须支持 editable'],
    [tabsTypesSource, 'destroyOnHide:', 'ATabs 必须支持 destroyOnHide'],
    [tabsTypesSource, 'lazyLoad:', 'ATabs 必须支持 lazyLoad'],
    [topbarTabbarSource, 'new Sortable(', '路由页签必须保留拖拽排序'],
    [topbarTabbarSource, 'appSettingsStore.settings.tabbar.hotkeys', '路由页签必须保留快捷键'],
    [topbarTabbarSource, 'case \'pin\':', '路由页签必须保留固定操作'],
    [topbarTabbarStoreSource, 'localStorage.setItem(\'tabbarPinData\'', '路由页签状态必须持久化'],
    [topbarTabbarStoreSource, 'appKeepAliveStore', '路由页签必须联动 keepAlive'],
    [topbarTabbarStoreSource, 'appIframeStore', '路由页签必须联动 iframe'],
  ]) {
    assert.ok(source.includes(phrase), `项目或 Arco 真相源漂移：${message}`)
  }

  const pageHeaderSection = readSecondLevelSection(navigationAndOther, 'PageHeader')
  for (const phrase of [
    '`FaPageHeader`',
    '`title`',
    '`description`',
    '`#default`',
    '`APageHeader`',
    '`subtitle`',
    '`show-back`',
    '不负责路由',
    '`web/packages/components/src/basic/page-header/index.vue`',
    '正文使用 `#default`',
    '没有 `#content`',
  ]) {
    assert.ok(pageHeaderSection.includes(phrase), `PageHeader 三层边界缺少：${phrase}`)
  }
  assert.doesNotMatch(pageHeaderSection, /(?:提供|支持)\s*`#content`/u, 'PageHeader 章节不得虚构 content slot')

  const tabsSection = readSecondLevelSection(navigationAndOther, 'Tabs')
  for (const phrase of [
    '`FaTabs`',
    '`modelValue`',
    '`list`',
    '`ATabs`',
    '`activeKey`',
    '`editable`',
    '`add`',
    '`delete`',
    '`destroyOnHide`',
    '`lazyLoad`',
    '路由页签',
    '`routeName`',
    '`tabId`',
    '`Sortable`',
    '快捷键',
    '固定',
    '`keepAlive`',
    '`iframe`',
    '持久化',
    '不能用可编辑 `ATabs` 替换',
    '`web/packages/components/src/basic/tabs/index.vue`',
    '`web/apps/qsmds-arco/src/layouts/components/Topbar/Tabbar/index.vue`',
  ]) {
    assert.ok(tabsSection.includes(phrase), `Tabs 三层边界缺少：${phrase}`)
  }
})

test('Arco Design Vue Task 7 其他组件分册固定 Icon 类型缺口与底层工具契约', () => {
  const navigationAndOther = readRequiredFile(arcoDesignVueHandbookPaths.navigationAndOther)
  const anchorSource = readRequiredFile(arcoDesignVueTask7SourcePaths.anchor)
  const arcoVueSource = readRequiredFile(arcoDesignVueTask7SourcePaths.arcoVue)
  const componentTypesSource = readRequiredFile(arcoDesignVueIntegrationSourcePaths.componentTypes)
  const configProviderSource = readRequiredFile(arcoDesignVueTask7SourcePaths.configProvider)
  const emptySource = readRequiredFile(arcoDesignVueTask7SourcePaths.empty)
  const iconSource = readRequiredFile(arcoDesignVueTask7SourcePaths.icon)
  const providerPluginSource = readRequiredFile(arcoDesignVueIntegrationSourcePaths.providerPlugin)
  const overflowListSource = readRequiredFile(arcoDesignVueTask7SourcePaths.overflowList)
  const resizeBoxTypesSource = readRequiredFile(arcoDesignVueTask7SourcePaths.resizeBoxTypes)
  const scrollbarSource = readRequiredFile(arcoDesignVueTask7SourcePaths.scrollbar)
  const scrollbarTypesSource = readRequiredFile(arcoDesignVueTask7SourcePaths.scrollbarTypes)
  const splitTypesSource = readRequiredFile(arcoDesignVueTask7SourcePaths.splitTypes)
  const triggerSource = readRequiredFile(arcoDesignVueTask7SourcePaths.trigger)

  const configProviderContract = readInstalledComponentContract(configProviderSource, 'ConfigProvider')
  for (const unsupportedProp of ['componentConfig', 'empty']) {
    assert.equal(configProviderContract.props.has(unsupportedProp), false, `AConfigProvider 2.58.0 没有 ${unsupportedProp} prop`)
  }
  assert.match(emptySource, /configCtx\?\.slots\.empty|configCtx == null[\s\S]{0,100}configCtx\.slots\.empty/u, 'ConfigProvider empty 是由 AEmpty 消费的 slot')

  const anchorContract = readInstalledComponentContract(anchorSource, 'Anchor')
  assert.equal(anchorContract.props.has('smooth'), true, 'Anchor 必须声明 smooth prop')
  assert.equal(countTextOccurrences(anchorSource, 'smooth'), 1, 'Anchor 2.58.0 运行时不得读取 smooth prop')

  const runtimeInventory = readArcoRuntimeInventory(arcoVueSource)
  assert.equal(runtimeInventory.get('Icon'), 'icon-component', 'ArcoVue 必须从 icon-component 安装 Icon')
  assert.match(arcoVueSource, /const ArcoVue\s*=\s*\{\s*\.\.\.components/u, 'ArcoVue 默认导出必须继承主 components 注册对象')
  assert.doesNotMatch(providerPluginSource, /ArcoVueIcon/u, '正式应用 Provider 不得虚构独立 ArcoVueIcon plugin')

  assert.doesNotMatch(componentTypesSource, /\bA(?:Icon|OverflowList|Scrollbar)\b/u, '全局模板类型没有声明三类底层组件')
  for (const runtimeName of ['Scrollbar', 'Icon', 'OverflowList']) {
    assert.ok(arcoVueSource.includes(runtimeName), `ArcoVue 运行时整包注册缺少：${runtimeName}`)
  }
  for (const phrase of ['svg', 'type', 'class']) {
    assert.ok(iconSource.includes(phrase), `IconComponent 源码事实缺少：${phrase}`)
  }
  for (const [source, phrase, message] of [
    [overflowListSource, 'change: (value) => true', 'OverflowList change 参数必须是隐藏数量'],
    [overflowListSource, 'number: overflowNumber.value', 'OverflowList overflow slot 必须暴露 number'],
    [resizeBoxTypesSource, 'movingStart: (ev: MouseEvent) => true;', 'ResizeBox 必须公开 movingStart'],
    [resizeBoxTypesSource, 'movingEnd: (ev: MouseEvent) => true;', 'ResizeBox 必须公开 movingEnd'],
    [splitTypesSource, 'moveStart: (ev: MouseEvent) => true;', 'Split 必须公开 moveStart'],
    [splitTypesSource, 'moveEnd: (ev: MouseEvent) => true;', 'Split 必须公开 moveEnd'],
    [scrollbarTypesSource, 'scrollTo(options?: number | {', 'Scrollbar 必须公开 scrollTo'],
    [scrollbarTypesSource, 'scrollTop(top: number): void;', 'Scrollbar 必须公开 scrollTop'],
    [scrollbarSource, '} else if (options || y) {', 'Scrollbar 数值式双零存在 truthy 边界'],
    [triggerSource, '"update:popupVisible"', 'Trigger 必须支持受控 popupVisible'],
    [triggerSource, '"popupVisibleChange"', 'Trigger 必须公开 popupVisibleChange'],
  ]) {
    assert.ok(source.includes(phrase), `Arco 2.58.0 源码事实漂移：${message}`)
  }

  const iconSection = readSecondLevelSection(navigationAndOther, 'Icon')
  for (const phrase of [
    '`Icon`',
    '`IconSearch`',
    '`@arco-design/web-vue/es/icon`',
    '`addFromIconFontCn()`',
    '`AIcon`',
    'SVG 容器',
    '`type` 只作为 class',
    '不会按名称生成图标',
    '全局模板类型',
    '`ArcoVueIcon`',
    '未安装',
    '可信',
    'CSP',
  ]) {
    assert.ok(iconSection.includes(phrase), `Icon 接入边界缺少：${phrase}`)
  }

  const familyContracts = {
    Anchor: ['`smooth`', '2.58.0', '未读取'],
    ConfigProvider: ['`#empty`', '不是 prop', '没有 `component-config`'],
    Menu: ['`selectedKeys`', '`openKeys`', '`collapsed`', '`update:collapsed`'],
    Pagination: ['`current`', '`pageSize`'],
    Steps: ['`current`'],
    Tabs: ['`activeKey`'],
    OverflowList: ['`change(number)`', '`#overflow`'],
    ResizeBox: ['`width`', '`height`', '`movingStart(event)`', '`moving(size, event)`', '`movingEnd(event)`'],
    Scrollbar: ['`scrollTo()`', '`scrollTop()`', '`scrollTo({ top: 0, left: 0 })`', '`scrollTo(0, 0)`'],
    Split: ['`size`', '`0.5`', '50%', '50px', '`moveStart(event)`', '`moving(event)`', '`moveEnd(event)`'],
    Trigger: [
      '`popupVisible`',
      '`update:popupVisible`',
      '`popupVisibleChange`',
      '`click`',
      '`hover`',
      '`focus`',
      '`contextMenu`',
      '`show`',
      '`hide`',
      '`scrollToClose`',
      '默认 slot 的第一个元素',
      '单一 wrapper',
      '动画完成',
    ],
  }
  for (const [family, phrases] of Object.entries(familyContracts)) {
    const section = readSecondLevelSection(navigationAndOther, family)
    for (const phrase of phrases) {
      assert.ok(section.includes(phrase), `${family} 高频契约缺少：${phrase}`)
    }
  }

  const configProviderSection = readSecondLevelSection(navigationAndOther, 'ConfigProvider')
  assert.doesNotMatch(extractVueFences(configProviderSection)[0].source, /component-config=/u, 'ConfigProvider 示例不得使用虚构 component-config prop')
})

test('Arco Design Vue 接入基础分册锁定正式应用的真实安装、语言与主题链路', () => {
  const integration = readRequiredFile(arcoDesignVueHandbookPaths.integration)
  const componentTypesSource = readRequiredFile(arcoDesignVueIntegrationSourcePaths.componentTypes)
  const mainSource = readRequiredFile(arcoDesignVueIntegrationSourcePaths.main)
  const messageSource = readRequiredFile(arcoDesignVueIntegrationSourcePaths.message)
  const modalSource = readRequiredFile(arcoDesignVueIntegrationSourcePaths.modal)
  const notificationSource = readRequiredFile(arcoDesignVueIntegrationSourcePaths.notification)
  const pluginSource = readRequiredFile(arcoDesignVueIntegrationSourcePaths.providerPlugin)
  const providerSource = readRequiredFile(arcoDesignVueIntegrationSourcePaths.providerComponent)
  const vitePluginsSource = readRequiredFile(arcoDesignVueIntegrationSourcePaths.vitePlugins)
  const installSection = readSecondLevelSection(integration, '当前安装与启动链路')
  const providerSection = readSecondLevelSection(integration, '全局配置、语言与主题')
  const feedbackSection = readSecondLevelSection(integration, '命令式反馈 API')
  const engineeringSection = readSecondLevelSection(integration, '工程边界、验证与升级')

  for (const requiredSourcePhrase of [
    'import ArcoVue from \'@arco-design/web-vue\'',
    'import \'@arco-design/web-vue/dist/arco.css\'',
    'import en from \'@arco-design/web-vue/es/locale/lang/en-us\'',
    'import zhCN from \'@arco-design/web-vue/es/locale/lang/zh-cn\'',
    'import zhTW from \'@arco-design/web-vue/es/locale/lang/zh-tw\'',
    'app.use(ArcoVue)',
  ]) {
    assert.ok(pluginSource.includes(requiredSourcePhrase), `正式应用 Arco plugin 源码事实漂移：${requiredSourcePhrase}`)
  }
  assert.ok(mainSource.includes('app.use(uiProvider)'), '正式应用入口必须继续安装 uiProvider')
  for (const requiredSourcePhrase of [
    '<AConfigProvider :locale="locales[appSettingsStore.lang]">',
    'window.matchMedia(\'(prefers-color-scheme: dark)\')',
    'document.body.setAttribute(\'arco-theme\', \'dark\')',
  ]) {
    assert.ok(providerSource.includes(requiredSourcePhrase), `正式应用 Provider 源码事实漂移：${requiredSourcePhrase}`)
  }
  assert.ok(
    vitePluginsSource.includes('FantasticAdminComponentsResolver()'),
    '正式应用 Vite components resolver 必须继续记录 Fantastic-admin 当前事实',
  )
  assert.doesNotMatch(
    vitePluginsSource,
    /\bArcoResolver\b/u,
    '正式应用 Vite 源码当前未配置 ArcoResolver；接入模式变化后必须重新核对手册',
  )
  for (const globalProperty of ['$message', '$notification', '$modal']) {
    assert.ok(componentTypesSource.includes(globalProperty), `Arco 2.58.0 全局实例类型缺少：${globalProperty}`)
  }
  assert.ok(componentTypesSource.includes('AModal'), 'Arco 2.58.0 必须公开模板组件 AModal')
  assert.doesNotMatch(
    componentTypesSource,
    /\bA(?:Message|Notification)\b/u,
    'Arco 2.58.0 不得被误读为公开 Message / Notification 模板组件',
  )
  assert.ok(messageSource.includes('app.config.globalProperties.$message'), 'Message install 必须注入 $message')
  assert.ok(notificationSource.includes('app.config.globalProperties.$notification'), 'Notification install 必须注入 $notification')
  assert.ok(
    modalSource.includes('app.component(componentPrefix + _Modal.name, _Modal)')
    && modalSource.includes('app.config.globalProperties.$modal'),
    'Modal install 必须同时注册模板组件并注入 $modal',
  )

  for (const requiredPhrase of [
    'import ArcoVue from \'@arco-design/web-vue\'',
    'import \'@arco-design/web-vue/dist/arco.css\'',
    'app.use(ArcoVue)',
    'app.use(uiProvider)',
    '全局注册',
    '整包 CSS',
    'FantasticAdminComponentsResolver()',
    '未配置 `ArcoResolver`',
    '不是 Arco 按需自动导入',
    '显式 `import type`',
  ]) {
    assert.ok(installSection.includes(requiredPhrase), `Arco 当前安装链路说明缺少：${requiredPhrase}`)
  }
  for (const requiredPhrase of [
    '`zh-cn`',
    '`zh-tw`',
    '`en`',
    'locales[appSettingsStore.lang]',
    'AConfigProvider',
    'document.body.setAttribute(\'arco-theme\', \'dark\')',
    'window.matchMedia(\'(prefers-color-scheme: dark)\')',
    'system',
    '当前实际启用',
  ]) {
    assert.ok(providerSection.includes(requiredPhrase), `Arco 全局 Provider 说明缺少：${requiredPhrase}`)
  }
  for (const requiredPhrase of [
    'from \'@arco-design/web-vue\'',
    '`Message`',
    '`Notification`',
    '`Modal`',
    '静态方法',
    'ConfigProvider',
    '项目封装',
  ]) {
    assert.ok(feedbackSection.includes(requiredPhrase), `Arco 命令式反馈边界说明缺少：${requiredPhrase}`)
  }
  for (const requiredPhrase of [
    '`$message`',
    '`$notification`',
    '`$modal`',
    '`AModal`',
    '`app._context`',
    '直接 import',
    '最近的 `AConfigProvider`',
  ]) {
    assert.ok(feedbackSection.includes(requiredPhrase), `Arco 命令式反馈接入语义缺少：${requiredPhrase}`)
  }
  assert.doesNotMatch(
    `${integration}\n${readRequiredFile(arcoDesignVueHandbookPaths.index)}`,
    /\bA(?:Message|Notification)\b/u,
    'Arco 手册不得虚构 Message / Notification 模板组件',
  )
  for (const requiredPhrase of [
    '`window`',
    '`document`',
    'SSR',
    '样式顺序',
    '主题变量',
    'TypeScript',
    '测试',
    '升级',
    '`pnpm-lock.yaml`',
  ]) {
    assert.ok(engineeringSection.includes(requiredPhrase), `Arco 工程边界说明缺少：${requiredPhrase}`)
  }
})

test('Arco Design Vue Task 6 组件分册固定关键 2.58.0 契约与安全边界', () => {
  const commonAndLayout = readRequiredFile(arcoDesignVueHandbookPaths.commonAndLayout)
  const dataEntry = readRequiredFile(arcoDesignVueHandbookPaths.dataEntry)
  const qsmdsArcoManifest = JSON.parse(readRequiredFile(qsmdsArcoManifestPath))
  const timePickerTypesSource = readRequiredFile(arcoDesignVueTask6SourcePaths.timePickerTypes)
  const uploadTypesSource = readRequiredFile(arcoDesignVueTask6SourcePaths.uploadTypes)
  const task6RegressionErrors = []

  assert.ok(
    Object.hasOwn(qsmdsArcoManifest.dependencies ?? {}, 'vue'),
    '正式应用必须直接声明 vue，Task 6 语法编译不得依赖 root hoist 或传递依赖布局',
  )
  assert.ok(
    timePickerTypesSource.includes('\'update:modelValue\': (timeString: string | Array<string | undefined> | undefined) => true;'),
    'TimePicker 2.58.0 类型真相源必须保留完整 update:modelValue union',
  )
  for (const methodSignature of [
    'submit(fileItem?: FileItem | undefined): void;',
    'abort(fileItem: FileItem): void;',
    'updateFile(id: string, file: File): void;',
    'upload(files: File[]): void;',
  ]) {
    assert.ok(uploadTypesSource.includes(methodSignature), `Upload 2.58.0 类型真相源缺少：${methodSignature}`)
  }

  const familyContracts = {
    Button: ['`AButton`', '`AButtonGroup`', '`html-type`'],
    Typography: ['`ATypographyTitle`', '`ATypographyParagraph`', '`ATypographyText`'],
    Grid: ['`ARow`', '`ACol`', '`xs`', '`xxl`'],
    Layout: ['`ALayoutHeader`', '`ALayoutSider`', '`ALayoutContent`', '`ALayoutFooter`'],
    Cascader: ['`v-model`', '`multiple`', '`path-mode`'],
    Checkbox: ['`ACheckboxGroup`'],
    ColorPicker: ['`AColorPicker`', '`show-text`'],
    DatePicker: ['`ADatePicker`', '`ARangePicker`', '`AWeekPicker`', '`AMonthPicker`', '`AQuarterPicker`', '`AYearPicker`', '`value-format`'],
    Form: ['`AForm`', '`AFormItem`', '`model`', '`field`', '`rules`', '`validate()`', '`FaForm`', 'Fantastic-admin 无法满足表单契约时才使用 Arco'],
    Input: ['`AInput`', '`AInputSearch`', '`AInputPassword`'],
    Mention: ['`AMention`'],
    Radio: ['`ARadioGroup`'],
    Select: ['`AOption`', '`AOptgroup`'],
    Textarea: ['`ATextarea`'],
    TimePicker: ['`ATimePicker`', '`type="time-range"`', '没有 `value-format`', '`string[]`'],
    Transfer: ['`v-model`', '`data`'],
    TreeSelect: ['`v-model`', '`data`'],
    Upload: ['`custom-request`', '`UploadRequest`', '`abort`', '项目 HTTP client', '服务端验证', '不得硬编码 token'],
    VerificationCode: ['`AVerificationCode`'],
  }

  for (const [family, requiredPhrases] of Object.entries(familyContracts)) {
    const source = arcoTask6Coverage.find(([candidate]) => candidate === family)?.[2] === 'commonAndLayout'
      ? commonAndLayout
      : dataEntry
    const section = readSecondLevelSection(source, family)
    for (const requiredPhrase of requiredPhrases) {
      assert.ok(section.includes(requiredPhrase), `${family} 章节缺少 2.58.0 关键契约：${requiredPhrase}`)
    }
  }

  for (const family of ['Cascader', 'Select', 'Transfer', 'TreeSelect']) {
    assert.ok(
      readSecondLevelSection(dataEntry, family).match(/虚拟列表|大数据/u),
      `${family} 必须说明大数据或虚拟列表边界`,
    )
  }
  for (const requiredPhrase of ['键盘', '焦点', 'label', '错误', '窄屏', '敏感输入']) {
    assert.ok(dataEntry.includes(requiredPhrase), `数据录入组件分册缺少跨组件质量边界：${requiredPhrase}`)
  }

  const autoCompleteSection = readSecondLevelSection(dataEntry, 'AutoComplete')
  const autoCompleteExample = extractVueFences(autoCompleteSection)[0]?.source ?? ''
  const autoCompleteOpeningTag = autoCompleteExample.match(/<AAutoComplete\b[^>]*>/u)?.[0]
  if (!autoCompleteExample.includes('<label for="region-keyword">')) {
    task6RegressionErrors.push('AutoComplete 示例必须提供关联 region-keyword 的可见 label')
  }
  if (!autoCompleteOpeningTag) {
    task6RegressionErrors.push('AutoComplete 示例必须包含 AAutoComplete opening tag')
  }
  else {
    if (!/:input-attrs="\{\s*id:\s*'region-keyword'\s*\}"/u.test(autoCompleteOpeningTag)) {
      task6RegressionErrors.push('AutoComplete 示例必须通过 input-attrs 把 region-keyword id 传给原生 input')
    }
    if (/\sid=(?:"|')/u.test(autoCompleteOpeningTag)) {
      task6RegressionErrors.push('AutoComplete 示例不得把 id 直接传给 wrapper')
    }
  }
  if (!autoCompleteSection.includes('wrapper') || !autoCompleteSection.includes('`input-attrs`')) {
    task6RegressionErrors.push('AutoComplete 章节必须说明 wrapper 与原生 input 属性边界')
  }

  const inputSection = readSecondLevelSection(dataEntry, 'Input')
  const inputExample = extractVueFences(inputSection)[0]?.source ?? ''
  const keywordInputOpeningTag = inputExample.match(/<AInput\b[^>]*>/u)?.[0]
  const passwordInputOpeningTag = inputExample.match(/<AInputPassword\b[^>]*>/u)?.[0]
  for (const requiredPhrase of ['普通 `span`', '没有 `tabindex`', '键盘事件', '键盘可访问性是硬要求']) {
    assert.ok(inputSection.includes(requiredPhrase), `Input 内置控制可访问性限制缺少：${requiredPhrase}`)
  }
  if (!keywordInputOpeningTag) {
    task6RegressionErrors.push('Input 示例必须包含 AInput opening tag')
  }
  else {
    if (!/:input-attrs="\{\s*id:\s*'search-keyword'\s*\}"/u.test(keywordInputOpeningTag)) {
      task6RegressionErrors.push('AInput 示例必须通过 input-attrs 把 search-keyword id 传给原生 input')
    }
    if (/\sid=(?:"|')/u.test(keywordInputOpeningTag)) {
      task6RegressionErrors.push('AInput 示例不得把 id 直接传给 wrapper')
    }
  }
  if (!passwordInputOpeningTag) {
    task6RegressionErrors.push('Input 示例必须包含 AInputPassword opening tag')
  }
  else {
    if (!/:input-attrs="\{\s*id:\s*'account-password'\s*\}"/u.test(passwordInputOpeningTag)) {
      task6RegressionErrors.push('AInputPassword 示例必须通过 input-attrs 把 account-password id 传给原生 input')
    }
    if (/\sid=(?:"|')/u.test(passwordInputOpeningTag)) {
      task6RegressionErrors.push('AInputPassword 示例不得把 id 直接传给 wrapper')
    }
  }
  assert.match(inputExample, /:allow-clear="false"/u, 'Input 示例必须关闭内置 clear 控件')
  assert.match(inputExample, /:invisible-button="false"/u, 'Input 示例必须关闭内置 password visibility 控件')
  assert.ok((inputExample.match(/<button\b[^>]*>/gu) ?? []).length >= 2, 'Input 示例必须为清空与显隐分别提供原生 button')
  for (const buttonTag of inputExample.match(/<button\b[^>]*>/gu) ?? []) {
    assert.match(buttonTag, /\btype="button"/u, 'Input suffix 原生按钮必须显式使用 type="button"')
    assert.match(buttonTag, /\baria-label=/u, 'Input suffix 原生按钮必须提供可访问名称')
  }

  const timePickerSection = readSecondLevelSection(dataEntry, 'TimePicker')
  const timePickerExample = extractVueFences(timePickerSection)[0]?.source ?? ''
  const timePickerOpeningTag = timePickerExample.match(/<ATimePicker\b[^>]*>/u)?.[0]
  const timePickerOutputType = timePickerExample.match(
    /type ([A-Za-z_$][\w$]*) = string \| Array<string \| undefined> \| undefined/u,
  )?.[1]
  const timePickerUpdateHandler = timePickerOpeningTag?.match(
    /@update:model-value="([A-Za-z_$][\w$]*)"/u,
  )?.[1]
  for (const requiredPhrase of ['clear', '`undefined`', 'Array<string | undefined>', '半范围']) {
    if (!timePickerSection.includes(requiredPhrase)) {
      task6RegressionErrors.push(`TimePicker 输出空值与半范围边界缺少：${requiredPhrase}`)
    }
  }
  for (const [pattern, message] of [
    [/ref<string\[\]>\(\[\]\)/u, 'TimePicker 示例必须保持归一化后的 string[] 业务状态'],
    [/\):\s*[A-Za-z_$][\w$]* is \[string, string\]/u, 'TimePicker 示例必须用类型守卫识别完整两项范围'],
    [/[A-Za-z_$][\w$]*\.length === 2/u, 'TimePicker 完整范围类型守卫必须校验两项长度'],
    [/typeof [A-Za-z_$][\w$]* === 'string'/u, 'TimePicker 完整范围类型守卫必须排除 undefined 元素'],
    [/serviceWindow\.value\s*=/u, 'TimePicker update handler 必须显式更新归一化后的业务状态'],
    [/\?\s*\[\.\.\.[A-Za-z_$][\w$]*\]/u, 'TimePicker update handler 必须复制完整两项范围'],
    [/:\s*\[\]/u, 'TimePicker update handler 必须把 clear 或半范围归一化为空数组'],
  ]) {
    if (!pattern.test(timePickerExample)) {
      task6RegressionErrors.push(message)
    }
  }
  if (!timePickerOutputType) {
    task6RegressionErrors.push('TimePicker 示例必须精确声明真实更新值 union')
  }
  if (!timePickerOpeningTag) {
    task6RegressionErrors.push('TimePicker 示例必须包含 ATimePicker opening tag')
  }
  else {
    if (!/:model-value="serviceWindow"/u.test(timePickerOpeningTag)) {
      task6RegressionErrors.push('TimePicker 示例必须使用受控 model-value 输入')
    }
    if (!timePickerUpdateHandler) {
      task6RegressionErrors.push('TimePicker 示例必须用 handler 接收真实 update union')
    }
    if (/\bv-model=/u.test(timePickerOpeningTag)) {
      task6RegressionErrors.push('TimePicker 范围示例不得把窄化 string[] 直接用于 v-model')
    }
  }
  if (timePickerOutputType && timePickerUpdateHandler) {
    const handlerSignature = new RegExp(
      `function\\s+${timePickerUpdateHandler}\\s*\\([^:]+:\\s*${timePickerOutputType}\\s*\\)`,
      'u',
    )
    if (!handlerSignature.test(timePickerExample)) {
      task6RegressionErrors.push('TimePicker 显式 update handler 参数必须覆盖真实输出 union')
    }
  }

  const transferSection = readSecondLevelSection(dataEntry, 'Transfer')
  const transferExample = extractVueFences(transferSection)[0]?.source ?? ''
  assert.match(
    transferExample,
    /import type \{ TransferItem \} from '@arco-design\/web-vue\/es\/transfer\/interface'/u,
    'Transfer 示例必须从真实 2.58.0 子路径导入 TransferItem',
  )
  assert.match(transferExample, /const items = \[[\s\S]*?\]\s+satisfies TransferItem\[\]/u, 'Transfer 示例数据必须用 satisfies 锁定类型')
  assert.equal(transferExample.match(/disabled: false/gu)?.length, 2, 'Transfer 示例每个静态条目都必须显式提供 disabled')
  for (const requiredPhrase of ['`tabindex="-1"`', '不包含数量', '没有覆盖 API', '业务双列表或分步选择器', '原生 `<button type="button">`']) {
    assert.ok(transferSection.includes(requiredPhrase), `Transfer 内置移动按钮限制缺少：${requiredPhrase}`)
  }

  const uploadSection = readSecondLevelSection(dataEntry, 'Upload')
  const uploadExample = extractVueFences(uploadSection)[0]?.source ?? ''
  const uploadOpeningTag = uploadExample.match(/<AUpload\b[^>]*>/u)?.[0]
  assert.ok(uploadOpeningTag, 'Upload 示例必须包含 AUpload opening tag')
  assert.match(uploadOpeningTag, /:custom-request="props\.customRequest"/u, 'Upload 示例必须真实绑定父级传入的 customRequest')
  assert.doesNotMatch(uploadOpeningTag, /:auto-upload="false"/u, 'Upload 示例采用默认自动上传时不得关闭 auto-upload')
  for (const requiredPhrase of ['父级', '已配置', '默认自动上传']) {
    assert.ok(uploadSection.includes(requiredPhrase), `Upload 可执行接线说明缺少：${requiredPhrase}`)
  }
  for (const methodSignature of [
    '`submit(fileItem?)`',
    '`abort(fileItem)`',
    '`updateFile(id, file)`',
    '`upload(files)`',
  ]) {
    if (!uploadSection.includes(methodSignature)) {
      task6RegressionErrors.push(`Upload 公开方法契约缺少：${methodSignature}`)
    }
  }
  if (!uploadSection.includes('后三者参数必需')) {
    task6RegressionErrors.push('Upload 必须明确 abort / updateFile / upload 的参数必需')
  }
  for (const zeroArgumentMethod of ['abort', 'updateFile', 'upload']) {
    if (uploadSection.includes(`\`${zeroArgumentMethod}()\``)) {
      task6RegressionErrors.push(`Upload 正文不得继续记录零参 ${zeroArgumentMethod}()`)
    }
  }

  for (const [documentName, content] of [
    ['通用与布局组件.md', commonAndLayout],
    ['数据录入组件.md', dataEntry],
  ]) {
    task6RegressionErrors.push(...collectVueFenceSyntaxErrors(content, documentName))
    task6RegressionErrors.push(...findArcoDocPolicyViolations(content).map(violation => `${documentName}：${violation}`))
  }
  assert.equal(
    task6RegressionErrors.length,
    0,
    `Task 6 示例语义或解析边界错误：\n${task6RegressionErrors.join('\n')}`,
  )
})

test('Task 6 Vue fence 语法编译拒绝 parse-only 无法发现的非法 TypeScript', () => {
  const invalidSfcDocument = [
    '```vue',
    '<script setup lang="ts">',
    'const invalidValue: = 1',
    '</script>',
    '',
    '<template><div>fixture</div></template>',
    '```',
  ].join('\n')
  const [invalidFence] = extractVueFences(invalidSfcDocument)
  assert.ok(invalidFence, 'synthetic fixture 必须包含真实 vue fence')
  assert.deepEqual(
    parseVueSfc(invalidFence.source, { filename: 'synthetic-invalid.vue' }).errors,
    [],
    'synthetic fixture 必须先证明 parse-only 会对非法 TypeScript 假绿',
  )
  assert.throws(
    () => assertVueFencesSyntaxCompile(invalidSfcDocument, 'synthetic-invalid.md'),
    /synthetic-invalid\.md.*第 1 行.*第 1 个 vue fence.*语法/u,
    '完整语法编译必须拒绝 parse-only 无法发现的非法 TypeScript，并报告 fence opening line',
  )
})

test('Task 6 Vue fence 诊断保留 EOF 未闭合 fence 的 opening line 与 info string', () => {
  const unclosedSfcDocument = [
    '# synthetic fixture',
    '',
    '```vue',
    '<template><div>fixture</div></template>',
  ].join('\n')
  assert.deepEqual(
    collectVueFenceSyntaxErrors(unclosedSfcDocument, 'synthetic-unclosed.md'),
    ['synthetic-unclosed.md 第 3 行 fence 未闭合（info string: vue）'],
  )
})

test('Task 6 文档策略扫描区分普通 TODO 说明并覆盖常见占位与敏感值', () => {
  const duplicatedViolations = findArcoDocPolicyViolations([
    'TODO: 相同占位',
    '普通说明',
    'TODO: 相同占位',
  ].join('\n'))
  const scanResult = {
    bearer: findArcoDocPolicyViolations('Authorization: Bearer real-looking-token').some(item => item.includes('Bearer')),
    bracePlaceholder: findArcoDocPolicyViolations('接口地址：{{UPLOAD_ENDPOINT}}').some(item => item.includes('{{UPLOAD_ENDPOINT}}')),
    cookieColon: findArcoDocPolicyViolations('COOKIE: "real-session-id"').some(item => item.includes('敏感值')),
    cookieEquals: findArcoDocPolicyViolations('cookie = \'real-session-id\'').some(item => item.includes('敏感值')),
    cookieHeaderUnquoted: findArcoDocPolicyViolations('Cookie: session=real-session-id')
      .some(item => item.includes('Cookie header')),
    cookieUnquoted: findArcoDocPolicyViolations('cookie = real-session-id')
      .some(item => item.includes('未加引号的 Cookie 值')),
    contractEndpoint: findArcoDocPolicyViolations('const endpoint = `/api/auth/me`'),
    duplicatedLines: duplicatedViolations
      .filter(item => item.includes('TODO: 相同占位'))
      .map(item => item.match(/第 (\d+) 行/u)?.[1]),
    endpoint: findArcoDocPolicyViolations('const endpoint = `/api/files`').some(item => item.includes('/api/files')),
    fullUrlEndpoint: findArcoDocPolicyViolations('const endpoint = `https://example.com/api/imaginary-users`')
      .some(item => item.includes('第 1 行') && item.includes('https://example.com/api/imaginary-users')),
    indentedPlaceholderLine: findArcoDocPolicyViolations('  TODO: 补充真实接口')
      .some(item => item.includes('第 1 行') && item.includes('TODO')),
    placeholderLine: findArcoDocPolicyViolations('TODO: 补充真实接口').some(item => item.includes('TODO')),
    placeholderTag: findArcoDocPolicyViolations('<PLACEHOLDER>').some(item => item.includes('<PLACEHOLDER>')),
    safeEmptyPassword: findArcoDocPolicyViolations('const password = \'\''),
    safeTokenPlaceholder: findArcoDocPolicyViolations('const token = "<TOKEN>"'),
    safeTodo: findArcoDocPolicyViolations('TODO 规则用于解释扫描边界'),
    setCookieHeaderUnquoted: findArcoDocPolicyViolations('Set-Cookie: session=real-session-id')
      .some(item => item.includes('Cookie header')),
    sensitiveValue: findArcoDocPolicyViolations('const password = "real-secret-123"').some(item => item.includes('敏感值')),
    vueInterpolation: findArcoDocPolicyViolations([
      '```vue',
      '<template>{{ passwordMasked ? \'显示\' : \'隐藏\' }}</template>',
      '```',
    ].join('\n')),
  }
  assert.deepEqual(scanResult, {
    bearer: true,
    bracePlaceholder: true,
    cookieColon: true,
    cookieEquals: true,
    cookieHeaderUnquoted: true,
    cookieUnquoted: true,
    contractEndpoint: [],
    duplicatedLines: ['1', '3'],
    endpoint: true,
    fullUrlEndpoint: true,
    indentedPlaceholderLine: true,
    placeholderLine: true,
    placeholderTag: true,
    safeEmptyPassword: [],
    safeTokenPlaceholder: [],
    safeTodo: [],
    setCookieHeaderUnquoted: true,
    sensitiveValue: true,
    vueInterpolation: [],
  })
})
