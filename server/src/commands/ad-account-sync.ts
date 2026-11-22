import 'dotenv/config'

import { CHEETAHGO_API_BASE_URL } from '../config/cheetahgo.config'
import { PrismaService } from '../infrastructure/database/prisma.service'
import { AdAccountSyncService } from '../modules/ad-accounts/ad-account-sync.service'
import { CheetahGoClient } from '../modules/ad-accounts/cheetahgo.client'
import { AuditService } from '../modules/audit/audit.service'
import { NumberingGeneratorService } from '../modules/numbering/numbering-generator.service'
import { SystemNotificationService } from '../modules/notifications/system-notification.service'

export interface AdAccountSyncOutput {
  log(message: string): void
  error(message: string): void
}

/**
 * 广告账户同步命令。由宿主 systemd timer 每 15 分钟调用一次。
 *
 * 凭据缺失时以非零退出码结束：定时任务里「静默跳过」等于监控失效，
 * 必须让 systemd 记录一次失败。
 */
export async function runAdAccountSyncCli(
  argv: readonly string[],
  output: AdAccountSyncOutput = console,
  connectionString = process.env.DATABASE_URL,
): Promise<number> {
  const dryRun = argv.includes('--dry-run')
  const nowArg = argv.find(argument => argument.startsWith('--now='))
  const now = nowArg === undefined ? undefined : new Date(nowArg.slice('--now='.length))

  if (
    connectionString === undefined
    || connectionString.length === 0
    || (now !== undefined && Number.isNaN(now.getTime()))
  ) {
    output.error('Ad account sync failed')
    return 1
  }

  const prisma = new PrismaService({
    getOrThrow: (key: string) => {
      if (key === 'DATABASE_URL') {
        return connectionString
      }

      throw new Error('Ad account sync failed')
    },
  } as never)

  try {
    await prisma.$connect()

    const appid = process.env.CHEETAHGO_APPID
    const secret = process.env.CHEETAHGO_SECRET
    const client = appid && secret
      ? new CheetahGoClient({ appid, secret, baseUrl: CHEETAHGO_API_BASE_URL })
      : null

    const service = new AdAccountSyncService(
      prisma,
      new SystemNotificationService(prisma, new NumberingGeneratorService(prisma)),
      new AuditService(),
      client,
    )

    const result = await service.sync({
      dryRun,
      ...(now === undefined ? {} : { now: () => now }),
    })

    output.log(JSON.stringify({ kind: 'ad_account_sync', ...result }))

    if (result.status === 'skipped' && result.reason === 'disabled') {
      output.error('Ad account sync skipped: CHEETAHGO_APPID / CHEETAHGO_SECRET are not configured')
      return 1
    }

    return 0
  }
  catch (error) {
    output.error(`Ad account sync failed: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
  finally {
    await prisma.onModuleDestroy().catch(() => undefined)
  }
}

if (require.main === module) {
  void runAdAccountSyncCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code
  })
}
