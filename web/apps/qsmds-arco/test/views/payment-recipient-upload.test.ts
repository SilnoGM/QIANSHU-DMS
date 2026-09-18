import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 挂载实际上传组件验证紧凑替换、默认尺寸和权限边界。
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as Vue from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'
import * as logic from '../../src/components/business/QsPaymentRecipientEditor/logic'

interface HostNode { tag: string, parent: HostNode | null, children: HostNode[], props: Record<string, any>, text: string }
const { createRenderer, defineComponent, h, nextTick, reactive, ref } = Vue
const node = (tag = '', text = ''): HostNode => ({ tag, text, parent: null, children: [], props: {} })
const flatten = (current: HostNode): HostNode[] => [current, ...current.children.flatMap(flatten)]
function element(tag: string) {
  return defineComponent({ inheritAttrs: false, setup: (_, { attrs, slots }) => () => h(tag, attrs, Object.values(slots).flatMap(slot => slot?.() ?? [])) })
}
function fixture(compact = false, initial?: string) {
  const props = reactive({ compact, mediaAssetId: initial as string | null | undefined, disabled: false })
  const account = reactive({ isLogin: true, authEpoch: 1 })
  const permission = ref('packaging-costs:create')
  const busy: boolean[] = []
  const calls: Array<{ file: File, signal?: AbortSignal }> = []
  let upload = async () => ({ data: { mediaAssetId: 'new-image' } })
  const source = new URL('../../src/components/business/QsPaymentRecipientEditor/QrImageUpload.vue', import.meta.url)
  const compiled = compileScript(parse(readFileSync(source, 'utf8')).descriptor, { id: 'recipient-image-test', inlineTemplate: true })
  const code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const component = { exports: {} as Record<string, any> }
  runInNewContext(code, {
    ...Vue,
    exports: component.exports,
    module: component,
    AbortController,
    useI18n: () => ({ t: (key: string) => key }),
    useAppAuth: () => ({ auth: (key: string) => key === permission.value }),
    useAppAccountStore: () => account,
    require: (specifier: string) => {
      if (specifier === 'vue') {
        return Vue
      }
      if (specifier === './logic') {
        return logic
      }
      if (specifier === './RecipientImage.vue') {
        return { __esModule: true, default: element('recipient-preview') }
      }
      if (specifier.includes('api/modules/payment-recipients')) {
        return { __esModule: true, default: { upload: (file: File, signal?: AbortSignal) => {
          calls.push({ file, signal })
          return upload()
        } } }
      }
      throw new Error(`Unexpected dependency: ${specifier}`)
    },
  })
  const renderer = createRenderer<HostNode, HostNode>({
    createElement: tag => node(tag),
    createText: text => node('', text),
    createComment: () => node(),
    insert: (child, parent, anchor) => {
      if (child.parent) {
        child.parent.children.splice(child.parent.children.indexOf(child), 1)
      }
      child.parent = parent
      const index = anchor ? parent.children.indexOf(anchor) : -1
      parent.children.splice(index < 0 ? parent.children.length : index, 0, child)
    },
    remove: (child) => { child.parent?.children.splice(child.parent.children.indexOf(child), 1) },
    parentNode: child => child.parent,
    nextSibling: child => child.parent?.children[child.parent.children.indexOf(child) + 1] ?? null,
    patchProp: (target, name, _previous, value) => { target.props[name] = value },
    setText: (target, text) => { target.text = text },
    setElementText: (target, text) => {
      target.text = text
      target.children = []
    },
  })
  const root = node('root')
  const app = renderer.createApp(defineComponent({ setup: () => () => h(component.exports.default, {
    ...props,
    'onUpdate:mediaAssetId': (id: string | null) => props.mediaAssetId = id,
    'onBusyChange': (value: boolean) => busy.push(value),
  }) }))
  for (const [name, tag] of Object.entries({ FaImageUpload: 'image-upload', FaButton: 'button', FaIcon: 'span' })) {
    app.component(name, element(tag))
  }
  app.mount(root)
  const nodes = () => flatten(root)
  const field = () => {
    const field = nodes().find(item => item.tag === 'image-upload')
    assert.ok(field)
    return field
  }
  return { props, account, permission, calls, busy, nodes, field, setUpload: (fn: typeof upload) => upload = fn, dispose: () => app.unmount() }
}

test('采购默认上传112px不变，包装compact上传96px且包装提报权限允许上传', async (context) => {
  const standard = fixture()
  const compact = fixture(true)
  context.after(standard.dispose)
  context.after(compact.dispose)
  assert.equal(standard.field().props.width, 112)
  assert.equal(compact.field().props.width, 96)
  assert.equal(compact.field().props.disabled, false)
  compact.permission.value = ''
  await nextTick()
  assert.equal(compact.field().props.disabled, true)
  assert.equal(compact.field().props['before-upload'](new File(['x'], 'qr.png', { type: 'image/png' })), false)
})

test('compact直接替换保留旧图，失败可重试，成功后展示96px缩略图', async (context) => {
  const f = fixture(true, 'old-image')
  context.after(f.dispose)
  const file = new File(['image'], 'qr.png', { type: 'image/png' })
  f.setUpload(async () => {
    throw new Error('Network error')
  })
  await f.field().props['http-request']({ file })
  assert.equal(f.props.mediaAssetId, 'old-image')
  let finish!: (value: { data: { mediaAssetId: string } }) => void
  f.setUpload(() => new Promise(resolve => finish = resolve))
  const pending = f.field().props['http-request']({ file })
  await nextTick()
  assert.equal(f.busy.at(-1), true)
  assert.equal(f.props.mediaAssetId, 'old-image')
  assert.equal(f.field().props.disabled, true)
  finish({ data: { mediaAssetId: 'new-image' } })
  await pending
  await nextTick()
  assert.equal(f.props.mediaAssetId, 'new-image')
  assert.equal(f.nodes().find(item => item.tag === 'recipient-preview')?.props['thumbnail-size'], 96)
  assert.equal(f.busy.at(-1), false)
})

test('上传时退出身份会取消请求，迟到结果不替换二维码', async (context) => {
  const f = fixture(true, 'old-image')
  context.after(f.dispose)
  let finish!: (value: { data: { mediaAssetId: string } }) => void
  f.setUpload(() => new Promise(resolve => finish = resolve))
  const pending = f.field().props['http-request']({ file: new File(['image'], 'qr.png', { type: 'image/png' }) })
  f.account.isLogin = false
  f.account.authEpoch++
  await nextTick()
  assert.equal(f.calls[0]?.signal?.aborted, true)
  finish({ data: { mediaAssetId: 'new-image' } })
  await pending
  assert.equal(f.props.mediaAssetId, 'old-image')
})
