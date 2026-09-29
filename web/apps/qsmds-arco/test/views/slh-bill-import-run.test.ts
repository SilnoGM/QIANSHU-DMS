import type { SlhBillImportPreviewDto, SlhBillStagedFileDto } from '../../src/api/generated/types.gen'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 验证导入加载器编排与页面契约。
import test from 'node:test'
import { effectScope, ref } from 'vue'
import { useSlhBillImportRun } from '../../src/views/workbenches/slh-bills/use-slh-bill-import-run'

const LABELS = { parse: '解析账单结构与金额', review: '复核金额与材积', upload: '上传对账单原件' }

function stagedFile(mediaAssetId = 'asset-1'): SlhBillStagedFileDto {
  return { checksumSha256: 'a'.repeat(64), fileName: '待签收返款账单.xlsx', mediaAssetId, sizeBytes: 1024 }
}

function preview(overrides: Partial<SlhBillImportPreviewDto> = {}): SlhBillImportPreviewDto {
  return {
    containerBatchCount: 1,
    containerBatchNames: ['1211-01柜'],
    duplicate: null,
    findings: [],
    lineCount: 1,
    lines: [],
    periodEnd: '2026-01-16',
    periodStart: '2025-12-11',
    reported: {
      embeddedForeignUnitsPerCny: null,
      netAmountFormula: null,
      netAmountTwd: null,
      payableAmountCny: null,
      reportedNetAmountTwd: '0.00',
      subtotalCodAmountTwd: null,
      subtotalNtdSurchargeAmountTwd: null,
      subtotalPayableAmountCny: null,
    },
    systemForeignUnitsPerCny: null,
    totals: {
      codHandlingTotalAmountCny: '0.00',
      codTotalAmountTwd: '0.00',
      freightTotalAmountCny: '0.00',
      ntdSurchargeTotalAmountTwd: '0.00',
      payableTotalAmountCny: '0.00',
      reportedNetAmountTwd: '0.00',
      surchargeTotalAmountCny: '0.00',
    },
    ...overrides,
  }
}

/** 手动控制完成时机的 promise，用来验证"请求还没回来"和"迟到的结果"两种情况。 */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    reject = rej
    resolve = res
  })
  return { promise, reject, resolve }
}

function setup(options: { parseFailure?: unknown, uploadFailure?: unknown } = {}) {
  const scope = effectScope()
  const epoch = ref(1)
  const uploads: { file: File, signal: AbortSignal }[] = []
  const parses: { mediaAssetId: string, signal: AbortSignal }[] = []
  const upload = deferred<SlhBillStagedFileDto>()
  const parse = deferred<SlhBillImportPreviewDto>()
  const state = scope.run(() => useSlhBillImportRun({
    epoch,
    parse: async (mediaAssetId, signal) => {
      parses.push({ mediaAssetId, signal })
      if (options.parseFailure !== undefined) {
        throw options.parseFailure
      }
      return parse.promise
    },
    upload: async (file, signal) => {
      uploads.push({ file, signal })
      if (options.uploadFailure !== undefined) {
        throw options.uploadFailure
      }
      return upload.promise
    },
  }))!
  return { epoch, parse, parses, scope, state, upload, uploads }
}

const file = new File(['x'], '待签收返款账单.xlsx')

test('完整导入三步：上传挂第一步、解析挂第二步，第三步只是文案', () => {
  const { state, scope } = setup()
  state.start({ file, labels: LABELS })
  assert.equal(state.loading.value, true)
  assert.deepEqual(state.steps.value.map(step => step.text), [LABELS.upload, LABELS.parse, LABELS.review])
  // 只有前两步带请求；第三步负责把组件的最短展示时长走完。
  assert.deepEqual(state.steps.value.map(step => Boolean(step.action)), [true, true, false])
  assert.equal(state.steps.value[0]?.name, 'staged')
  scope.stop()
})

test('解析步骤通过上下文拿到上传结果，加载器完成前不给预览', async () => {
  const { parse, parses, scope, state, upload, uploads } = setup()
  state.start({ file, labels: LABELS })
  assert.equal(uploads.length, 0)

  const uploading = state.steps.value[0]!.action!({})
  assert.equal(uploads.length, 1)
  upload.resolve(stagedFile('asset-9'))
  const uploaded = await uploading as SlhBillStagedFileDto
  assert.equal(state.staged.value?.mediaAssetId, 'asset-9')
  assert.equal(parses.length, 0)

  const parsing = state.steps.value[1]!.action!({ staged: uploaded })
  assert.equal(parses.length, 1)
  assert.equal(parses[0]?.mediaAssetId, 'asset-9')
  // 请求已返回但加载器还没 emit complete，页面此时仍不应拿到结果。
  parse.resolve(preview())
  await parsing
  assert.equal(state.complete()?.periodStart, '2025-12-11')
  assert.equal(state.loading.value, false)
  scope.stop()
})

