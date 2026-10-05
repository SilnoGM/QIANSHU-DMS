import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  ReleaseImagesStageError,
  buildReleaseImages,
  imageArtifactNames,
  imageReferences,
  parseReleaseImagesArguments,
} from './release-images.mjs'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptsDirectory, '..')
const tag = 'v1.2.3'
const imageDigest = `sha256:${'c'.repeat(64)}`

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function createTemporaryRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'qianshu-release-images-test-'))
}

function cliArguments(overrides = {}) {
  const values = {
    output: 'images',
    platform: 'linux/amd64',
    serverArchive: 'server.tar.gz',
    tag,
    webArchive: 'web.tar.gz',
    ...overrides,
  }
  return [
    '--tag', values.tag,
    '--platform', values.platform,
    '--server-archive', values.serverArchive,
    '--web-archive', values.webArchive,
    '--output', values.output,
  ]
}

test('镜像构建参数只接受固定 flag 顺序与稳定 Tag 形状', () => {
  assert.deepEqual(
    parseReleaseImagesArguments(cliArguments(), '/work'),
    {
      outputDirectory: '/work/images',
      platform: 'linux/amd64',
      serverArchivePath: '/work/server.tar.gz',
      tag,
      webArchivePath: '/work/web.tar.gz',
    },
  )
  assert.throws(() => parseReleaseImagesArguments(['--tag', tag], '/work'), /Usage/u)
  assert.throws(
    () => parseReleaseImagesArguments(
      ['--tag', tag, '--server-archive', 'a', '--platform', 'linux/amd64', '--web-archive', 'b', '--output', 'c'],
      '/work',
    ),
    /Usage/u,
  )
})

test('镜像归档名与镜像引用由 Tag 唯一决定', () => {
  assert.deepEqual(imageArtifactNames(tag), {
    server: 'qsmds-server-image-v1.2.3-linux-x64.tar.gz',
    web: 'qsmds-web-image-v1.2.3-linux-x64.tar.gz',
  })
  assert.deepEqual(imageReferences(tag), {
    server: 'qsmds-server:v1.2.3',
    web: 'qsmds-web:v1.2.3',
  })
  assert.throws(() => imageArtifactNames('1.2.3'), /stable/u)
  assert.throws(() => imageArtifactNames('v1.2.3-preview'), /stable/u)
})

test('镜像构建按 server→web 顺序产出可校验的元数据并清理暂存目录', async () => {
  const temporaryRoot = await createTemporaryRoot()
  const outputDirectory = path.join(temporaryRoot, 'images')
  const buildCommands = []
  const inspectedReferences = []
  const savedBytes = new Map()
  const dependencies = {
    repositoryRoot,
    temporaryRoot,
    run: async (command, args) => {
      if (command !== 'docker') {
        throw new Error(`Unexpected command: ${command}`)
      }
      buildCommands.push(args)
      // 构建上下文里必须已经放好镜像资产与固定目录名的应用树。
      const contextDirectory = args.at(-1)
      for (const relativePath of [
        'Dockerfile.server',
        'Dockerfile.web',
        'nginx/qianshu-dms.conf',
        'entrypoint/server-entrypoint.sh',
        'server-app',
        'web-app',
      ]) {
        await fs.lstat(path.join(contextDirectory, relativePath))
      }
      return undefined
    },
    runCapture: async (command, args) => {
      assert.equal(command, 'docker')
      assert.deepEqual(args.slice(0, 2), ['image', 'inspect'])
      inspectedReferences.push(args.at(-1))
      return `${imageDigest}\n`
    },
    saveImage: async ({ destination }) => {
      const bytes = Buffer.from(`image-archive:${path.basename(destination)}\n`)
      await fs.writeFile(destination, bytes, { flag: 'wx', mode: 0o600 })
      savedBytes.set(path.basename(destination), bytes)
    },
    // 真实流程复用 release-package 的归档审计与解包校验；这里只验证编排与产物契约。
    stageApplications: async (input, stageRoot) => {
      assert.equal(input.tag, tag)
      for (const directory of ['server-app', 'web-app']) {
        await fs.mkdir(path.join(stageRoot, directory))
      }
    },
  }

  const result = await buildReleaseImages({
    outputDirectory,
    platform: 'linux/amd64',
    serverArchivePath: path.join(temporaryRoot, 'server.tar.gz'),
    tag,
    webArchivePath: path.join(temporaryRoot, 'web.tar.gz'),
  }, dependencies)

  assert.equal(buildCommands.length, 2)
  assert.deepEqual(inspectedReferences, ['qsmds-server:v1.2.3', 'qsmds-web:v1.2.3'])
  for (const kind of ['server', 'web']) {
    const index = kind === 'server' ? 0 : 1
    const command = buildCommands[index]
    assert.deepEqual(command.slice(0, 6), [
      'build',
      '--platform',
      'linux/amd64',
      '--tag',
      `qsmds-${kind}:${tag}`,
      '--file',
    ])
    assert.ok(command[6].endsWith(`Dockerfile.${kind}`))
  }

  for (const kind of ['server', 'web']) {
    const bytes = savedBytes.get(imageArtifactNames(tag)[kind])
    assert.deepEqual(result.metadata.images[kind], {
      reference: `qsmds-${kind}:${tag}`,
      digest: imageDigest,
      archive: imageArtifactNames(tag)[kind],
      platform: 'linux',
      arch: 'x64',
      sha256: `sha256:${sha256(bytes)}`,
      size: bytes.length,
    })
  }
  const metadataContents = await fs.readFile(result.metadataPath, 'utf8')
  assert.equal(metadataContents, `${JSON.stringify(result.metadata, null, 2)}\n`)

  const outputEntries = await fs.readdir(outputDirectory)
  outputEntries.sort()
  assert.deepEqual(outputEntries, [
    'qsmds-server-image-v1.2.3-linux-x64.tar.gz',
    'qsmds-web-image-v1.2.3-linux-x64.tar.gz',
    'release-images.json',
  ])
  // 暂存目录必须回收，否则每次发布都会在 runner 临时目录里留下整棵应用树。
  assert.deepEqual(await fs.readdir(temporaryRoot), ['images'])
})

