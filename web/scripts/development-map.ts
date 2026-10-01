/**
 * 开发图谱数据生成器：在构建时读取 Git 历史与依赖清单，产出「版本更新」「开发图谱」
 * 两个页面所需的数据。运行时不访问 Git —— 数据由 Vite 虚拟模块编进前端懒加载 chunk。
 *
 * 纯函数（解析、泳道布局、发版切分、技术栈归类）与 Git / 文件系统 IO 分离：
 * 单测只覆盖纯函数，不依赖当前仓库的历史深度，因此浅克隆 CI 也能全绿。
 *
 * 安全边界：Git 一律以 `execFile` 的 argv 数组调用（不经过 shell），所有进入参数的
 * revision 先过 `assertGitRef` 白名单，并在其前加 `--end-of-options`，防止把
 * `--upload-pack=...` 之类的前导连字符参数当成 Git 选项注入。脚本只读仓库、不写文件：
 * JSON 与发版更新内容都走 stdout，由调用方自行重定向。
 */
import type {
  DevelopmentMapData,
  DevelopmentMapSource,
  GitGraphCommit,
  GitGraphData,
  GitGraphVersion,
  ReleaseNotesData,
  ReleaseNotesGroup,
  ReleaseNotesRelease,
  TechStackData,
  TechStackGroup,
  TechStackItem,
} from '../apps/qsmds-arco/src/types/development-map'
import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { commitTypeLabels } from '../apps/qsmds-arco/src/types/commit-types.ts'

const execFileAsync = promisify(execFile)

/** Git 输出以 ASCII 单元分隔符分列，避免提交信息里的任意字符破坏解析。 */
const columnSeparator = '\u001F'

const versionTagPattern = /^v(\d+)\.(\d+)\.(\d+)$/u
const conventionalCommitPattern = /^([a-z]+)(?:\([^)]*\))?!?:/u
const safeGitRefPattern = /^[A-Za-z0-9][\w./-]{0,199}$/u

/** 变更条目分类标签沿用前端共享映射，避免两处维护不同的中文名。 */
export const COMMIT_TYPE_LABELS: Readonly<Record<string, string>> = commitTypeLabels

/** 变更条目分类展示顺序；不在表内的前缀一律落到「其他」。 */
const commitTypeOrder = ['feat', 'fix', 'perf', 'refactor', 'docs', 'test', 'style', 'chore', 'ci', 'build', 'revert', 'other']

export interface RawCommit {
  sha: string
  shortSha: string
  parents: string[]
  date: string
  subject: string
}

export interface RawTag {
  name: string
  target: string
  date: string
  subject: string
}

export interface GraphLayoutRow {
  /** 本提交所在泳道。 */
  lane: number
  /** 行下边沿需要绘制的泳道，渲染下一行时即为它的上边沿。 */
  lanes: number[]
}

/** 进入 Git 参数的 revision 白名单：拒绝前导连字符、空白、控制字符与超长输入。 */
function assertGitRef(value: string, label: string): string {
  if (!safeGitRefPattern.test(value)) {
    throw new Error(`${label} 不是安全的 Git revision：${JSON.stringify(value)}`)
  }
  return value
}

export function parseCommitLog(output: string): RawCommit[] {
  const commits: RawCommit[] = []
  for (const line of output.split('\n')) {
    if (line.length === 0) {
      continue
    }
    const [sha, shortSha, parents, date, ...subjectParts] = line.split(columnSeparator)
    if (!sha || !shortSha || date === undefined) {
      throw new Error('Git 提交记录格式无效')
    }
    commits.push({
      sha,
      shortSha,
      parents: parents ? parents.split(' ').filter(parent => parent.length > 0) : [],
      date: date.slice(0, 10),
      subject: subjectParts.join(columnSeparator),
    })
  }
  return commits
}

export function commitTypeOf(subject: string, parentCount: number): string {
  if (parentCount > 1) {
    return 'merge'
  }
  const matchedType = subject.match(conventionalCommitPattern)?.[1]
  if (!matchedType || matchedType === 'merge') {
    return 'other'
  }
  return matchedType in COMMIT_TYPE_LABELS ? matchedType : 'other'
}

