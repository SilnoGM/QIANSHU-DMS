import type { ContainerImportPreviewDto } from '../../src/api/generated/types.gen'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 验证解析编排、一次解析交接与页面契约。
import test from 'node:test'
import { effectScope, ref } from 'vue'
import { stageImportPreview, takeImportPreview } from '../../src/views/workbenches/containers/container-import-preview-cache'
import { useContainerImportParse } from '../../src/views/workbenches/containers/use-container-import-parse'

function preview(overrides: Partial<ContainerImportPreviewDto> = {}): ContainerImportPreviewDto {
  return { containerBatchId: 'batch', containerBatchName: '0919柜', containerBatchNo: 'CTN/1', warehouseValue: 'b5', expectedVersion: 2, sourceFileId: 'source', sourceFilename: '0919柜.xlsx', sourceHash: 'hash', alreadyImported: false, warnings: [], rows: [], ...overrides }
}

const LABELS = ['读取来源文件', '解析表格数据', '匹配货件'] as const

function setup(data: ContainerImportPreviewDto = preview(), failure?: unknown) {
  const scope = effectScope()
  const enabled = ref(true)
  const epoch = ref(1)
  const loads: AbortSignal[] = []
  const state = scope.run(() => useContainerImportParse(enabled, epoch, ref('batch'), async (signal) => {
    loads.push(signal)
    if (failure) {
      throw failure
    }
    return data
  }))!
  return { scope, enabled, epoch, state, loads }
}

test('一次解析交接缓存读取即消费，不接受与柜次不一致的结果', () => {
  stageImportPreview('batch', preview())
  assert.equal(takeImportPreview('other'), null)
  assert.equal(takeImportPreview('batch')?.containerBatchId, 'batch')
  assert.equal(takeImportPreview('batch'), null)
  stageImportPreview('batch', preview({ containerBatchId: 'other' }))
  assert.equal(takeImportPreview('batch'), null)
})

test('解析请求挂在中间步骤，加载器完成前不交接结果', async () => {
  const { scope, state, loads } = setup()
  state.start(LABELS)
  assert.equal(state.parsing.value, true)
  assert.deepEqual(state.steps.value.map(step => step.text), [...LABELS])
  assert.deepEqual(state.steps.value.map(step => Boolean(step.action)), [false, true, false])
  // 请求只由加载器推进到解析步骤时发出，其余步骤只是展示文案。
  assert.equal(loads.length, 0)
  await state.steps.value[1]!.action!()
  assert.equal(loads.length, 1)
  assert.equal(takeImportPreview('batch'), null)
  assert.equal(state.complete()?.containerBatchId, 'batch')
  assert.equal(state.parsing.value, false)
  assert.equal(takeImportPreview('batch')?.containerBatchId, 'batch')
  scope.stop()
})

test('解析中重复触发与无导入权限都不发请求', async () => {
  const running = setup()
  running.state.start(LABELS)
  running.state.start(LABELS)
  assert.equal(running.state.steps.value.length, 3)
  await running.state.steps.value[1]!.action!()
  assert.equal(running.loads.length, 1)
  running.scope.stop()
  const denied = setup()
  denied.enabled.value = false
  denied.state.start(LABELS)
  assert.equal(denied.state.parsing.value, false)
  assert.deepEqual(denied.state.steps.value, [])
  assert.equal(denied.loads.length, 0)
  denied.scope.stop()
})

test('解析失败停止加载器并保留错误，不交接结果', async () => {
  const failure = Object.assign(new Error('来源文件无法读取'), { status: 500 })
  const { scope, state } = setup(preview(), failure)
  state.start(LABELS)
  let thrown: unknown
  try {
    await state.steps.value[1]!.action!()
  }
  catch (error) {
    thrown = error
  }
  assert.equal(state.fail(thrown), true)
  assert.equal(state.parsing.value, false)
  assert.equal(state.error.value, '来源文件无法读取')
  assert.equal(state.complete(), null)
  assert.equal(takeImportPreview('batch'), null)
  scope.stop()
})

test('换身份后到达的解析结果不交接也不提示', async () => {
  const { scope, state, epoch } = setup()
  state.start(LABELS)
  await state.steps.value[1]!.action!()
  epoch.value = 2
  assert.equal(state.complete(), null)
  assert.equal(takeImportPreview('batch'), null)
  assert.equal(state.fail(new Error('offline')), false)
  assert.equal(state.error.value, '')
  scope.stop()
})

test('柜次详情点击解析先走多步骤加载器，完成后才进入解析与匹配页', async () => {
  const source = await readFile(new URL('../../src/views/workbenches/containers/detail.vue', import.meta.url), 'utf8')
  assert.match(source, /<FaMultiStepLoader[\s\S]*?:loading="parse\.parsing\.value"[\s\S]*?:steps="parse\.steps\.value"[\s\S]*?prevent-close[\s\S]*?@complete="parseComplete"[\s\S]*?@error="parseFailed"/u)
  assert.match(source, /@click="parseSource"/u)
  assert.doesNotMatch(source, /@click="router\.push\(\{ name: 'qsPurchaseTransportContainerImport'/u)
  assert.match(source, /function parseComplete\(\)[\s\S]*?parse\.complete\(\)[\s\S]*?router\.push\(\{ name: 'qsPurchaseTransportContainerImport'/u)
  assert.match(source, /function parseSource\(\)[\s\S]*?parse\.start\(/u)
  assert.match(source, /function parseFailed\(error: Error\)[\s\S]*?parse\.fail\(error\)/u)
  assert.match(source, /watch\(\[enabled, epoch\][\s\S]*?parse\.reset\(\)/u)
})

test('导入页首次加载复用详情页交接结果，重载仍走真实解析', async () => {
  const source = await readFile(new URL('../../src/views/workbenches/containers/import/index.vue', import.meta.url), 'utf8')
  assert.match(source, /takeImportPreview\(id\.value\)[\s\S]*?containerImportApi\.preview\(id\.value, signal\)/u)
})
