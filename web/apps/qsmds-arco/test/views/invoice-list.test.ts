import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 与其它 views 测试同一范式：直接校验纯函数与页面结构。
import test from 'node:test'
import { buildInvoiceDocumentFilename, buildInvoiceDocumentItems, formatInvoiceDocumentFileSize, resolveInvoiceDocumentContentUrl } from '../../src/views/workbenches/invoices/invoice-document.logic'

async function readPageSource(name: 'records' | 'approval'): Promise<string> {
  return readFile(new URL(`../../src/views/workbenches/invoices/${name}/index.vue`, import.meta.url), 'utf8')
}

test('发票照片列：缩略变体进列表、原件进预览、无照片返回空组', () => {
  assert.equal(buildInvoiceDocumentItems({ id: 'abc', documentMediaAssetId: null }, '发票照片').length, 0)
  const items = buildInvoiceDocumentItems({ id: 'abc', documentMediaAssetId: 'asset-1' }, '发票照片')
  assert.equal(items.length, 1)
  assert.equal(items[0]?.src, '/api/invoice-requests/abc/document?variant=thumb')
  assert.equal(items[0]?.previewSrc, '/api/invoice-requests/abc/document')
  assert.equal(items[0]?.key, 'abc')
  assert.equal(items[0]?.alt, '发票照片')
  // id 必须整体编码，不能把路径分隔符带进内容路径。
  assert.equal(resolveInvoiceDocumentContentUrl('a/b c'), '/api/invoice-requests/a%2Fb%20c/document')
})

test('上传改名：抬头-统编-YYYYMMDDHHMMSS，扩展名跟随原文件、缺失时按 MIME 兜底', () => {
  const base = {
    buyerName: '流程測試有限公司',
    buyerTaxId: '87654321',
    uploadedAt: new Date(2026, 9, 15, 15, 45, 6),
  }
  assert.equal(
    buildInvoiceDocumentFilename({ ...base, originalName: '00000.png' }),
    '流程測試有限公司-87654321-20261015154506.png',
  )
  // 扩展名统一小写，原文件名带多个点也只取最后一段。
  assert.equal(
    buildInvoiceDocumentFilename({ ...base, originalName: 'scan.v2.WEBP' }),
    '流程測試有限公司-87654321-20261015154506.webp',
  )
  // 原文件名没有可用扩展名时按声明的 MIME 兜底；都缺省时给 .jpg。
  assert.equal(buildInvoiceDocumentFilename({ ...base, originalName: 'IMG_0001', mimeType: 'image/jpeg' }), '流程測試有限公司-87654321-20261015154506.jpg')
  assert.equal(buildInvoiceDocumentFilename({ ...base, originalName: 'IMG_0001', mimeType: 'image/png' }), '流程測試有限公司-87654321-20261015154506.png')
  assert.equal(buildInvoiceDocumentFilename({ ...base, originalName: 'noext' }), '流程測試有限公司-87654321-20261015154506.jpg')
  // 月/日/时/分/秒都要补零；长度可疑的“扩展名”不认，按 MIME 兜底。
  assert.equal(
    buildInvoiceDocumentFilename({ ...base, uploadedAt: new Date(2026, 0, 2, 3, 4, 5), originalName: 'a.thisisaverylongextension' }),
    '流程測試有限公司-87654321-20260102030405.jpg',
  )
})

test('暂存卡片文件体积展示：KB/MB 取整口径，非法输入给「—」', () => {
  assert.equal(formatInvoiceDocumentFileSize(0), '—')
  assert.equal(formatInvoiceDocumentFileSize(Number.NaN), '—')
  assert.equal(formatInvoiceDocumentFileSize(512), '1 KB')
  assert.equal(formatInvoiceDocumentFileSize(240 * 1024), '240 KB')
  assert.equal(formatInvoiceDocumentFileSize(1024 * 1024 - 1), '1024 KB')
  assert.equal(formatInvoiceDocumentFileSize(1024 * 1024), '1.0 MB')
  assert.equal(formatInvoiceDocumentFileSize(2.5 * 1024 * 1024), '2.5 MB')
})