test('失败时把遮罩交回调用方关闭，并保留已上传的原件以便重试', () => {
  const failure = new Error('boom')
  const { scope, state } = setup({ parseFailure: failure })
  state.start({ file, labels: LABELS })
  // 文案由 containerFailure 归一（接口错误的友好文案在别处覆盖），这里只断言交回了文案。
  assert.equal(state.fail(failure), 'boom')
  assert.equal(state.loading.value, false)
  // 组件只 emit error，遮罩必须由这里关掉；再调一次不应重复处理。
  assert.equal(state.fail(failure), null)
  scope.stop()
})

test('重试解析只走两步且不重复上传', () => {
  const { state, scope, uploads } = setup()
  state.staged.value = stagedFile()
  state.startParseOnly({ labels: LABELS, mediaAssetId: 'asset-9' })
  assert.deepEqual(state.steps.value.map(step => step.text), [LABELS.parse, LABELS.review])
  assert.equal(uploads.length, 0)
  scope.stop()
})

test('复位或换身份后，迟到的上传结果不再写入状态', async () => {
  const reset = setup()
  reset.state.start({ file, labels: LABELS })
  const uploading = reset.state.steps.value[0]!.action!({})
  reset.state.reset()
  reset.upload.resolve(stagedFile('asset-late'))
  await uploading
  assert.equal(reset.state.staged.value, null)
  assert.equal(reset.uploads[0]?.signal.aborted, true)
  reset.scope.stop()

  const rotated = setup()
  rotated.state.start({ file, labels: LABELS })
  const running = rotated.state.steps.value[0]!.action!({})
  rotated.epoch.value = 2
  rotated.upload.resolve(stagedFile('asset-rotated'))
  await running
  assert.equal(rotated.state.staged.value, null)
  rotated.scope.stop()
})

test('作用域销毁会取消进行中的运行', () => {
  const { scope, state, uploads } = setup()
  state.start({ file, labels: LABELS })
  void state.steps.value[0]!.action!({})
  scope.stop()
  assert.equal(state.loading.value, false)
  assert.equal(uploads[0]?.signal.aborted, true)
})

test('导入页把加载器接在遮罩上并禁止中途关闭', async () => {
  const source = await readFile(new URL('../../src/views/workbenches/slh-bills/import.vue', import.meta.url), 'utf8')
  const loader = source.slice(source.indexOf('<FaMultiStepLoader'))
  const tag = loader.slice(0, loader.indexOf('/>'))
  for (const fragment of ['prevent-close', '@complete="importComplete"', '@error="importFailed"', ':loading="importLoading"', ':steps="importSteps"']) {
    assert.ok(tag.includes(fragment), fragment)
  }
  // 选好文件即启动，不再有单独的"正在解析"文案阶段（改由遮罩承担）。
  assert.equal(/t\('slhBill\.parsing'\)/u.test(source), false)
})

test('入库先开确认弹窗，成功后回账单列表页', async () => {
  const page = await readFile(new URL('../../src/views/workbenches/slh-bills/import.vue', import.meta.url), 'utf8')
  assert.ok(page.includes('<SlhBillImportModal'))
  assert.ok(page.includes('@click="openArchiveModal"'))
  // 底部按钮只开弹窗，不再直接提交。
  assert.equal(page.includes('@click="submit"'), false)
  // 入库后回列表页；列表页没有开保活，返回即重新加载。
  assert.ok(page.includes('qsFinanceBillReconciliationSlhBillManagement'))
  assert.equal(page.includes('qsFinanceBillReconciliationSlhBillDetail'), false)

  const modal = await readFile(new URL('../../src/views/workbenches/slh-bills/slh-bill-import-modal.vue', import.meta.url), 'utf8')
  // 五个展示项与两个按钮；月份用现成的月份选择器。
  for (const fragment of ['slhBill.archive.billNo', 'slhBill.archive.billName', 'slhBill.archive.billMonth', 'slhBill.archive.attachment', 'slhBill.archive.remark', '<FaCalendarMonth', 'slhBill.archive.billNoPending']) {
    assert.ok(modal.includes(fragment), fragment)
  }
  // 名称冲突时补后缀并把字段错误交回表单。
  assert.ok(modal.includes('withSlhBillNameSuffix'))
  assert.ok(modal.includes('setFieldError'))
})
