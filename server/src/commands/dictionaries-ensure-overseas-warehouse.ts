import 'dotenv/config'
import 'reflect-metadata'

import { ApiException } from '../infrastructure/http/api.exception'

const OVERSEAS_WAREHOUSE_TYPE = {
  code: 'overseas.warehouse',
  name: '海外仓库',
  sortOrder: 0,
  items: [
    { value: 'RF_TZ', label: '瑞锋-台中仓', sortOrder: 0 },
    { value: 'RF_LK', label: '瑞锋-林口仓', sortOrder: 10 },
  ],
} as const

interface EnsureResult {
  readonly mode: 'preview' | 'applied'
  readonly typeCreated: number
  readonly typeEnabled: number
  readonly itemsCreated: number
  readonly itemsEnabled: number
  readonly skipped: number
}

interface Dependencies {
  run(apply: boolean): Promise<EnsureResult>
  output: { log(value: string): void, error(value: string): void }
  processRef: { exitCode?: number | string | null }
}

function parseArguments(argv: readonly string[]): boolean {
  let apply = false
  for (const argument of argv) {
    if (argument === '--apply') {
      apply = true
      continue
    }
    if (argument === '--dry-run') continue
    throw new Error('Invalid dictionary ensure arguments')
  }
  return apply
}

async function runDefault(apply: boolean): Promise<EnsureResult> {
  const [{ NestFactory }, { AppModule }, { PrismaService }, { DictionaryCommandService }] = await Promise.all([
    import('@nestjs/core'),
    import('../app.module'),
    import('../infrastructure/database/prisma.service'),
    import('../modules/dictionaries/dictionary-command.service'),
  ])
  const application = await NestFactory.createApplicationContext(AppModule, { abortOnError: false, logger: false })
  try {
    const prisma = application.get(PrismaService)
    const commands = application.get(DictionaryCommandService, { strict: false })
    const admin = await prisma.userRole.findFirst({
      where: { role: { code: 'system_admin' } },
      select: { userId: true },
      orderBy: { userId: 'asc' },
    })
    if (admin === null) {
      throw new ApiException(409, 'DICTIONARY_ENSURE_ACTOR_MISSING', '缺少系统管理员账号，无法写入字典')
    }
    const context = { actorUserId: admin.userId, requestId: `cli-overseas-warehouse-${Date.now()}` }
    let type = await prisma.dictionaryType.findUnique({
      where: { code: OVERSEAS_WAREHOUSE_TYPE.code },
      include: { items: true },
    })
    let typeCreated = 0
    let typeEnabled = 0
    let itemsCreated = 0
    let itemsEnabled = 0
    let skipped = 0

    if (type === null) {
      if (!apply) {
        return {
          mode: 'preview',
          typeCreated: 1,
          typeEnabled: 1,
          itemsCreated: OVERSEAS_WAREHOUSE_TYPE.items.length,
          itemsEnabled: OVERSEAS_WAREHOUSE_TYPE.items.length,
          skipped: 0,
        }
      }
      const createdType = await commands.createType(context, {
        code: OVERSEAS_WAREHOUSE_TYPE.code,
        name: OVERSEAS_WAREHOUSE_TYPE.name,
        sortOrder: OVERSEAS_WAREHOUSE_TYPE.sortOrder,
      })
      typeCreated += 1
      for (const item of OVERSEAS_WAREHOUSE_TYPE.items) {
        const createdItem = await commands.createItem(context, createdType.id, {
          value: item.value,
          label: item.label,
          sortOrder: item.sortOrder,
        })
        await commands.enableItem(context, createdType.id, createdItem.id, {
          expectedVersion: createdItem.version,
        })
        itemsCreated += 1
        itemsEnabled += 1
      }
      const refreshed = await prisma.dictionaryType.findUniqueOrThrow({
        where: { id: createdType.id },
        select: { version: true },
      })
      await commands.enableType(context, createdType.id, { expectedVersion: refreshed.version })
      typeEnabled += 1
      return { mode: 'applied', typeCreated, typeEnabled, itemsCreated, itemsEnabled, skipped }
    }

    const itemsByValue = new Map(type.items.map(item => [item.value, item]))
    for (const item of OVERSEAS_WAREHOUSE_TYPE.items) {
      const existing = itemsByValue.get(item.value)
      if (existing === undefined) {
        if (apply) {
          const createdItem = await commands.createItem(context, type.id, {
            value: item.value,
            label: item.label,
            sortOrder: item.sortOrder,
          })
          await commands.enableItem(context, type.id, createdItem.id, {
            expectedVersion: createdItem.version,
          })
          itemsCreated += 1
          itemsEnabled += 1
        }
        else {
          itemsCreated += 1
          itemsEnabled += 1
        }
        continue
      }
      if (!existing.enabled) {
        if (apply) {
          await commands.enableItem(context, type.id, existing.id, {
            expectedVersion: existing.version,
          })
        }
        itemsEnabled += 1
        continue
      }
      skipped += 1
    }

    if (!type.enabled) {
      if (apply) {
        const refreshed = await prisma.dictionaryType.findUniqueOrThrow({
          where: { id: type.id },
          select: { version: true },
        })
        await commands.enableType(context, type.id, { expectedVersion: refreshed.version })
      }
      typeEnabled += 1
    }

    return {
      mode: apply ? 'applied' : 'preview',
      typeCreated,
      typeEnabled,
      itemsCreated,
      itemsEnabled,
      skipped,
    }
  }
  finally {
    await application.close()
  }
}

/** 只补齐海外仓类型与两个条目，不修改已有标签，也不触碰其他字典。 */
export async function runEnsureOverseasWarehouseCli(
  argv: readonly string[],
  dependencies: Dependencies = { run: runDefault, output: console, processRef: process },
): Promise<void> {
  try {
    const result = await dependencies.run(parseArguments(argv))
    dependencies.output.log(JSON.stringify({ kind: 'ensure_overseas_warehouse', ...result }))
  }
  catch (error) {
    dependencies.output.error(JSON.stringify({
      kind: 'ensure_overseas_warehouse',
      status: 'failed',
      code: error instanceof ApiException ? error.code : 'DICTIONARY_ENSURE_FAILED',
    }))
    dependencies.processRef.exitCode = 1
  }
}

if (process.argv[1]?.endsWith('dictionaries-ensure-overseas-warehouse.js')) {
  void runEnsureOverseasWarehouseCli(process.argv.slice(2))
}
