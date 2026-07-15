import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// 测试以自身位置推导仓库根目录，避免调用者从其他工作目录执行时误读同名文件。
const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptsDirectory, '..')

const currentGlobalDocuments = Object.freeze([
  '发布与版本管理.md',
  '开发工作流.md',
  '项目工程组织方案.md',
])

const archiveTasks = new Map([
  [
    '项目工程组织方案分阶段落地',
    Object.freeze([
      '归档说明.md',
      '阶段一根级治理实施计划.md',
      '阶段二Web边界整理实施计划.md',
      '阶段三Server初始化实施计划.md',
      '阶段四接口契约实施计划.md',
      '阶段四接口契约设计.md',
      '阶段五CI与发布实施计划.md',
      '阶段五CI与发布设计.md',
    ]),
  ],
  [
    '服务器发布打包故障修复',
    Object.freeze([
      '归档说明.md',
      '服务器发布归档硬链接根因修复实施计划.md',
      '服务器发布归档硬链接根因修复设计.md',
      '服务器发布打包故障诊断与CI复现实施计划.md',
      '服务器发布打包故障诊断与修复设计.md',
    ]),
  ],
  [
    '文档体系收口与归档整理',
    Object.freeze([
      '归档说明.md',
      '文档体系收口与归档整理实施计划.md',
      '文档体系收口与归档整理设计.md',
    ]),
  ],
  [
    'Fantastic-admin与Arco文档本地化',
    Object.freeze([
      '归档说明.md',
      'Fantastic-admin与Arco文档本地化实施计划.md',
      'Fantastic-admin与Arco文档本地化设计.md',
    ]),
  ],
])

function fromRoot(...segments) {
  return path.join(repositoryRoot, ...segments)
}

async function exists(...segments) {
  try {
    await lstat(fromRoot(...segments))
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false
    }
    throw error
  }
}

// 精确目录契约同时编码名称和实体类型；symlink 或其他特殊条目不会被过滤掉，
// 而是作为 unexpected kind 触发 deepEqual 失败。
async function directoryEntryKinds(relativeDirectory) {
  const entries = await readdir(fromRoot(relativeDirectory), {
    withFileTypes: true,
  })
  return entries.map(entry => {
    if (entry.isFile()) return `file:${entry.name}`
    if (entry.isDirectory()) return `directory:${entry.name}`
    if (entry.isSymbolicLink()) return `symlink:${entry.name}`
    return `other:${entry.name}`
  }).sort()
}

function expectedDirectoryEntryKinds({ directories = [], files = [] }) {
  return [
    ...directories.map(name => `directory:${name}`),
    ...files.map(name => `file:${name}`),
  ].sort()
}

// docs 树只允许真实文件和目录；任何 symlink 或特殊条目都直接失败，避免扫描器
// 因 Dirent.isFile/isDirectory 均为 false 而静默跳过。
async function markdownFilesUnder(relativeDirectory) {
  const entries = await readdir(fromRoot(relativeDirectory), {
    withFileTypes: true,
  })
  const files = []
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name)
    if (entry.isDirectory()) {
      files.push(...await markdownFilesUnder(relativePath))
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(relativePath)
    } else if (!entry.isFile()) {
      assert.fail(`docs 树不得包含 symlink 或特殊条目：${relativePath}`)
    }
  }
  return files.sort()
}

function isEscapedMarkdownCharacter(document, index) {
  let backslashCount = 0
  for (let cursor = index - 1; cursor >= 0 && document[cursor] === '\\'; cursor -= 1) {
    backslashCount += 1
  }
  return backslashCount % 2 === 1
}

function backtickRunLength(document, start) {
  let end = start
  while (document[end] === '`') end += 1
  return end - start
}

function nextUnescapedBacktick(document, start) {
  let cursor = start
  while (cursor < document.length) {
    const candidate = document.indexOf('`', cursor)
    if (candidate === -1) return -1
    if (!isEscapedMarkdownCharacter(document, candidate)) return candidate
    cursor = candidate + 1
  }
  return -1
}

// code span 只能由长度完全相同的 backtick run 闭合。被遮蔽区域保留换行，
// 避免删除代码后把原本分离的 Markdown 片段拼成一个虚假的链接。
function maskMarkdownCodeSpans(document) {
  let result = ''
  let cursor = 0
  while (cursor < document.length) {
    const openingStart = nextUnescapedBacktick(document, cursor)
    if (openingStart === -1) return result + document.slice(cursor)

    const openingLength = backtickRunLength(document, openingStart)
    let closingStart = nextUnescapedBacktick(
      document,
      openingStart + openingLength,
    )
    while (
      closingStart !== -1 &&
      backtickRunLength(document, closingStart) !== openingLength
    ) {
      closingStart = nextUnescapedBacktick(
        document,
        closingStart + backtickRunLength(document, closingStart),
      )
    }

    if (closingStart === -1) {
      const openingEnd = openingStart + openingLength
      result += document.slice(cursor, openingEnd)
      cursor = openingEnd
      continue
    }

    const closingEnd = closingStart + openingLength
    result += document.slice(cursor, openingStart)
    result += document.slice(openingStart, closingEnd).replace(/[^\n]/gu, ' ')
    cursor = closingEnd
  }
  return result
}

function openingMarkdownFence(line) {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})/u)
  if (!match) return undefined
  return { marker: match[1][0], length: match[1].length }
}

function closesMarkdownFence(line, activeFence) {
  const match = line.match(/^ {0,3}(`+|~+)[ \t]*\r?$/u)
  return Boolean(
    match &&
      match[1][0] === activeFence.marker &&
      match[1].length >= activeFence.length,
  )
}

// 计划文档会在 fenced/inline code 中展示待写入的链接示例；这些技术示例不是
// 当前文档导航。Fence 只允许 0-3 个前导空格，且关闭标记必须同类、足够长、
// 尾部仅含空白；四空格缩进 marker 是代码文本，不能跨行开启 fence/code span。
function markdownOutsideFencedCode(document) {
  let activeFence
  const outsideFences = document
    .split('\n')
    .map(line => {
      if (activeFence !== undefined) {
        if (closesMarkdownFence(line, activeFence)) activeFence = undefined
        return ''
      }

      const openingFence = openingMarkdownFence(line)
      if (openingFence !== undefined) {
        activeFence = openingFence
        return ''
      }
      if (/^ {4,}(?:`{3,}|~{3,})/u.test(line)) return ''
      return line
    })
    .join('\n')

  return maskMarkdownCodeSpans(outsideFences)
}

