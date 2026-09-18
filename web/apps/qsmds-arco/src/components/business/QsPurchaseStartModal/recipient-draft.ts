import type { PaymentRecipientAccountInputDto } from '../../../api/modules/payment-recipients'
import { validatePaymentRecipientAccounts } from '../QsPaymentRecipientEditor/logic'

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const prefix = 'qs-purchase-recipient:'
const lifetime = 24 * 60 * 60 * 1000

/** 账户资料不进入路由；仅随机键可分享，草稿仍受账号和本次登录会话约束。 */
export function savePurchaseRecipientDraft(identity: string, accounts: readonly PaymentRecipientAccountInputDto[], storage: DraftStorage = sessionStorage, createKey: () => string = () => crypto.randomUUID(), now = Date.now()): string {
  if (!identity) {
    throw new Error('Authenticated purchase draft identity is required')
  }
  const key = createKey()
  storage.setItem(`${prefix}${key}`, JSON.stringify({ identity, accounts, createdAt: now }))
  return key
}

export function loadPurchaseRecipientDraft(key: unknown, identity: string, storage: DraftStorage = sessionStorage, now = Date.now()): PaymentRecipientAccountInputDto[] | null {
  if (typeof key !== 'string' || !key || !identity) {
    return null
  }
  try {
    const raw = storage.getItem(`${prefix}${key}`)
    if (!raw) {
      return null
    }
    const draft = JSON.parse(raw)
    if (draft.identity !== identity || !Number.isFinite(draft.createdAt) || now - draft.createdAt > lifetime || !Array.isArray(draft.accounts)) {
      return null
    }
    return validatePaymentRecipientAccounts(draft.accounts, 1) === null ? draft.accounts : null
  }
  catch {
    return null
  }
}

export function clearPurchaseRecipientDraft(key: unknown, storage: DraftStorage = sessionStorage): void {
  if (typeof key === 'string' && key) {
    storage.removeItem(`${prefix}${key}`)
  }
}
