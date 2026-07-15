/* eslint-disable test/no-import-node-test */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const handbookPath = fileURLToPath(new URL('../../docs/前端文档/前端开发手册/README.md', import.meta.url))
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
const documentIndexPath = fileURLToPath(new URL('../../docs/文档索引.md', import.meta.url))
const webManifestPath = fileURLToPath(new URL('../package.json', import.meta.url))
const webLockfilePath = fileURLToPath(new URL('../pnpm-lock.yaml', import.meta.url))
const fantasticAdminComponentsIndexPath = fileURLToPath(new URL('../packages/components/src/index.ts', import.meta.url))
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

/**
 * 入口文档是正式开发依据，缺失时必须直接失败，不能用空内容继续断言。
 * 明确报告绝对路径可以让本地开发与 CI 都快速定位文档搬移或漏提交问题。
 */
function readRequiredFile(filePath) {
  assert.equal(existsSync(filePath), true, `缺少前端手册治理所需文件：${filePath}`)
  return readFileSync(filePath, 'utf8')
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
    ['标准业务交互：表单、数据录入、数据展示、反馈、企业后台交互', 'Arco Design Vue'],
    ['领域组件', '`web/apps/qsmds-arco/src/components/`'],
  ]) {
    const row = findTableRow(responsibilityMatrix, responsibility)
    const context = `组件职责矩阵：${responsibility}`

    assert.ok(row, `${context} 行不存在`)
    assert.equal(row.length, 4, `${context} 必须保持四个表格单元格`)
    assert.equal(row[1], expectedTarget, `${context} 默认落点错误：期望 ${expectedTarget}，实际 ${row[1]}`)
  }

  const overlapMatrix = readSecondLevelSection(content, '4. 与 Arco 重叠能力的选择')
  const overlapRows = Object.fromEntries(
    ['表单与表单项', '表格与描述', '反馈'].map((capability) => {
      const row = findTableRow(overlapMatrix, capability)
      const context = `重叠能力选择矩阵：${capability}`

      assert.ok(row, `${context} 行不存在`)
      assert.equal(row.length, 4, `${context} 必须保持四个表格单元格`)
      return [capability, row]
    }),
  )

  for (const requiredPhrase of ['`FaForm`', '`FaFormItem`']) {
    assert.ok(
      overlapRows['表单与表单项'][1].includes(requiredPhrase),
      `重叠能力选择矩阵：表单与表单项的 Fantastic-admin 单元格缺少 ${requiredPhrase}`,
    )
  }
  for (const requiredPhrase of ['`AForm`', '`AFormItem`']) {
    assert.ok(
      overlapRows['表单与表单项'][2].includes(requiredPhrase),
      `重叠能力选择矩阵：表单与表单项的 Arco 单元格缺少 ${requiredPhrase}`,
    )
  }
  for (const requiredPhrase of ['标准业务表单默认 Arco', '语义迁移']) {
    assert.ok(
      overlapRows['表单与表单项'][3].includes(requiredPhrase),
      `重叠能力选择矩阵：表单与表单项的项目决策缺少 ${requiredPhrase}`,
    )
  }
  assert.ok(
    overlapRows['表格与描述'][3].includes('标准业务数据展示默认 Arco'),
    '重叠能力选择矩阵：表格与描述的项目决策缺少“标准业务数据展示默认 Arco”',
  )
  assert.ok(
    overlapRows['反馈'][3].includes('业务反馈默认 Arco'),
    '重叠能力选择矩阵：反馈的项目决策缺少“业务反馈默认 Arco”',
  )
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

