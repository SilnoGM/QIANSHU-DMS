import type { RawCommit, RawTag } from './development-map'
import assert from 'node:assert/strict'

// eslint-disable-next-line test/no-import-node-test -- 生成器纯函数由 `tsx --test` 直接运行，不引入额外测试框架。
import test from 'node:test'
import {
  assignGraphLanes,
  buildDevelopmentMapData,
  buildGraph,
  buildReleaseNotes,
  buildReleaseNotesData,
  buildTechStack,
  commitTypeOf,
  compareVersionTags,
  createReleaseNotes,
  groupReleaseItems,
  parseCliOptions,
  parseCommitLog,
  renderReleaseNotesMarkdown,
} from './development-map'

const separator = '\u001F'

function commit(sha: string, parents: string[], subject: string, date = '2026-09-29'): RawCommit {
  return { sha: `${sha}${'0'.repeat(40 - sha.length)}`, shortSha: sha, parents: parents.map(parent => `${parent}${'0'.repeat(40 - parent.length)}`), date, subject }
}

function tag(name: string, target: string, date = '2026-09-29', subject = `千树 DMS ${name}`): RawTag {
  return { name, target: `${target}${'0'.repeat(40 - target.length)}`, date, subject }
}

test('提交日志解析保留分隔符内的完整提交信息', () => {
  const output = [
    `aaa${separator}aaaaaaa${separator}bbb ccc${separator}2026-09-29T09:36:03+08:00${separator}feat: 支持 A / B 双通道`,
    `bbb${separator}bbbbbbb${separator}${separator}2026-09-28T10:00:00+08:00${separator}docs: 初始提交`,
    '',
  ].join('\n')
  const commits = parseCommitLog(output)
  assert.equal(commits.length, 2)
  assert.deepEqual(commits[0], {
    sha: 'aaa',
    shortSha: 'aaaaaaa',
    parents: ['bbb', 'ccc'],
    date: '2026-09-29',
    subject: 'feat: 支持 A / B 双通道',
  })
  // 根提交没有父提交，不能因为空字段被当作格式错误。
  assert.deepEqual(commits[1].parents, [])
})

test('提交日志解析拒绝缺列记录', () => {
  assert.throws(() => parseCommitLog(`aaa${separator}aaaaaaa`), /提交记录格式无效/u)
})

test('提交类型按 conventional commits 归类，合并提交与未知前缀落到确定分类', () => {
  assert.equal(commitTypeOf('feat: 新增台账', 1), 'feat')
  assert.equal(commitTypeOf('fix(对账): 修正空值口径', 1), 'fix')
  assert.equal(commitTypeOf('refactor!: 重写匹配', 1), 'refactor')
  assert.equal(commitTypeOf('wip: 临时提交', 1), 'other')
  assert.equal(commitTypeOf('没有前缀的提交', 1), 'other')
  assert.equal(commitTypeOf('feat: 分支合并', 2), 'merge')
  assert.equal(commitTypeOf('Merge pull request #28 from x/y', 2), 'merge')
})

test('泳道分配让线性历史保持在主干，并让合并分叉再收敛', () => {
  const linear = assignGraphLanes([commit('a', ['b'], 'feat: a'), commit('b', [], 'feat: b')])
  assert.deepEqual(linear.rows, [{ lane: 0, lanes: [0] }, { lane: 0, lanes: [] }])
  assert.equal(linear.maxLane, 0)

  // m 合并 b（第一父）与 c（第二父，独立分支）；c 再合并回 b 的历史。
  const merge = assignGraphLanes([
    commit('m', ['b', 'c'], 'Merge pull request #1 from x/y'),
    commit('b', ['d'], 'feat: b'),
    commit('c', ['d'], 'feat: c'),
    commit('d', [], 'feat: d'),
  ])
  assert.equal(merge.rows[0].lane, 0)
  assert.equal(merge.rows[0].lanes.includes(0), true)
  assert.equal(merge.rows[0].lanes.includes(1), true)
  assert.equal(merge.rows[1].lane, 0, '第一父提交延续主干泳道')
  assert.equal(merge.rows[2].lane, 1, '第二父提交占用侧泳道')
  assert.deepEqual(merge.rows[3], { lane: 0, lanes: [] }, '收敛到共同祖先后释放全部泳道')
  assert.equal(merge.maxLane, 1)
})

test('泳道分配保证每一行的连线在下一行都有落点', () => {
  const commits = [
    commit('m', ['l', 'r'], 'Merge pull request #2 from x/z'),
    commit('l', ['base'], 'feat: 左'),
    commit('r', ['base'], 'feat: 右'),
    commit('base', [], 'docs: 基线'),
  ]
  const { rows } = assignGraphLanes(commits)
  rows.forEach((row, index) => {
    const next = rows[index + 1]
    for (const lane of row.lanes) {
      if (!next) {
        assert.fail('最后一行不允许残留未收敛的泳道')
      }
      assert.ok(
        lane === next.lane || next.lanes.includes(lane),
        `第 ${index} 行泳道 ${lane} 在下一行没有落点`,
      )
    }
  })
  assert.deepEqual(rows.at(-1)?.lanes, [])
})