/**
 * 经典 Git 泳道分配：按拓扑序（子提交先于父提交）逐行占用/释放泳道。
 * 首父优先延续本提交泳道，使主干与分支主体保持直线；其它父提交复用已占用泳道，
 * 否则申请最小空闲泳道，从而让 `maxLane` 只随并发分支数增长。
 */
export function assignGraphLanes(commits: readonly RawCommit[]): { rows: GraphLayoutRow[], maxLane: number } {
  const laneBySha = new Map<string, number>()
  const inFlight = new Set<number>()
  const rows: GraphLayoutRow[] = []
  let maxLane = 0

  const claimLowestFreeLane = (): number => {
    let lane = 0
    while (inFlight.has(lane)) {
      lane += 1
    }
    return lane
  }

  for (const commit of commits) {
    let lane = laneBySha.get(commit.sha)
    if (lane === undefined) {
      lane = claimLowestFreeLane()
    }
    else {
      laneBySha.delete(commit.sha)
    }
    inFlight.delete(lane)

    commit.parents.forEach((parent, index) => {
      let parentLane = laneBySha.get(parent)
      if (parentLane === undefined) {
        parentLane = index === 0 && !inFlight.has(lane) ? lane : claimLowestFreeLane()
        laneBySha.set(parent, parentLane)
      }
      inFlight.add(parentLane)
    })

    maxLane = Math.max(maxLane, lane)
    rows.push({ lane, lanes: [...inFlight].sort((left, right) => left - right) })
  }

  return { rows, maxLane }
}

export function compareVersionTags(left: string, right: string): number {
  const leftParts = left.match(versionTagPattern)
  const rightParts = right.match(versionTagPattern)
  if (!leftParts || !rightParts) {
    throw new Error(`发版 Tag 必须是 vX.Y.Z 形式：${left} / ${right}`)
  }
  for (const index of [1, 2, 3]) {
    const difference = Number(leftParts[index]) - Number(rightParts[index])
    if (difference !== 0) {
      return difference
    }
  }
  return 0
}

export function groupReleaseItems(commits: readonly RawCommit[]): ReleaseNotesGroup[] {
  const buckets = new Map<string, RawCommit[]>()
  for (const commit of commits) {
    const type = commitTypeOf(commit.subject, commit.parents.length)
    if (type === 'merge') {
      continue
    }
    const bucket = buckets.get(type)
    if (bucket) {
      bucket.push(commit)
    }
    else {
      buckets.set(type, [commit])
    }
  }
  return commitTypeOrder
    .filter(type => (buckets.get(type)?.length ?? 0) > 0)
    .map(type => ({
      type,
      label: COMMIT_TYPE_LABELS[type] ?? COMMIT_TYPE_LABELS.other,
      count: buckets.get(type)?.length ?? 0,
      items: (buckets.get(type) ?? []).map(commit => ({
        sha: commit.shortSha,
        subject: commit.subject,
      })),
    }))
}

export interface BuildReleaseNotesInput {
  tags: readonly RawTag[]
  commits: readonly RawCommit[]
  /** Tag 名 -> 该版本区间内的全部提交 SHA（含合并提交）。 */
  membersByTag: ReadonlyMap<string, ReadonlySet<string>>
  /** 最新发版 Tag 之后仍未发版的提交 SHA。 */
  unreleasedShas: ReadonlySet<string>
}

export interface BuildReleaseNotesResult {
  /** 按发版时间倒序，下标 0 为最新版本。 */
  releases: ReleaseNotesRelease[]
  /** 提交 SHA -> releases 下标；未发版为 -1。 */
  releaseIndexBySha: Map<string, number>
  unreleased: ReleaseNotesData['unreleased']
}

