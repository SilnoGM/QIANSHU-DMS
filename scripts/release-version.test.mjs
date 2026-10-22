import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  STABLE_TAG_PATTERN,
  compareVersions,
  parseReleaseVersionArguments,
  parseStableVersion,
  readProductVersions,
  runReleaseVersionCli,
  verifyReleaseVersion,
} from './release-version.mjs'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const entrypoint = path.join(scriptsDirectory, 'release-version.mjs')
// 用户视角的 Release 文案样本：不含技术词汇、代码标识符、路径或提交号。
const releaseNotesFixture = '本版影响角色：运营人员\n\n功能新增\n- 【运营人员】订单列表可以直接按柜号筛选\n\n功能优化\n- 无\n\n缺陷修复\n- 【运营人员】修复了登录状态过期后部分页面出错的问题\n\n已知问题\n- 无'

function gitResult(repositoryRoot, args, options = {}) {
  const result = spawnSync('git', args, {
    cwd: repositoryRoot,
    encoding: null,
    input: options.input,
  })
  if (result.error) {
    throw result.error
  }
  return {
    exitCode: result.status,
    stderr: result.stderr ?? Buffer.alloc(0),
    stdout: result.stdout ?? Buffer.alloc(0),
  }
}

function mustGit(repositoryRoot, args, options) {
  const result = gitResult(repositoryRoot, args, options)
  assert.equal(
    result.exitCode,
    0,
    `Git fixture command failed: git ${args.join(' ')}\n${result.stderr}`,
  )
  return result.stdout.toString('utf8').trim()
}

async function createGitFixture(t) {
  const temporaryRoot = await fs.realpath(os.tmpdir())
  const sandbox = await fs.mkdtemp(
    path.join(temporaryRoot, 'qianshu-release-version-test-'),
  )
  const origin = path.join(sandbox, 'origin.git')
  const repositoryRoot = path.join(sandbox, 'repository')
  const runnerTemp = path.join(sandbox, 'runner-temp')
  await fs.mkdir(repositoryRoot)
  await fs.mkdir(runnerTemp)
  mustGit(sandbox, ['init', '--bare', '--initial-branch=main', origin])
  mustGit(repositoryRoot, ['init', '--initial-branch=main'])
  mustGit(repositoryRoot, ['config', 'user.name', 'Qianshu Release Fixture'])
  mustGit(
    repositoryRoot,
    ['config', 'user.email', 'release-fixture@example.invalid'],
  )
  mustGit(repositoryRoot, ['remote', 'add', 'origin', origin])
  t.after(() => fs.rm(sandbox, { force: true, recursive: true }))
  return { origin, repositoryRoot, runnerTemp, sandbox }
}

function jsonBytes(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

async function writeProductFiles(repositoryRoot, version, overrides = {}) {
  const versions = {
    root: version,
    server: version,
    serverOpenApi: version,
    webApp: version,
    webOpenApi: version,
    ...overrides.versions,
  }
  const serverOpenApi = jsonBytes({
    info: { title: 'Qianshu Server', version: versions.serverOpenApi },
    openapi: '3.0.3',
    paths: {},
  })
  const webOpenApi = overrides.webOpenApiBytes ?? jsonBytes({
    info: { title: 'Qianshu Server', version: versions.webOpenApi },
    openapi: '3.0.3',
    paths: {},
  })
  const files = new Map([
    ['package.json', jsonBytes({ name: 'qianshu-dms', version: versions.root })],
    [
      'server/package.json',
      jsonBytes({ name: 'qianshu-server', version: versions.server }),
    ],
    [
      'web/apps/qsmds-arco/package.json',
      jsonBytes({ name: 'qsmds-arco', version: versions.webApp }),
    ],
    ['server/openapi/openapi.json', serverOpenApi],
    ['web/openapi/openapi.json', webOpenApi],
  ])
  // 用户视角的 Release 文案必须随版本准备一起进入被 Tag 的提交；null 表示故意不写。
  const releaseNotes = overrides.releaseNotes === undefined
    ? releaseNotesFixture
    : overrides.releaseNotes
  if (releaseNotes !== null) {
    files.set(
      path.join('release', 'notes', `v${version}.md`),
      `${releaseNotes}\n`,
    )
  }

  for (const [relativePath, contents] of files) {
    const target = path.join(repositoryRoot, relativePath)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, contents)
  }
}