test('详情抽屉按 2026-10-15 结构图重组：五节 + 节点四组 + 复用现有展示组件', async () => {
  const source = await readFile(new URL('../../src/views/workbenches/invoices/invoice-request-detail-drawer.vue', import.meta.url), 'utf8')
  for (const key of ['detail.sectionBasic', 'detail.sectionSettle', 'detail.sectionFlow']) {
    assert.ok(source.includes(key), `抽屉缺少 ${key}`)
  }
  // 「发票信息 + 收件信息」已抽为共用块（审批弹窗第一步按用户要求复用同一结构）。
  assert.match(source, /<InvoiceRequestInfo :detail="detail" \/>/u)
  // 节点四组「人 + 时间」的操作人从流程历史派生（NOTIFY/UPLOAD_DOCUMENT/SETTLE 取最近一条）。
  for (const action of ['actor(\'NOTIFY\')', 'actor(\'UPLOAD_DOCUMENT\')', 'actor(\'SETTLE\')']) {
    assert.ok(source.includes(action), `抽屉缺少节点派生 ${action}`)
  }
  // 金额与人员必须复用展示组件；照片升级为可点击放大；未结算时给占位而不是隐藏整块。
  assert.match(source, /import AmountDisplay from '@\/components\/base\/AmountDisplay\/index\.vue'/u)
  assert.match(source, /import QsPersonDisplay from '@\/components\/business\/QsPersonDisplay\/index\.vue'/u)
  assert.match(source, /<FaImagePreview/u)
  assert.match(source, /detail\.settleNone/u)
  // 结构图里没有的旧分区标题不得回归。
  assert.equal(source.includes('form.remarkSection'), false)
  assert.equal(source.includes('detail.history\''), false)
  // 流程行：操作人 + 执行了 + 【动作】 + 状态流转，动作标签与流转都走三语键。
  assert.match(source, /detail\.actionVerb/u)
  assert.match(source, /detail\.action\.\$\{entry\.action\}/u)
  assert.match(source, /statusTransition/u)
  // 两处占位为「图标 + 标题 + 说明」。
  assert.match(source, /detail\.documentNoneDescription/u)
  assert.match(source, /detail\.settleNoneDescription/u)
})