export function buildReleaseNotes(input: BuildReleaseNotesInput): BuildReleaseNotesResult {
  const sortedTags = input.tags
    .filter(tag => versionTagPattern.test(tag.name))
    .toSorted((left, right) => compareVersionTags(left.name, right.name))
  const commitsBySha = new Map(input.commits.map(commit => [commit.sha, commit]))

  const ascending = sortedTags.map((tag, index) => {
    const members = input.membersByTag.get(tag.name) ?? new Set<string>()
    const rangeCommits = input.commits.filter(commit => members.has(commit.sha))
    const release: ReleaseNotesRelease = {
      version: tag.name.slice(1),
      tag: tag.name,
      label: tag.subject.length > 0 ? tag.subject : null,
      datetime: tag.date,
      commit: tag.target.slice(0, 8),
      commitCount: rangeCommits.filter(commit => commit.parents.length <= 1).length,
      range: { from: index === 0 ? null : sortedTags[index - 1].name, to: tag.name },
      groups: groupReleaseItems(rangeCommits),
    }
    return release
  })

  const releases = [...ascending].reverse()
  const releaseIndexBySha = new Map<string, number>()
  releases.forEach((release, index) => {
    for (const sha of input.membersByTag.get(release.tag) ?? []) {
      releaseIndexBySha.set(sha, index)
    }
  })

  const unreleasedCommits = [...input.unreleasedShas]
    .map(sha => commitsBySha.get(sha))
    .filter((commit): commit is RawCommit => commit !== undefined)
  const unreleased = unreleasedCommits.length > 0
    ? {
        commitCount: unreleasedCommits.filter(commit => commit.parents.length <= 1).length,
        groups: groupReleaseItems(unreleasedCommits),
      }
    : null

  return { releases, releaseIndexBySha, unreleased }
}

export interface BuildGraphInput {
  commits: readonly RawCommit[]
  layout: { rows: GraphLayoutRow[], maxLane: number }
  tagsByCommit: ReadonlyMap<string, readonly string[]>
  headSha: string | null
  releaseIndexBySha: ReadonlyMap<string, number>
  releases: readonly ReleaseNotesRelease[]
}

export function buildGraph(input: BuildGraphInput): GitGraphData {
  const commits: GitGraphCommit[] = input.commits.map((commit, index) => {
    const row = input.layout.rows[index] ?? { lane: 0, lanes: [] }
    const refs = [...(input.tagsByCommit.get(commit.sha) ?? [])]
    if (input.headSha === commit.sha) {
      refs.push('HEAD')
    }
    return {
      sha: commit.shortSha,
      lane: row.lane,
      lanes: row.lanes,
      subject: commit.subject,
      type: commitTypeOf(commit.subject, commit.parents.length),
      date: commit.date,
      refs,
      release: input.releaseIndexBySha.get(commit.sha) ?? -1,
    }
  })

  const versions: GitGraphVersion[] = input.releases.map(release => ({
    version: release.version,
    tag: release.tag,
    datetime: release.datetime,
    commitCount: release.commitCount,
  }))

  return { maxLane: input.layout.maxLane, commits, versions }
}

/**
 * 技术栈分类与说明为人工维护层：版本号始终自动解析，说明文字只在此处登记。
 * 新增依赖若未登记会落到「其他依赖」，展示仍完整，只是没有中文说明。
 */
const techStackGroups: readonly { key: string, label: string }[] = [
  { key: 'runtime', label: '运行时与平台' },
  { key: 'base', label: 'Fantastic Admin 基座' },
  { key: 'frontend', label: '前端框架与状态' },
  { key: 'ui', label: 'UI 与样式' },
  { key: 'server', label: '后端框架与数据' },
  { key: 'build', label: '构建与工程化' },
  { key: 'quality', label: '测试与质量' },
  { key: 'other', label: '其他依赖' },
]

