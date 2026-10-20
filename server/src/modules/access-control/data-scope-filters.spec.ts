import { fundAccountScopeWhere, fundLedgerEntryScopeWhere } from '../fund-accounts/application/fund-account-access'
import { fundWithdrawalScopeWhere } from '../fund-withdrawals/fund-withdrawal-access'
import { packagingCostScopeWhere } from '../packaging-costs/packaging-cost-access'
import {
  purchaseOrderPartScopeWhere,
  purchaseOrderPayableScopeWhere,
  purchaseOrderScopeWhere,
} from '../purchase-orders/purchase-order-access'
import { salesOrderScopeWhere } from '../sales-orders/sales-order-access'
import { salesReceiptScopeWhere } from '../sales-orders/receipts/sales-receipt-access'

const ACTOR = '00000000-0000-4000-8000-000000000101'

describe('data scope where builders', () => {
  it('keeps every ALL scope empty so finance, purchasing and custom roles are unchanged', () => {
    expect(salesOrderScopeWhere('ALL', ACTOR)).toEqual({})
    expect(purchaseOrderScopeWhere('ALL', ACTOR)).toEqual({})
    expect(purchaseOrderPartScopeWhere('ALL', ACTOR)).toEqual({})
    expect(purchaseOrderPayableScopeWhere('ALL', ACTOR)).toEqual({})
    expect(salesReceiptScopeWhere('ALL', ACTOR)).toEqual({})
    expect(packagingCostScopeWhere('ALL', ACTOR)).toEqual({})
    expect(fundAccountScopeWhere('ALL', ACTOR)).toEqual({})
    expect(fundLedgerEntryScopeWhere('ALL', ACTOR)).toEqual({})
    expect(fundWithdrawalScopeWhere('ALL', ACTOR)).toEqual({})
  })

  it('maps SELF to the business owner field of each domain', () => {
    expect(salesOrderScopeWhere('SELF', ACTOR)).toEqual({ issuerUserId: ACTOR })
    expect(purchaseOrderScopeWhere('SELF', ACTOR)).toEqual({
      salesOrder: { is: { issuerUserId: ACTOR } },
    })
    expect(purchaseOrderPartScopeWhere('SELF', ACTOR)).toEqual({
      purchaseOrder: { is: { salesOrder: { is: { issuerUserId: ACTOR } } } },
    })
    expect(purchaseOrderPayableScopeWhere('SELF', ACTOR)).toEqual({ ownerUserId: ACTOR })
    expect(salesReceiptScopeWhere('SELF', ACTOR)).toEqual({ accountOwnerUserId: ACTOR })
    expect(packagingCostScopeWhere('SELF', ACTOR)).toEqual({ ownerUserId: ACTOR })
    expect(fundAccountScopeWhere('SELF', ACTOR)).toEqual({ userId: ACTOR })
    expect(fundLedgerEntryScopeWhere('SELF', ACTOR)).toEqual({
      account: { is: { userId: ACTOR } },
    })
    expect(fundWithdrawalScopeWhere('SELF', ACTOR)).toEqual({ userId: ACTOR })
  })
})
