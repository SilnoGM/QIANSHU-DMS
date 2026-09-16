import type { PackagingCostContext, PackagingCostDraft } from '../../src/views/operations/warehouse-arrivals/packaging-cost.logic'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 执行弹窗脚本，验证父层提交边界和图片生命周期。
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { computed, effectScope, nextTick, reactive, ref, shallowRef, watch } from 'vue'
import * as logic from '../../src/views/operations/warehouse-arrivals/packaging-cost.logic'
import { createPackagingImagePreview } from '../../src/views/operations/warehouse-arrivals/packaging-image-preview'

const shipment: PackagingCostContext = { shipmentId: 'part-1', shipmentNo: 'SHP-1', shippingMarkText: 'MARK', purchaseOrderNo: 'PO-1', salesOrderNo: 'SO-1', ownerName: '出单人' }
type Group = 'packagingImages' | 'quotationImages'
interface ModalState {
  fields: { value: { packagingTypeValue: string | null, vendor: string | null, customVendorName: string, amount: string | null, remark: string } }
  imageUrls: { value: Record<Group, string[]> }
  previews: { value: Record<Group, ReturnType<typeof createPackagingImagePreview>> }
  rules: Record<string, () => string | true>
  submit: () => Promise<void>
}

async function fixture() {
  const source = await readFile(new URL('../../src/views/operations/warehouse-arrivals/packaging-cost-modal.vue', import.meta.url), 'utf8')
  const script = source.split('<script setup lang="ts">')[1]!.split('</script>')[0]!.replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*$/gm, '')
  const props = reactive({ modelValue: true, context: shipment as PackagingCostContext | null, loading: false, error: null as string | null, submitting: false, submitDisabled: false, submitDisabledHint: null })
  const events: Array<[string, PackagingCostDraft]> = []
  const revoked: string[] = []
  const fieldErrors: Record<string, string | undefined> = {}
  const currencyError = ref<string | null>(null)
  let pendingValidation: Promise<{ valid: boolean }> | null = null
  let sequence = 0
  let unmount = () => {}
  const scope = effectScope()
  const state: ModalState = scope.run(() => runInNewContext(ts.transpileModule(`${script}\n;({ fields, imageUrls, previews, rules, submit })`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, {
    ...logic,
    computed,
    createPackagingImagePreview,
    ref,
    shallowRef,
    watch,
    defineProps: () => props,
    withDefaults: (value: unknown) => value,
    defineEmits: () => (name: string, payload: PackagingCostDraft) => events.push([name, payload]),
    useI18n: () => ({ t: (key: string) => key }),
    useId: () => 'vendor-label',
    useCurrencyCatalog: () => ({ currencies: ref([{ code: 'CNY', enabled: true, minorUnit: 2 }]), resolve: () => ({ enabled: true, minorUnit: 2 }), errorMessage: currencyError, loading: ref(false), reload: () => {} }),
    useTemplateRef: () => ref({
      setFieldError: (field: string, error: string | undefined) => fieldErrors[field] = error,
      validate: async () => {
        if (pendingValidation) {
          return pendingValidation
        }
        const errors = Object.entries(state.rules).map(([field, rule]) => [field, rule()] as const).filter(([, result]) => result !== true)
        errors.forEach(([field, result]) => fieldErrors[field] = String(result))
        return { valid: errors.length === 0 }
      },
    }),
    onBeforeUnmount: (callback: () => void) => unmount = callback,
    URL: { createObjectURL: () => `blob:${++sequence}`, revokeObjectURL: (url: string) => revoked.push(url) },
  })) as ModalState
  function addImage(group: Group) {
    const file = new File(['test'], 'image.png', { type: 'image/png' })
    const preview = state.previews.value[group]
    const response = preview.httpRequest({ file })
    const url = preview.afterUpload(response)
    state.imageUrls.value[group].push(url)
    return { file, url, response, preview }
  }
  function fill() {
    state.fields.value = { packagingTypeValue: 'WOODEN_FRAME', vendor: 'OTHER', customVendorName: '  外部厂商  ', amount: '99.5', remark: '  备注  ' }
    return [addImage('packagingImages'), addImage('quotationImages')]
  }
  return {
    state,
    props,
    events,
    fieldErrors,
    currencyError,
    revoked,
    addImage,
    fill,
    waitValidation: (promise: Promise<{ valid: boolean }>) => pendingValidation = promise,
    dispose: () => {
      unmount()
      scope.stop()
    },
  }
}