const techStackCatalog: Readonly<Record<string, { group: string, note: string }>> = Object.freeze({
  '@fantastic-admin/components': { group: 'base', note: 'Fantastic Admin 业务组件与图表组件' },
  '@fantastic-admin/composables': { group: 'base', note: '组合式函数（主题、布局、权限桥接）' },
  '@fantastic-admin/hotkeys': { group: 'base', note: '全局快捷键注册' },
  '@fantastic-admin/locales': { group: 'base', note: '框架内置多语言资源' },
  '@fantastic-admin/settings': { group: 'base', note: '应用设置与偏好面板' },
  '@fantastic-admin/themes': { group: 'base', note: '主题 Token 与配色定义' },
  '@fantastic-admin/types': { group: 'base', note: '框架类型声明' },
  '@fantastic-admin/copyright': { group: 'base', note: '版权信息插件' },
  '@fantastic-admin/iconify-tools': { group: 'base', note: '图标清单生成工具' },
  'vue': { group: 'frontend', note: '核心视图框架' },
  'vue-router': { group: 'frontend', note: '菜单与路由真相源' },
  'pinia': { group: 'frontend', note: '应用状态管理' },
  'vue-i18n': { group: 'frontend', note: '界面多语言' },
  'axios': { group: 'frontend', note: 'HTTP 客户端（含重试与错误归一化）' },
  'zod': { group: 'frontend', note: '数据校验' },
  'vee-validate': { group: 'frontend', note: '表单校验集成' },
  '@vee-validate/zod': { group: 'frontend', note: 'zod 与表单校验桥接' },
  '@vueuse/core': { group: 'frontend', note: '组合式工具集（含虚拟列表）' },
  '@arco-design/web-vue': { group: 'ui', note: '组件库依赖（仅少量页面直接调用）' },
  'reka-ui': { group: 'ui', note: '无样式交互原语' },
  'unocss': { group: 'ui', note: '原子化样式引擎' },
  '@iconify/vue': { group: 'ui', note: '图标渲染' },
  'sass-embedded': { group: 'ui', note: 'SCSS 编译' },
  '@nestjs/common': { group: 'server', note: 'NestJS 运行时基础模块' },
  '@nestjs/core': { group: 'server', note: '依赖注入与应用容器' },
  '@nestjs/platform-express': { group: 'server', note: 'HTTP 平台适配' },
  '@nestjs/config': { group: 'server', note: '环境配置加载' },
  '@nestjs/swagger': { group: 'server', note: 'OpenAPI 契约生成' },
  '@nestjs/terminus': { group: 'server', note: '健康检查指示器' },
  'prisma': { group: 'server', note: 'ORM 工具链与迁移' },
  '@prisma/client': { group: 'server', note: '数据库客户端' },
  '@prisma/adapter-pg': { group: 'server', note: 'Prisma 的 PostgreSQL 驱动适配' },
  'pg': { group: 'server', note: 'PostgreSQL 驱动' },
  'class-validator': { group: 'server', note: 'DTO 校验装饰器' },
  'class-transformer': { group: 'server', note: 'DTO 序列化与转换' },
  'argon2': { group: 'server', note: '密码哈希' },
  'sharp': { group: 'server', note: '产品图片处理' },
  'busboy': { group: 'server', note: '文件上传流式解析' },
  'file-type': { group: 'server', note: '上传文件类型嗅探' },
  'yauzl': { group: 'server', note: 'ZIP 读取（导入包解析）' },
  'vite': { group: 'build', note: '构建与开发服务器' },
  'typescript': { group: 'build', note: '类型系统' },
  'vue-tsc': { group: 'build', note: 'Vue 单文件组件类型检查' },
  'tsx': { group: 'build', note: '脚本与测试的 TS 执行器' },
  '@vitejs/plugin-vue': { group: 'build', note: 'Vue SFC 编译插件' },
  '@vitejs/plugin-legacy': { group: 'build', note: '旧浏览器兼容产物' },
  'vite-plugin-compression2': { group: 'build', note: '产物压缩' },
  '@hey-api/openapi-ts': { group: 'build', note: '按 OpenAPI 生成前端类型' },
  'unplugin-vue-components': { group: 'build', note: '组件自动注册' },
  'unplugin-auto-import': { group: 'build', note: 'API 自动导入' },
  'jest': { group: 'quality', note: '服务端测试运行器' },
  'ts-jest': { group: 'quality', note: '服务端 TS 测试转换' },
  'supertest': { group: 'quality', note: 'HTTP 接口端到端测试' },
  'eslint': { group: 'quality', note: '代码规范检查' },
  'stylelint': { group: 'quality', note: '样式规范检查' },
})

