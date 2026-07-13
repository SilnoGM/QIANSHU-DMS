/* eslint-disable test/no-import-node-test */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const webRoot = fileURLToPath(new URL('../', import.meta.url))
const projectRoot = fileURLToPath(new URL('../../', import.meta.url))

/**
 * 根级中文文档属于组合仓库治理资产，不是独立 Web 发布物的一部分。
 * 只有父目录明确声明为千树 DMS 根工程时才校验它们；这样既不会在主仓库
 * 中因文档缺失而假绿，也不会让移植后的 Web 副本反向依赖原仓库目录。
 */
function isCombinedProjectRoot() {
  const manifestPath = `${projectRoot}/package.json`

  if (!existsSync(manifestPath)) {
    return false
  }

  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8')).name === 'qianshu-dms'
  }
  catch {
    return false
  }
}

const rootDocumentTestOptions = { skip: !isCombinedProjectRoot() }

/**
 * 读取必须存在的协作资产，并在缺失时给出可直接定位的中文错误。
 * 这里不使用默认空字符串，避免文件缺失时后续断言产生误导。
 */
function readRequiredFile(filePath) {
  assert.equal(existsSync(filePath), true, `缺少协作资产：${filePath}`)
  return readFileSync(filePath, 'utf8')
}

const skillCases = [
  ['fa-i18n-manager', 'apps/qsmds-arco/src/locales/'],
  ['fa-route-generator', 'apps/qsmds-arco/src/router/'],
  ['fa-page-optimizer', 'apps/qsmds-arco/src/views/'],
  ['fa-form-builder', 'apps/qsmds-arco/src/views/'],
  ['fa-store-generator', 'apps/qsmds-arco/src/store/'],
  ['fa-slot-creator', 'apps/qsmds-arco/src/slots/'],
  ['fa-framework-settings', 'apps/qsmds-arco/src/settings.ts'],
]

test('Web 协作入口明确正式应用、参考应用和默认命令', () => {
  for (const relativePath of ['AGENTS.md', 'README.md']) {
    const content = readRequiredFile(`${webRoot}/${relativePath}`)

    assert.match(content, /apps\/qsmds-arco/u, `${relativePath} 必须标明唯一正式业务应用`)
    assert.match(content, /examples\/\*/u, `${relativePath} 必须说明参考应用边界`)
    assert.match(content, /pnpm dev/u, `${relativePath} 必须给出默认开发命令`)
    assert.match(content, /pnpm check/u, `${relativePath} 必须给出默认检查命令`)
    assert.match(content, /pnpm build/u, `${relativePath} 必须给出默认构建命令`)
    assert.match(content, /pnpm check:examples/u, `${relativePath} 必须给出参考应用检查命令`)
    assert.match(content, /pnpm-lock\.yaml/u, `${relativePath} 必须说明独立 lockfile`)
    assert.match(content, /VITE_/u, `${relativePath} 必须说明浏览器环境变量安全边界`)
    assert.match(content, /明确要求修改/u, `${relativePath} 必须要求明确的参考应用写入授权`)
  }
})

test('Web 协作文档区分上游基座与产品版本且不保留 bumpp 入口', () => {
  const manifest = JSON.parse(readRequiredFile(`${webRoot}/package.json`))
  const documents = [
    ['README.md', readRequiredFile(`${webRoot}/README.md`)],
    ['AGENTS.md', readRequiredFile(`${webRoot}/AGENTS.md`)],
  ]

  assert.equal(manifest.version, '6.3.0')
  assert.equal('release' in manifest.scripts, false)
  assert.equal(
    Object.values(manifest.scripts).some(command => /\bbumpp\b/u.test(command)),
    false,
  )
  assert.equal('bumpp' in (manifest.devDependencies ?? {}), false)

  for (const [label, document] of documents) {
    assert.ok(
      document.includes(
        '`web/package.json.version = 6.3.0` 是 Fantastic Admin 上游基座版本',
      ),
      `${label} 必须说明上游基座版本`,
    )
    assert.ok(
      document.includes(
        '`apps/qsmds-arco/package.json.version` 是正式 Web app 的产品 version',
      ),
      `${label} 必须说明产品版本真相源`,
    )
    assert.ok(
      document.includes('不提供 `release: bumpp` 或其他 `bumpp` 入口'),
      `${label} 必须禁止恢复基座发布入口`,
    )
  }
})

test('Web 架构文档固定独立工作区、依赖方向和产品版本边界', rootDocumentTestOptions, () => {
  const architecture = readRequiredFile(`${projectRoot}/docs/前端文档/前端架构.md`)

  assert.match(architecture, /独立(?:安装|构建|发布)/u)
  assert.match(architecture, /apps\/qsmds-arco/u)
  assert.match(architecture, /examples\/\*/u)
  assert.match(architecture, /packages\/\*/u)
  assert.match(architecture, /pnpm-lock\.yaml/u)
  assert.match(architecture, /OpenAPI/u)
  assert.ok(
    architecture.includes('apps → packages'),
    '前端架构必须明确 apps → packages 依赖方向',
  )
  assert.ok(
    architecture.includes(
      '`web/package.json.version = 6.3.0` 是 Fantastic Admin 上游基座版本',
    ),
  )
  assert.ok(
    architecture.includes(
      '`apps/qsmds-arco/package.json.version` 是正式 Web app 的产品 version',
    ),
  )
  assert.ok(architecture.includes('不提供 `release: bumpp` 或其他 `bumpp` 入口'))
})

