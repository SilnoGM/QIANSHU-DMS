import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(scriptsDirectory, '..')

const expectedBusinessDirectories = ['qsmds-arco']
const expectedExampleDirectories = ['core', 'core-arco-design-vue', 'example']
const expectedPackageDirectories = [
  'components',
  'composables',
  'copyright',
  'hotkeys',
  'iconify-tools',
  'locales',
  'settings',
  'themes',
  'types',
]
const expectedWorkspacePatterns = ['apps/*', 'examples/*', 'packages/*']
const dependencySectionNames = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right, 'en'))
}

function getChildDirectories(relativeDirectory) {
  const absoluteDirectory = path.join(webRoot, relativeDirectory)
  if (!fs.existsSync(absoluteDirectory)) {
    return []
  }

  return sorted(fs.readdirSync(absoluteDirectory, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name))
}

function readPackageJson(relativeDirectory) {
  return JSON.parse(fs.readFileSync(path.join(webRoot, relativeDirectory, 'package.json'), 'utf8'))
}

function parseWorkspacePatterns() {
  const lines = fs.readFileSync(path.join(webRoot, 'pnpm-workspace.yaml'), 'utf8').split(/\r?\n/)
  const packagesIndex = lines.findIndex(line => line === 'packages:')
  assert.notEqual(packagesIndex, -1, 'pnpm-workspace.yaml 缺少 packages 声明')

  const patterns = []
  for (const line of lines.slice(packagesIndex + 1)) {
    const match = line.match(/^  - (.+)$/)
    if (!match) {
      break
    }
    patterns.push(match[1])
  }

  return patterns
}

function parseLockfileImporters() {
  const lines = fs.readFileSync(path.join(webRoot, 'pnpm-lock.yaml'), 'utf8').split(/\r?\n/)
  const importersIndex = lines.findIndex(line => line === 'importers:')
  assert.notEqual(importersIndex, -1, 'pnpm-lock.yaml 缺少 importers')

  const importers = []
  for (const line of lines.slice(importersIndex + 1)) {
    if (/^[^\s]/.test(line)) {
      break
    }

    // pnpm 会把无依赖 importer 压缩成 `path: {}`，两种 YAML 形式都属于同一层级键。
    const match = line.match(/^  ([^\s][^:]*):(?: \{\})?$/)
    if (match) {
      importers.push(match[1])
    }
  }

  return sorted(importers)
}

function getExpectedImporterPaths() {
  return sorted([
    '.',
    ...expectedBusinessDirectories.map(directory => `apps/${directory}`),
    ...expectedExampleDirectories.map(directory => `examples/${directory}`),
    ...expectedPackageDirectories.map(directory => `packages/${directory}`),
  ])
}

function getExpectedWorkspaceFolderPaths() {
  return sorted(getExpectedImporterPaths().filter(importer => importer !== '.'))
}

function getAppDependencyEntries(manifest) {
  // 逐区段检查，避免同名依赖被对象展开覆盖后漏过其中一个不安全声明。
  return dependencySectionNames.flatMap(sectionName => Object.entries(manifest[sectionName] ?? {})
    .map(([dependencyName, version]) => ({ dependencyName, sectionName, version })))
}

function isRegistryVersion(version) {
  if (!version || version.includes(':') || version.includes('/') || version.includes('\\')) {
    return false
  }

  if (/\.(?:tgz|tar|tar\.gz)$/i.test(version)) {
    return false
  }

  // 允许常见 semver range 和 registry dist-tag；路径、URL 与其他协议已在上方排除。
  return /^(?:[A-Za-z][A-Za-z0-9._-]*|[0-9v*<>=~^xX][0-9A-Za-z*<>=~^xX.,+\-|\s]*)$/.test(version)
}

function isRegistryAlias(version) {
  if (!version.startsWith('npm:')) {
    return false
  }

  const alias = version.slice('npm:'.length)
  const versionSeparator = alias.lastIndexOf('@')
  if (versionSeparator <= 0) {
    return false
  }

  const packageName = alias.slice(0, versionSeparator)
  const packageVersion = alias.slice(versionSeparator + 1)
  return /^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/.test(packageName) && isRegistryVersion(packageVersion)
}

function assertAppDependencyAllowed({ appPackageNames, dependencyName, directory, publicPackageNames, version }) {
  assert.equal(appPackageNames.has(dependencyName), false, `${directory} 不得依赖其他应用 ${dependencyName}`)
  assert.equal(typeof version, 'string', `${directory} 的 ${dependencyName} 依赖版本必须是字符串`)

  if (version.startsWith('workspace:')) {
    assert.equal(version, 'workspace:*', `${directory} 的 workspace 依赖必须使用 workspace:*`)
    assert.equal(publicPackageNames.has(dependencyName), true, `${directory} 的 ${dependencyName} 不是 packages/* 公共包`)
    return
  }

  assert.equal(publicPackageNames.has(dependencyName), false, `${directory} 的内部公共包 ${dependencyName} 必须使用 workspace:*`)

  if (/^catalog:(?:[A-Za-z0-9._-]+)?$/.test(version)) {
    return
  }

  assert.equal(isRegistryVersion(version) || isRegistryAlias(version), true, `${directory} 的 ${dependencyName} 使用了未允许的依赖协议 ${version}`)
}