async function commitProductVersion(
  repositoryRoot,
  version,
  message,
  overrides,
) {
  await writeProductFiles(repositoryRoot, version, overrides)
  mustGit(repositoryRoot, ['add', '--all'])
  mustGit(repositoryRoot, ['commit', '-m', message])
  return mustGit(repositoryRoot, ['rev-parse', 'HEAD'])
}

function createAnnotatedTag(repositoryRoot, tag, target = 'HEAD') {
  mustGit(repositoryRoot, [
    'tag',
    '--annotate',
    tag,
    target,
    '--message',
    `release ${tag}`,
  ])
  return mustGit(repositoryRoot, ['rev-parse', `refs/tags/${tag}`])
}

async function createValidReleaseFixture(t) {
  const fixture = await createGitFixture(t)
  const historicalCommit = await commitProductVersion(
    fixture.repositoryRoot,
    '1.0.0',
    'release 1.0.0',
  )
  createAnnotatedTag(fixture.repositoryRoot, 'v1.0.0', historicalCommit)
  const sourceCommit = await commitProductVersion(
    fixture.repositoryRoot,
    '1.2.3',
    'release 1.2.3',
  )
  const tagObjectSha = createAnnotatedTag(
    fixture.repositoryRoot,
    'v1.2.3',
    sourceCommit,
  )
  mustGit(fixture.repositoryRoot, [
    'push',
    '--set-upstream',
    'origin',
    'main',
  ])
  return {
    ...fixture,
    historicalCommit,
    sourceCommit,
    tagObjectSha,
    tag: 'v1.2.3',
    version: '1.2.3',
  }
}

function verificationInput(fixture, overrides = {}) {
  return {
    sourceCommit: fixture.sourceCommit,
    tag: fixture.tag,
    ...overrides,
  }
}

function verificationDependencies(fixture, overrides = {}) {
  return {
    fileSystem: fs,
    repositoryRoot: fixture.repositoryRoot,
    ...overrides,
  }
}

test('稳定 SemVer 与 Tag pattern 只接受规范安全版本并数字排序', () => {
  assert.equal(STABLE_TAG_PATTERN.test('v0.0.0'), true)
  assert.equal(STABLE_TAG_PATTERN.test('v12.3.45'), true)
  assert.deepEqual(parseStableVersion('1.2.3'), [1, 2, 3])
  assert.equal(Object.isFrozen(parseStableVersion('1.2.3')), true)
  assert.equal(compareVersions([1, 10, 0], [1, 2, 99]), 8)
  assert.equal(compareVersions([1, 2, 3], [1, 2, 3]), 0)

  for (const value of [
    'v1.2',
    '1.2.3',
    'v1.2.3-rc.1',
    'v1.2.3+build',
    'v01.2.3',
    'v1.02.3',
    'v1.2.03',
  ]) {
    assert.equal(STABLE_TAG_PATTERN.test(value), false)
  }
  for (const value of [
    '1.2',
    '1.2.3-rc.1',
    '1.2.3+build',
    '01.2.3',
    '1.02.3',
    '1.2.03',
    '9007199254740992.0.0',
  ]) {
    assert.throws(() => parseStableVersion(value))
  }
})

test('readProductVersions 读取固定五个版本且验证双快照 raw bytes', async (t) => {
  const fixture = await createGitFixture(t)
  await writeProductFiles(fixture.repositoryRoot, '1.2.3')

  const result = await readProductVersions(fs, fixture.repositoryRoot)

  assert.equal(Object.isFrozen(result), true)
  assert.deepEqual(result, {
    root: '1.2.3',
    server: '1.2.3',
    serverOpenApi: '1.2.3',
    webApp: '1.2.3',
    webOpenApi: '1.2.3',
  })

  await fs.writeFile(
    path.join(fixture.repositoryRoot, 'web', 'package.json'),
    jsonBytes({ version: '999.0.0' }),
  )
  assert.deepEqual(
    await readProductVersions(fs, fixture.repositoryRoot),
    result,
  )
})

