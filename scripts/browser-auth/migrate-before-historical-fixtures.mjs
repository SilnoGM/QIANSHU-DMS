import { cp, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { validateBrowserAuthDatabaseUrl } from '../ci-browser-auth-e2e.mjs'
import { isDirectEntry, runCommand } from '../run-command.mjs'

export const historicalFixtureCutover = '20260907120000_purchase_order_parts'
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))

export function selectHistoricalFixtureMigrations(names) {
  if (!names.includes(historicalFixtureCutover)) {
    throw new Error('Historical fixture cutover migration is missing')
  }
  return names.filter(name => /^\d+_[a-z0-9_]+$/u.test(name) && name < historicalFixtureCutover).sort()
}

/**
 * 历史订单必须在对应约束发布前写入。仅在一次性 CI 数据库复制旧 migration 集合，
 * 仍由 Prisma 正常 deploy 并记录账本；夹具完成后再 deploy 当前集合，不关闭任何守卫。
 */
export async function migrateBeforeHistoricalFixtures(environment = process.env) {
  const databaseUrl = validateBrowserAuthDatabaseUrl(environment.DATABASE_URL)
  const directory = path.join(repositoryRoot, 'server/prisma/migrations')
  const names = selectHistoricalFixtureMigrations(await readdir(directory))
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'qianshu-browser-history-'))
  try {
    const migrations = path.join(temporaryDirectory, 'migrations')
    for (const name of [...names, 'migration_lock.toml']) {
      await cp(path.join(directory, name), path.join(migrations, name), { recursive: true })
    }
    const require = createRequire(path.join(repositoryRoot, 'server/package.json'))
    const configPath = path.join(temporaryDirectory, 'prisma.config.mjs')
    await writeFile(configPath, [
      `import { defineConfig } from ${JSON.stringify(pathToFileURL(require.resolve('prisma/config')).href)}`,
      `export default defineConfig({ schema: ${JSON.stringify(path.join(repositoryRoot, 'server/prisma/schema.prisma'))},`,
      `migrations: { path: ${JSON.stringify(migrations)} }, datasource: { url: process.env.DATABASE_URL } })`,
    ].join('\n'), { mode: 0o600 })
    await runCommand('pnpm', ['-C', 'server', 'exec', 'prisma', 'migrate', 'deploy', '--config', configPath], {
      cwd: repositoryRoot,
      env: { ...environment, DATABASE_URL: databaseUrl, DOTENV_CONFIG_PATH: '/dev/null' },
    })
  }
  finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}

if (isDirectEntry(import.meta.url)) {
  migrateBeforeHistoricalFixtures().catch(() => {
    console.error('Browser historical fixture migration failed')
    process.exitCode = 1
  })
}
