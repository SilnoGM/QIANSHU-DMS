import type { Prisma } from '../../generated/prisma/client'
import { DATA_SCOPE_ALL } from '../access-control/data-scope'
import { INVOICE_REQUEST_MANAGER_PERMISSION_CODE } from './invoice-request.contract'

/**
 * 操作者对开票申请的可见与可操作范围。
 *
 * 权限守卫只保证「能进这个接口」；「运营仅可见本人」是行级归属，必须在这层判定，
 * 因此这里显式查一次授权：持有 `:read-all` 或 `data-scope:all` 的（财务与系统管理员）
 * 可以跨提交人查看与取消，其余人只能看到并操作自己提交的单据。
 */
export interface InvoiceRequestViewer {
  readonly actorUserId: string
  readonly canManageOthers: boolean
}

type ViewerReader = Pick<Prisma.TransactionClient, 'userRole'>

export async function resolveInvoiceRequestViewer(
  reader: ViewerReader,
  actorUserId: string,
): Promise<InvoiceRequestViewer> {
  const grant = await reader.userRole.findFirst({
    where: {
      userId: actorUserId,
      role: {
        permissions: {
          some: {
            permission: {
              code: {
                in: [INVOICE_REQUEST_MANAGER_PERMISSION_CODE, DATA_SCOPE_ALL],
              },
            },
          },
        },
      },
    },
    select: { userId: true },
  })
  return { actorUserId, canManageOthers: grant !== null }
}
