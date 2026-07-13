import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { lstat, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// 测试以自身位置推导仓库根目录，避免调用者从其他工作目录执行时误读同名文件。
const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptsDirectory, '..')

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

test('根 package 保持无依赖且不是 workspace', async () => {
  const manifest = JSON.parse(await readFile(fromRoot('package.json'), 'utf8'))

  assert.equal(manifest.name, 'qianshu-dms')
  assert.equal(manifest.version, '0.0.0')
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

test('根级治理文件和阶段一至阶段四文档真实存在', async () => {
  const requiredFiles = [
    'README.md',
    'AGENTS.md',
    '.gitignore',
    '.editorconfig',
    '.node-version',
    'package.json',
    'scripts/root-governance.test.mjs',
    'docs/文档索引.md',
    'docs/全局文档/项目工程组织方案.md',
    'docs/全局文档/阶段一根级治理实施计划.md',
    'docs/全局文档/阶段四接口契约设计.md',
    'docs/全局文档/阶段四接口契约实施计划.md',
    'docs/后端文档/接口契约规范.md',
    'docs/前端文档/接口接入规范.md',
  ]

  for (const file of requiredFiles) {
    await assertRegularFile(file)
  }
})

test('Node.js 主版本配置为 24', async () => {
  const nodeVersion = await readFile(fromRoot('.node-version'), 'utf8')
  assert.equal(nodeVersion.trim(), '24')
})

test('文档索引链接到真实全局文档与两端接口规范', async () => {
  const index = await readFile(fromRoot('docs', '文档索引.md'), 'utf8')
  const requiredLinks = [
    './全局文档/项目工程组织方案.md',
    './全局文档/阶段一根级治理实施计划.md',
    './全局文档/阶段四接口契约设计.md',
    './全局文档/阶段四接口契约实施计划.md',
    './后端文档/接口契约规范.md',
    './前端文档/接口接入规范.md',
  ]

  for (const link of requiredLinks) {
    assert.ok(index.includes(`(${link})`), `文档索引缺少链接：${link}`)
    await assertRegularFile(path.join('docs', link))
  }
})

test('阶段三计划、后端架构和数据库迁移规范均为真实文件', async () => {
  const requiredDocuments = [
    'docs/全局文档/阶段三Server初始化实施计划.md',
    'docs/后端文档/后端架构.md',
    'docs/后端文档/数据库迁移规范.md',
  ]
  for (const document of requiredDocuments) {
    await assertRegularFile(document)
  }
})

test('文档索引链接到阶段三计划和两份后端正式文档', async () => {
  const index = await readFile(fromRoot('docs', '文档索引.md'), 'utf8')
  const requiredLinks = [
    './全局文档/阶段三Server初始化实施计划.md',
    './后端文档/后端架构.md',
    './后端文档/数据库迁移规范.md',
  ]

  for (const link of requiredLinks) {
    assert.ok(index.includes(`(${link})`), `文档索引缺少链接：${link}`)
    await assertRegularFile(path.join('docs', link))
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
  assert.match(design, /阶段 4：接口契约（已实施并完成验收）/)
  assert.doesNotMatch(design, /最终运行时验收待完成/)
  assert.doesNotMatch(design, /Blob media type 不冲突/)
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