test('镜像保存失败时不留下元数据与半成品', async () => {
  const temporaryRoot = await createTemporaryRoot()
  const outputDirectory = path.join(temporaryRoot, 'images')
  const dependencies = {
    repositoryRoot,
    temporaryRoot,
    run: async () => undefined,
    runCapture: async () => `${imageDigest}\n`,
    saveImage: async ({ destination }) => {
      // 模拟 docker save 中途失败：半成品已经落盘，随后必须被回收。
      await fs.writeFile(destination, 'partial', { flag: 'wx', mode: 0o600 })
      throw new Error('docker save failed')
    },
    stageApplications: async (input, stageRoot) => {
      await fs.mkdir(path.join(stageRoot, 'server-app'))
      await fs.mkdir(path.join(stageRoot, 'web-app'))
    },
  }

  await assert.rejects(
    buildReleaseImages({
      outputDirectory,
      platform: 'linux/amd64',
      serverArchivePath: path.join(temporaryRoot, 'server.tar.gz'),
      tag,
      webArchivePath: path.join(temporaryRoot, 'web.tar.gz'),
    }, dependencies),
    error => error instanceof ReleaseImagesStageError && error.exitCode === 1,
  )
  assert.deepEqual(await fs.readdir(outputDirectory), [])
  assert.deepEqual(await fs.readdir(temporaryRoot), ['images'])
})

test('镜像构建输入拒绝未知字段与不支持的平台', async () => {
  const temporaryRoot = await createTemporaryRoot()
  const input = {
    outputDirectory: path.join(temporaryRoot, 'images'),
    platform: 'linux/amd64',
    serverArchivePath: path.join(temporaryRoot, 'server.tar.gz'),
    tag,
    webArchivePath: path.join(temporaryRoot, 'web.tar.gz'),
  }
  await assert.rejects(
    buildReleaseImages({ ...input, extra: true }, { repositoryRoot, temporaryRoot }),
    /unsupported shape/u,
  )
  await assert.rejects(
    buildReleaseImages({ ...input, platform: 'linux/arm64' }, { repositoryRoot, temporaryRoot }),
    /platform is unsupported/u,
  )
  await assert.rejects(
    buildReleaseImages({ ...input, tag: 'v1.2.3-preview' }, { repositoryRoot, temporaryRoot }),
    /stable vX.Y.Z/u,
  )
})
