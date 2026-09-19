import type { ContainerSourceFileDto } from '../../src/api/generated/types.gen'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 验证创建前上传生命周期与身份隔离。
import test from 'node:test'
import { effectScope, ref } from 'vue'
import { useContainerCreateSource } from '../../src/views/workbenches/containers/use-container-create-source'

const file = () => new File(['xlsx'], '装柜资料.xlsx')
const uploaded = { mediaAssetId: 'asset-a', originalFilename: '装柜资料.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', sizeBytes: '4' } satisfies ContainerSourceFileDto
function fixture(send: (file: File, signal: AbortSignal) => Promise<ContainerSourceFileDto>) {
  const enabled = ref(true)
  const disabled = ref(false)
  const epoch = ref(1)
  const scope = effectScope()
  const state = scope.run(() => useContainerCreateSource(enabled, disabled, epoch, send, key => key))!
  return { enabled, disabled, epoch, state, dispose: () => scope.stop() }
}

test('拒绝空文件、错误格式和超限文件；上传成功后只暴露已完成的附件身份', async (context) => {
  let count = 0
  const f = fixture(async () => {
    count++
    return uploaded
  })
  context.after(f.dispose)
  for (const invalid of [new File([], 'empty.xlsx'), new File(['pdf'], 'file.pdf'), { name: 'large.xlsx', size: 50 * 1024 * 1024 + 1 } as File]) {
    assert.equal(await f.state.selectFile(invalid), false)
    assert.equal(f.state.error.value, 'containerSource.invalidFile')
  }
  assert.equal(count, 0)
  assert.equal(await f.state.selectFile(file()), false)
  assert.equal(f.state.sourceFile.value?.mediaAssetId, 'asset-a')
  assert.equal(f.state.uploading.value, false)
  assert.equal(f.state.error.value, '')
  f.disabled.value = true
  f.state.remove()
  assert.ok(f.state.sourceFile.value)
  f.disabled.value = false
  f.state.remove()
  assert.equal(f.state.selectedFile.value, null)
  assert.equal(f.state.sourceFile.value, null)
})

test('上传失败不产生附件身份，保留文件以便重试', async (context) => {
  let attempts = 0
  const f = fixture(async () => {
    if (++attempts === 1) {
      throw new Error('网络异常')
    }
    return uploaded
  })
  context.after(f.dispose)
  const chosen = file()
  await f.state.selectFile(chosen)
  assert.equal(f.state.sourceFile.value, null)
  assert.equal(f.state.selectedFile.value, chosen)
  assert.equal(f.state.error.value, '网络异常')
  await f.state.retry()
  assert.equal(attempts, 2)
  assert.equal(f.state.sourceFile.value?.mediaAssetId, 'asset-a')
})

test('上传中不能重复请求，关闭、换身份和销毁后迟到响应不能恢复附件', async () => {
  for (const action of ['close', 'identity', 'dispose'] as const) {
    let resolve!: (value: ContainerSourceFileDto) => void
    let signal!: AbortSignal
    let calls = 0
    const f = fixture(async (_file, s) => {
      calls++
      signal = s
      return new Promise((r) => {
        resolve = r
      })
    })
    const pending = f.state.selectFile(file())
    assert.equal(f.state.uploading.value, true)
    await f.state.selectFile(file())
    assert.equal(calls, 1)
    if (action === 'close') {
      f.enabled.value = false
    }
    else if (action === 'identity') {
      f.epoch.value++
    }
    else {
      f.dispose()
    }
    assert.equal(signal.aborted, true)
    resolve(uploaded)
    await pending
    assert.equal(f.state.sourceFile.value, null)
    assert.equal(f.state.selectedFile.value, null)
    assert.equal(f.state.uploading.value, false)
    f.dispose()
  }
})