test('版本比较按数值而非字典序处理多位版本号', () => {
  assert.ok(compareVersionTags('v0.1.10', 'v0.1.9') > 0)
  assert.ok(compareVersionTags('v0.2.0', 'v0.1.99') > 0)
  assert.equal(compareVersionTags('v1.0.0', 'v1.0.0'), 0)
  assert.throws(() => compareVersionTags('v0.1', 'v0.1.0'), /必须是 vX\.Y\.Z/u)
})

test('变更条目按类型分组、保持展示顺序并排除合并提交', () => {
  const groups = groupReleaseItems([
    commit('a', ['z'], 'chore: 重新生成图标清单'),
    commit('b', ['z'], 'fix: 修正计数'),
    commit('c', ['z'], 'feat: 新增页面'),
    commit('d', ['z', 'z'], 'Merge pull request #9 from x/y'),
    commit('e', ['z'], 'feat: 第二个功能'),
    commit('f', ['z'], 'unknown: 未知前缀'),
  ])
  assert.deepEqual(groups.map(group => group.type), ['feat', 'fix', 'chore', 'other'])
  assert.deepEqual(groups.map(group => group.count), [2, 1, 1, 1])
  assert.equal(groups[0].label, '新功能')
  assert.equal(groups.at(-1)?.label, '其他')
  assert.deepEqual(groups[0].items.map(item => item.sha), ['c', 'e'])
})

test('发版切分按发布时间倒序、区间首尾相接并把未发版提交单独成桶', () => {
  const commits = [
    commit('h', ['g'], 'feat: 未发版提交'),
    commit('g', ['f'], 'fix: 修复二'),
    commit('f', ['e'], 'feat: 功能二'),
    commit('e', ['d'], 'feat: 功能一'),
    commit('d', [], 'docs: 起点'),
  ]
  const tags = [tag('v0.1.0', 'd', '2026-07-14'), tag('v0.1.1', 'f', '2026-07-20')]
  const membersByTag = new Map([
    ['v0.1.0', new Set([commits[3].sha, commits[4].sha])],
    ['v0.1.1', new Set([commits[2].sha, commits[1].sha])],
  ])
  const result = buildReleaseNotes({
    tags,
    commits,
    membersByTag,
    unreleasedShas: new Set([commits[0].sha]),
  })

  assert.deepEqual(result.releases.map(release => release.tag), ['v0.1.1', 'v0.1.0'])
  assert.deepEqual(result.releases[0].range, { from: 'v0.1.0', to: 'v0.1.1' })
  assert.deepEqual(result.releases[1].range, { from: null, to: 'v0.1.0' })
  assert.equal(result.releases[0].commitCount, 2)
  assert.equal(result.releases[0].version, '0.1.1')
  assert.equal(result.releases[0].label, '千树 DMS v0.1.1')
  assert.equal(result.releaseIndexBySha.get(commits[2].sha), 0)
  assert.equal(result.releaseIndexBySha.get(commits[4].sha), 1)
  assert.equal(result.releaseIndexBySha.get(commits[0].sha), undefined)
  assert.equal(result.unreleased?.commitCount, 1)
  assert.equal(result.unreleased?.groups[0].type, 'feat')
})

test('线路图行数据带出引用徽标与所属发版', () => {
  const commits = [commit('b', ['a'], 'feat: 新功能'), commit('a', [], 'docs: 起点')]
  const release = {
    version: '0.1.0',
    tag: 'v0.1.0',
    label: null,
    datetime: '2026-07-14',
    commit: 'aaaaaaa',
    commitCount: 2,
    range: { from: null, to: 'v0.1.0' },
    groups: [],
  }
  const graph = buildGraph({
    commits,
    layout: assignGraphLanes(commits),
    tagsByCommit: new Map([[commits[1].sha, ['v0.1.0']]]),
    headSha: commits[0].sha,
    releaseIndexBySha: new Map([[commits[0].sha, 0], [commits[1].sha, 0]]),
    releases: [release],
  })
  assert.deepEqual(graph.commits[0].refs, ['HEAD'])
  assert.deepEqual(graph.commits[1].refs, ['v0.1.0'])
  assert.equal(graph.commits[0].release, 0)
  assert.deepEqual(graph.versions, [{ version: '0.1.0', tag: 'v0.1.0', datetime: '2026-07-14', commitCount: 2 }])
})