test('业务应用、参考应用和共享包位于各自唯一目录', () => {
  assert.deepEqual(getChildDirectories('apps'), expectedBusinessDirectories)
  assert.deepEqual(getChildDirectories('examples'), expectedExampleDirectories)
  assert.deepEqual(getChildDirectories('packages'), expectedPackageDirectories)
})

test('pnpm workspace 只收录 apps、examples 和 packages', () => {
  assert.deepEqual(parseWorkspacePatterns(), expectedWorkspacePatterns)
})

test('lockfile importer 与最终 workspace 目录完全一致', () => {
  const importers = parseLockfileImporters()
  assert.deepEqual(importers, getExpectedImporterPaths())
  assert.equal(importers.some(importer => /^apps\/(core|core-arco-design-vue|example)$/.test(importer)), false)
})

test('依赖检查必须逐区段保留同名声明', () => {
  const entries = getAppDependencyEntries({
    dependencies: { shared: 'catalog:' },
    devDependencies: { shared: 'portal:../../../server' },
  })

  assert.equal(entries.length, 2)
})

test('依赖协议只允许 registry、catalog 和受控 workspace', () => {
  const context = {
    appPackageNames: new Set(['business-app']),
    dependencyName: 'external-package',
    directory: 'apps/business-app',
    publicPackageNames: new Set(['@internal/public-package']),
  }

  for (const version of ['portal:../../../server', 'patch:package@1.0.0#patch.diff', 'git+https://example.com/repo.git', 'https://example.com/package.tgz', 'owner/repository']) {
    assert.throws(() => assertAppDependencyAllowed({ ...context, version }), `必须拒绝 ${version}`)
  }

  assert.doesNotThrow(() => assertAppDependencyAllowed({ ...context, version: '^1.2.3' }))
  assert.doesNotThrow(() => assertAppDependencyAllowed({ ...context, version: 'catalog:' }))
  assert.doesNotThrow(() => assertAppDependencyAllowed({ ...context, version: 'npm:real-package@^1.2.3' }))
  assert.doesNotThrow(() => assertAppDependencyAllowed({
    ...context,
    dependencyName: '@internal/public-package',
    version: 'workspace:*',
  }))
})

test('四个应用 package name 唯一且依赖只指向 Web 公共包', () => {
  const appDirectories = [
    ...expectedBusinessDirectories.map(directory => `apps/${directory}`),
    ...expectedExampleDirectories.map(directory => `examples/${directory}`),
  ]
  const publicPackageNames = new Set(expectedPackageDirectories.map(directory => readPackageJson(`packages/${directory}`).name))
  const appManifests = appDirectories.map(directory => ({
    directory,
    manifest: readPackageJson(directory),
  }))
  const appPackageNames = new Set(appManifests.map(({ manifest }) => manifest.name))

  assert.equal(appPackageNames.size, appManifests.length, '四个应用的 package name 必须唯一')

  for (const { directory, manifest } of appManifests) {
    for (const { dependencyName, version } of getAppDependencyEntries(manifest)) {
      assertAppDependencyAllowed({
        appPackageNames,
        dependencyName,
        directory,
        publicPackageNames,
        version,
      })
    }
  }
})

test('编辑器 workspace 只引用 1 个业务应用、3 个参考应用和 9 个公共包', () => {
  const workspacePath = path.join(webRoot, 'fantastic-admin.code-workspace')
  const workspace = JSON.parse(fs.readFileSync(workspacePath, 'utf8'))
  const folderPaths = sorted(workspace.folders.map(folder => folder.path))

  assert.deepEqual(folderPaths, getExpectedWorkspaceFolderPaths())
  for (const folder of workspace.folders) {
    assert.equal(folder.name, folder.path, `workspace folder 的 name 和 path 必须一致：${folder.path}`)
    assert.equal(fs.existsSync(path.join(webRoot, folder.path)), true, `workspace 路径不存在：${folder.path}`)
  }

  const localePaths = workspace.settings['i18n-ally-next.localesPaths']
  assert.deepEqual(localePaths, [
    'packages/locales/lang/**/*',
    'apps/*/src/locales/lang/**/*',
    'examples/*/src/locales/lang/**/*',
  ])
})