// 归档提示必须紧跟一级标题；只读取开头的同一个 block，避免正文、代码示例
// 或测试代码中的同名字符串让缺失的真实提示产生 false-positive。
function leadingArchiveNotice(document) {
  const lines = document.replaceAll('\r\n', '\n').split('\n')
  assert.match(lines[0] ?? '', /^#\s+\S/u)
  let index = 1
  while (lines[index] === '') index += 1
  assert.equal(lines[index], '> [!IMPORTANT]')
  const notice = []
  while (lines[index]?.startsWith('>')) {
    notice.push(lines[index])
    index += 1
  }
  return notice.join('\n')
}

function readBracketedMarkdown(document, start) {
  if (document[start] !== '[') return undefined
  let depth = 1
  let cursor = start + 1
  while (cursor < document.length) {
    if (document[cursor] === '\\' && cursor + 1 < document.length) {
      cursor += 2
      continue
    }
    if (document[cursor] === '[') depth += 1
    if (document[cursor] === ']') {
      depth -= 1
      if (depth === 0) {
        return {
          content: document.slice(start + 1, cursor),
          end: cursor + 1,
        }
      }
    }
    cursor += 1
  }
  return undefined
}

function unescapeMarkdownPunctuation(value) {
  let result = ''
  let cursor = 0
  while (cursor < value.length) {
    const nextCharacter = value[cursor + 1]
    if (
      value[cursor] === '\\' &&
      nextCharacter !== undefined &&
      /[!-/:-@[-`{-~]/u.test(nextCharacter)
    ) {
      result += nextCharacter
      cursor += 2
      continue
    }
    result += value[cursor]
    cursor += 1
  }
  return result
}

function skipMarkdownWhitespace(document, start) {
  let cursor = start
  while (/[ \t\r\n]/u.test(document[cursor] ?? '')) cursor += 1
  return cursor
}

function inlineLinkEndAfterTarget(document, start) {
  const cursor = skipMarkdownWhitespace(document, start)
  return document[cursor] === ')' ? cursor + 1 : undefined
}

function readInlineMarkdownTarget(document, openingParenthesis) {
  let cursor = skipMarkdownWhitespace(document, openingParenthesis + 1)
  if (document[cursor] === ')') return { target: '', end: cursor + 1 }

  if (document[cursor] === '<') {
    const targetStart = cursor + 1
    cursor = targetStart
    while (cursor < document.length) {
      if (document[cursor] === '\\' && cursor + 1 < document.length) {
        cursor += 2
        continue
      }
      if (document[cursor] === '\n' || document[cursor] === '\r') return undefined
      if (document[cursor] === '>') {
        const end = inlineLinkEndAfterTarget(document, cursor + 1)
        if (end === undefined) return undefined
        return {
          target: unescapeMarkdownPunctuation(
            document.slice(targetStart, cursor),
          ),
          end,
        }
      }
      cursor += 1
    }
    return undefined
  }

  const targetStart = cursor
  let depth = 0
  while (cursor < document.length) {
    if (document[cursor] === '\\' && cursor + 1 < document.length) {
      cursor += 2
      continue
    }
    if (document[cursor] === '(') {
      depth += 1
      cursor += 1
      continue
    }
    if (document[cursor] === ')') {
      if (depth > 0) {
        depth -= 1
        cursor += 1
        continue
      }
      return {
        target: unescapeMarkdownPunctuation(
          document.slice(targetStart, cursor),
        ),
        end: cursor + 1,
      }
    }
    if (/[ \t\r\n]/u.test(document[cursor]) && depth === 0) {
      const end = inlineLinkEndAfterTarget(document, cursor)
      if (end === undefined) return undefined
      return {
        target: unescapeMarkdownPunctuation(
          document.slice(targetStart, cursor),
        ),
        end,
      }
    }
    cursor += 1
  }
  return undefined
}

function readReferenceDefinitionTarget(line, start) {
  let cursor = skipMarkdownWhitespace(line, start)
  if (line[cursor] === '<') {
    const targetStart = cursor + 1
    cursor = targetStart
    while (cursor < line.length) {
      if (line[cursor] === '\\' && cursor + 1 < line.length) {
        cursor += 2
        continue
      }
      if (line[cursor] === '>') {
        return unescapeMarkdownPunctuation(line.slice(targetStart, cursor))
      }
      cursor += 1
    }
    return undefined
  }

  const targetStart = cursor
  let depth = 0
  while (cursor < line.length && !(/[ \t\r]/u.test(line[cursor]) && depth === 0)) {
    if (line[cursor] === '\\' && cursor + 1 < line.length) {
      cursor += 2
      continue
    }
    if (line[cursor] === '(') depth += 1
    if (line[cursor] === ')') {
      if (depth === 0) return undefined
      depth -= 1
    }
    cursor += 1
  }
  if (cursor === targetStart || depth !== 0) return undefined
  return unescapeMarkdownPunctuation(line.slice(targetStart, cursor))
}

function normalizeReferenceLabel(label) {
  return unescapeMarkdownPunctuation(label)
    .trim()
    .replace(/\s+/gu, ' ')
    .toLowerCase()
}

function markdownReferenceDefinitions(document) {
  const definitions = new Map()
  for (const line of document.split('\n')) {
    const indent = line.match(/^ {0,3}/u)?.[0].length ?? 0
    const label = readBracketedMarkdown(line, indent)
    if (!label || line[label.end] !== ':') continue
    const target = readReferenceDefinitionTarget(line, label.end + 1)
    const normalizedLabel = normalizeReferenceLabel(label.content)
    if (
      target !== undefined &&
      normalizedLabel !== '' &&
      !definitions.has(normalizedLabel)
    ) {
      definitions.set(normalizedLabel, target)
    }
  }
  return definitions
}

// 这里只解析治理检查需要的 inline/full-reference 链接，不尝试实现完整 renderer。
// 有限状态扫描器负责 bracket/parenthesis 平衡与反斜杠 escape，避免正则截断 target。
function localMarkdownLinks(document) {
  const visibleMarkdown = markdownOutsideFencedCode(document)
  const referenceDefinitions = markdownReferenceDefinitions(visibleMarkdown)
  const targets = []
  let cursor = 0
  while (cursor < visibleMarkdown.length) {
    if (
      visibleMarkdown[cursor] !== '[' ||
      isEscapedMarkdownCharacter(visibleMarkdown, cursor)
    ) {
      cursor += 1
      continue
    }

    const label = readBracketedMarkdown(visibleMarkdown, cursor)
    if (!label) {
      cursor += 1
      continue
    }

    const imageMarker = cursor - 1
    const isImage =
      visibleMarkdown[imageMarker] === '!' &&
      !isEscapedMarkdownCharacter(visibleMarkdown, imageMarker)
    let parsedLink
    if (visibleMarkdown[label.end] === '(') {
      parsedLink = readInlineMarkdownTarget(visibleMarkdown, label.end)
    } else if (visibleMarkdown[label.end] === '[') {
      const reference = readBracketedMarkdown(visibleMarkdown, label.end)
      if (reference) {
        const referenceLabel = normalizeReferenceLabel(
          reference.content === '' ? label.content : reference.content,
        )
        const target = referenceDefinitions.get(referenceLabel)
        if (target !== undefined) parsedLink = { target, end: reference.end }
      }
    }

    if (parsedLink) {
      if (!isImage && parsedLink.target !== '') targets.push(parsedLink.target)
      cursor = parsedLink.end
      continue
    }
    cursor = label.end
  }

  return targets.filter(
    target => !/^(?:[a-z][a-z\d+.-]*:|#|\/)/iu.test(target),
  )
}

// 所有本地目标必须保持在仓库根内；即使链接目标当前存在，也不能允许 ../ 逃逸。
function resolveLocalMarkdownLink(sourceRelativePath, target) {
  const decodedPath = decodeURIComponent(target.split(/[?#]/u)[0])
  const targetRelativePath = path.normalize(
    path.join(path.dirname(sourceRelativePath), decodedPath),
  )
  const containment = path.relative(repositoryRoot, fromRoot(targetRelativePath))
  assert.ok(
    containment !== '..' &&
      !containment.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(containment),
    `Markdown 链接不得逃逸仓库：${sourceRelativePath} -> ${target}`,
  )
  return targetRelativePath
}

// lstat 每一级路径，既拒绝链接目标本身是 symlink，也拒绝通过 symlink 父目录
// 间接逃逸；普通文件或目录才是可接受的本地 Markdown 目标。
async function safeLocalMarkdownTargetExists(relativePath) {
  const segments = relativePath.split(path.sep).filter(segment => segment !== '')
  let currentPath = repositoryRoot
  try {
    for (const [index, segment] of segments.entries()) {
      currentPath = path.join(currentPath, segment)
      const stats = await lstat(currentPath)
      if (stats.isSymbolicLink()) return false
      if (index < segments.length - 1 && !stats.isDirectory()) return false
      if (index === segments.length - 1) {
        return stats.isFile() || stats.isDirectory()
      }
    }
    return false
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return false
    throw error
  }
}

async function assertRegularFile(relativePath) {
  const fileStats = await lstat(fromRoot(relativePath))
  assert.equal(fileStats.isFile(), true, `治理路径必须是实际文件：${relativePath}`)
}

function markdownSection(document, heading) {
  const sectionStart = document.indexOf(`${heading}\n`)
  assert.notEqual(sectionStart, -1, `文档必须包含章节：${heading}`)

  const contentStart = sectionStart + heading.length + 1
  const remainingDocument = document.slice(contentStart)
  const nextSectionOffset = remainingDocument.search(/^## /m)

  return nextSectionOffset === -1
    ? remainingDocument
    : remainingDocument.slice(0, nextSectionOffset)
}

function assertBashCodeLine(section, expectedLine) {
  const bashBlocks = [...section.matchAll(/```bash\n([\s\S]*?)\n```/g)].map(
    match => match[1],
  )
  const hasExactLine = bashBlocks.some(block =>
    block.split('\n').includes(expectedLine),
  )

  assert.equal(hasExactLine, true, `bash 代码块缺少独立命令：${expectedLine}`)
}

function checkIgnore(relativePath) {
  // 明确固定 Git 的工作目录，使忽略规则回归测试不依赖调用测试时所在的 cwd。
  const result = spawnSync(
    'git',
    ['check-ignore', '-q', '--no-index', '--', relativePath],
    { cwd: repositoryRoot, encoding: 'utf8' },
  )

  assert.equal(result.error, undefined, `无法执行 git check-ignore：${relativePath}`)
  assert.ok(
    result.status === 0 || result.status === 1,
    `git check-ignore 异常退出：${relativePath}\n${result.stderr}`,
  )
  return result.status
}

test('Markdown code 过滤遵循 fence 与 code span 边界', async t => {
  const scenarios = [
    {
      name: '双反引号 code span 不产生真实链接',
      document: '``[示例](missing.md)``\n[当前文档](visible.md)',
      expectedTargets: ['visible.md'],
    },
    {
      name: '四反引号 fence 内的三反引号不会提前关闭 fence',
      document: [
        '````markdown',
        '[示例一](missing-one.md)',
        '```',
        '[示例二](missing-two.md)',
        '````',
        '[当前文档](visible.md)',
      ].join('\n'),
      expectedTargets: ['visible.md'],
    },
    {
      name: '四空格缩进 marker 不会开启 fence',
      document: [
        '    ```markdown',
        '[当前文档](visible.md)',
        '    ```',
      ].join('\n'),
      expectedTargets: ['visible.md'],
    },
  ]

  for (const scenario of scenarios) {
    await t.test(scenario.name, () => {
      assert.deepEqual(localMarkdownLinks(scenario.document), scenario.expectedTargets)
    })
  }
})

test('Markdown link parser 解析治理所需链接语法', async t => {
  const scenarios = [
    {
      name: '嵌套 label',
      document: '[outer [inner]](missing.md)',
      expectedTargets: ['missing.md'],
    },
    {
      name: 'target 中的平衡括号',
      document: '[x](docs/foo(bar).md)',
      expectedTargets: ['docs/foo(bar).md'],
    },
    {
      name: 'reference-style link',
      document: '[guide][ref]\n\n[ref]: ./guide.md',
      expectedTargets: ['./guide.md'],
    },
    {
      name: 'reference label 忽略首尾空白、连续空白与大小写',
      document: '[guide][  ReF   Label ]\n\n[ref label]: ./guide.md',
      expectedTargets: ['./guide.md'],
    },
    {
      name: '转义 bracket 与 target 括号',
      document: '[escaped \\[label\\]](docs/foo\\(bar\\).md)',
      expectedTargets: ['docs/foo(bar).md'],
    },
    {
      name: 'image 不作为文档链接',
      document: '![image](image.png)',
      expectedTargets: [],
    },
    {
      name: 'angle target 保留空格',
      document: '[guide](<docs/guide file.md>)',
      expectedTargets: ['docs/guide file.md'],
    },
    {
      name: 'scheme、anchor 与 absolute target 被过滤',
      document: [
        '[web](https://example.com)',
        '[anchor](#section)',
        '[absolute](/docs/guide.md)',
      ].join('\n'),
      expectedTargets: [],
    },
  ]

  for (const scenario of scenarios) {
    await t.test(scenario.name, () => {
      assert.deepEqual(localMarkdownLinks(scenario.document), scenario.expectedTargets)
    })
  }
})

test('索引链接计数只使用 code 之外的真实 target', () => {
  const index = [
    '[工程归档](./工程归档/归档索引.md)',
    '``[inline 示例](./工程归档/归档索引.md)``',
    '```markdown',
    '[fenced 示例](./工程归档/虚构任务/归档说明.md)',
    '```',
  ].join('\n')
  const targets = localMarkdownLinks(index)

  assert.equal(
    targets.filter(target => target === './工程归档/归档索引.md').length,
    1,
  )
  assert.equal(
    targets.filter(target => /^\.\/工程归档\/[^/]+\/归档说明\.md$/u.test(target)).length,
    0,
  )
})

test('根 package 保持无依赖且不是 workspace', async () => {
  const manifest = JSON.parse(await readFile(fromRoot('package.json'), 'utf8'))

  assert.equal(manifest.name, 'qianshu-dms')
  // 根 manifest 是会随正式发布推进的产品版本真相源；治理测试只冻结严格稳定
  // SemVer 格式，避免合法版本升级因为测试硬编码旧值而无意义地破坏 CI。
  assert.match(
    manifest.version,
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u,
    '根产品 version 必须是无前导零、prerelease 或 build metadata 的稳定 SemVer',
  )
  assert.equal(manifest.private, true)
  assert.equal(manifest.packageManager, 'pnpm@11.9.0')
  assert.equal(manifest.engines.node, '^24.15.0')
  assert.equal('workspaces' in manifest, false)
  assert.equal('dependencies' in manifest, false)
  assert.equal('devDependencies' in manifest, false)
  assert.deepEqual(manifest.scripts, {
    bootstrap: 'node ./scripts/bootstrap.mjs',
    dev: 'node ./scripts/dev.mjs',
    'dev:server': 'node ./scripts/dev.mjs server',
    'dev:web': 'node ./scripts/dev.mjs web',
    'contract:sync': 'node ./scripts/contract-sync.mjs',
    'contract:check': 'node ./scripts/contract-check.mjs',
    'ci:server-e2e': 'node ./scripts/ci-postgres.mjs -- node ./scripts/ci-server-e2e.mjs',
    'ci:contract': 'node ./scripts/ci-contract-baseline.mjs',
    'release:check': 'node ./scripts/release-version.mjs',
    'release:package:web': 'node ./scripts/release-package.mjs web',
    'release:package:server': 'node ./scripts/release-package.mjs server',
    'release:smoke:server': 'node ./scripts/ci-postgres.mjs -- node ./scripts/release-package.mjs smoke-server',
    'release:manifest': 'node ./scripts/release-manifest.mjs',
    'release:publish': 'node ./scripts/release-github.mjs',
    'test:root': 'node --test ./scripts/*.test.mjs',
    check: 'node ./scripts/check.mjs',
    'check:server': 'pnpm -C server check',
    'check:web': 'pnpm -C web check',
    build: 'pnpm -C server build && pnpm -C web build',
    'build:server': 'pnpm -C server build',
    'build:web': 'pnpm -C web build',
  })
})

test('根目录不创建 workspace、lockfile 或依赖目录', async () => {
  assert.equal(await exists('pnpm-workspace.yaml'), false)
  assert.equal(await exists('pnpm-lock.yaml'), false)
  assert.equal(await exists('node_modules'), false)
})

test('发布清单与 GitHub Release 协调器均为真实文件', async () => {
  for (const file of [
    'release/manifest.schema.json',
    'scripts/release-manifest.mjs',
    'scripts/release-manifest.test.mjs',
    'scripts/release-github.mjs',
    'scripts/release-github.test.mjs',
  ]) {
    await assertRegularFile(file)
  }
})

test('主 CI Workflow 与源码结构测试均为真实文件', async () => {
  for (const file of [
    '.github/workflows/ci.yml',
    'scripts/ci-workflows.test.mjs',
  ]) {
    await assertRegularFile(file)
  }
})

test('根治理入口和当前指导文档均为真实文件', async () => {
  for (const file of [
    'README.md',
    'AGENTS.md',
    '.gitignore',
    '.editorconfig',
    '.node-version',
    'package.json',
    'scripts/root-governance.test.mjs',
    'docs/文档索引.md',
    'docs/全局文档/项目工程组织方案.md',
    'docs/全局文档/开发工作流.md',
    'docs/全局文档/发布与版本管理.md',
    'docs/工程归档/归档索引.md',
  ]) {
    await assertRegularFile(file)
  }
})

test('Node.js 主版本配置为 24', async () => {
  const nodeVersion = await readFile(fromRoot('.node-version'), 'utf8')
  assert.equal(nodeVersion.trim(), '24')
})

test('全局文档只保留三份当前指导文档', async () => {
  assert.deepEqual(
    await directoryEntryKinds(path.join('docs', '全局文档')),
    expectedDirectoryEntryKinds({ files: currentGlobalDocuments }),
  )
})

test('工程归档按任务组织且每个任务文件集合精确', async () => {
  assert.deepEqual(
    await directoryEntryKinds(path.join('docs', '工程归档')),
    expectedDirectoryEntryKinds({
      directories: [...archiveTasks.keys()],
      files: ['归档索引.md'],
    }),
  )
  for (const [taskName, expectedFiles] of archiveTasks) {
    assert.deepEqual(
      await directoryEntryKinds(path.join('docs', '工程归档', taskName)),
      expectedDirectoryEntryKinds({ files: expectedFiles }),
      `归档任务文件集合不正确：${taskName}`,
    )
  }
})

test('文档索引只展开当前文档并通过唯一入口进入工程归档', async () => {
  const index = await readFile(fromRoot('docs', '文档索引.md'), 'utf8')
  const indexTargets = localMarkdownLinks(index)
  const currentLinks = [
    './全局文档/项目工程组织方案.md',
    './全局文档/开发工作流.md',
    './全局文档/发布与版本管理.md',
    './前端文档/前端架构.md',
    './前端文档/应用边界规范.md',
    './前端文档/接口接入规范.md',
    './后端文档/后端架构.md',
    './后端文档/数据库迁移规范.md',
    './后端文档/接口契约规范.md',
  ]
  for (const link of currentLinks) {
    assert.equal(indexTargets.filter(target => target === link).length, 1)
  }
  assert.equal(
    indexTargets.filter(target => target === './工程归档/归档索引.md').length,
    1,
  )
  assert.equal(
    indexTargets.filter(target => target.startsWith('./工程归档/')).length,
    1,
    '项目文档索引只能通过一个入口进入工程归档',
  )
  assert.doesNotMatch(index, /\.\/全局文档\/阶段/u)
  assert.ok(index.includes('仅用于历史追溯，不作为当前执行依据'))
})

test('工程归档索引覆盖全部任务且任务说明包含完整字段', async () => {
  const archiveIndex = await readFile(
    fromRoot('docs', '工程归档', '归档索引.md'),
    'utf8',
  )
  const archiveIndexTargets = localMarkdownLinks(archiveIndex)
  const requiredHeadings = [
    '## 1. 归档范围',
    '## 2. 任务时间线',
    '## 3. 文档清单与阅读顺序',
    '## 4. 结果与归档原因',
    '## 5. 当前真相源',
    '## 6. 关联证据',
  ]
  assert.ok(archiveIndex.includes(
    '| 任务名称 | 任务类型 | 首次产出日期 | 完成日期 | 归档日期 | 最终结果 | 归档原因 | 当前真相源 | 归档说明 |',
  ))
  const indexedTaskNames = archiveIndexTargets
    .map(target => target.match(/^\.\/([^/]+)\/归档说明\.md$/u)?.[1])
    .filter(taskName => taskName !== undefined)
    .sort()
  assert.deepEqual(indexedTaskNames, [...archiveTasks.keys()].sort())
  for (const [taskName, expectedFiles] of archiveTasks) {
    assert.equal(
      archiveIndexTargets.filter(
        target => target === `./${taskName}/归档说明.md`,
      ).length,
      1,
      `工程归档索引必须且只能有一行任务：${taskName}`,
    )
    const explanation = await readFile(
      fromRoot('docs', '工程归档', taskName, '归档说明.md'),
      'utf8',
    )
    for (const heading of requiredHeadings) assert.ok(explanation.includes(heading))
    for (const file of expectedFiles.filter(file => file !== '归档说明.md')) {
      assert.ok(explanation.includes(file))
    }
    for (const field of [
      '首次产出日期',
      '文档声明日期',
      '首次 Commit',
      '原路径',
      '当前路径',
      '用途',
      '阶段',
      '归档原因',
    ]) {
      assert.ok(explanation.includes(field))
    }
  }
})

test('每份归档设计和实施计划都有归档提示', async () => {
  for (const [taskName, files] of archiveTasks) {
    for (const file of files.filter(file => file !== '归档说明.md')) {
      const document = await readFile(
        fromRoot('docs', '工程归档', taskName, file),
        'utf8',
      )
      const notice = leadingArchiveNotice(document)
      assert.ok(notice.includes('[归档说明](./归档说明.md)'))
      assert.match(
        notice,
        /\[(?:项目工程组织方案|开发工作流|发布与版本管理)\]\(\.\.\/\.\.\/全局文档\/(?:项目工程组织方案|开发工作流|发布与版本管理)\.md\)/u,
      )
    }
  }
})

test('docs 下全部本地 Markdown 链接都指向真实仓库路径', async () => {
  for (const source of await markdownFilesUnder('docs')) {
    const document = await readFile(fromRoot(source), 'utf8')
    for (const target of localMarkdownLinks(document)) {
      assert.equal(
        await safeLocalMarkdownTargetExists(
          resolveLocalMarkdownLink(source, target),
        ),
        true,
        `Markdown 链接失效或经过 symlink：${source} -> ${target}`,
      )
    }
  }
})

test('当前指导文档不保留平台待验收状态', async () => {
  const staleState =
    /Task 14|平台尚未(?:验收|验证)|尚未进行 GitHub 平台验收|当前不能声称 GitHub CI 已通过|GitHub 平台验证以 Task 14/u
  for (const file of currentGlobalDocuments) {
    const document = await readFile(
      fromRoot('docs', '全局文档', file),
      'utf8',
    )
    assert.doesNotMatch(document, staleState, `当前指导文档仍有旧状态：${file}`)
  }
})

test('开发工作流在安装前声明并验证受支持 runtime', async () => {
  const workflow = await readFile(
    fromRoot('docs', '全局文档', '开发工作流.md'),
    'utf8',
  )
  for (const fact of [
    '.node-version',
    'package.json#engines.node',
    'package.json#packageManager',
    '^24.15.0',
    'pnpm@11.9.0',
    'node --version',
    'pnpm --version',
  ]) {
    assert.ok(workflow.includes(fact), `开发工作流缺少 runtime 事实：${fact}`)
  }
})

test('根 README 使用当前时态且不保留阶段一至阶段四旧状态', async () => {
  const readme = await readFile(fromRoot('README.md'), 'utf8')
  const staleDescriptions = [
    '当前提交只完成根级治理与文档纳管',
    '待阶段二',
    '待阶段三',
    '当前处于根级工程治理阶段',
    '其余根命令依赖后续任务',
    '业务 API 与 OpenAPI 契约将在阶段四实施',
  ]

  assert.deepEqual(
    staleDescriptions.filter(description => readme.includes(description)),
    [],
  )
})

test('根 README 公开 CI、Release 与当前平台事实且不暗示根安装', async () => {
  const readme = await readFile(fromRoot('README.md'), 'utf8')
  const rootCommands = markdownSection(readme, '## 根命令')
  const releaseSection = markdownSection(readme, '## CI 与发布')
  const documentSection = markdownSection(readme, '## 项目文档')
  const requiredCommands = [
    'node --run ci:server-e2e',
    'node --run ci:contract',
    'node --run release:check',
    'node --run release:package:web',
    'node --run release:package:server',
    'node --run release:smoke:server',
    'node --run release:manifest',
    'node --run release:publish',
  ]

  for (const command of requiredCommands) {
    assert.ok(releaseSection.includes(`\`${command}\``), `根 README 缺少命令：${command}`)
  }
  assert.ok(releaseSection.includes('根目录仍不执行 `pnpm install`'))
  assert.ok(releaseSection.includes('`v0.1.2` 已完成 GitHub 平台验收'))
  assert.ok(releaseSection.includes('Main CI Run `29317624359`'))
  assert.ok(releaseSection.includes('Release Run `29317866199` attempt `2`'))
  assert.doesNotMatch(releaseSection, /平台验收以 Task 14 为准|当前不得.*平台已验收/u)
  assert.ok(rootCommands.includes('归档已构建的正式 Web 产物'))
  assert.ok(rootCommands.includes('归档已构建的 Server production 产物'))
  assert.ok(
    releaseSection.includes(
      '`release:package:*` 只归档已构建产物，单独执行前必须先完成对应 build',
    ),
  )
  for (const link of [
    './docs/全局文档/开发工作流.md',
    './docs/工程归档/归档索引.md',
  ]) {
    assert.ok(documentSection.includes(`(${link})`), `根 README 缺少文档入口：${link}`)
  }
})

test('根 README 给出两端独立安装、检查、migration 和 E2E 命令', async () => {
  const readme = await readFile(fromRoot('README.md'), 'utf8')
  const installSection = markdownSection(readme, '## 独立安装')
  const checkSection = markdownSection(readme, '## 检查与构建')
  const databaseSection = markdownSection(readme, '## 数据库 migration 与 E2E')
  const requiredCommandsBySection = [
    [installSection, 'pnpm -C server install --frozen-lockfile'],
    [installSection, 'pnpm -C web install --frozen-lockfile'],
    [
      checkSection,
      'env -u DATABASE_URL DOTENV_CONFIG_PATH=/dev/null pnpm -C server check',
    ],
    [checkSection, 'pnpm -C web check'],
    [databaseSection, 'pnpm -C server db:migrate:deploy'],
    [databaseSection, 'pnpm -C server test:e2e'],
  ]

  for (const [section, command] of requiredCommandsBySection) {
    assertBashCodeLine(section, command)
  }
})

test('根 README 的 migration 与 E2E 命令禁止静默回退到本地环境文件', async () => {
  const readme = await readFile(fromRoot('README.md'), 'utf8')
  const databaseSection = markdownSection(readme, '## 数据库 migration 与 E2E')
  const requiredGuards = [
    ': "${DATABASE_URL:?DATABASE_URL must reference the isolated test database}"',
    'export DOTENV_CONFIG_PATH=/dev/null',
    'unset DEBUG',
    'unset PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION',
  ]

  for (const guard of requiredGuards) {
    assertBashCodeLine(databaseSection, guard)
  }
})

test('工程方案当前事实准确反映根、Server、Web 和健康检查边界', async () => {
  const design = await readFile(
    fromRoot('docs', '全局文档', '项目工程组织方案.md'),
    'utf8',
  )
  // 只检查“当前工程事实”，避免把后文保留的原始决策和阶段规划误判为已实施状态。
  const currentFacts = markdownSection(design, '## 2. 当前工程事实')
  const requiredFacts = [
    '根目录不是 pnpm workspace',
    '`server/package.json`',
    '`server/pnpm-lock.yaml`',
    '`server/pnpm-workspace.yaml`',
    '`allowBuilds`',
    '不声明 `packages`',
    '`web/apps/qsmds-arco/`',
    '`web/examples/core/`',
    '`web/examples/core-arco-design-vue/`',
    '`web/examples/example/`',
    '`GET /api/health`',
    '`server/openapi/openapi.json`',
    '`web/openapi/openapi.json`',
    '`contract:sync`',
    '`contract:check`',
    '`X-Request-Id`',
    '`ApiError`',
    '`apps/qsmds-arco/src/api/generated/`',
  ]

  assert.deepEqual(
    requiredFacts.filter(fact => !currentFacts.includes(fact)),
    [],
  )
  assert.match(currentFacts, /^- 根目录不是 pnpm workspace，/m)
  assert.match(currentFacts, /^- Server 已初始化为独立 NestJS 11 CommonJS /m)
  assert.match(currentFacts, /^- 当前唯一 HTTP 能力是 `GET \/api\/health`，/m)
  assert.doesNotMatch(currentFacts, /server\/.*为空目录|尚未初始化后端框架/)
  assert.doesNotMatch(currentFacts, /web\/apps\/(?:core|example)\//)
  assert.doesNotMatch(currentFacts, /(?:尚未|未|没有)提供.*GET \/api\/health/)
  assert.doesNotMatch(currentFacts, /阶段四.*(?:尚未|未实施|待实施)/)
})

test('工程方案准确记录阶段四已实施契约能力', async () => {
  const design = await readFile(
    fromRoot('docs', '全局文档', '项目工程组织方案.md'),
    'utf8',
  )
  const requiredFacts = [
    'moduleFormat = "cjs"',
    '`server/test/app.e2e-spec.ts`',
    '当前 `scripts/check.mjs`',
    '`server/openapi/openapi.json`',
    '`web/openapi/openapi.json`',
    '`node --run contract:sync`',
    '`node --run contract:check`',
    '`pnpm -C web api:generate`',
    '环境变量模板已经纳入 Git',
  ]

  assert.deepEqual(
    requiredFacts.filter(fact => !design.includes(fact)),
    [],
  )
  assert.doesNotMatch(design, /HTTP 端到端测试放在 `test\/e2e\/`/)
  assert.doesNotMatch(design, /OpenAPI 契约能力将在阶段四实施/)
  assert.doesNotMatch(design, /`api:generate` 尚未实施/)
  assert.doesNotMatch(design, /当前仓库尚无 `contract:sync`/)
  assert.doesNotMatch(design, /最终运行时验收待完成/)
  assert.doesNotMatch(design, /Blob media type 不冲突/)
})

test('Server 文档限定 workspace 注入只服务现代 production deploy', async () => {
  const documentPaths = [
    'server/README.md',
    'server/AGENTS.md',
    'docs/后端文档/后端架构.md',
  ]

  for (const documentPath of documentPaths) {
    const document = await readFile(fromRoot(documentPath), 'utf8')
    assert.ok(
      document.includes('`injectWorkspacePackages` 只服务现代 production deploy'),
      `${documentPath} 必须限定 workspace 注入用途`,
    )
    assert.ok(document.includes('injectWorkspacePackages: true'))
    assert.ok(
      document.includes('`pnpm deploy --prod`'),
      `${documentPath} 缺少现代 deploy 命令`,
    )
    assert.ok(
      document.includes('不得使用 `--legacy`'),
      `${documentPath} 必须拒绝 legacy deploy`,
    )
    assert.doesNotMatch(
      document,
      /pnpm-workspace\.yaml[^\n。]*仅承载[^\n。]*安全配置/u,
      `${documentPath} 不得保留仅有安装安全配置的陈旧表述`,
    )
  }
})

test('工程方案记录三 Workflow、双端重建和本地与平台验收边界', async () => {
  const design = await readFile(
    fromRoot('docs', '全局文档', '项目工程组织方案.md'),
    'utf8',
  )
  const currentFacts = markdownSection(design, '## 2. 当前工程事实')
  const ciSection = markdownSection(design, '## 12. 当前 CI 与发布流程')
  const releaseSection = markdownSection(design, '## 13. 构建、部署与 Release Manifest')
  const requiredFacts = [
    '`.github/workflows/ci.yml`',
    '`.github/workflows/examples.yml`',
    '`.github/workflows/release.yml`',
    '`release/manifest.schema.json`',
    '`injectWorkspacePackages`',
  ]

  assert.deepEqual(requiredFacts.filter(fact => !currentFacts.includes(fact)), [])
  for (const fact of [
    '| 状态 | 已全部完成 |',
    '| 完成日期 | 2026-07-14 |',
    '| 当前产品版本 | `v0.1.2` |',
    '| 当前正式版本 Source Commit | `ec418b8a7dca9c0da51770f6559813f3c7059077` |',
    'Server release archive packaging',
    'Main CI Run `29317624359`',
    'Release Run `29317866199`',
    '[项目工程组织方案分阶段落地]',
  ]) {
    assert.ok(design.includes(fact), `工程方案缺少完成事实：${fact}`)
  }
  for (const fact of [
    '`ci.yml`',
    '`examples.yml`',
    '`release.yml`',
    '`ci-gate`',
    '不按路径跳过',
  ]) {
    assert.ok(ciSection.includes(fact), `当前 CI 章节缺少：${fact}`)
  }
  for (const fact of [
    '同一 Tag Commit',
    'qsmds-web-vX.Y.Z.tar.gz',
    'qsmds-server-vX.Y.Z-linux-x64.tar.gz',
    'release-manifest.json',
    'SHA256SUMS',
  ]) {
    assert.ok(releaseSection.includes(fact), `当前 Release 章节缺少：${fact}`)
  }

  for (const stale of [
    /ci-server\.yml/,
    /ci-web\.yml/,
    /ci-contract\.yml/,
    /ci-examples\.yml/,
    /`server\/\*\*` 变化时/,
    /`web\/\*\*`[^\n]*变化时/,
    /只发布 Web 时，Server 可以继续引用上一产品版本/,
    /未变化的组件重新构建或改版本/,
    /阶段五 CI 设计（尚未实施）/,
    /阶段 5：CI 与发布（待实施）/,
  ]) {
    assert.doesNotMatch(design, stale)
  }
  const implementationResult = markdownSection(
    design,
    '## 16. 实施结果与历史归档',
  )
  for (const phase of ['阶段一', '阶段二', '阶段三', '阶段四', '阶段五']) {
    assert.match(
      implementationResult,
      new RegExp(`^[^\\n]*${phase}[^\\n]*完成[^\\n]*$`, 'mu'),
      `工程方案缺少${phase}完成摘要`,
    )
  }
  assert.ok(implementationResult.includes('[项目工程组织方案分阶段落地]'))
})

test('阶段五历史设计保留实施计划链接并冻结已确认 EARS 需求', async () => {
  const design = await readFile(
    fromRoot(
      'docs',
      '工程归档',
      '项目工程组织方案分阶段落地',
      '阶段五CI与发布设计.md',
    ),
    'utf8',
  )
  const location = markdownSection(design, '## 1. 文档定位')
  const requirements = markdownSection(design, '## 5. EARS 需求')

  assert.ok(
    location.includes(
      '[阶段五 CI 与发布实施计划](./阶段五CI与发布实施计划.md)',
    ),
  )
  assert.doesNotMatch(location, /不声称相关能力已经落地|仓库仍没有/)
  // 需求章节是已经确认的设计输入；Task 13 只能更新实施状态，不得顺手改写 REQ。
  assert.equal(
    createHash('sha256').update(requirements).digest('hex'),
    '356740f4767a383461762f3d936335a2eab3c7cb32150c0bd63040c856554386',
    '已经确认的 REQ-001 至 REQ-054 不得在文档收口时改写',
  )
})

test('发布与版本管理文档覆盖平台基线、完整发布、恢复与外部配置边界', async () => {
  const guide = await readFile(
    fromRoot('docs', '全局文档', '发布与版本管理.md'),
    'utf8',
  )
  const requiredFactsBySection = [
    [
      '## 1. 状态与边界',
      [
        '`v0.1.2`',
        '`ec418b8a7dca9c0da51770f6559813f3c7059077`',
        '29317624359',
        '29240879781',
        '29317866199',
        'attempt 2',
      ],
    ],
    [
      '## 2. 产品版本与准备',
      [
        '`package.json.version`',
        '`server/package.json.version`',
        '`web/apps/qsmds-arco/package.json.version`',
        '`web/package.json.version = 6.3.0`',
        'Fantastic Admin',
        '单独确认',
        '`contract:sync`',
        '版本准备 Commit',
      ],
    ],
    [
      '## 3. Annotated Tag',
      ['annotated Tag', '`origin/main`', '禁止移动', '禁止复用'],
    ],
    [
      '## 4. GitHub Actions 工作流',
      [
        '`ci.yml`',
        '`examples.yml`',
        '`release.yml`',
        '`ci-gate`',
        'Required Check',
        '非阻断',
        '双端 package Job 并行',
        'Actions 默认 `contents: read`',
      ],
    ],
    [
      '## 5. Release 附件与校验',
      [
        '`qsmds-web-vX.Y.Z.tar.gz`',
        '`qsmds-server-vX.Y.Z-linux-x64.tar.gz`',
        '`release-manifest.json`',
        '`SHA256SUMS`',
        '四个固定附件',
      ],
    ],
    [
      '## 6. Server 兼容范围',
      ['Ubuntu 24.04', 'glibc', 'x64', 'Node 24', 'Alpine/musl'],
    ],
    [
      '## 7. Draft 恢复与不可变发布',
      [
        '只重跑失败的 `publish` Job',
        'artifact ID',
        'artifact digest',
        '人工核对',
        '未发布 Draft',
        '新的 Patch 版本',
        '`v0.1.2`',
        'Release Run `29317866199`',
        'attempt `2`',
        '自然恢复',
      ],
    ],
    [
      '## 8. Migration 与部署边界',
      ['只向前', '不连接生产数据库', '不执行生产 migration', '不自动部署'],
    ],
    [
      '## 9. 平台治理基线',
      [
        '`ci-gate`',
        'Required Check',
        '`v*.*.*`',
        'Tag ruleset',
        'Release immutability',
        '`contents: read`',
      ],
    ],
  ]

  for (const [heading, facts] of requiredFactsBySection) {
    const section = markdownSection(guide, heading)
    assert.deepEqual(
      facts.filter(fact => !section.includes(fact)),
      [],
      `发布文档章节缺少事实：${heading}`,
    )
  }

  const tagSection = markdownSection(guide, '## 3. Annotated Tag')
  const orderedTagCommands = [
    ': "${RELEASE_VERSION:?RELEASE_VERSION must be an approved stable version}"',
    'git fetch origin main --tags',
    'source_commit="$(git rev-parse refs/remotes/origin/main)"',
    'git tag -a "v${RELEASE_VERSION}" "$source_commit" -m "千树 DMS v${RELEASE_VERSION}"',
    'test "$(git cat-file -t "refs/tags/v${RELEASE_VERSION}")" = tag',
    'test "$(git rev-parse "v${RELEASE_VERSION}^{commit}")" = "$source_commit"',
    'node --run release:check -- --tag "v${RELEASE_VERSION}" --source-commit "$source_commit"',
    'git push origin "v${RELEASE_VERSION}"',
  ]
  let previousCommandOffset = -1
  for (const command of orderedTagCommands) {
    assertBashCodeLine(tagSection, command)
    const commandOffset = tagSection.indexOf(command)
    assert.ok(
      commandOffset > previousCommandOffset,
      `Annotated Tag 安全命令顺序错误：${command}`,
    )
    previousCommandOffset = commandOffset
  }

  const assetSection = markdownSection(guide, '## 5. Release 附件与校验')
  for (const command of [
    ': "${RELEASE_TAG:?RELEASE_TAG must be an existing published version}"',
    'gh release download "$RELEASE_TAG" --dir "$release_dir"',
    '(cd "$release_dir" && sha256sum -c SHA256SUMS)',
    '(cd "$release_dir" && shasum -a 256 -c SHA256SUMS)',
  ]) {
    assertBashCodeLine(assetSection, command)
  }

  assert.doesNotMatch(
    guide,
    /v0\.0\.0|git tag -f|git push (?:--force|-f)|gh release delete|DATABASE_URL=postgres|ghp_|github_pat_/,
  )
})

test('后端架构文档记录当前运行时、接口契约、安全与测试边界', async () => {
  const architecture = await readFile(
    fromRoot('docs', '后端文档', '后端架构.md'),
    'utf8',
  )
  const requiredFactsBySection = [
    ['## 1. 文档定位', ['CommonJS']],
    ['## 2. 工程与依赖边界', ['`server/pnpm-workspace.yaml`', '`allowBuilds`']],
    ['## 4. 启动配置与 HTTP 基线', ['`ValidationPipe`', '`422`']],
    [
      '## 5. Prisma 与 PostgreSQL 生命周期',
      [
        '`PrismaPg`',
        '`pg.Pool`',
        '`Database initialization failed`',
        '`Database shutdown failed`',
        '`DEBUG`',
        '`prisma:*`',
      ],
    ],
    [
      '## 6. 健康检查',
      ['`GET /api/health`', 'Terminus', '全局成功 envelope', '`X-Request-Id`'],
    ],
    [
      '## 7. 接口契约与 OpenAPI',
      [
        '`ApiError`',
        '`operationId`',
        '`x-qianshu-contract`',
        '`server/openapi/openapi.json`',
        '不开放 Swagger route',
      ],
    ],
  ]

  for (const [heading, facts] of requiredFactsBySection) {
    const section = markdownSection(architecture, heading)
    assert.deepEqual(
      facts.filter(fact => !section.includes(fact)),
      [],
      `后端架构章节缺少事实：${heading}`,
    )
  }

  const healthSection = markdownSection(architecture, '## 6. 健康检查')
  assert.match(healthSection, /^当前提供 `GET \/api\/health`。/m)
  assert.doesNotMatch(healthSection, /(?:尚未|未|没有)提供.*GET \/api\/health/)
  assert.doesNotMatch(architecture, /OpenAPI 契约将在阶段四实施/)
  assert.doesNotMatch(architecture, /这些接口契约能力将在阶段四/)
})

test('后端接口契约规范记录 Request ID、ApiError、OpenAPI 与安全边界', async () => {
  const guide = await readFile(
    fromRoot('docs', '后端文档', '接口契约规范.md'),
    'utf8',
  )
  const requiredFactsBySection = [
    [
      '## 1. 契约真相源',
      [
        'Controller',
        'DTO',
        'OpenAPI decorators',
        '`server/openapi/openapi.json`',
      ],
    ],
    [
      '## 2. Request ID 与 ApiError',
      [
        '`X-Request-Id`',
        'Server-generated',
        '`ApiError`',
        '`fieldErrors`',
        '`422`',
        '`REQUEST_REJECTED`',
        '中文',
        'health',
        'Terminus',
      ],
    ],
    [
      '## 3. OpenAPI 响应描述',
      [
        '`operationId`',
        '`x-qianshu-contract`',
        '`ApiContractResponse`',
        '`204`',
        'binary',
        '`ApiApplicationContract`',
      ],
    ],
    [
      '## 4. 生成、同步与检查',
      [
        'preview',
        '`openapi:generate`',
        '`contract:sync`',
        '`contract:check`',
        '不读取 `.env`',
        '不连接数据库',
        '不监听端口',
      ],
    ],
    [
      '## 5. 安全边界',
      ['不开放 Swagger route', '密码', '连接字符串', '堆栈'],
    ],
  ]

  for (const [heading, facts] of requiredFactsBySection) {
    const section = markdownSection(guide, heading)
    assert.deepEqual(
      facts.filter(fact => !section.includes(fact)),
      [],
      `后端接口契约章节缺少事实：${heading}`,
    )
  }
})

test('前端接口接入规范记录类型、响应、错误、重试、取消与 fake 边界', async () => {
  const guide = await readFile(
    fromRoot('docs', '前端文档', '接口接入规范.md'),
    'utf8',
  )
  const requiredFactsBySection = [
    [
      '## 1. 快照与类型生成',
      [
        '`web/openapi/openapi.json`',
        '`api:generate`',
        '`apps/qsmds-arco/src/api/generated/`',
        '`types.gen.ts`',
        '不得手工修改',
      ],
    ],
    [
      '## 2. 成功响应',
      ['`HealthGetResponses[200]`', '`AxiosResponse<T>`', '`res.data`'],
    ],
    [
      '## 3. 错误与 Blob',
      [
        '`ApiClientError`',
        '`1 MiB`',
        '`Content-Type`',
        '`Blob.type`',
        '不读取或要求',
        '`application/json`',
        '`401`',
        '`403`',
      ],
    ],
    [
      '## 4. 重试与取消',
      [
        '`GET`',
        '`HEAD`',
        '`OPTIONS`',
        '`PUT`',
        '`502`',
        '`503`',
        '`504`',
        '`Retry-After`',
        '`500/1000/2000 ms`',
        '`CanceledError`',
      ],
    ],
    [
      '## 5. Fake 与网络前提',
      [
        '裸 DTO',
        '`401 ApiError`',
        '同源',
        '反向代理',
        '不声称支持跨域',
        '`Access-Control-Expose-Headers: X-Request-Id, Retry-After`',
      ],
    ],
  ]

  for (const [heading, facts] of requiredFactsBySection) {
    const section = markdownSection(guide, heading)
    assert.deepEqual(
      facts.filter(fact => !section.includes(fact)),
      [],
      `前端接口接入章节缺少事实：${heading}`,
    )
  }

  assert.match(guide, /默认生成失败不承诺恢复旧目录/)
  assert.doesNotMatch(guide, /Blob 自身 media type 不与响应 Header 冲突/)
  assert.doesNotMatch(guide, /失败时恢复原目录/)
})

test('前端架构与协作文档使用当前契约时态并固定生成规则', async () => {
  const architecture = await readFile(
    fromRoot('docs', '前端文档', '前端架构.md'),
    'utf8',
  )
  const contractSection = markdownSection(architecture, '## 8. 前后端契约')
  const webReadme = await readFile(fromRoot('web', 'README.md'), 'utf8')
  const agents = await readFile(fromRoot('web', 'AGENTS.md'), 'utf8')
  const agentContractSection = markdownSection(agents, '## 前后端契约')
  const requiredCurrentFacts = [
    '`web/openapi/openapi.json`',
    '`api:generate`',
    '`apps/qsmds-arco/src/api/generated/`',
    '`types.gen.ts`',
    '`contract:sync`',
    '`contract:check`',
  ]

  for (const document of [contractSection, webReadme, agentContractSection]) {
    assert.deepEqual(
      requiredCurrentFacts.filter(fact => !document.includes(fact)),
      [],
    )
  }

  const staleDescriptions = [
    'OpenAPI 客户端生成在阶段四实施',
    'OpenAPI 客户端生成将在阶段四落地',
    '当前工作区尚未提供 `api:generate`',
    'OpenAPI 客户端生成安排在阶段四实施',
    '当前不得假设 `api:generate` 已存在',
  ]
  for (const document of [architecture, webReadme, agents]) {
    assert.deepEqual(
      staleDescriptions.filter(description => document.includes(description)),
      [],
    )
  }

  assertBashCodeLine(agentContractSection, 'node --run contract:sync')
  assertBashCodeLine(agentContractSection, 'node --run contract:check')
  assertBashCodeLine(agentContractSection, 'pnpm -C web api:generate')
  for (const fact of [
    '`lint`',
    '`typecheck`',
    '`build`',
    '`build:test`',
    '`test:api`',
    '`apps/qsmds-arco/src/api/index.ts`',
    '唯一生产 Axios Client',
    '`AxiosResponse<T>`',
    '`res.data`',
  ]) {
    assert.ok(agentContractSection.includes(fact), `web/AGENTS.md 缺少：${fact}`)
  }
})

test('根与 Server 入口文档记录当前契约命令和运行时事实', async () => {
  const rootReadme = await readFile(fromRoot('README.md'), 'utf8')
  const serverReadme = await readFile(fromRoot('server', 'README.md'), 'utf8')
  const serverAgents = await readFile(fromRoot('server', 'AGENTS.md'), 'utf8')
  const contractSection = markdownSection(rootReadme, '## 接口契约')

  assertBashCodeLine(contractSection, 'node --run contract:sync')
  assertBashCodeLine(contractSection, 'node --run contract:check')
  assertBashCodeLine(contractSection, 'pnpm -C web api:generate')
  assert.ok(
    contractSection.includes('`web/apps/qsmds-arco/src/api/generated/types.gen.ts`'),
  )

  const requiredServerFacts = [
    '`server/openapi/openapi.json`',
    '`openapi:generate`',
    '`X-Request-Id`',
    '`ApiError`',
    '不开放 Swagger route',
  ]
  for (const document of [serverReadme, serverAgents]) {
    assert.deepEqual(
      requiredServerFacts.filter(fact => !document.includes(fact)),
      [],
    )
  }
  assert.ok(serverReadme.includes('preview application 本身不读取 `.env`'))
  assert.doesNotMatch(
    serverReadme,
    /`openapi:generate`[^\n]*过程不读取 `\.env`/,
  )
})

test('数据库迁移规范记录不可变迁移、安全验证和向前修复规则', async () => {
  const migrationGuide = await readFile(
    fromRoot('docs', '后端文档', '数据库迁移规范.md'),
    'utf8',
  )
  const requiredFactsBySection = [
    [
      '## 1. 目的与真相源',
      ['`prisma/schema.prisma`', '`prisma/migrations/`', '`src/generated/prisma/`'],
    ],
    ['## 2. 当前迁移基线', ['`20260710152144_init`', 'PostgreSQL 16']],
    ['## 3. 不可变与只追加原则', ['向前修复']],
    [
      '## 4. 命令使用边界',
      [
        '`prisma migrate dev`',
        '`prisma migrate deploy`',
        '`prisma migrate status`',
        '`prisma db push`',
      ],
    ],
    ['## 5. 空库部署验证', ['`_prisma_migrations`']],
    [
      '## 6. 临时 PostgreSQL 安全流程',
      ['`trap`', '`127.0.0.1`', '`DATABASE_URL`'],
    ],
  ]

  for (const [heading, facts] of requiredFactsBySection) {
    const section = markdownSection(migrationGuide, heading)
    assert.deepEqual(
      facts.filter(fact => !section.includes(fact)),
      [],
      `数据库迁移章节缺少事实：${heading}`,
    )
  }
})

test('数据库迁移命令要求显式临时 URL 且禁止回退本地 .env', async () => {
  const migrationGuide = await readFile(
    fromRoot('docs', '后端文档', '数据库迁移规范.md'),
    'utf8',
  )
  const commandSection = markdownSection(migrationGuide, '## 4. 命令使用边界')
  const requiredGuards = [
    ': "${DATABASE_URL:?DATABASE_URL must reference the isolated database}"',
    'export DOTENV_CONFIG_PATH=/dev/null',
    'unset DEBUG',
    'unset PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION',
  ]

  for (const guard of requiredGuards) {
    assertBashCodeLine(commandSection, guard)
  }
})

test('Git 忽略真实环境文件、系统文件和生成目录，但保留环境模板', () => {
  const ignoredPaths = [
    'server/.env',
    'web/apps/qsmds-arco/.env.development',
    '.DS_Store',
    'docs/.DS_Store',
    'server/src/generated/prisma/client.ts',
    'web/apps/qsmds-arco/src/api/generated/schema.d.ts',
  ]
  const trackedTemplatePaths = [
    'server/.env.example',
    'server/.env.test.example',
  ]

  for (const file of ignoredPaths) {
    assert.equal(checkIgnore(file), 0, `路径应被 Git 忽略：${file}`)
  }
  for (const file of trackedTemplatePaths) {
    assert.equal(checkIgnore(file), 1, `环境模板不应被 Git 忽略：${file}`)
  }
})