test('任一产品版本不一致、双快照字节不同或 JSON 非法都拒绝且脱敏', async (t) => {
  const fixture = await createGitFixture(t)
  const versionKeys = [
    'root',
    'server',
    'webApp',
    'serverOpenApi',
    'webOpenApi',
  ]

  for (const key of versionKeys) {
    await writeProductFiles(fixture.repositoryRoot, '1.2.3', {
      versions: { [key]: '1.2.4' },
    })
    await assert.rejects(
      readProductVersions(fs, fixture.repositoryRoot),
    )
  }

  const sameDocument = {
    info: { title: 'Qianshu Server', version: '1.2.3' },
    openapi: '3.0.3',
    paths: {},
  }
  await writeProductFiles(fixture.repositoryRoot, '1.2.3', {
    webOpenApiBytes: JSON.stringify(sameDocument),
  })
  await assert.rejects(
    readProductVersions(fs, fixture.repositoryRoot),
    /snapshot bytes/u,
  )

  const secret = 'release-version-json-secret'
  await fs.writeFile(
    path.join(fixture.repositoryRoot, 'package.json'),
    `{ invalid ${secret}`,
  )
  await assert.rejects(
    readProductVersions(fs, fixture.repositoryRoot),
    error => !error.message.includes(secret),
  )
})

test('verifyReleaseVersion 返回冻结的产品与 annotated Tag 身份', async (t) => {
  const fixture = await createValidReleaseFixture(t)

  const result = await verifyReleaseVersion(
    verificationInput(fixture),
    verificationDependencies(fixture),
  )

  assert.equal(Object.isFrozen(result), true)
  assert.deepEqual(result, {
    version: '1.2.3',
    tag: 'v1.2.3',
    tagObjectSha: fixture.tagObjectSha,
    sourceCommit: fixture.sourceCommit,
  })
})

test('当前 annotated Tag Git 身份命令保持固定顺序与 argv', async (t) => {
  const fixture = await createValidReleaseFixture(t)
  const calls = []
  const git = async args => {
    calls.push([...args])
    return gitResult(fixture.repositoryRoot, args)
  }

  await verifyReleaseVersion(
    verificationInput(fixture),
    verificationDependencies(fixture, { git }),
  )

  assert.deepEqual(calls.slice(0, 6), [
    ['cat-file', '-t', 'refs/tags/v1.2.3'],
    ['cat-file', 'tag', 'refs/tags/v1.2.3'],
    ['rev-parse', 'refs/tags/v1.2.3'],
    ['rev-parse', 'refs/tags/v1.2.3^{commit}'],
    ['rev-parse', 'refs/remotes/origin/main'],
    [
      'merge-base',
      '--is-ancestor',
      fixture.sourceCommit,
      'refs/remotes/origin/main',
    ],
  ])
})

test('verifyReleaseVersion 精确拒绝 input shape、Tag 与 source SHA', async (t) => {
  const fixture = await createValidReleaseFixture(t)
  const invalidInputs = [
    { sourceCommit: fixture.sourceCommit, tag: 'v1.2' },
    { sourceCommit: fixture.sourceCommit, tag: '1.2.3' },
    { sourceCommit: fixture.sourceCommit, tag: 'v1.2.3-rc.1' },
    { sourceCommit: fixture.sourceCommit, tag: 'v1.2.3+build' },
    { sourceCommit: fixture.sourceCommit.slice(0, 12), tag: fixture.tag },
    { ...verificationInput(fixture), githubContext: { token: 'secret' } },
  ]

  for (const input of invalidInputs) {
    await assert.rejects(
      verifyReleaseVersion(input, verificationDependencies(fixture)),
    )
  }
})