test('弹窗逐字段显示错误，填写完整后仅向父层发规范化草稿和原 File', async (context) => {
  const f = await fixture()
  context.after(f.dispose)
  await f.state.submit()
  assert.equal(f.events.length, 0)
  for (const field of ['packagingTypeValue', 'vendor', 'amount', 'packagingImages', 'quotationImages']) {
    assert.equal(Boolean(f.fieldErrors[field]), true, field)
  }
  const photos = f.fill()
  await f.state.submit()
  assert.equal(f.events.length, 1)
  assert.equal(f.events[0]?.[0], 'submit')
  const draft = f.events[0]![1]
  assert.equal(draft.amount, '99.50')
  assert.equal(draft.vendorName, '外部厂商')
  assert.equal(draft.remark, '备注')
  assert.equal(draft.packagingImages[0], photos[0]!.file)
  assert.equal(draft.quotationImages[0], photos[1]!.file)
})

test('无销售来源禁提报、请求中、请求失败和币种不可用均不会发提交事件', async (context) => {
  const f = await fixture()
  context.after(f.dispose)
  f.fill()
  for (const flag of ['submitDisabled', 'submitting', 'loading'] as const) {
    f.props[flag] = true
    await f.state.submit()
    f.props[flag] = false
  }
  f.props.error = 'load failed'
  await f.state.submit()
  f.props.error = null
  f.currencyError.value = 'unavailable'
  await f.state.submit()
  assert.equal(f.events.length, 0)
})

test('删除、关闭、换货件和卸载清理预览；旧校验与图片回调不能进入新草稿', async (context) => {
  const f = await fixture()
  context.after(f.dispose)
  const photos = f.fill()
  await nextTick()
  f.state.imageUrls.value.packagingImages.splice(0, 1)
  await nextTick()
  assert.deepEqual(f.revoked, [photos[0]!.url])
  let finish!: (value: { valid: boolean }) => void
  f.waitValidation(new Promise(resolve => finish = resolve))
  const pendingSubmit = f.state.submit()
  f.props.modelValue = false
  assert.deepEqual(f.revoked, photos.map(item => item.url))
  f.props.modelValue = true
  assert.equal(photos[1]!.preview.afterUpload(photos[1]!.response), '')
  finish({ valid: true })
  await pendingSubmit
  assert.equal(f.events.length, 0)
  assert.equal(f.state.fields.value.amount, null)
  const next = f.addImage('packagingImages')
  f.props.context = { ...shipment, shipmentId: 'part-2' }
  await nextTick()
  assert.equal(f.revoked.includes(next.url), true)
  const last = f.addImage('quotationImages')
  f.dispose()
  assert.equal(f.revoked.filter(url => url === last.url).length, 1)
})

test('校验期间父层重新加载上下文，晚到校验结果不能提交旧表单', async (context) => {
  const f = await fixture()
  context.after(f.dispose)
  f.fill()
  let finish!: (value: { valid: boolean }) => void
  f.waitValidation(new Promise(resolve => finish = resolve))
  const submission = f.state.submit()
  f.props.loading = true
  finish({ valid: true })
  await submission
  assert.equal(f.events.length, 0)
})

test('真实图片控件的 splice 交换经过中间重复值，只按最终顺序同步且不释放仍在列表的 URL', async (context) => {
  const f = await fixture()
  context.after(f.dispose)
  const first = f.addImage('packagingImages')
  const second = f.addImage('packagingImages')
  await nextTick()
  const images = f.state.imageUrls.value.packagingImages
  images[0] = images.splice(1, 1, images[0]!)[0]!
  await nextTick()
  assert.deepEqual(f.revoked, [])
  assert.deepEqual([...images], [second.url, first.url])
  const files = f.state.previews.value.packagingImages.files(images)
  assert.equal(files.length, 2)
  assert.equal(files[0], second.file)
  assert.equal(files[1], first.file)
})