export interface BuildTechStackInput {
  runtime: Array<{ label: string, value: string }>
  manifests: ReadonlyArray<{ origin: 'app' | 'server', dependencies: Record<string, string>, devDependencies: Record<string, string> }>
  /** 解析构建环境实际安装版本；解析失败返回 null 并回退到清单声明值。 */
  resolveInstalledVersion: (origin: 'app' | 'server', name: string) => string | null
}

export function buildTechStack(input: BuildTechStackInput): TechStackData {
  const items = new Map<string, TechStackItem & { group: string }>()
  for (const manifest of input.manifests) {
    for (const [name, declared] of Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })) {
      if (items.has(name)) {
        continue
      }
      const catalogEntry = techStackCatalog[name]
      items.set(name, {
        name,
        version: input.resolveInstalledVersion(manifest.origin, name) ?? (declared.startsWith('catalog:') ? '未解析' : declared),
        note: catalogEntry?.note ?? null,
        group: catalogEntry?.group ?? 'other',
      })
    }
  }

  const groups: TechStackGroup[] = techStackGroups
    .map(group => ({
      key: group.key,
      label: group.label,
      items: [...items.values()]
        .filter(item => item.group === group.key)
        .sort((left, right) => left.name.localeCompare(right.name))
        .map(({ name, version, note }) => ({ name, version, note })),
    }))
    .filter(group => group.items.length > 0)

  return { runtime: input.runtime, groups }
}

export interface BuildDevelopmentMapInput {
  source: DevelopmentMapSource
  releases: ReleaseNotesRelease[]
  unreleased: ReleaseNotesData['unreleased']
  graph: GitGraphData
  techStack: TechStackData
}

export function buildReleaseNotesData(input: BuildDevelopmentMapInput): ReleaseNotesData {
  return {
    schemaVersion: 1,
    source: input.source,
    releases: input.releases,
    unreleased: input.unreleased,
  }
}

export function buildDevelopmentMapData(input: BuildDevelopmentMapInput): DevelopmentMapData {
  return {
    schemaVersion: 1,
    source: input.source,
    graph: input.graph,
    techStack: input.techStack,
  }
}

export function renderReleaseNotesMarkdown(release: ReleaseNotesRelease): string {
  const lines = [`## ${release.tag}（${release.datetime.slice(0, 10)}）`, '']
  if (release.groups.length === 0) {
    lines.push('_本版本没有可归类的提交。_')
  }
  for (const group of release.groups) {
    lines.push(`### ${group.label}（${group.count}）`)
    for (const item of group.items) {
      lines.push(`- ${item.subject} (${item.sha})`)
    }
    lines.push('')
  }
  return `${lines.join('\n').trimEnd()}\n`
}

export function unavailableSource(version: string, reason: string, generatedAt: string): DevelopmentMapSource {
  return {
    available: false,
    mode: 'unavailable',
    reason,
    version,
    tag: null,
    commit: null,
    shortCommit: null,
    branch: null,
    describe: null,
    dirty: false,
    shallow: false,
    generatedAt,
  }
}

async function runGit(repoRoot: string, args: readonly string[]): Promise<string> {
  // 不经过 shell：execFile 直接以 argv 调用 git，参数不会经历字符串拼接与再次解析。
  const { stdout } = await execFileAsync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return stdout
}

/** 带 revision 的 Git 调用统一在 `--end-of-options` 之后传值，拒绝选项注入。 */
function runGitWithRevision(repoRoot: string, args: readonly string[], revision: string, label: string): Promise<string> {
  return runGit(repoRoot, [...args, '--end-of-options', assertGitRef(revision, label)])
}

function readJsonFile(filePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>
}