test('拒绝 lightweight、非 Commit target、递归 Tag 与 header tag 漂移', async (t) => {
  const cases = [
    {
      name: 'lightweight',
      createTag(repositoryRoot, sourceCommit) {
        mustGit(repositoryRoot, ['tag', 'v1.2.3', sourceCommit])
      },
    },
    {
      name: 'blob target',
      createTag(repositoryRoot) {
        const blob = mustGit(repositoryRoot, ['rev-parse', 'HEAD:package.json'])
        createAnnotatedTag(repositoryRoot, 'v1.2.3', blob)
      },
    },
    {
      name: 'recursive tag target',
      createTag(repositoryRoot, sourceCommit) {
        createAnnotatedTag(repositoryRoot, 'v1.2.2', sourceCommit)
        createAnnotatedTag(repositoryRoot, 'v1.2.3', 'refs/tags/v1.2.2')
      },
    },
    {
      name: 'header tag drift',
      createTag(repositoryRoot, sourceCommit) {
        const tagObject = createAnnotatedTag(
          repositoryRoot,
          'v1.2.2',
          sourceCommit,
        )
        mustGit(repositoryRoot, [
          'update-ref',
          'refs/tags/v1.2.3',
          tagObject,
        ])
      },
    },
  ]

  for (const fixtureCase of cases) {
    await t.test(fixtureCase.name, async (nestedT) => {
      const fixture = await createGitFixture(nestedT)
      const sourceCommit = await commitProductVersion(
        fixture.repositoryRoot,
        '1.2.3',
        fixtureCase.name,
      )
      fixtureCase.createTag(fixture.repositoryRoot, sourceCommit)
      mustGit(fixture.repositoryRoot, [
        'push',
        '--set-upstream',
        'origin',
        'main',
      ])

      await assert.rejects(
        verifyReleaseVersion(
          { sourceCommit, tag: 'v1.2.3' },
          verificationDependencies(fixture),
        ),
      )
    })
  }
})

test('peeled Commit 必须等于完整 sourceCommit', async (t) => {
  const fixture = await createValidReleaseFixture(t)

  await assert.rejects(
    verifyReleaseVersion(
      verificationInput(fixture, {
        sourceCommit: fixture.historicalCommit,
      }),
      verificationDependencies(fixture),
    ),
  )
})

test('peeled Commit 与 sourceCommit 正确时仍必须等于当前 checkout', async (t) => {
  const fixture = await createValidReleaseFixture(t)
  mustGit(fixture.repositoryRoot, [
    'commit',
    '--allow-empty',
    '--message',
    'checkout moved after tag',
  ])
  mustGit(fixture.repositoryRoot, ['push', 'origin', 'main'])

  await assert.rejects(
    verifyReleaseVersion(
      verificationInput(fixture),
      verificationDependencies(fixture),
    ),
  )
})

test('source Commit 必须可从已取得的 origin/main 到达', async (t) => {
  const fixture = await createGitFixture(t)
  await commitProductVersion(
    fixture.repositoryRoot,
    '1.0.0',
    'main base',
  )
  mustGit(fixture.repositoryRoot, [
    'push',
    '--set-upstream',
    'origin',
    'main',
  ])
  mustGit(fixture.repositoryRoot, ['switch', '--create', 'feature'])
  const sourceCommit = await commitProductVersion(
    fixture.repositoryRoot,
    '1.2.3',
    'feature release',
  )
  createAnnotatedTag(fixture.repositoryRoot, 'v1.2.3', sourceCommit)

  await assert.rejects(
    verifyReleaseVersion(
      { sourceCommit, tag: 'v1.2.3' },
      verificationDependencies(fixture),
    ),
  )
})

test('当前版本必须严格大于当前 Commit 可达的最高历史稳定 Tag', async (t) => {
  const fixture = await createValidReleaseFixture(t)
  createAnnotatedTag(
    fixture.repositoryRoot,
    'v2.0.0',
    fixture.historicalCommit,
  )

  await assert.rejects(
    verifyReleaseVersion(
      verificationInput(fixture),
      verificationDependencies(fixture),
    ),
  )
})

test('历史 prerelease/非法与不可达稳定 Tag 不污染稳定版本排序', async (t) => {
  const fixture = await createValidReleaseFixture(t)
  createAnnotatedTag(
    fixture.repositoryRoot,
    'v99.0.0-rc.1',
    fixture.historicalCommit,
  )
  createAnnotatedTag(
    fixture.repositoryRoot,
    'v-not-a-version',
    fixture.historicalCommit,
  )
  mustGit(fixture.repositoryRoot, ['switch', '--create', 'future'])
  const futureCommit = await commitProductVersion(
    fixture.repositoryRoot,
    '9.0.0',
    'future release',
  )
  createAnnotatedTag(fixture.repositoryRoot, 'v9.0.0', futureCommit)
  mustGit(fixture.repositoryRoot, ['switch', 'main'])

  const result = await verifyReleaseVersion(
    verificationInput(fixture),
    verificationDependencies(fixture),
  )
  assert.equal(result.version, '1.2.3')
})