test('应用边界规范禁止参考应用和共享包承载默认业务改动', rootDocumentTestOptions, () => {
  const boundary = readRequiredFile(`${projectRoot}/docs/前端文档/应用边界规范.md`)

  assert.match(boundary, /apps\/qsmds-arco/u)
  assert.match(boundary, /examples\/\*/u)
  assert.match(boundary, /packages\/\*/u)
  assert.match(boundary, /只有用户明确指定参考应用时/u)
  assert.match(boundary, /业务代码/u)
  assert.match(boundary, /YAGNI/u)
})

test('文档索引收录两个前端边界文档', rootDocumentTestOptions, () => {
  const index = readRequiredFile(`${projectRoot}/docs/文档索引.md`)

  assert.match(index, /\.\/前端文档\/前端架构\.md/u)
  assert.match(index, /\.\/前端文档\/应用边界规范\.md/u)
})

test('七个项目 Skill 默认写入正式应用且保护参考应用', () => {
  for (const [skillName, expectedPath] of skillCases) {
    const skillPath = `${webRoot}/skills/${skillName}/SKILL.md`
    const content = readRequiredFile(skillPath)

    assert.match(content, /apps\/qsmds-arco/u, `${skillName} 必须默认正式业务应用`)
    assert.match(content, /examples\/\*/u, `${skillName} 必须标明参考应用边界`)
    assert.match(content, /只有用户明确指定参考应用时/u, `${skillName} 必须保护参考应用`)
    assert.match(content, /明确要求修改/u, `${skillName} 必须要求明确的参考应用写入授权`)
    assert.match(content, /路径前缀 `apps\/qsmds-arco`/u, `${skillName} 必须说明参考应用路径映射`)
    assert.match(content, /不得同时修改 `apps\/qsmds-arco`/u, `${skillName} 必须隔离参考应用和正式应用写入`)
    assert.ok(content.includes(expectedPath), `${skillName} 缺少准确默认路径：${expectedPath}`)
    assert.doesNotMatch(content, /才读取或修改/u, `${skillName} 不得把只读查阅等同于修改授权`)
    assert.doesNotMatch(content, /apps\/<app>/u, `${skillName} 仍含模糊应用占位符`)
    assert.doesNotMatch(content, /apps\/(?:core|example)(?:\b|\/)/u, `${skillName} 仍含旧应用路径`)
    assert.doesNotMatch(content, /必须阻塞等待用户回复/u, `${skillName} 不应阻塞正式业务需求`)
    assert.doesNotMatch(content, /ls apps\//u, `${skillName} 不应依靠列目录猜测目标应用`)
  }
})

test('框架设置 Skill 引用真实存在的共享配置文件', () => {
  const skillPath = `${webRoot}/skills/fa-framework-settings/SKILL.md`
  const content = readRequiredFile(skillPath)

  assert.match(content, /packages\/settings\/src\/types\.ts/u)
  assert.doesNotMatch(content, /packages\/settings\/types\.ts/u)
  assert.doesNotMatch(content, /(?:仅|只)修改 `apps\/qsmds-arco\/src\/settings\.ts`/u)
  assert.equal(existsSync(`${webRoot}/packages/settings/src/types.ts`), true)
  assert.equal(existsSync(`${webRoot}/packages/settings/src/default.ts`), true)
})

test('主 Skill 直接引用的工作说明不再包含旧应用占位符', () => {
  const referencePaths = [
    'skills/fa-i18n-manager/references/locale-structure.md',
    'skills/fa-i18n-manager/references/adding-language.md',
    'skills/fa-framework-settings/references/toolbar-settings.md',
  ]

  for (const relativePath of referencePaths) {
    const content = readRequiredFile(`${webRoot}/${relativePath}`)

    assert.match(content, /apps\/qsmds-arco/u, `${relativePath} 必须指向正式业务应用`)
    assert.doesNotMatch(content, /apps\/<app>/u, `${relativePath} 仍含模糊应用占位符`)
    assert.doesNotMatch(content, /apps\/(?:core|example)(?:\b|\/)/u, `${relativePath} 仍含旧应用路径`)
  }
})

test('正式应用 Arco locale 导入路径与依赖包的小写文件名完全一致', () => {
  const provider = readRequiredFile(
    `${webRoot}/apps/qsmds-arco/src/ui/provider/index.ts`,
  )

  // macOS 默认文件系统不区分大小写，错误路径会在本地假通过；这里锁定依赖包
  // 发布到 Linux Runner 后使用的真实小写文件名，防止再次出现 TS2307。
  for (const localeFile of ['en-us', 'zh-cn', 'zh-tw']) {
    assert.ok(
      provider.includes(`@arco-design/web-vue/es/locale/lang/${localeFile}`),
      `Arco locale 必须使用精确小写路径：${localeFile}`,
    )
  }
  assert.doesNotMatch(provider, /locale\/lang\/(?:en-US|zh-CN|zh-TW)/u)
})