interface ManifestInfo {
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
  version: string
  engines?: Record<string, string>
  packageManager?: string
}

function readManifest(filePath: string): ManifestInfo {
  const manifest = readJsonFile(filePath)
  return {
    dependencies: (manifest.dependencies ?? {}) as Record<string, string>,
    devDependencies: (manifest.devDependencies ?? {}) as Record<string, string>,
    version: typeof manifest.version === 'string' ? manifest.version : '0.0.0',
    engines: manifest.engines as Record<string, string> | undefined,
    packageManager: typeof manifest.packageManager === 'string' ? manifest.packageManager : undefined,
  }
}

function installedVersion(baseDir: string, name: string): string | null {
  const manifestPath = path.join(baseDir, 'node_modules', name, 'package.json')
  if (!existsSync(manifestPath)) {
    return null
  }
  const version = readJsonFile(manifestPath).version
  return typeof version === 'string' ? version : null
}

export interface DevelopmentMapPaths {
  repoRoot: string
  appRoot: string
  serverRoot: string
}

export interface DevelopmentMapBundle {
  developmentMap: DevelopmentMapData
  releaseNotes: ReleaseNotesData
}

export async function createDevelopmentMapData(paths: DevelopmentMapPaths): Promise<DevelopmentMapBundle> {
  const appManifest = readManifest(path.join(paths.appRoot, 'package.json'))
  const generatedAt = new Date().toISOString()

  const emptyInput = (source: DevelopmentMapSource): BuildDevelopmentMapInput => ({
    source,
    releases: [],
    unreleased: null,
    graph: { maxLane: 0, commits: [], versions: [] },
    techStack: { runtime: [], groups: [] },
  })

  try {
    return await collectDevelopmentMapData(paths, { appManifest, generatedAt })
  }
  catch {
    // 无 .git 的源码包构建或 Git 不可用时降级为空态：页面如实展示「数据不可用」，不让构建失败。
    process.stderr.write('开发图谱数据生成失败：构建环境缺少可用的 Git 仓库，页面将以不可用空态呈现\n')
    const input = emptyInput(unavailableSource(appManifest.version, 'git-unavailable', generatedAt))
    return {
      developmentMap: buildDevelopmentMapData(input),
      releaseNotes: buildReleaseNotesData(input),
    }
  }
}

interface DevelopmentMapContext {
  appManifest: ManifestInfo
  generatedAt: string
}