test('历史稳定 Tag 若为 lightweight 或不可 peel 对象必须失败', async (t) => {
  for (const kind of ['lightweight', 'blob']) {
    await t.test(kind, async (nestedT) => {
      const fixture = await createValidReleaseFixture(nestedT)
      if (kind === 'lightweight') {
        mustGit(fixture.repositoryRoot, [
          'tag',
          'v1.1.0',
          fixture.historicalCommit,
        ])
      } else {
        const blob = mustGit(
          fixture.repositoryRoot,
          ['rev-parse', `${fixture.historicalCommit}:package.json`],
        )
        createAnnotatedTag(fixture.repositoryRoot, 'v1.1.0', blob)
      }

      await assert.rejects(
        verifyReleaseVersion(
          verificationInput(fixture),
          verificationDependencies(fixture),
        ),
      )
    })
  }
})

function rewriteAnnotatedTagMessage(repositoryRoot, tag, message) {
  const target = mustGit(repositoryRoot, ['rev-parse', `refs/tags/${tag}^{commit}`])
  const payload = [
    `object ${target}`,
    'type commit',
    `tag ${tag}`,
    'tagger Qianshu Release Fixture <release-fixture@example.invalid> 1700000000 +0000',
    '',
    message,
  ].join('\n')
  const tagObjectSha = mustGit(
    repositoryRoot,
    ['hash-object', '-t', 'tag', '-w', '--stdin'],
    { input: payload },
  )
  mustGit(repositoryRoot, ['update-ref', `refs/tags/${tag}`, tagObjectSha])
  return tagObjectSha
}

async function rewriteReleaseNotes(fixture, contents) {
  const notesPath = path.join(
    fixture.repositoryRoot,
    'release',
    'notes',
    `${fixture.tag}.md`,
  )
  if (contents === null) {
    await fs.rm(notesPath)
    return notesPath
  }
  await fs.writeFile(notesPath, contents)
  return notesPath
}

test('Tag 技术文案不能为空', async (t) => {
  const fixture = await createValidReleaseFixture(t)
  rewriteAnnotatedTagMessage(fixture.repositoryRoot, fixture.tag, '')
  await assert.rejects(
    verifyReleaseVersion(
      verificationInput(fixture),
      verificationDependencies(fixture),
    ),
    /Annotated Tag message must not be empty/u,
  )
})

test('用户文案缺失、为空、非文本或含技术痕迹时失败关闭', async (t) => {
  // 技术词用例必须先把四个分类与角色标注补齐：否则会先被结构闸门拦下，测不到词表。
  const notesWithBody = (text, section = '缺陷修复') => {
    const sections = { 功能新增: '- 无', 功能优化: '- 无', 缺陷修复: '- 无', 已知问题: '- 无' }
    sections[section] = `- 【运营人员】${text}`
    return `本版影响角色：运营人员\n\n${Object.entries(sections).map(([title, content]) => `${title}\n${content}`).join('\n\n')}`
  }
  const cases = [
    { name: 'missing file', notes: null, expected: /ENOENT/u },
    { name: 'empty file', notes: '\n\n', expected: /must not be empty/u },
    { name: 'binary bytes', notes: Buffer.from([0x61, 0x00, 0x62]), expected: /UTF-8/u },
    {
      name: 'ownership marker',
      notes: '<!-- qianshu-release:{"schemaVersion":1} -->\n',
      expected: /ownership marker/u,
    },
    { name: 'chinese jargon', notes: notesWithBody('修复了缓存导致的加载慢'), expected: /technical vocabulary: 缓存/u },
    { name: 'ascii jargon', notes: notesWithBody('修复了 API 返回异常'), expected: /API/u },
    { name: 'identifier', notes: notesWithBody('修复了 prepare() 的问题'), expected: /function call/u },
    { name: 'file path', notes: notesWithBody('修复了 libs/utils 的问题'), expected: /file path/u },
    { name: 'file name', notes: notesWithBody('修复了 types.gen.ts 的问题'), expected: /file name/u },
    { name: 'constant', notes: notesWithBody('修复了 MEDIA_STORAGE_ENV 的问题'), expected: /constant name/u },
    { name: 'commit hash', notes: notesWithBody('修复了 1b8e02ca 引入的问题'), expected: /commit hash/u },
  ]
  for (const fixtureCase of cases) {
    const fixture = await createValidReleaseFixture(t)
    await rewriteReleaseNotes(fixture, fixtureCase.notes)
    await assert.rejects(
      verifyReleaseVersion(
        verificationInput(fixture),
        verificationDependencies(fixture),
      ),
      fixtureCase.expected,
      fixtureCase.name,
    )
  }
})