/**
 * 公开能力只能来自 index.ts 指定注释后的 export 区段。先切区段再用
 * TypeScript AST 读取真实运行时导出名，排除注释、字符串与 type-only。
 * 命名导出在去重前拒绝同名；runtime namespace export 一律失败；runtime
 * export star 只允许调用方给出的精确清单，既兼容专业版现有两条聚合导出，
 * 又确保以后新增不透明 star export 时测试会要求人工核对。
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

  function visit(node) {
    if (ts.isExportDeclaration(node) && !node.isTypeOnly) {
      const moduleName = node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
        ? node.moduleSpecifier.text
        : '<unknown>'

      if (!node.exportClause) {
        assert.ok(
          allowedRuntimeStarModules.includes(moduleName),
          `Fantastic-admin ${sectionName}公开覆盖无法静默解析 runtime export star：module=${moduleName}`,
        )
        runtimeStarModules.push(moduleName)
      }
      else if (ts.isNamespaceExport(node.exportClause)) {
        assert.fail(
          `Fantastic-admin ${sectionName}公开覆盖无法静默解析 runtime namespace export：module=${moduleName}`,
        )
      }
      else {
        for (const specifier of node.exportClause.elements) {
          if (!specifier.isTypeOnly) {
            const publicName = specifier.name.text
            if (publicNamePattern.test(publicName)) {
              rawPublicExports.push({ moduleName, publicName })
            }
          }
        }
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)

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
    handbook.includes('Arco Design Vue 用于标准业务 UI'),
    '手册必须明确 Arco Design Vue 用于标准业务 UI',
  )
  assert.ok(
    handbook.includes('Fantastic-admin 内置组件用于框架壳与框架交互'),
    '手册必须明确 Fantastic-admin 内置组件用于框架壳与框架交互',
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

test('Fantastic-admin 组件选型契约拒绝标准业务默认落到 Fantastic-admin', () => {
  const selection = readRequiredFile(fantasticAdminComponentHandbookPaths.selection)
  const mutatedSelection = selection.replace(
    '| 标准业务交互：表单、数据录入、数据展示、反馈、企业后台交互 | Arco Design Vue |',
    '| 标准业务交互：表单、数据录入、数据展示、反馈、企业后台交互 | Fantastic-admin 内置组件 |',
  )

  assert.notEqual(mutatedSelection, selection, '标准业务默认落点变异 fixture 必须命中真实职责矩阵')
  assert.throws(
    () => assertFantasticAdminSelectionContracts(mutatedSelection),
    /组件职责矩阵.*标准业务交互/u,
    '标准业务默认落点改为 Fantastic-admin 时，结构化职责矩阵契约必须失败',
  )
})

for (const [capability, originalDecision, mutatedDecision] of [
  ['表单与表单项', '标准业务表单默认 Arco', '标准业务表单默认 Fantastic-admin'],
  ['表格与描述', '标准业务数据展示默认 Arco', '标准业务数据展示默认 Fantastic-admin'],
  ['反馈', '业务反馈默认 Arco', '业务反馈默认 Fantastic-admin'],
]) {
  test(`Fantastic-admin 组件选型契约拒绝${capability}默认落点变异`, () => {
    const selection = readRequiredFile(fantasticAdminComponentHandbookPaths.selection)
    const mutatedSelection = selection.replace(originalDecision, mutatedDecision)

    assert.notEqual(mutatedSelection, selection, `${capability}变异 fixture 必须命中真实重叠能力矩阵`)
    assert.throws(
      () => assertFantasticAdminSelectionContracts(mutatedSelection),
      new RegExp(`重叠能力选择矩阵.*${capability}`, 'u'),
      `${capability}默认落点改为 Fantastic-admin 时，结构化重叠能力契约必须失败`,
    )
  })
}

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

test('Fantastic-admin AI Skill 遵循应用定位与 Arco 业务 UI 契约', () => {
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
      `共同规则缺少 Fantastic-admin 到 Arco 的可执行映射：${from} -> ${to}`,
    )
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
      section.includes('复用') && section.includes('不直接采用') && section.includes('Fa* 业务 UI'),
      `${skillName} 必须明确只复用工作流与结构，不直接采用默认 Fa* 业务 UI 输出`,
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
