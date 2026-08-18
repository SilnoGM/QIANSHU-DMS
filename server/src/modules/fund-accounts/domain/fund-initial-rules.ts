import type {
  FundAmountSignPolicy,
  FundBusinessCategory,
  FundDirectionPolicy,
  FundPostingRule,
} from './fund-rule.types'

function splitRule(
  postingTypeCode: string,
  businessCategory: FundBusinessCategory,
  directionPolicy: FundDirectionPolicy,
  amountSignPolicy: FundAmountSignPolicy,
): FundPostingRule {
  return {
    postingTypeCode,
    businessCategory,
    amountSignPolicy,
    requiresUser: true,
    inputMode: 'STANDARD',
    legs: [
      {
        position: 1,
        accountTarget: 'USER',
        directionPolicy,
        amountStrategy: 'USER_SHARE',
      },
      {
        position: 2,
        accountTarget: 'COMPANY',
        directionPolicy,
        amountStrategy: 'COMPANY_REMAINDER',
      },
    ],
  }
}

/** 九个初始化业务类型的首版规则，是后续 migration 种子和运行时校验的真相源。 */
export const INITIAL_FUND_POSTING_RULES: readonly FundPostingRule[] = [
  splitRule(
    'ORDER_SETTLEMENT',
    'REVENUE',
    'FOLLOW_AMOUNT_SIGN',
    'NON_ZERO_SIGNED',
  ),
  {
    postingTypeCode: 'USER_WITHDRAWAL',
    businessCategory: 'NEUTRAL',
    amountSignPolicy: 'POSITIVE_ONLY',
    requiresUser: true,
    inputMode: 'STANDARD',
    legs: [{
      position: 1,
      accountTarget: 'USER',
      directionPolicy: 'DEBIT',
      amountStrategy: 'FULL_AMOUNT',
    }],
  },
  splitRule('PURCHASE_PAYMENT', 'COST', 'DEBIT', 'POSITIVE_ONLY'),
  {
    postingTypeCode: 'RENT_UTILITIES',
    businessCategory: 'COST',
    amountSignPolicy: 'POSITIVE_ONLY',
    requiresUser: false,
    inputMode: 'STANDARD',
    legs: [{
      position: 1,
      accountTarget: 'COMPANY',
      directionPolicy: 'DEBIT',
      amountStrategy: 'FULL_AMOUNT',
    }],
  },
  splitRule('BUSINESS_ACCOUNT_FEE', 'COST', 'DEBIT', 'POSITIVE_ONLY'),
  splitRule('ADVERTISING_FEE', 'COST', 'DEBIT', 'POSITIVE_ONLY'),
  splitRule('NETWORK_IP_VPN_FEE', 'COST', 'DEBIT', 'POSITIVE_ONLY'),
  splitRule('INVOICE_FEE', 'COST', 'DEBIT', 'POSITIVE_ONLY'),
  {
    postingTypeCode: 'ADMIN_MANUAL_ADJUSTMENT',
    businessCategory: 'ADJUSTMENT',
    amountSignPolicy: 'NON_ZERO_SIGNED',
    requiresUser: true,
    inputMode: 'ADMIN_ADJUSTMENT',
    legs: [
      {
        position: 1,
        accountTarget: 'USER',
        directionPolicy: 'FOLLOW_AMOUNT_SIGN',
        amountStrategy: 'FULL_AMOUNT',
        adjustmentMode: 'USER_ONLY',
      },
      {
        position: 2,
        accountTarget: 'USER',
        directionPolicy: 'FOLLOW_AMOUNT_SIGN',
        amountStrategy: 'USER_SHARE',
        adjustmentMode: 'USER_AND_COMPANY_BY_SHARE',
      },
      {
        position: 3,
        accountTarget: 'COMPANY',
        directionPolicy: 'FOLLOW_AMOUNT_SIGN',
        amountStrategy: 'COMPANY_REMAINDER',
        adjustmentMode: 'USER_AND_COMPANY_BY_SHARE',
      },
    ],
  },
]
