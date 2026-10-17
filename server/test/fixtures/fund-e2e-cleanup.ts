import type { PrismaService } from '../../src/infrastructure/database/prisma.service'

interface FundE2eCleanupOptions {
  readonly roleCodePrefix?: string
  readonly usernamePrefix: string
}

/**
 * 资金域 E2E 会生成账户、批次、流水、提款单和付款截图；共享隔离库里后续套件
 * 会校验空账户/空媒体基线。资金事实表有 DELETE 触发器，清理只在测试事务内
 * 临时关闭 USER 触发器，事务回滚或提交前统一恢复。
 */
export async function cleanupFundE2eData(
  prisma: PrismaService,
  options: FundE2eCleanupOptions,
): Promise<void> {
  const users = await prisma.user.findMany({
    where: { usernameNormalized: { startsWith: options.usernamePrefix } },
    select: { id: true },
  })
  if (users.length === 0) {
    return
  }
  const userIds = users.map(user => user.id)

  const [
    accounts,
    requests,
    batches,
    mediaAssets,
    roles,
  ] = await Promise.all([
    prisma.fundAccount.findMany({
      where: { userId: { in: userIds } },
      select: { id: true },
    }),
    prisma.fundWithdrawalRequest.findMany({
      where: {
        OR: [
          { userId: { in: userIds } },
          { reviewedByUserId: { in: userIds } },
        ],
      },
      select: { id: true, numberingIssuanceId: true },
    }),
    prisma.fundPostingBatch.findMany({
      where: {
        OR: [
          { userId: { in: userIds } },
          { actorUserId: { in: userIds } },
        ],
      },
      select: { id: true, numberingIssuanceId: true },
    }),
    prisma.mediaAsset.findMany({
      where: { createdByUserId: { in: userIds } },
      select: { id: true },
    }),
    options.roleCodePrefix === undefined
      ? Promise.resolve([])
      : prisma.role.findMany({
          where: { code: { startsWith: options.roleCodePrefix } },
          select: { id: true },
        }),
  ])

  const accountIds = accounts.map(account => account.id)
  const requestIds = requests.map(request => request.id)
  const batchIds = batches.map(batch => batch.id)
  const mediaAssetIds = mediaAssets.map(asset => asset.id)
  const roleIds = roles.map(role => role.id)
  const issuanceIds = [...new Set([
    ...requests.map(request => request.numberingIssuanceId),
    ...batches.flatMap(batch => batch.numberingIssuanceId === null
      ? []
      : [batch.numberingIssuanceId]),
  ].filter((value): value is string => typeof value === 'string'))]

  await prisma.$transaction(async (transaction) => {
    for (const table of [
      'fund_withdrawal_requests',
      'fund_posting_batches',
      'fund_ledger_entries',
      'fund_accounts',
      'numbering_issuances',
    ]) {
      await transaction.$executeRawUnsafe(
        `ALTER TABLE "${table}" DISABLE TRIGGER USER`,
      )
    }

    await transaction.auditEvent.deleteMany({
      where: requestIds.length === 0
        ? { actorUserId: { in: userIds } }
        : {
            OR: [
              { actorUserId: { in: userIds } },
              {
                targetType: 'FUND_WITHDRAWAL_REQUEST',
                targetId: { in: requestIds },
              },
            ],
          },
    })
    if (requestIds.length > 0) {
      await transaction.fundWithdrawalRequest.deleteMany({
        where: { id: { in: requestIds } },
      })
    }
    if (batchIds.length > 0) {
      await transaction.fundLedgerEntry.deleteMany({
        where: { batchId: { in: batchIds } },
      })
      await transaction.fundPostingBatch.deleteMany({
        where: { id: { in: batchIds } },
      })
    }
    if (issuanceIds.length > 0) {
      await transaction.numberingIssuance.deleteMany({
        where: { id: { in: issuanceIds } },
      })
    }
    if (accountIds.length > 0) {
      await transaction.fundAccount.deleteMany({
        where: { id: { in: accountIds } },
      })
    }
    if (mediaAssetIds.length > 0) {
      await transaction.mediaAsset.deleteMany({
        where: { id: { in: mediaAssetIds } },
      })
    }
    await transaction.authSession.deleteMany({
      where: { userId: { in: userIds } },
    })
    await transaction.userRole.deleteMany({
      where: { userId: { in: userIds } },
    })
    await transaction.user.updateMany({
      where: { id: { in: userIds } },
      data: {
        status: 'ACTIVE',
        createdByUserId: null,
        disabledAt: null,
        disabledByUserId: null,
      },
    })
    await transaction.user.deleteMany({ where: { id: { in: userIds } } })
    if (roleIds.length > 0) {
      await transaction.rolePermission.deleteMany({
        where: { roleId: { in: roleIds } },
      })
      await transaction.role.deleteMany({ where: { id: { in: roleIds } } })
    }

    for (const table of [
      'fund_withdrawal_requests',
      'fund_posting_batches',
      'fund_ledger_entries',
      'fund_accounts',
      'numbering_issuances',
    ]) {
      await transaction.$executeRawUnsafe(
        `ALTER TABLE "${table}" ENABLE TRIGGER USER`,
      )
    }
  })
}