test('用户文案必须按四个分类组织：缺分类、重复分类、顺序错乱或留空节都失败关闭', async (t) => {
  const complete = [
    ['功能新增', '- 无'],
    ['功能优化', '- 无'],
    ['缺陷修复', '- 无'],
    ['已知问题', '- 无'],
  ]
  const render = sections => [
    '本版影响角色：无',
    ...sections.map(([title, content]) => `${title}\n${content}`),
  ].join('\n\n')
  const cases = [
    { name: 'missing section', notes: render(complete.slice(0, 3)), expected: /exactly one "已知问题" section, found 0/u },
    { name: 'missing first section', notes: render(complete.slice(1)), expected: /exactly one "功能新增" section, found 0/u },
    { name: 'duplicated section', notes: render([...complete, ['功能新增', '- 又一条']]), expected: /exactly one "功能新增" section, found 2/u },
    { name: 'out of order', notes: render([complete[1], complete[0], complete[2], complete[3]]), expected: /must keep the documented order/u },
    { name: 'empty section body', notes: render(complete.map(([title]) => [title, ''])), expected: /section "功能新增" must not be empty/u },
    { name: 'only the last section empty', notes: render(complete.map(([title, content], index) => [title, index === 3 ? '   ' : content])), expected: /section "已知问题" must not be empty/u },
  ]
  for (const fixtureCase of cases) {
    const fixture = await createValidReleaseFixture(t)
    await rewriteReleaseNotes(fixture, fixtureCase.notes)
    await assert.rejects(
      verifyReleaseVersion(
        verificationInput(fixture),
        verificationDependencies(fixture),
      ),
      fixtureCase.expected,
      fixtureCase.name,
    )
  }
})

