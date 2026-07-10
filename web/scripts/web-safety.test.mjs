import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(scriptsDir, '..')

const credentialKeyPattern = /secret|token|password|passwd|api[_-]?key|private[_-]?key|credential|dsn/i
const urlCredentialPattern = /:\/\/[^/\s@]+:[^/\s@]+@/
const obviousSecretPattern = /-----BEGIN [A-Z ]*PRIVATE KEY-----|sk-[A-Za-z0-9_-]{16,}|AKIA[A-Z0-9]{16}/i

const commonKeys = [
  'VITE_APP_SETTING',
  'VITE_APP_TITLE',
  'VITE_APP_API_BASEURL',
  'VITE_APP_STORAGE_PREFIX',
  'VITE_APP_DEBUG_TOOL',
]

const expectedKeysByMode = {
  development: [
    ...commonKeys,
    'VITE_ENABLE_PROXY',
    'VITE_ENABLE_VUE_DEVTOOLS',
    'VITE_ENABLE_TURBO_CONSOLE',
    'VITE_LAUNCH_EDITOR',
  ],
  production: [
    ...commonKeys,
    'VITE_APP_DISABLE_DEVTOOL',
    'VITE_BUILD_FAKE',
    'VITE_BUILD_SOURCEMAP',
    'VITE_BUILD_COMPRESS',
    'VITE_BUILD_ARCHIVE',
  ],
  test: [
    ...commonKeys,
    'VITE_APP_DISABLE_DEVTOOL',
    'VITE_BUILD_FAKE',
    'VITE_BUILD_SOURCEMAP',
    'VITE_BUILD_COMPRESS',
    'VITE_BUILD_ARCHIVE',
  ],
}

const appIdentityByDirectory = {
  'core': {
    storagePrefix: 'fantastic-admin-core-reference',
    title: 'Fantastic Admin Core Reference',
  },
  'core-arco-design-vue': {
    storagePrefix: 'fantastic-admin-arco-reference',
    title: 'Fantastic Admin Arco Reference',
  },
  'example': {
    storagePrefix: 'fantastic-admin-example-reference',
    title: 'Fantastic Admin Example Reference',
  },
  'qsmds-arco': {
    storagePrefix: 'qianshu-dms',
    title: '千树 DMS',
  },
}

function getExpectedValues(mode, appDirectoryName) {
  const identity = appIdentityByDirectory[appDirectoryName]
  assert.ok(identity, `未声明应用模板标识：${appDirectoryName}`)

  const commonValues = {
    VITE_APP_API_BASEURL: '/api',
    VITE_APP_DEBUG_TOOL: '',
    VITE_APP_STORAGE_PREFIX: identity.storagePrefix,
    VITE_APP_TITLE: identity.title,
  }

  if (mode === 'development') {
    return {
      ...commonValues,
      VITE_APP_SETTING: 'true',
      VITE_ENABLE_PROXY: 'false',
      VITE_ENABLE_TURBO_CONSOLE: 'false',
      VITE_ENABLE_VUE_DEVTOOLS: 'true',
      VITE_LAUNCH_EDITOR: '',
    }
  }

  if (mode === 'test') {
    return {
      ...commonValues,
      VITE_APP_DISABLE_DEVTOOL: 'false',
      VITE_APP_SETTING: 'false',
      VITE_BUILD_ARCHIVE: 'false',
      VITE_BUILD_COMPRESS: '',
      VITE_BUILD_FAKE: 'true',
      VITE_BUILD_SOURCEMAP: 'true',
    }
  }

  return {
    ...commonValues,
    VITE_APP_DISABLE_DEVTOOL: 'true',
    VITE_APP_SETTING: 'false',
    VITE_BUILD_ARCHIVE: 'false',
    VITE_BUILD_COMPRESS: 'gzip,brotli',
    VITE_BUILD_FAKE: 'false',
    VITE_BUILD_SOURCEMAP: 'false',
  }
}

function discoverAppDirectories() {
  const appDirectories = []

  for (const workspaceDirectory of ['apps', 'examples']) {
    const absoluteWorkspaceDirectory = path.join(webRoot, workspaceDirectory)
    if (!fs.existsSync(absoluteWorkspaceDirectory)) {
      continue
    }

    for (const entry of fs.readdirSync(absoluteWorkspaceDirectory, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue
      }

      const appDirectory = path.join(absoluteWorkspaceDirectory, entry.name)
      if (fs.existsSync(path.join(appDirectory, 'package.json'))) {
        appDirectories.push(appDirectory)
      }
    }
  }

  return appDirectories.sort()
}

function parseEnvTemplate(templatePath) {
  const entries = {}

  for (const [index, rawLine] of fs.readFileSync(templatePath, 'utf8').split(/\r?\n/).entries()) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) {
      continue
    }

    const separatorIndex = line.indexOf('=')
    assert.notEqual(separatorIndex, -1, `${templatePath}:${index + 1} 缺少等号`)

    const key = line.slice(0, separatorIndex).trim()
    const value = line.slice(separatorIndex + 1).trim()
    assert.ok(key, `${templatePath}:${index + 1} 缺少变量名`)
    assert.equal(Object.hasOwn(entries, key), false, `${templatePath}:${index + 1} 重复声明 ${key}`)
    entries[key] = value
  }

  return entries
}

