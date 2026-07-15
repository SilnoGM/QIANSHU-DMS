/* eslint-disable test/no-import-node-test */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const handbookPath = fileURLToPath(new URL('../../docs/前端文档/前端开发手册/README.md', import.meta.url))
const documentIndexPath = fileURLToPath(new URL('../../docs/文档索引.md', import.meta.url))
const webManifestPath = fileURLToPath(new URL('../package.json', import.meta.url))
const webLockfilePath = fileURLToPath(new URL('../pnpm-lock.yaml', import.meta.url))

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

test('前端开发手册入口固定正式应用、技术基线与组件职责', () => {
  const handbook = readRequiredFile(handbookPath)
  const documentIndex = readRequiredFile(documentIndexPath)
  const fantasticAdminVersion = readFantasticAdminVersion()
  const arcoVersion = readArcoCatalogResolvedVersion()

  assert.ok(
    documentIndex.includes('./前端文档/前端开发手册/README.md'),
    '根文档索引必须收录前端开发手册入口',
  )
  assert.ok(
    handbook.includes(`Fantastic-admin 专业版 \`${fantasticAdminVersion}\``),
    `Fantastic-admin 代码真相源版本为 ${fantasticAdminVersion}，手册必须包含：Fantastic-admin 专业版 \`${fantasticAdminVersion}\``,
  )
  assert.ok(
    handbook.includes(`\`@arco-design/web-vue@${arcoVersion}\``),
    `Arco lockfile 真相源版本为 ${arcoVersion}，手册必须包含：\`@arco-design/web-vue@${arcoVersion}\``,
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
