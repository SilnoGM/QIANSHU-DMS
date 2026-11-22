import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 审批状态机隔离上传、通过、驳回、并发冲突与账号切换。
import test from 'node:test'
import { effectScope, ref } from 'vue'
import { useWithdrawalReview } from '../../src/views/admin/fund-account-management/withdrawal-approvals/use-withdrawal-review'

const proof = () => new File(['png'], 'proof.png', { type: 'image/png' })

function record(status = 'PENDING', version = 1) {
  return {
    id: 'withdrawal-1',
    version,
    withdrawalNo: 'WD-20261122-0001',
    userId: 'user-1',
    applicantName: '张三',
    applicantUsername: 'zhangsan',
    applicantAvatarUrl: null,
    amount: '100.00',
    currency: 'CNY',
    status,
    accountBalance: '-20.00',
    submittedAt: '2026-11-22T01:00:00.000Z',
    reviewedAt: null,
    reviewerName: null,
    reviewerAvatarUrl: null,
    rejectReason: null,
    paymentProof: null,
    fundPostingBatchNo: null,
  }
}

function fixture() {
  // Node 没有对象 URL 实现：截图预览与审批后的凭证回读都走它，测试用固定值替代。
  const originalCreate = URL.createObjectURL
  const originalRevoke = URL.revokeObjectURL
  ;(URL as unknown as { createObjectURL: unknown }).createObjectURL = () => 'blob:test'
  ;(URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = () => {}
  const enabled = ref(true)
  const canReview = ref(true)
  const epoch = ref(1)
  const requestId = ref<string | null>('withdrawal-1')
  const calls: Array<{ kind: 'approve' | 'reject', id: string, body: Record<string, unknown> }> = []
  const uploads: Array<{ id: string, file: File }> = []
  let detailCalls = 0
  let detailResponse = async () => ({ data: record() })
  let approveResponse = async () => ({ data: record('APPROVED', 2) })
  let rejectResponse = async () => ({ data: record('REJECTED', 2) })
  let uploadResponse = async () => ({ data: { mediaAssetId: 'asset-1', fileName: 'proof.png' } })
  let proofResponse = async () => ({ data: new Blob(['png'], { type: 'image/png' }) })
  const api = {
    get: () => {
      detailCalls += 1
      return detailResponse()
    },
    approve: (id: string, body: Record<string, unknown>) => {
      calls.push({ kind: 'approve', id, body: structuredClone(body) })
      return approveResponse()
    },
    reject: (id: string, body: Record<string, unknown>) => {
      calls.push({ kind: 'reject', id, body: structuredClone(body) })
      return rejectResponse()
    },
    uploadProof: (id: string, file: File) => {
      uploads.push({ id, file })
      return uploadResponse()
    },
    proofReview: () => proofResponse(),
  }
  const scope = effectScope()
  const state = scope.run(() => useWithdrawalReview(
    enabled,
    canReview,
    epoch,
    requestId,
    api as never,
  ))!
  return {
    state,
    enabled,
    canReview,
    epoch,
    requestId,
    calls,
    uploads,
    detailCalls: () => detailCalls,
    setDetail: (value: typeof detailResponse) => detailResponse = value,
    setApprove: (value: typeof approveResponse) => approveResponse = value,
    setReject: (value: typeof rejectResponse) => rejectResponse = value,
    setUpload: (value: typeof uploadResponse) => uploadResponse = value,
    setProof: (value: typeof proofResponse) => proofResponse = value,
    dispose: () => {
      scope.stop()
      ;(URL as unknown as { createObjectURL: unknown }).createObjectURL = originalCreate
      ;(URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = originalRevoke
    },
  }
}

const flush = () => new Promise(resolve => setImmediate(resolve))

/** 与 normalizeAxiosError 产物同形的失败对象；用 Error 承载以满足 no-throw-literal。 */
function apiFailure(status: number, message: string): Error {
  return Object.assign(new Error(message), {
    kind: 'http' as const,
    status,
    body: { message },
  })
}

test('启用后按单号加载详情，禁用时清空且不再保留待审批状态', async (context) => {
  const f = fixture()
  context.after(f.dispose)
  await flush()
  assert.equal(f.state.detail.value?.id, 'withdrawal-1')
  assert.equal(f.state.pending.value, true)
  f.enabled.value = false
  await flush()
  assert.equal(f.state.detail.value, null)
  assert.equal(f.state.loading.value, false)
})

test('详情 404 视为不存在或无权查看，而不是普通加载失败', async (context) => {
  const f = fixture()
  context.after(f.dispose)
  f.setDetail(async () => {
    throw apiFailure(404, '提款申请不存在')
  })
  f.requestId.value = 'withdrawal-missing'
  await flush()
  assert.equal(f.state.invalid.value, true)
  assert.equal(f.state.loadError.value, '')
})

test('没有付款截图或缺少审批权限时不提交通过', async (context) => {
  const f = fixture()
  context.after(f.dispose)
  await flush()
  assert.equal(await f.state.approve(), false)
  assert.equal(f.state.fieldError.value, 'proof')
  f.canReview.value = false
  await flush()
  assert.equal(await f.state.approve(), false)
  assert.equal(f.calls.length, 0)
})

test('上传只接受图片，非图片在本地就被拒绝', async (context) => {
  const f = fixture()
  context.after(f.dispose)
  await flush()
  assert.equal(await f.state.uploadProof(new File(['x'], 'proof.txt', { type: 'text/plain' })), false)
  assert.equal(f.state.fieldError.value, 'proof')
  assert.equal(f.uploads.length, 0)
  assert.equal(await f.state.uploadProof(proof()), true)
  assert.equal(f.state.upload.value?.mediaAssetId, 'asset-1')
  assert.equal(f.uploads.length, 1)
})

test('通过提交读取版本号与截图资产 id，重复点击只提交一次', async (context) => {
  const f = fixture()
  context.after(f.dispose)
  await flush()
  assert.equal(await f.state.uploadProof(proof()), true)
  let finish!: (value: { data: ReturnType<typeof record> }) => void
  f.setApprove(() => new Promise(resolve => finish = resolve))
  const first = f.state.approve()
  await flush()
  assert.equal(await f.state.approve(), false)
  assert.equal(f.calls.length, 1)
  assert.deepEqual(f.calls[0]?.body, { expectedVersion: 1, paymentProofMediaAssetId: 'asset-1' })
  finish({ data: record('APPROVED', 2) })
  assert.equal(await first, true)
  assert.equal(f.state.detail.value?.status, 'APPROVED')
  assert.equal(f.state.upload.value, null)
  assert.equal(f.state.previewUrl.value, null)
})

test('驳回必须填写原因并提交去空格后的文本', async (context) => {
  const f = fixture()
  context.after(f.dispose)
  await flush()
  assert.equal(await f.state.reject(), false)
  assert.equal(f.state.fieldError.value, 'reason')
  f.state.rejectReason.value = '  余额与流水不符  '
  assert.equal(await f.state.reject(), true)
  assert.deepEqual(f.calls[0]?.body, { expectedVersion: 1, reason: '余额与流水不符' })
  assert.equal(f.state.detail.value?.status, 'REJECTED')
})

test('状态冲突标记陈旧并停止提交，刷新后恢复可操作', async (context) => {
  const f = fixture()
  context.after(f.dispose)
  await flush()
  f.state.rejectReason.value = '原因'
  f.setReject(async () => {
    throw apiFailure(409, '提款申请状态已变化')
  })
  assert.equal(await f.state.reject(), false)
  assert.equal(f.state.stale.value, true)
  assert.equal(f.state.busy.value, false)
  assert.equal(await f.state.reject(), false)
  assert.equal(f.calls.length, 1)
  f.setDetail(async () => ({ data: record('APPROVED', 2) }))
  await f.state.load()
  assert.equal(f.state.stale.value, false)
  assert.equal(f.state.pending.value, false)
})

test('已处理申请加载后自动读取付款截图', async (context) => {
  const f = fixture()
  context.after(f.dispose)
  f.setDetail(async () => ({
    data: {
      ...record('APPROVED', 2),
      paymentProof: {
        mediaAssetId: 'asset-9',
        fileName: '张三-提款100元-20261122.png',
        uploadedAt: '2026-11-22T02:00:00.000Z',
      },
    },
  }))
  f.requestId.value = 'withdrawal-approved'
  await flush()
  await flush()
  assert.equal(f.state.proofUrl.value, 'blob:test')
  assert.equal(f.state.pending.value, false)
})

test('账号切换重新拉取详情并清空草稿', async (context) => {
  const f = fixture()
  context.after(f.dispose)
  await flush()
  assert.equal(await f.state.uploadProof(proof()), true)
  f.state.rejectReason.value = '残留草稿'
  f.epoch.value = 2
  await flush()
  assert.equal(f.detailCalls(), 2)
  assert.equal(f.state.upload.value, null)
  assert.equal(f.state.rejectReason.value, '')
})
