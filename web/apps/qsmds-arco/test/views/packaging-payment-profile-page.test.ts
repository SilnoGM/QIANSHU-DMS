import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 验证表格配置入口、弹窗关闭保护与保存后的列表更新。
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { computed, effectScope, reactive, ref, watch } from 'vue'

async function fixture() {
  const source = await readFile(new URL('../../src/views/admin/supplier-payment-profiles/packaging-payment-profile.vue', import.meta.url), 'utf8')
  const script = source.split('<script setup lang="ts">')[1]!.split('</script>')[0]!.replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*$/gm, '')
  const account = reactive({ isLogin: true, authEpoch: 1 })
  const write = ref(true)
  const profile = ref({ vendor: 'CHENGXIN', vendorName: '沙井·诚信木箱', version: 1, accounts: [], updatedAt: null, updatedBy: null })
  let saveResult = false
  let saveCalls = 0
  const hook = {
    profile,
    draft: ref([]),
    loading: ref(false),
    saving: ref(false),
    error: ref(''),
    needsRefresh: ref(false),
    dirty: ref(false),
    load: async () => {},
    save: async () => {
      saveCalls++
      if (saveResult) {
        profile.value = { ...profile.value, version: 2 }
        hook.dirty.value = false
      }
      return saveResult
    },
    discard: () => { hook.dirty.value = false },
    clear: () => {},
  }
  const lifecycle: Record<string, (...args: any[]) => any> = {}
  const success: string[] = []
  const scope = effectScope()
  const state = scope.run(() => runInNewContext(ts.transpileModule(`${script}\n;({ rows, search, editorVisible, discardVisible, uploading, open, close, submit, finishLeave, busy })`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, {
    computed,
    ref,
    watch,
    useI18n: () => ({ t: (key: string) => key }),
    useAppAuth: () => ({ auth: (key: string) => key.endsWith(':read') || write.value }),
    useAppAccountStore: () => account,
    useQsToast: () => ({ success: (message: string) => success.push(message) }),
    usePackagingPaymentProfile: () => hook,
    defineEmits: () => () => {},
    defineExpose() {},
    onBeforeRouteLeave: (callback: () => unknown) => lifecycle.leave = callback,
    onActivated: (callback: () => void) => lifecycle.activate = callback,
    onDeactivated: (callback: () => void) => lifecycle.deactivate = callback,
    onBeforeUnmount: (callback: () => void) => lifecycle.unmount = callback,
  }))!
  return {
    state,
    hook,
    write,
    account,
    success,
    lifecycle,
    setSaveResult: (value: boolean) => { saveResult = value },
    getSaveCalls: () => saveCalls,
    dispose: () => {
      lifecycle.unmount?.()
      scope.stop()
    },
  }
}

test('未配置厂商仍有表格行，点击配置才打开弹窗，搜索可以筛空再恢复', async (context) => {
  const f = await fixture()
  context.after(f.dispose)
  assert.equal(f.state.rows.value.length, 1)
  assert.equal(f.state.rows.value[0].vendorName, '沙井·诚信木箱')
  assert.equal(f.state.editorVisible.value, false)
  f.state.search.value = '不存在'
  assert.equal(f.state.rows.value.length, 0)
  f.state.search.value = '诚信'
  assert.equal(f.state.rows.value.length, 1)
  f.state.open()
  assert.equal(f.state.editorVisible.value, true)
})

test('保存失败保留弹窗，保存成功刷新数据并关闭，只读用户只能查看', async (context) => {
  const f = await fixture()
  context.after(f.dispose)
  f.state.open()
  await f.state.submit()
  assert.equal(f.state.editorVisible.value, true)
  f.setSaveResult(true)
  await f.state.submit()
  assert.equal(f.state.editorVisible.value, false)
  assert.equal(f.state.rows.value[0].version, 2)
  assert.equal(f.success.length, 1)
  f.state.open()
  f.write.value = false
  assert.equal(f.state.editorVisible.value, false)
  f.state.open()
  assert.equal(f.state.editorVisible.value, true)
  await f.state.submit()
  assert.equal(f.getSaveCalls(), 2)
  assert.equal(f.success.length, 1)
})

test('上传和未保存修改阻止直接关闭，放弃后关闭，身份变化清空编辑状态', async (context) => {
  const f = await fixture()
  context.after(f.dispose)
  f.state.open()
  f.hook.saving.value = true
  f.state.close()
  assert.equal(f.state.editorVisible.value, true)
  f.hook.saving.value = false
  f.state.uploading.value = true
  f.state.close()
  assert.equal(f.state.editorVisible.value, true)
  assert.equal(f.lifecycle.leave!(), false)
  f.state.uploading.value = false
  f.hook.dirty.value = true
  f.state.close()
  assert.equal(f.state.discardVisible.value, true)
  assert.equal(f.state.editorVisible.value, true)
  f.state.finishLeave(false)
  assert.equal(f.state.editorVisible.value, true)
  f.state.close()
  f.state.finishLeave(true)
  assert.equal(f.state.editorVisible.value, false)
  f.state.open()
  f.account.authEpoch++
  assert.equal(f.state.editorVisible.value, false)
})
