import assert from 'node:assert/strict'

// 完整固定 SemVer 不包含 range、tag、alias、路径或 URL，因此无需维护一份
// 永远可能漏项的来源黑名单。预发布数字标识仍遵守“不允许前导零”的 SemVer 规则。
const fixedRegistryVersionPattern = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const dependencySections = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
]

export function dependencyEntries(manifest) {
  return dependencySections.flatMap(section =>
    Object.entries(manifest[section] ?? {}).map(([name, specifier]) => ({
      name,
      section,
      specifier,
    })),
  )
}

export function isFixedRegistryVersion(specifier) {
  return typeof specifier === 'string' && fixedRegistryVersionPattern.test(specifier)
}

function decodeLockfileScalar(rawValue, lineNumber) {
  const value = rawValue.trim()

  if (value.startsWith("'")) {
    assert.match(
      value,
      /^'(?:[^']|'')*'$/,
      `lockfile 第 ${lineNumber} 行包含不完整的单引号标量`,
    )
    return value.slice(1, -1).replaceAll("''", "'")
  }
  if (value.startsWith('"')) {
    const parsed = JSON.parse(value)
    assert.equal(typeof parsed, 'string', `lockfile 第 ${lineNumber} 行必须是字符串`)
    return parsed
  }

  // 只解析 importer 键、package 名和 specifier 所需的保守字符集；不执行 YAML tag、
  // anchor、flow collection 或任意对象构造，从而避免为根测试引入 YAML 运行时依赖。
  assert.match(
    value,
    /^[A-Za-z0-9@._/+~-]+$/,
    `lockfile 第 ${lineNumber} 行包含不受支持的标量`,
  )
  return value
}

export function parseLockfileImporters(lockfileContents) {
  const importers = new Map()
  let foundImporters = false
  let insideImporters = false
  let currentImporter
  let currentSection
  let currentDependency

  for (const [lineIndex, line] of lockfileContents.split(/\r?\n/).entries()) {
    const lineNumber = lineIndex + 1

    if (line === 'importers:') {
      assert.equal(foundImporters, false, 'lockfile 只能包含一个 importers 节点')
      foundImporters = true
      insideImporters = true
      continue
    }
    if (!insideImporters) {
      continue
    }
    if (line !== '' && !line.startsWith(' ')) {
      break
    }
    if (line.trim() === '') {
      continue
    }

    const importerMatch = line.match(/^  (\S.*):$/)
    if (importerMatch) {
      currentImporter = decodeLockfileScalar(importerMatch[1], lineNumber)
      assert.equal(importers.has(currentImporter), false, `重复 importer：${currentImporter}`)
      importers.set(currentImporter, new Map())
      currentSection = undefined
      currentDependency = undefined
      continue
    }

    const sectionMatch = line.match(
      /^    (dependencies|devDependencies|optionalDependencies|peerDependencies):$/,
    )
    if (sectionMatch) {
      assert.notEqual(currentImporter, undefined, `lockfile 第 ${lineNumber} 行缺少 importer`)
      currentSection = sectionMatch[1]
      const importer = importers.get(currentImporter)
      assert.equal(importer.has(currentSection), false, `重复依赖区段：${currentSection}`)
      importer.set(currentSection, new Map())
      currentDependency = undefined
      continue
    }

    const dependencyMatch = line.match(/^      (\S.*):$/)
    if (dependencyMatch) {
      assert.notEqual(currentSection, undefined, `lockfile 第 ${lineNumber} 行缺少依赖区段`)
      currentDependency = decodeLockfileScalar(dependencyMatch[1], lineNumber)
      const dependencies = importers.get(currentImporter).get(currentSection)
      assert.equal(
        dependencies.has(currentDependency),
        false,
        `重复依赖：${currentDependency}`,
      )
      dependencies.set(currentDependency, undefined)
      continue
    }

    const specifierMatch = line.match(/^        specifier: (.+)$/)
    if (specifierMatch) {
      assert.notEqual(currentDependency, undefined, `lockfile 第 ${lineNumber} 行缺少依赖名`)
      const dependencies = importers.get(currentImporter).get(currentSection)
      assert.equal(
        dependencies.get(currentDependency),
        undefined,
        `重复 specifier：${currentDependency}`,
      )
      dependencies.set(
        currentDependency,
        decodeLockfileScalar(specifierMatch[1], lineNumber),
      )
      continue
    }
    if (/^        version: .+$/.test(line)) {
      const dependencies = importers.get(currentImporter)?.get(currentSection)
      assert.equal(
        typeof dependencies?.get(currentDependency),
        'string',
        `lockfile 第 ${lineNumber} 行的 version 缺少对应 specifier`,
      )
      continue
    }

    assert.fail(`lockfile 第 ${lineNumber} 行不符合 importer 安全子集`)
  }

  assert.equal(foundImporters, true, 'lockfile 必须包含 importers 节点')
  for (const sections of importers.values()) {
    for (const dependencies of sections.values()) {
      for (const [name, specifier] of dependencies) {
        assert.equal(typeof specifier, 'string', `lockfile 缺少 specifier：${name}`)
      }
    }
  }
  return importers
}

export function assertLockfileMatchesManifest(manifest, importers) {
  assert.deepEqual([...importers.keys()], ['.'], 'lockfile 只能包含单一 . importer')
  const rootImporter = importers.get('.')

  for (const section of dependencySections) {
    const actual = Object.fromEntries(rootImporter.get(section) ?? [])
    const expected = manifest[section] ?? {}
    assert.deepEqual(
      actual,
      expected,
      `lockfile ${section} specifier 必须与 package.json 一致`,
    )
  }
}