function listTrackedFilesFromNearestGit(startDirectory) {
  // Web 可以从外层仓库归档后独立运行，因此先探测 Git 根；“没有 Git 元数据”是合法的移植状态。
  const rootResult = spawnSync('git', ['-C', startDirectory, 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  })

  if (rootResult.error) {
    throw new Error('无法执行 Git 仓库探测', { cause: rootResult.error })
  }

  if (rootResult.status !== 0) {
    return null
  }

  const gitRoot = rootResult.stdout.trim()
  assert.ok(gitRoot, 'Git 仓库探测未返回根目录')

  const trackedResult = spawnSync('git', ['-C', gitRoot, 'ls-files', '-z'], {
    encoding: 'utf8',
  })

  if (trackedResult.error) {
    throw new Error('无法读取 Git 已跟踪文件', { cause: trackedResult.error })
  }

  assert.equal(trackedResult.status, 0, 'Git 已跟踪文件检查失败')
  return trackedResult.stdout.split('\0').filter(Boolean)
}

test('安全模式能够识别凭据型键、URL 用户信息和明显密钥值', () => {
  assert.equal(credentialKeyPattern.test('VITE_API_TOKEN'), true)
  assert.equal(urlCredentialPattern.test('https://user:pass@example.com'), true)
  assert.equal(obviousSecretPattern.test('sk-1234567890abcdefghijklmnop'), true)
})

test('所有 Web 应用都提供精确且不含凭据的环境模板', () => {
  const appDirectories = discoverAppDirectories()
  assert.ok(appDirectories.length > 0, '未发现任何 Web 应用')

  for (const appDirectory of appDirectories) {
    const appDirectoryName = path.basename(appDirectory)

    for (const mode of Object.keys(expectedKeysByMode)) {
      const templatePath = path.join(appDirectory, `.env.${mode}.example`)
      assert.equal(fs.existsSync(templatePath), true, `缺少环境模板：${templatePath}`)

      const entries = parseEnvTemplate(templatePath)
      assert.deepEqual(Object.keys(entries).sort(), [...expectedKeysByMode[mode]].sort(), `${templatePath} 的键集合不正确`)
      assert.deepEqual(entries, getExpectedValues(mode, appDirectoryName), `${templatePath} 的公开默认值不正确`)

      for (const [key, value] of Object.entries(entries)) {
        assert.equal(credentialKeyPattern.test(key), false, `${templatePath} 包含凭据型键名：${key}`)
        assert.equal(urlCredentialPattern.test(value), false, `${templatePath} 包含 URL 内嵌凭据`)
        assert.equal(obviousSecretPattern.test(value), false, `${templatePath} 包含明显密钥值`)
      }
    }
  }
})

test('Web 自身的 ignore 规则保护真实环境文件和生成物并放行模板', () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'qianshu-web-safety-'))

  try {
    fs.copyFileSync(path.join(webRoot, '.gitignore'), path.join(temporaryDirectory, '.gitignore'))
    fs.mkdirSync(path.join(temporaryDirectory, 'app', 'coverage'), { recursive: true })
    fs.writeFileSync(path.join(temporaryDirectory, 'app', '.env.development'), 'PUBLIC_VALUE=true\n')
    fs.writeFileSync(path.join(temporaryDirectory, 'app', '.env.development.example'), 'PUBLIC_VALUE=true\n')
    fs.writeFileSync(path.join(temporaryDirectory, 'app', 'coverage', 'result.json'), '{}\n')
    fs.writeFileSync(path.join(temporaryDirectory, 'app', 'runtime.log'), 'safe test log\n')
    execFileSync('git', ['init', '--quiet'], { cwd: temporaryDirectory })

    for (const ignoredPath of ['app/.env.development', 'app/coverage/result.json', 'app/runtime.log']) {
      const result = spawnSync('git', ['check-ignore', '--quiet', '--', ignoredPath], { cwd: temporaryDirectory })
      assert.equal(result.status, 0, `${ignoredPath} 应由 web/.gitignore 独立忽略`)
    }

    const exampleResult = spawnSync('git', ['check-ignore', '--quiet', '--', 'app/.env.development.example'], {
      cwd: temporaryDirectory,
    })
    assert.equal(exampleResult.status, 1, '环境模板必须被 Git 放行')
  }
  finally {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true })
  }
})

test('没有 Git 父目录时不把独立 Web 副本误判为失败', () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'qianshu-web-no-git-'))

  try {
    assert.equal(listTrackedFilesFromNearestGit(temporaryDirectory), null)
  }
  finally {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true })
  }
})

test('最近的 Git 仓库没有追踪任何真实环境文件', (context) => {
  const trackedFiles = listTrackedFilesFromNearestGit(webRoot)
  if (trackedFiles === null) {
    context.skip('独立 Web 副本没有 Git 元数据，跳过 tracked 文件断言')
    return
  }

  const trackedRealEnvFiles = trackedFiles.filter((file) => {
    const fileName = path.basename(file)
    return (fileName === '.env' || fileName.startsWith('.env.')) && !fileName.endsWith('.example')
  })

  assert.deepEqual(trackedRealEnvFiles, [])
})