async function collectDevelopmentMapData(paths: DevelopmentMapPaths, context: DevelopmentMapContext): Promise<DevelopmentMapBundle> {
  const { appManifest, generatedAt } = context
  // 非 Git 元信息在降级路径之外读取：源码包构建仍可展示版本，只是没有历史与图谱。
  const serverManifest = readManifest(path.join(paths.serverRoot, 'package.json'))
  const rootManifest = readManifest(path.join(paths.repoRoot, 'package.json'))
  const webManifest = readManifest(path.join(paths.repoRoot, 'web', 'package.json'))
  const emptyInput = (source: DevelopmentMapSource): BuildDevelopmentMapInput => ({
    source,
    releases: [],
    unreleased: null,
    graph: { maxLane: 0, commits: [], versions: [] },
    techStack: { runtime: [], groups: [] },
  })

  const shallow = (await runGit(paths.repoRoot, ['rev-parse', '--is-shallow-repository'])).trim() === 'true'
  if (shallow) {
    // 浅克隆拿不到完整历史与 Tag；明确降级为不可用，页面走空态而不是给出残缺图谱。
    const input = emptyInput({ ...unavailableSource(appManifest.version, 'shallow-clone', generatedAt), shallow: true })
    return {
      developmentMap: buildDevelopmentMapData(input),
      releaseNotes: buildReleaseNotesData(input),
    }
  }

  const [logOutput, tagOutput, headSha, branchOutput, describe] = await Promise.all([
    runGit(paths.repoRoot, ['log', '--topo-order', `--pretty=format:%H${columnSeparator}%h${columnSeparator}%P${columnSeparator}%cI${columnSeparator}%s`]),
    runGit(paths.repoRoot, ['for-each-ref', `--format=%(refname:short)${columnSeparator}%(objecttype)${columnSeparator}%(objectname)${columnSeparator}%(*objectname)${columnSeparator}%(creatordate:iso-strict)${columnSeparator}%(contents:subject)`, 'refs/tags']),
    runGit(paths.repoRoot, ['rev-parse', 'HEAD']).then(value => value.trim()),
    runGit(paths.repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']).then(value => value.trim()),
    runGit(paths.repoRoot, ['describe', '--tags', '--always', '--dirty']).then(value => value.trim()),
  ])

  const commits = parseCommitLog(logOutput)
  const tags: RawTag[] = tagOutput.split('\n')
    .filter(line => line.length > 0)
    .map((line) => {
      const [name, objectType, objectName, peeledName, date, ...subjectParts] = line.split(columnSeparator)
      const target = objectType === 'tag' ? peeledName : objectName
      if (!name || !target || !date) {
        throw new Error('Git Tag 记录格式无效')
      }
      return { name, target: target.slice(0, 40), date: date.slice(0, 10), subject: subjectParts.join(columnSeparator) }
    })
    .filter(tag => versionTagPattern.test(tag.name))

  const sortedTags = tags.toSorted((left, right) => compareVersionTags(left.name, right.name))
  const membersByTag = new Map<string, Set<string>>()
  const releasedShas = new Set<string>()
  for (const [index, tag] of sortedTags.entries()) {
    const previous = index === 0 ? null : sortedTags[index - 1].name
    // 版本区间只使用已校验的 Tag 名与 40 位提交 SHA 构造，绝不拼接用户输入。
    const range = previous === null
      ? await runGitWithRevision(paths.repoRoot, ['rev-list'], assertGitRef(tag.target, 'Tag 目标提交'), 'Tag 目标提交')
      : await runGitWithRevision(paths.repoRoot, ['rev-list'], `${assertGitRef(previous, '上一版 Tag')}..${assertGitRef(tag.target, 'Tag 目标提交')}`, '版本区间')
    const members = new Set(range.split('\n').filter(sha => sha.length > 0))
    membersByTag.set(tag.name, members)
    for (const sha of members) {
      releasedShas.add(sha)
    }
  }
  const unreleasedShas = new Set(commits.map(commit => commit.sha).filter(sha => !releasedShas.has(sha)))

  const { releases, releaseIndexBySha, unreleased } = buildReleaseNotes({
    tags: sortedTags,
    commits,
    membersByTag,
    unreleasedShas,
  })
  const layout = assignGraphLanes(commits)
  const tagsByCommit = new Map<string, string[]>()
  for (const tag of sortedTags) {
    tagsByCommit.set(tag.target, [...(tagsByCommit.get(tag.target) ?? []), tag.name])
  }
  const graph = buildGraph({
    commits,
    layout,
    tagsByCommit,
    headSha,
    releaseIndexBySha,
    releases,
  })
  const techStack = buildTechStack({
    runtime: [
      { label: 'Node', value: rootManifest.engines?.node ?? '未声明' },
      { label: 'pnpm', value: rootManifest.packageManager ?? '未声明' },
      { label: 'PostgreSQL', value: '16' },
      { label: 'Web 基座', value: `Fantastic Admin ${webManifest.version}` },
    ],
    manifests: [
      { origin: 'app', dependencies: appManifest.dependencies, devDependencies: appManifest.devDependencies },
      { origin: 'server', dependencies: serverManifest.dependencies, devDependencies: serverManifest.devDependencies },
    ],
    resolveInstalledVersion: (origin, name) => installedVersion(origin === 'app' ? paths.appRoot : paths.serverRoot, name),
  })

  const dirty = (await runGit(paths.repoRoot, ['status', '--porcelain', '-uno'])).trim().length > 0
  const tagOnHead = sortedTags.find(tag => tag.target === headSha) ?? null
  const mode: DevelopmentMapSource['mode'] = tagOnHead && !dirty && tagOnHead.name === `v${appManifest.version}`
    ? 'release'
    : 'development'
  const reason = mode === 'release'
    ? null
    : tagOnHead === null
      ? 'head-not-tagged'
      : dirty
        ? 'dirty-worktree'
        : 'version-mismatch'
  const source: DevelopmentMapSource = {
    available: true,
    mode,
    reason,
    version: appManifest.version,
    tag: tagOnHead?.name ?? null,
    commit: headSha,
    shortCommit: headSha.slice(0, 8),
    branch: branchOutput === 'HEAD' ? null : branchOutput,
    describe,
    dirty,
    shallow: false,
    generatedAt,
  }

  const input: BuildDevelopmentMapInput = { source, releases, unreleased, graph, techStack }
  return {
    developmentMap: buildDevelopmentMapData(input),
    releaseNotes: buildReleaseNotesData(input),
  }
}

/** 发版更新内容：默认覆盖「最近一个发版 Tag → 目标提交」的完整区间。 */
export async function createReleaseNotes(repoRoot: string, options: { from: string | null, to: string, tag: string | null }): Promise<ReleaseNotesRelease> {
  const from = options.from === null ? null : assertGitRef(options.from, '起始 Tag')
  const to = assertGitRef(options.to, '目标提交')
  const output = await runGitWithRevision(
    repoRoot,
    ['log', '--topo-order', `--pretty=format:%H${columnSeparator}%h${columnSeparator}%P${columnSeparator}%cI${columnSeparator}%s`],
    from === null ? to : `${from}..${to}`,
    '发版区间',
  )
  const commits = parseCommitLog(output)
  const date = (await runGitWithRevision(repoRoot, ['log', '-1', '--pretty=format:%cI'], to, '目标提交')).trim()
  return {
    version: (options.tag ?? to).replace(/^v/u, ''),
    tag: options.tag ?? to.slice(0, 8),
    label: null,
    datetime: date.slice(0, 10),
    commit: to.slice(0, 8),
    commitCount: commits.filter(commit => commit.parents.length <= 1).length,
    range: { from, to },
    groups: groupReleaseItems(commits),
  }
}

interface CliOptions {
  releaseNotes: boolean
  from: string | null
  to: string
  tag: string | null
}

export function parseCliOptions(argv: readonly string[]): CliOptions {
  const options: CliOptions = { releaseNotes: false, from: null, to: 'HEAD', tag: null }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--release-notes') {
      options.releaseNotes = true
    }
    else if (['--from', '--to', '--tag'].includes(argument ?? '')) {
      const value = argv[index + 1]
      if (value === undefined) {
        throw new Error(`${argument} 缺少取值`)
      }
      if (argument === '--from') {
        options.from = value
      }
      else if (argument === '--to') {
        options.to = value
      }
      else {
        options.tag = value
      }
      index += 1
    }
    else {
      throw new Error(`未知参数：${argument}`)
    }
  }
  return options
}

async function latestVersionTag(repoRoot: string): Promise<string | null> {
  const output = await runGit(repoRoot, ['tag', '--list', 'v*.*.*', '--sort=-v:refname'])
  return output.split('\n').find(line => versionTagPattern.test(line)) ?? null
}

async function main(): Promise<void> {
  const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const repoRoot = path.resolve(webRoot, '..')
  const options = parseCliOptions(process.argv.slice(2))

  if (options.releaseNotes) {
    const from = options.from ?? await latestVersionTag(repoRoot)
    const body = renderReleaseNotesMarkdown(await createReleaseNotes(repoRoot, {
      from,
      to: options.to,
      tag: options.tag,
    }))
    process.stdout.write(body)
    return
  }

  const bundle = await createDevelopmentMapData({
    repoRoot,
    appRoot: path.join(webRoot, 'apps', 'qsmds-arco'),
    serverRoot: path.join(repoRoot, 'server'),
  })
  process.stdout.write(`${JSON.stringify(bundle.developmentMap, null, 2)}\n`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