test('开票信息块抽为共用组件：抽屉与审批弹窗第一步复用同一结构', async () => {
  const source = await readFile(new URL('../../src/views/workbenches/invoices/invoice-request-info.vue', import.meta.url), 'utf8')
  for (const key of ['detail.sectionInvoice', 'detail.sectionRecipient']) {
    assert.ok(source.includes(key), `共用块缺少 ${key}`)
  }
  // 主体/备注卡复用组件库复制按钮。
  assert.match(source, /import CopyCellButton from '@\/components\/business\/QsGenericTable\/CopyCellButton\.vue'/u)
  // 明细表数量、单价、金额右对齐。
  assert.match(source, /qs-type-data[^"\n]*text-right/u)
  assert.match(source, /qs-type-data-emphasis[^"\n]*text-right/u)
  // 字段代码后缀已按用户要求移除，不得回归。
  for (const code of ['(buyer_name)', '(buyer_tax_id)', '(invoice_remark)', '(internal_remark)']) {
    assert.equal(source.includes(code), false, `${code} 应已移除`)
  }
  const drawer = await readFile(new URL('../../src/views/workbenches/invoices/invoice-request-detail-drawer.vue', import.meta.url), 'utf8')
  assert.match(drawer, /<InvoiceRequestInfo :detail="detail" \/>/u)
  const modal = await readFile(new URL('../../src/views/workbenches/invoices/approval/review-modal.vue', import.meta.url), 'utf8')
  assert.match(modal, /<InvoiceRequestInfo :detail="detail" \/>/u)
})

test('两张列表的列与口径符合 2026-10-15 拍板：照片用 ImageGroup、无明细摘要/可结算/提交人独立列', async () => {
  for (const name of ['records', 'approval'] as const) {
    const source = await readPageSource(name)
    // 展示组件必须显式导入：漏掉会被当成原生标签静默渲染成空白。
    assert.match(source, /import ImageGroup from '@\/components\/base\/ImageGroup\/index\.vue'/u)
    assert.match(source, /buildInvoiceDocumentItems/u)
    for (const slot of ['#cell-document', '#cell-buyer', '#cell-salesAmount', '#cell-taxAmount', '#cell-recipient']) {
      assert.ok(source.includes(slot), `${name} 缺少 ${slot}`)
    }
    // 两个备注列走 accessorFn + cellClass，不需要额外插槽。
    assert.match(source, /id: 'invoiceRemark'/u, `${name} 缺少发票备注列`)
    assert.match(source, /id: 'internalRemark'/u, `${name} 缺少申请单备注列`)
    // 拍板删除的列不得回归。
    assert.equal(source.includes('#cell-lineSummary'), false, `${name} 不应再显示明细摘要列`)
    assert.equal(source.includes('#cell-settleable'), false, `${name} 不应再显示可结算列`)
  }
  const approval = await readPageSource('approval')
  assert.equal(approval.includes('#cell-creatorName'), false, '审批页提交人并入提交时间列')
  // R12.2 的剩余时间落点：结算按钮禁用并以 tooltip 展示等待提示。
  assert.match(approval, /v-else-if="row\.status === 'ISSUED'"[\s\S]{0,400}<FaTooltip[\s\S]{0,400}settleHint\(row\)/u)
  assert.match(approval, /:disabled="!canSettleRow\(row\)"/u)
})

test('上传发票照片弹窗：信息卡含抬头/统编卡与整行总计，上传区居中、选图后换成横条卡片', async () => {
  const approval = await readPageSource('approval')
  // 信息卡重组：抬头/统编改图2 式卡片（带复制按钮），总计单独占一整行且字号加大；旧的 3xl 口径不得回归。
  assert.match(approval, /import CopyCellButton from '@\/components\/business\/QsGenericTable\/CopyCellButton\.vue'/u)
  assert.match(approval, /invoiceRequest\.field\.buyerName'\)[\s\S]{0,500}CopyCellButton/u)
  assert.match(approval, /invoiceRequest\.field\.buyerTaxId'\)[\s\S]{0,500}CopyCellButton/u)
  assert.match(approval, /invoiceRequest\.field\.totalAmount'\) \}\}[\s\S]{0,400}\[&_\[data-currency\]\]:text-4xl/u)
  assert.equal(approval.includes('[&_[data-currency]]:text-3xl'), false, '总计已移到整行卡片，字号应加大为 4xl')
  // 36px 字号的行内盒高过行高会溢出，overflow-x-auto 的兜底必须显式关掉竖向滚动条；
  // 段间距必须用显式 mt-6/pt-8：UnoCSS 的 space-y 走 margin-bottom，会被子元素（dl、段落）的 m-0 反压掉。
  assert.match(approval, /overflow-x-auto overflow-y-hidden/u)
  assert.match(approval, /mt-6 gap-4 grid min-w-0 sm:grid-cols-2/u)
  assert.match(approval, /mt-6 p-4 border border-border rounded-xl bg-background/u)
  assert.match(approval, /pt-8 space-y-4/u)
  // 原因输入框不再单设「原因 *」标签行（必填由占位符与按钮禁用表达）。
  assert.equal(approval.includes(':label="t(\'invoiceRequest.action.reasonLabel\')"'), false, '原因标签行应已移除')
  // 上传区：点击区域与两行说明文字都居中。
  assert.match(approval, /flex justify-center">\s*<FaImageUpload/u)
  assert.match(approval, /text-center">\s*\{\{ t\('invoiceRequest\.approval\.documentBody'\) \}\}/u)
  assert.match(approval, /text-center">\s*\{\{ t\('invoiceRequest\.approval\.documentHint'\) \}\}/u)
  // 选图后隐藏上传区，换成横条卡片（缩略图 + 云端目标文件名/体积 + 右侧删除）；删除后上传区恢复。
  assert.match(approval, /v-if="pickedFile === null"/u)
  assert.match(approval, /pickedPreviewUrl/u)
  assert.match(approval, /pickedUploadName/u)
  assert.match(approval, /invoiceRequest\.upload\.remove/u)
  assert.match(approval, /@click="clearPick"/u)
  assert.match(approval, /URL\.revokeObjectURL/u)
  assert.equal(approval.includes('pickedFile.name'), false, '旧的原文件名文本展示应已换成卡片')
  // 上传前改名：抬头-统编-上传时间，卡片展示与实际上传是同一个名称。
  assert.match(approval, /buildInvoiceDocumentFilename/u)
  assert.match(approval, /new File\(\[file\], pickedUploadName\.value \?\? file\.name, \{ type: file\.type \}\)/u)
  assert.match(approval, /uploadDocument\(row\.id, renamed, signal\)/u)
})

test('写操作弹窗的关闭与刷新必须晚于释放 busy/submitting（防空壳弹窗回归）', async () => {
  // 退回/取消/上传/结算四个动作共用 submitAction：守卫在 submitting 期间拒绝受控关闭并回写 true，
  // 提前置 actionOpen=false 会留下「有头有脚没有内容」的空壳弹窗（2026-10-15 用户实测退回重填复现）。
  const approval = await readPageSource('approval')
  const action = approval.slice(approval.indexOf('async function submitAction'), approval.indexOf('const cancelBodyKey'))
  assert.match(action, /let succeeded = false/u, '成功标记缺失')
  assert.match(action, /finally \{\s*busy\.value = false\s*\}/u, 'busy 必须在 finally 释放')
  assert.ok(action.indexOf('busy.value = false') < action.indexOf('actionOpen.value = false'), 'actionOpen 必须晚于释放 busy')
  assert.ok(action.indexOf('actionOpen.value = false') < action.indexOf('target.value = null'), '先关弹窗再清 target')
  assert.ok(action.indexOf('target.value = null') < action.indexOf('await load()'), '刷新放在关闭与清空之后')
  // 审批弹窗的通知成功路径遵守同一不变量。
  const modal = await readFile(new URL('../../src/views/workbenches/invoices/approval/review-modal.vue', import.meta.url), 'utf8')
  const notify = modal.slice(modal.indexOf('async function confirmNotify'), modal.indexOf('function close'))
  assert.ok(notify.includes('let succeeded = false'), 'review-modal 通知缺少成功标记')
  assert.ok(notify.indexOf('submitting.value = false') < notify.indexOf('emit(\'update:modelValue\', false)'), 'review-modal 关闭必须晚于释放 submitting')
})

test('发票审批按 2026-10-15 规格走三步弹窗（独立组件 review-modal）', async () => {
  const approval = await readPageSource('approval')
  assert.match(approval, /import InvoiceRequestReviewModal from '\.\/review-modal\.vue'/u)
  assert.match(approval, /invoiceRequest\.action\.review/u)
  // 操作列按钮改「发票审批」后，旧的 review 分支与复制函数不得残留。
  assert.equal(approval.includes('openAction(row, \'review\')'), false)
  assert.equal(approval.includes('copyInvoiceInfo'), false)
  const modal = await readFile(new URL('../../src/views/workbenches/invoices/approval/review-modal.vue', import.meta.url), 'utf8')
  for (const key of ['reviewStepInfo', 'reviewStepCopy', 'reviewStepConfirm', 'reviewNext', 'reviewBack', 'reviewConfirm', 'reviewCopyHint', 'reviewDone', 'reviewConfirmTitle', 'reviewConfirmHint', 'copyLabel']) {
    assert.ok(modal.includes(key), `review-modal 缺少 ${key}`)
  }
  assert.match(modal, /<FaSteps v-model="step"/u)
  assert.match(modal, /buildInvoiceCopyText/u)
  assert.match(modal, /invoiceRequestsApi\.notify/u)
  // 第二步内容区：复制文本全文预览（灰底）+ 右上角一键复制按钮；展示与剪贴板同一来源。
  assert.match(modal, /import CopyCellButton from '@\/components\/business\/QsGenericTable\/CopyCellButton\.vue'/u)
  assert.match(modal, /const copyText = computed\(/u)
  assert.match(modal, /bg-muted\/50/u)
  assert.match(modal, /:text="copyText"/u)
  assert.match(modal, /<pre[^>]*>\{\{ copyText \}\}<\/pre>/u)
  assert.match(modal, /await navigator\.clipboard\.writeText\(copyText\.value\)/u)
  // 第二步：复制按钮在 footer 并承担前进（复制 + 前进一步）；该步不出现「取消」。
  assert.match(modal, /copyAndAdvance/u)
  assert.match(modal, /v-if="step !== 1"[\s\S]{0,200}invoiceRequest\.common\.cancel/u)
  // 第三步：图标 + 标题 + 说明的确认块（send 图标）。
  assert.match(modal, /i-lucide:send/u)
})