test('用户文案必须按角色标注：头行、标签、并集与「无」的独占性', async (t) => {
  const render = (header, sections) => [
    `本版影响角色：${header}`,
    ...sections.flatMap(([title, body]) => ['', title, body]),
  ].join('\n')
  const complete = [
    ['功能新增', '- 【运营人员】新增了按柜号筛选订单的能力'],
    ['功能优化', '- 无'],
    ['缺陷修复', '- 【运营人员】修复了登录状态过期后部分页面出错的问题'],
    ['已知问题', '- 无'],
  ]
  const withSection = (title, body) => complete.map(([sectionTitle, sectionBody]) => (
    sectionTitle === title ? [sectionTitle, body] : [sectionTitle, sectionBody]
  ))
  const validCases = [
    { name: 'single audience', notes: render('运营人员', complete) },
    {
      name: 'multiple audiences',
      notes: render('运营人员、财务人员', withSection('功能优化', '- 【财务人员】付款列表打开更快')),
    },
    {
      name: 'multi-role item',
      notes: render(
        '运营人员、财务人员、采运人员',
        withSection(
          '功能新增',
          '- 【运营人员、财务人员、采运人员】新增了三个业务角色都能使用的入口',
        ),
      ),
    },
    {
      name: 'admin workbench item',
      notes: render(
        '系统管理员',
        complete.map(([title]) => [
          title,
          title === '功能优化'
            ? '- 【系统管理员】用户管理新增了按角色筛选的能力'
            : '- 无',
        ]),
      ),
    },
    {
      name: 'no audience',
      notes: render('无', complete.map(([title]) => [title, '- 无'])),
    },
  ]
  for (const fixtureCase of validCases) {
    const fixture = await createValidReleaseFixture(t)
    await rewriteReleaseNotes(fixture, fixtureCase.notes)
    await verifyReleaseVersion(
      verificationInput(fixture),
      verificationDependencies(fixture),
    )
  }

  const invalidCases = [
    {
      name: 'missing header',
      notes: complete.map(([title, body]) => `${title}\n${body}`).join('\n\n'),
      expected: /exactly one "本版影响角色："/u,
    },
    {
      name: 'header not first',
      notes: `千树 DMS 1.2.3\n\n${render('运营人员', complete)}`,
      expected: /must start with the audience header/u,
    },
    {
      name: 'unknown header audience',
      notes: render('包装人员', complete),
      expected: /unknown audience: 包装人员/u,
    },
    {
      name: 'duplicated header audience',
      notes: render('运营人员、运营人员', complete),
      expected: /must not repeat audience: 运营人员/u,
    },
    {
      name: 'header audience order',
      notes: render('财务人员、运营人员', complete),
      expected: /must keep the documented audience order/u,
    },
    {
      name: 'bullet without label',
      notes: render('运营人员', withSection('功能新增', '- 新增了按柜号筛选订单的能力')),
      expected: /must start with an audience label/u,
    },
    {
      name: 'unknown bullet audience',
      notes: render('运营人员', withSection('功能新增', '- 【包装人员】新增了按柜号筛选订单的能力')),
      expected: /unknown audience: 包装人员/u,
    },
    {
      name: 'bullet audience order',
      notes: render(
        '运营人员、财务人员',
        withSection('功能新增', '- 【财务人员、运营人员】新增了按柜号筛选订单的能力'),
      ),
      expected: /must keep the documented audience order/u,
    },
    {
      name: 'empty bullet body',
      notes: render('运营人员', withSection('功能新增', '- 【运营人员】')),
      expected: /must have content after the audience label/u,
    },
    {
      name: 'bullet body is 无',
      notes: render('运营人员', withSection('功能新增', '- 【运营人员】无')),
      expected: /must not be only 无/u,
    },
    {
      name: 'header does not cover bullets',
      notes: render('运营人员、财务人员', complete),
      expected: /must match the labeled items/u,
    },
    {
      name: 'header covers unlabeled roles',
      notes: render('无', complete),
      expected: /must match the labeled items/u,
    },
    {
      name: 'mix 无 with labeled item',
      notes: render('运营人员', withSection('功能优化', '- 无\n- 【运营人员】付款列表打开更快')),
      expected: /must not mix 无 with labeled items/u,
    },
    {
      name: 'duplicated 无',
      notes: render('无', withSection('功能优化', '- 无\n- 无')),
      expected: /must contain exactly one 无/u,
    },
    {
      name: 'wrapped continuation',
      notes: render(
        '运营人员',
        withSection('功能新增', '- 【运营人员】新增了按柜号筛选订单的能力\n第二行没有标签'),
      ),
      expected: /must start with an audience label/u,
    },
    {
      name: 'half-width header colon',
      notes: `本版影响角色: 运营人员\n\n${complete.map(([title, body]) => `${title}\n${body}`).join('\n\n')}`,
      expected: /exactly one "本版影响角色："/u,
    },
  ]
  for (const fixtureCase of invalidCases) {
    const fixture = await createValidReleaseFixture(t)
    await rewriteReleaseNotes(fixture, fixtureCase.notes)
    await assert.rejects(
      verifyReleaseVersion(
        verificationInput(fixture),
        verificationDependencies(fixture),
      ),
      fixtureCase.expected,
      fixtureCase.name,
    )
  }
})

test('CLI 参数只接受固定 tag/source 与可选 output', () => {
  const cwd = path.join(path.sep, 'tmp', 'release-caller')
  const sourceCommit = 'a'.repeat(40)
  assert.deepEqual(
    parseReleaseVersionArguments([
      '--tag',
      'v1.2.3',
      '--source-commit',
      sourceCommit,
    ], cwd),
    { outputPath: undefined, sourceCommit, tag: 'v1.2.3' },
  )
  assert.deepEqual(
    parseReleaseVersionArguments([
      '--tag',
      'v1.2.3',
      '--source-commit',
      sourceCommit,
      '--output',
      'release-version.json',
    ], cwd),
    {
      outputPath: path.join(cwd, 'release-version.json'),
      sourceCommit,
      tag: 'v1.2.3',
    },
  )

  for (const argv of [
    [],
    ['--tag', 'v1.2.3'],
    ['--source-commit', sourceCommit, '--tag', 'v1.2.3'],
    ['--tag', 'v1.2.3', '--source-commit', sourceCommit, '--unknown'],
    ['--tag', 'v1.2.3', '--source-commit', sourceCommit, '--output'],
  ]) {
    assert.throws(() => parseReleaseVersionArguments(argv, cwd))
  }
})

