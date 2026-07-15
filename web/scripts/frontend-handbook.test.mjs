/* eslint-disable test/no-import-node-test */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const handbookPath = fileURLToPath(new URL('../../docs/前端文档/前端开发手册/README.md', import.meta.url))
const fantasticAdminHandbookPaths = {
  index: fileURLToPath(new URL('../../docs/前端文档/前端开发手册/Fantastic-admin/README.md', import.meta.url)),
  guide: fileURLToPath(new URL('../../docs/前端文档/前端开发手册/Fantastic-admin/指引与开发准备.md', import.meta.url)),
  skills: fileURLToPath(new URL('../../docs/前端文档/前端开发手册/Fantastic-admin/AI技能.md', import.meta.url)),
  foundation: fileURLToPath(new URL('../../docs/前端文档/前端开发手册/Fantastic-admin/工程基础.md', import.meta.url)),
}
const documentIndexPath = fileURLToPath(new URL('../../docs/文档索引.md', import.meta.url))
const webManifestPath = fileURLToPath(new URL('../package.json', import.meta.url))
const webLockfilePath = fileURLToPath(new URL('../pnpm-lock.yaml', import.meta.url))
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

function readMarkdownHeadingAnchors(content) {
  return new Set(
    content
      .split(/\r?\n/u)
      .map(readMarkdownHeading)
      .filter(Boolean)
      .map(createHeadingAnchor),
  )
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

test('Fantastic-admin 分册完整覆盖第一阶段官方主题', () => {
  const documents = Object.fromEntries(
    Object.entries(fantasticAdminHandbookPaths).map(([name, filePath]) => [name, readRequiredFile(filePath)]),
  )

  for (const [name, content] of Object.entries(documents)) {
    assert.notEqual(content.trim(), '', `Fantastic-admin 分册不得为空：${name}`)
  }

  assert.equal(fantasticAdminCoverage.length, 23, 'Fantastic-admin 覆盖契约必须独立固定为 23 项')

  const coverageRows = readCoverageMatrix(documents.index)
  const actualKeys = coverageRows.map(row => row.key)
  const expectedKeys = fantasticAdminCoverage.map(([key]) => key)

  assert.equal(new Set(actualKeys).size, actualKeys.length, 'Fantastic-admin 覆盖矩阵不得包含重复覆盖键')
  assert.deepEqual(actualKeys, expectedKeys, 'Fantastic-admin 覆盖矩阵必须按约定顺序完整收录 23 个覆盖键')

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