test('技术栈按人工分类归类，版本优先取实际安装值并保留未登记项', () => {
  const techStack = buildTechStack({
    runtime: [{ label: 'Node', value: '^24.15.0' }],
    manifests: [
      {
        origin: 'app',
        dependencies: { 'vue': 'catalog:', 'unknown-package': '^1.2.3' },
        devDependencies: { vite: 'catalog:' },
      },
      {
        origin: 'server',
        dependencies: { '@nestjs/common': '11.1.28', 'vue': '9.9.9' },
        devDependencies: {},
      },
    ],
    resolveInstalledVersion: (origin, name) => {
      if (name === 'vue') {
        return '3.5.39'
      }
      if (name === 'unknown-package') {
        return null
      }
      return null
    },
  })

  assert.deepEqual(techStack.runtime, [{ label: 'Node', value: '^24.15.0' }])
  const frontend = techStack.groups.find(group => group.key === 'frontend')
  assert.deepEqual(frontend?.items, [{ name: 'vue', version: '3.5.39', note: '核心视图框架' }], '同名依赖只登记一次并优先取解析出的实际版本')
  const server = techStack.groups.find(group => group.key === 'server')
  assert.deepEqual(server?.items, [{ name: '@nestjs/common', version: '11.1.28', note: 'NestJS 运行时基础模块' }])
  const build = techStack.groups.find(group => group.key === 'build')
  assert.deepEqual(build?.items, [{ name: 'vite', version: '未解析', note: '构建与开发服务器' }], 'catalog 依赖解析失败时不展示 catalog: 字面量')
  const other = techStack.groups.at(-1)
  assert.equal(other?.key, 'other', '未登记依赖统一落到最后一组')
  assert.deepEqual(other?.items, [{ name: 'unknown-package', version: '^1.2.3', note: null }], '未登记项回退清单声明值')
})

test('发版更新内容按分组渲染为可直接写进 Tag 说明的 Markdown', () => {
  const markdown = renderReleaseNotesMarkdown({
    version: '0.1.12',
    tag: 'v0.1.12',
    label: '千树 DMS v0.1.12',
    datetime: '2026-09-29T00:00:00+08:00',
    commit: 'aafa579e',
    commitCount: 2,
    range: { from: 'v0.1.11', to: 'v0.1.12' },
    groups: [
      { type: 'feat', label: '新功能', count: 1, items: [{ sha: '67f31bed', subject: '优化角色权限分配抽屉' }] },
      { type: 'fix', label: '修复', count: 1, items: [{ sha: 'a98f8154', subject: '修正图标清单漂移' }] },
    ],
  })
  assert.match(markdown, /^## v0\.1\.12（2026-09-29）/u)
  assert.match(markdown, /### 新功能（1）\n- 优化角色权限分配抽屉 \(67f31bed\)/u)
  assert.match(markdown, /### 修复（1）\n- 修正图标清单漂移 \(a98f8154\)/u)

  const empty = renderReleaseNotesMarkdown({
    version: '0.1.13',
    tag: 'v0.1.13',
    label: null,
    datetime: '2026-10-01',
    commit: 'deadbeef',
    commitCount: 0,
    range: { from: 'v0.1.12', to: 'v0.1.13' },
    groups: [],
  })
  assert.match(empty, /_本版本没有可归类的提交。_/u)
})

test('页面数据契约只暴露文档化的顶层字段', () => {
  const input = {
    source: {
      available: true,
      mode: 'release' as const,
      reason: null,
      version: '0.1.12',
      tag: 'v0.1.12',
      commit: 'aafa579e',
      shortCommit: 'aafa579e',
      branch: 'main',
      describe: 'v0.1.12',
      dirty: false,
      shallow: false,
      generatedAt: '2026-09-29T00:00:00.000Z',
    },
    releases: [],
    unreleased: null,
    graph: { maxLane: 0, commits: [], versions: [] },
    techStack: { runtime: [], groups: [] },
  }
  assert.deepEqual(Object.keys(buildReleaseNotesData(input)).sort(), ['releases', 'schemaVersion', 'source', 'unreleased'])
  assert.deepEqual(Object.keys(buildDevelopmentMapData(input)).sort(), ['graph', 'schemaVersion', 'source', 'techStack'])
})

test('命令行参数解析拒绝未知参数与缺值，并支持发版更新内容模式', () => {
  assert.deepEqual(parseCliOptions([]), { releaseNotes: false, from: null, to: 'HEAD', tag: null })
  assert.deepEqual(parseCliOptions(['--release-notes', '--from', 'v0.1.11', '--to', 'origin/main', '--tag', 'v0.1.12']), {
    releaseNotes: true,
    from: 'v0.1.11',
    to: 'origin/main',
    tag: 'v0.1.12',
  })
  assert.throws(() => parseCliOptions(['--unknown']), /未知参数/u)
  assert.throws(() => parseCliOptions(['--from']), /缺少取值/u)
})

test('不安全的 revision 在调用 Git 之前就被拒绝', async () => {
  // `--upload-pack=...` 这类前导连字符参数是最典型的 Git 选项注入，必须在进入 argv 前拦截。
  await assert.rejects(
    createReleaseNotes('/nonexistent', { from: null, to: '--upload-pack=touch /tmp/pwned', tag: null }),
    /不是安全的 Git revision/u,
  )
  await assert.rejects(
    createReleaseNotes('/nonexistent', { from: '-x', to: 'HEAD', tag: null }),
    /不是安全的 Git revision/u,
  )
})