test('CLI stdout 与安全 output 文件使用相同 canonical JSON', async (t) => {
  const fixture = await createValidReleaseFixture(t)
  const outputDirectory = await fs.mkdtemp(
    path.join(fixture.runnerTemp, 'release-version-'),
  )
  const outputPath = path.join(outputDirectory, 'release-version.json')
  const writes = []

  const result = await runReleaseVersionCli({
    argv: [
      '--tag',
      fixture.tag,
      '--source-commit',
      fixture.sourceCommit,
      '--output',
      outputPath,
    ],
    cwd: fixture.repositoryRoot,
    env: { RUNNER_TEMP: fixture.runnerTemp },
    fileSystem: fs,
    repositoryRoot: fixture.repositoryRoot,
    stdout: { write: value => writes.push(value) },
  })

  const expectedLine = `${JSON.stringify(result)}\n`
  assert.equal(writes.join(''), expectedLine)
  assert.equal(await fs.readFile(outputPath, 'utf8'), expectedLine)
  assert.deepEqual(JSON.parse(expectedLine), result)
  assert.equal((await fs.lstat(outputPath)).isFile(), true)
})

test('CLI canonicalize RUNNER_TEMP alias 后仍接受同一真实 child', async (t) => {
  const fixture = await createValidReleaseFixture(t)
  const runnerTempAlias = path.join(fixture.sandbox, 'runner-temp-alias')
  await fs.symlink(fixture.runnerTemp, runnerTempAlias, 'dir')
  const outputDirectory = await fs.mkdtemp(
    path.join(fixture.runnerTemp, 'release-version-'),
  )
  const outputPath = path.join(
    runnerTempAlias,
    path.basename(outputDirectory),
    'release-version.json',
  )

  await runReleaseVersionCli({
    argv: [
      '--tag',
      fixture.tag,
      '--source-commit',
      fixture.sourceCommit,
      '--output',
      outputPath,
    ],
    cwd: fixture.repositoryRoot,
    env: { RUNNER_TEMP: runnerTempAlias },
    fileSystem: fs,
    repositoryRoot: fixture.repositoryRoot,
    stdout: { write() {} },
  })

  assert.equal(
    (await fs.lstat(path.join(
      outputDirectory,
      'release-version.json',
    ))).isFile(),
    true,
  )
})

test('CLI output 拒绝 RUNNER_TEMP 外路径、错误文件名与既有 leaf', async (t) => {
  const fixture = await createValidReleaseFixture(t)
  const outputDirectory = await fs.mkdtemp(
    path.join(fixture.runnerTemp, 'release-version-'),
  )
  const baseOptions = {
    cwd: fixture.repositoryRoot,
    env: { RUNNER_TEMP: fixture.runnerTemp },
    fileSystem: fs,
    repositoryRoot: fixture.repositoryRoot,
    stdout: { write() {} },
  }
  const outputPaths = [
    path.join(fixture.sandbox, 'release-version.json'),
    path.join(outputDirectory, 'unexpected.json'),
  ]
  const externalDirectory = path.join(fixture.sandbox, 'external-output')
  const symlinkDirectory = path.join(fixture.runnerTemp, 'symlink-child')
  await fs.mkdir(externalDirectory)
  await fs.symlink(externalDirectory, symlinkDirectory, 'dir')
  outputPaths.push(path.join(symlinkDirectory, 'release-version.json'))
  const existingPath = path.join(outputDirectory, 'release-version.json')
  await fs.writeFile(existingPath, 'existing-canary\n')
  outputPaths.push(existingPath)

  for (const outputPath of outputPaths) {
    await assert.rejects(runReleaseVersionCli({
      ...baseOptions,
      argv: [
        '--tag',
        fixture.tag,
        '--source-commit',
        fixture.sourceCommit,
        '--output',
        outputPath,
      ],
    }))
  }
  assert.equal(await fs.readFile(existingPath, 'utf8'), 'existing-canary\n')
})

test('CLI 失败固定写 stderr 且不泄露参数或环境', async (t) => {
  const fixture = await createGitFixture(t)
  const secret = 'release-cli-secret'
  const result = spawnSync(
    process.execPath,
    [entrypoint, '--tag', secret, '--source-commit', 'short-sha'],
    {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        RUNNER_TEMP: fixture.runnerTemp,
        SECRET_CANARY: secret,
      },
    },
  )

  assert.equal(result.status, 1)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, 'Release version check failed\n')
  assert.equal(result.stderr.includes(secret), false)
})
