import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 本单收款草稿必须隔离登录会话且不能将账户资料写入 URL。
import test from 'node:test'
import { clearPurchaseRecipientDraft, loadPurchaseRecipientDraft, savePurchaseRecipientDraft } from '../../src/components/business/QsPurchaseStartModal/recipient-draft'

const accounts = [{ paymentMethod: 'BANK_TRANSFER' as const, recipientName: '供应商', bankName: '测试银行', bankAccount: '12345678' }]
function storage() {
  const records = new Map<string, string>()
  return {
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => { records.set(key, value) },
    removeItem: (key: string) => { records.delete(key) },
  }
}

test('本单收款草稿按账号与登录会话隔离，读取不消耗，完成后清除', () => {
  const store = storage()
  const key = savePurchaseRecipientDraft('user:session1', accounts, store, () => 'draft-key')
  assert.equal(key, 'draft-key')
  assert.deepEqual(loadPurchaseRecipientDraft(key, 'user:session1', store), accounts)
  assert.deepEqual(loadPurchaseRecipientDraft(key, 'user:session1', store), accounts)
  assert.equal(loadPurchaseRecipientDraft(key, 'other:session1', store), null)
  assert.equal(loadPurchaseRecipientDraft(key, 'user:session2', store), null)
  clearPurchaseRecipientDraft(key, store)
  assert.equal(loadPurchaseRecipientDraft(key, 'user:session1', store), null)
})

test('拒绝无身份、非法或过期草稿；已保存资料与可编辑数组隔离', () => {
  const store = storage()
  assert.throws(() => savePurchaseRecipientDraft('', accounts, store))
  const value = structuredClone(accounts)
  const key = savePurchaseRecipientDraft('user:session', value, store, () => 'id', 1)
  value[0]!.bankAccount = 'changed'
  assert.equal(loadPurchaseRecipientDraft(key, 'user:session', store, 2)?.[0]?.bankAccount, '12345678')
  assert.equal(loadPurchaseRecipientDraft(key, 'user:session', store, 86_400_002), null)
  assert.equal(loadPurchaseRecipientDraft('bad', 'user:session', store), null)
  store.setItem('qs-purchase-recipient:malformed', JSON.stringify({ identity: 'user:session', createdAt: 1, accounts: [{}] }))
  assert.equal(loadPurchaseRecipientDraft('malformed', 'user:session', store, 2), null)
})
