<script setup lang="ts">
import type { FormExpose } from '@fantastic-admin/components'
import Sortable from 'sortablejs'
import apiMenu from '@/api/modules/menu'
import { icons } from '@/iconify'
import { localesInfo } from '@/locales'

const props = withDefaults(
  defineProps<{
    id?: string | number
    parentId?: string | number
  }>(),
  {
    id: '',
    parentId: '',
  },
)

const emits = defineEmits<{
  onSubmit: []
}>()

interface AuthItem {
  name: string
  value: string
}

type KeepAliveValue = string[] | boolean

function openWindow(url: string) {
  window.open(url, '_blank')
}

function getStringList(value: unknown) {
  return Array.isArray(value) ? value as string[] : []
}

const loading = ref(false)
const formRef = useTemplateRef<FormExpose>('formRef')
const model = ref({
  id: props.id,
  parentId: props.parentId,
  path: '',
  redirect: '',
  name: '',
  component: '',
  meta: {
    auths: [] as AuthItem[],
    auth: [] as string[],
    localeAuth: [] as string[],
    title: '',
    icon: ['', ''],
    menu: true,
    activeMenu: '',
    expand: [false, false],
    badge: ['', 'default'],
    sort: 0,
    breadcrumb: true,
    tabPermanent: false,
    keepAlive: [] as string[] | boolean,
    noKeepAlive: [] as string[],
    maximize: [false, false],
    newWindow: false,
    iframe: '',
    link: '',
    copyright: false,
  },
})

const validationSchema = {
  path(value?: string) {
    return !model.value.parentId || value?.trim() ? true : '请输入路由地址'
  },
  'meta.title': function (value?: string) {
    return value?.trim() ? true : '请输入显示名称'
  },
}

onMounted(() => {
  if (model.value.id !== '') {
    getInfo()
  }
})

function getInfo() {
  loading.value = true
  apiMenu.detail(model.value.id).then((res: any) => {
    loading.value = false
    model.value.id = res.data.id
    model.value.parentId = res.data.parentId
    model.value.path = res.data.path
    model.value.redirect = res.data.redirect
    model.value.name = res.data.name
    model.value.component = res.data.component
    Object.assign(model.value.meta, res.data.meta)
  })
}

// 鉴权标识
const inputAuth = ref('')
const inputAuthVisible = ref(false)
const inputAuthRef = useTemplateRef('inputAuthRef')
function onInputAuthClose(tag: string) {
  model.value.meta.auth = model.value.meta.auth.filter(item => item !== tag)
}
function onInputAuthShow() {
  inputAuthVisible.value = true
  nextTick(() => {
    inputAuthRef.value?.ref?.focus()
  })
}
function onInputAuthConfirm() {
  if (inputAuth.value) {
    if (!model.value.meta.auth.includes(inputAuth.value)) {
      model.value.meta.auth = [...model.value.meta.auth, inputAuth.value]
    }
    else {
      useFaToast().warning('标识已存在')
    }
  }
  inputAuthVisible.value = false
  inputAuth.value = ''
}

// 保活规则
const inputKeepAlive = ref('')
const inputKeepAliveVisible = ref(false)
const inputKeepAliveRef = useTemplateRef('inputKeepAliveRef')
function onInputKeepAliveClose(tag: string) {
  if (Array.isArray(model.value.meta.keepAlive)) {
    model.value.meta.keepAlive = model.value.meta.keepAlive.filter(item => item !== tag)
  }
}
function onInputKeepAliveShow() {
  inputKeepAliveVisible.value = true
  nextTick(() => {
    inputKeepAliveRef.value?.ref?.focus()
  })
}
function onInputKeepAliveConfirm() {
  if (inputKeepAlive.value && Array.isArray(model.value.meta.keepAlive)) {
    if (!model.value.meta.keepAlive.includes(inputKeepAlive.value)) {
      model.value.meta.keepAlive = [...model.value.meta.keepAlive, inputKeepAlive.value]
    }
    else {
      useFaToast().warning('规则已存在')
    }
  }
  inputKeepAliveVisible.value = false
  inputKeepAlive.value = ''
}
function onKeepAliveModeChange(value: KeepAliveValue) {
  model.value.meta.keepAlive = value
}

// 不保活规则
const inputNoKeepAlive = ref('')
const inputNoKeepAliveVisible = ref(false)
const inputNoKeepAliveRef = useTemplateRef('inputNoKeepAliveRef')
function onInputNoKeepAliveClose(tag: string) {
  model.value.meta.noKeepAlive = model.value.meta.noKeepAlive.filter(item => item !== tag)
}
function onInputNoKeepAliveShow() {
  inputNoKeepAliveVisible.value = true
  nextTick(() => {
    inputNoKeepAliveRef.value?.ref?.focus()
  })
}
function onInputNoKeepAliveConfirm() {
  if (inputNoKeepAlive.value) {
    if (!model.value.meta.noKeepAlive.includes(inputNoKeepAlive.value)) {
      model.value.meta.noKeepAlive = [...model.value.meta.noKeepAlive, inputNoKeepAlive.value]
    }
    else {
      useFaToast().warning('规则已存在')
    }
  }
  inputNoKeepAliveVisible.value = false
  inputNoKeepAlive.value = ''
}

const authsListRef = useTemplateRef<HTMLDivElement>('authsListRef')
const authItemKeys = new WeakMap<AuthItem, number>()
let authItemKeySeed = 0
let authsSortable: Sortable | null = null

watch(() => model.value.meta.auths.length, () => {
  nextTick(() => {
    initAuthSortable()
  })
}, {
  flush: 'post',
})

onBeforeUnmount(() => {
  authsSortable?.destroy()
})

function getAuthItemKey(item: AuthItem) {
  if (!authItemKeys.has(item)) {
    authItemKeySeed += 1
    authItemKeys.set(item, authItemKeySeed)
  }
  return authItemKeys.get(item)!
}

function onAuthAdd() {
  model.value.meta.auths.push({
    name: '',
    value: '',
  })
  nextTick(() => {
    const listElement = authsListRef.value
    listElement?.scrollTo({
      top: listElement.scrollHeight,
      behavior: 'smooth',
    })
  })
}
function onAuthDelete(index: number) {
  model.value.meta.auths.splice(index, 1)
}
function initAuthSortable() {
  authsSortable?.destroy()
  if (!authsListRef.value || model.value.meta.auths.length <= 1) {
    authsSortable = null
    return
  }
  authsSortable = Sortable.create(authsListRef.value, {
    handle: '.sortable-handle',
    animation: 300,
    onEnd: ({ newIndex, oldIndex }) => {
      if (newIndex === undefined || oldIndex === undefined) {
        return
      }
      const currRow = model.value.meta.auths.splice(oldIndex, 1)[0]
      model.value.meta.auths.splice(newIndex, 0, currRow)
    },
  })
}

async function submit() {
  const result = await formRef.value?.validate()

  if (!result?.valid) {
    return false
  }

  await onSubmit()
  return true
}

async function onSubmit() {
  if (model.value.id === '') {
    await apiMenu.create(model.value)
    useFaToast().success('模拟新增成功')
  }
  else {
    await apiMenu.edit(model.value)
    useFaToast().success('模拟编辑成功')
  }

  emits('onSubmit')
}

defineExpose({
  submit,
})
</script>

<template>
  <div class="flex flex-1 flex-col size-full absolute">
    <FaForm
      ref="formRef"
      v-loading="loading"
      :model="model"
      :validation-schema="validationSchema"
      label-placement="top"
      scroll-to-error
      class="flex flex-1 flex-col overflow-auto"
      @submit="onSubmit"
    >
      <div class="flex flex-1 h-0 min-h-0 w-full">
        <div class="p-4 flex-1 min-w-0 overflow-auto">
          <FaPageHeader v-if="!!model.parentId" title="基础配置" description="标准路由配置，包含 path/redirect/name/component" class="mb-0 border-b-none bg-border/50" />
          <div v-if="!!model.parentId" class="p-4 gap-x-4 gap-y-2 grid grid-cols-1 xl:grid-cols-2">
            <FaFormItem label="路由地址" name="path" required>
              <FaInput v-model="model.path" clearable placeholder="请输入路由地址" class="w-full" />
            </FaFormItem>
            <FaFormItem name="redirect">
              <template #label>
                重定向
                <span class="text-muted-foreground/50 ms-4 inline-flex items-center">父级路由通常无需设置，框架会自行处理</span>
              </template>
              <FaInput v-model="model.redirect" clearable placeholder="请输入重定向地址" class="w-full" />
            </FaFormItem>
            <FaFormItem name="name">
              <template #label>
                路由命名
                <span class="text-muted-foreground/50 ms-4 inline-flex items-center">即 name ，系统唯一</span>
              </template>
              <FaInput v-model="model.name" clearable placeholder="请输入路由命名" class="w-full" />
            </FaFormItem>
            <FaFormItem name="component">
              <template #label>
                组件路径
                <span class="text-muted-foreground/50 ms-4 inline-flex items-center">
                  顶级路由请设置为<FaButton type="button" variant="outline" class="mx-1 p-0 px-1 h-auto" @click.prevent="model.component = 'Layout'">Layout</FaButton>，中间层级路由无需设置
                </span>
              </template>
              <FaInput v-model="model.component" clearable placeholder="请输入完整组件路径" class="w-full">
                <template v-if="model.component !== 'Layout'" #start>
                  /src/views/
                </template>
              </FaInput>
            </FaFormItem>
          </div>
          <FaPageHeader title="扩展配置" class="mb-0 border-b-none bg-border/50">
            <template #description>
              <div class="flex">
                框架扩展配置，详细配置介绍请查看
                <FaButton type="button" variant="outline" class="mx-1 p-0 px-1 h-auto" @click="openWindow('https://fantastic-admin.hurui.me/guide/router.html#%E5%AF%BC%E8%88%AA%E9%85%8D%E7%BD%AE')">
                  文档
                </FaButton>
              </div>
            </template>
          </FaPageHeader>
          <div class="p-4 gap-x-4 gap-y-2 grid grid-cols-1 xl:grid-cols-2">
            <FaFormItem name="meta.auth" :auto-bind="false">
              <template #label>
                鉴权标识
                <FaTooltip text="当设置多个标识时，只要命中其中一个则鉴权通过">
                  <FaIcon name="i-ri:question-line" />
                </FaTooltip>
              </template>
              <div class="flex flex-wrap gap-2 max-w-full items-center">
                <div
                  v-for="item in model.meta.auth"
                  :key="item"
                  class="text-xs text-secondary-foreground px-2.5 py-2 border rounded-lg bg-secondary inline-flex gap-1.5 max-w-full items-center"
                >
                  <span class="truncate" :title="item">{{ item }}</span>
                  <div class="flex-center size-4 cursor-pointer" @click="onInputAuthClose(item)">
                    <FaIcon name="i-lucide:x" />
                  </div>
                </div>
                <FaInput v-if="inputAuthVisible" ref="inputAuthRef" v-model="inputAuth" class="w-50" @keyup.enter="onInputAuthConfirm" @blur="onInputAuthConfirm" />
                <FaButton v-else type="button" variant="outline" @click="onInputAuthShow">
                  新增
                </FaButton>
              </div>
            </FaFormItem>
            <FaFormItem label="区域权限" name="meta.localeAuth">
              <FaSelect v-model="model.meta.localeAuth" multiple placeholder="请选择区域权限" :options="Object.keys(localesInfo).map((key) => ({ label: localesInfo[key].label, value: key }))" class="w-full" />
            </FaFormItem>
            <FaFormItem label="显示名称" name="meta.title" required>
              <FaInput v-model="model.meta.title" clearable placeholder="请输入显示名称" class="w-full" />
            </FaFormItem>
            <div class="flex gap-4 items-start">
              <FaFormItem label="默认图标" name="meta.icon[0]">
                <FaIconPicker v-model="model.meta.icon[0]" :icons />
              </FaFormItem>
              <FaFormItem label="激活图标" name="meta.icon[1]">
                <FaIconPicker v-model="model.meta.icon[1]" :icons />
              </FaFormItem>
            </div>
            <FaFormItem v-if="!!model.parentId" name="meta.activeMenu">
              <template #label>
                在导航显示 & 高亮导航
                <FaTooltip text="未在导航显示的路由，需设置高亮导航">
                  <FaIcon name="i-ri:question-line" />
                </FaTooltip>
              </template>
              <FaInput v-model="model.meta.activeMenu" clearable placeholder="请输入高亮导航的完整路由地址" :disabled="model.meta.menu" class="w-full">
                <template #start>
                  <FaSwitch v-model="model.meta.menu" />
                </template>
              </FaInput>
            </FaFormItem>
            <div v-if="!!model.parentId" class="flex gap-4 items-start">
              <FaFormItem label="默认展开" name="meta.expand[0]">
                <FaSwitch v-model="model.meta.expand[0]" />
              </FaFormItem>
              <FaFormItem label="始终展开" name="meta.expand[1]">
                <FaSwitch v-model="model.meta.expand[1]" />
              </FaFormItem>
            </div>
            <div class="flex gap-4">
              <FaFormItem label="徽标" name="meta.badge[0]" class="flex-1">
                <FaInput v-model="model.meta.badge[0]" clearable placeholder="请输入徽标显示内容，建议控制在4个字符内" class="w-full" />
              </FaFormItem>
              <FaFormItem label="徽标变体" name="meta.badge[1]">
                <FaSelect
                  v-model="model.meta.badge[1]" :options="[
                    { label: '默认', value: 'default' },
                    { label: '次要', value: 'secondary' },
                    { label: '破坏', value: 'destructive' },
                  ]"
                />
              </FaFormItem>
            </div>
            <FaFormItem v-if="!!model.parentId" name="meta.sort">
              <template #label>
                排序
                <FaTooltip text="数字越大越靠前">
                  <FaIcon name="i-ri:question-line" />
                </FaTooltip>
              </template>
              <FaNumberField v-model="model.meta.sort" :min="0" />
            </FaFormItem>
            <FaFormItem v-if="!!model.parentId" label="在面包屑显示" name="meta.breadcrumb">
              <FaSwitch v-model="model.meta.breadcrumb" />
            </FaFormItem>
            <FaFormItem v-if="!!model.parentId" name="meta.tabPermanent">
              <template #label>
                常驻标签页
                <span class="text-muted-foreground/50 ms-4 inline-flex items-center">请勿在带有参数的路由地址上开启该设置</span>
              </template>
              <FaSwitch v-model="model.meta.tabPermanent" />
            </FaFormItem>
            <FaFormItem v-if="!!model.parentId" name="meta.keepAlive" :auto-bind="false">
              <template #label>
                保活规则
                <FaTooltip text="当跳转到设置的路由时，则会对当前路由进行保活">
                  <FaIcon name="i-ri:question-line" />
                </FaTooltip>
                <span v-show="Array.isArray(model.meta.keepAlive)" class="text-muted-foreground/50 inline-flex items-center">
                  切换为
                  <FaButton type="button" variant="link" class="p-0 h-auto" @click.prevent="onKeepAliveModeChange(true)">始终保活</FaButton>
                </span>
                <span v-show="typeof model.meta.keepAlive === 'boolean'" class="text-muted-foreground/50 inline-flex items-center">
                  切换为
                  <FaButton type="button" variant="link" class="p-0 h-auto" @click.prevent="onKeepAliveModeChange([])">规则模式</FaButton>
                </span>
              </template>
              <div v-show="Array.isArray(model.meta.keepAlive)" class="flex flex-wrap gap-2 max-w-full items-center">
                <div
                  v-for="item in getStringList(model.meta.keepAlive)"
                  :key="item"
                  class="text-xs text-secondary-foreground px-2.5 py-2 border rounded-lg bg-secondary inline-flex gap-1.5 max-w-full items-center"
                >
                  <span class="truncate" :title="item">{{ item }}</span>
                  <div class="flex-center size-4 cursor-pointer" @click="onInputKeepAliveClose(item)">
                    <FaIcon name="i-lucide:x" />
                  </div>
                </div>
                <FaInput v-if="inputKeepAliveVisible" ref="inputKeepAliveRef" v-model="inputKeepAlive" class="w-50" @keyup.enter="onInputKeepAliveConfirm" @blur="onInputKeepAliveConfirm" />
                <FaButton v-else type="button" variant="outline" @click="onInputKeepAliveShow">
                  新增
                </FaButton>
              </div>
              <div v-show="typeof model.meta.keepAlive === 'boolean'" class="flex gap-2 items-center">
                <FaTag variant="secondary">
                  始终保活
                </FaTag>
              </div>
            </FaFormItem>
            <FaFormItem v-if="!!model.parentId" name="meta.noKeepAlive" :auto-bind="false">
              <template #label>
                不保活规则
                <FaTooltip text="当跳转到设置的路由时，则会对当前路由取消保活">
                  <FaIcon name="i-ri:question-line" />
                </FaTooltip>
                <span class="text-muted-foreground/50 ms-4 inline-flex items-center">当保活规则为"始终保活"时生效</span>
              </template>
              <div class="flex flex-wrap gap-2 max-w-full items-center">
                <div
                  v-for="item in model.meta.noKeepAlive"
                  :key="item"
                  class="text-xs text-secondary-foreground px-2.5 py-2 border rounded-lg bg-secondary inline-flex gap-1.5 max-w-full items-center"
                >
                  <span class="truncate" :title="item">{{ item }}</span>
                  <div class="flex-center size-4 cursor-pointer" @click="onInputNoKeepAliveClose(item)">
                    <FaIcon name="i-lucide:x" />
                  </div>
                </div>
                <FaInput v-if="inputNoKeepAliveVisible" ref="inputNoKeepAliveRef" v-model="inputNoKeepAlive" class="w-50" @keyup.enter="onInputNoKeepAliveConfirm" @blur="onInputNoKeepAliveConfirm" />
                <FaButton v-else type="button" variant="outline" @click="onInputNoKeepAliveShow">
                  新增
                </FaButton>
              </div>
            </FaFormItem>
            <div v-if="!!model.parentId" class="flex gap-4 items-start">
              <FaFormItem label="最大化" name="meta.maximize[0]">
                <FaSwitch v-model="model.meta.maximize[0]" />
              </FaFormItem>
              <FaFormItem label="允许手动退出" name="meta.maximize[1]">
                <FaSwitch v-model="model.meta.maximize[1]" />
              </FaFormItem>
            </div>
            <FaFormItem v-if="!!model.parentId" label="新窗口打开" name="meta.newWindow">
              <FaSwitch v-model="model.meta.newWindow" />
            </FaFormItem>
            <FaFormItem v-if="!!model.parentId" name="meta.iframe">
              <template #label>
                内嵌网页
                <span class="text-muted-foreground/50 ms-4 inline-flex items-center">请勿与外链同时设置，同时设置时，本设置会失效</span>
              </template>
              <FaInput v-model="model.meta.iframe" clearable placeholder="请输入网址" class="w-full" />
            </FaFormItem>
            <FaFormItem v-if="!!model.parentId" name="meta.link">
              <template #label>
                访问外链
                <span class="text-muted-foreground/50 ms-4 inline-flex items-center">请设置 http/https 开头的完整外链地址</span>
              </template>
              <FaInput v-model="model.meta.link" clearable placeholder="请输入网址" class="w-full" />
            </FaFormItem>
            <FaFormItem v-if="!!model.parentId" label="底部版权" name="meta.copyright">
              <FaSwitch v-model="model.meta.copyright" />
            </FaFormItem>
          </div>
        </div>
        <div class="p-4 border-l border-l-dashed flex flex-col min-w-0 w-500px">
          <div class="flex flex-col h-full">
            <FaPageHeader title="权限池" class="mb-0 border-b-none bg-border/50">
              <template #description>
                <p>设置导航所具备的所有权限，权限池内的权限会用于角色管理</p>
                <p>通常只在最子级导航上进行设置</p>
              </template>
            </FaPageHeader>
            <div class="pt-4 flex flex-1 flex-col gap-4 overflow-hidden">
              <div class="px-4 py-3 border border-border rounded-xl bg-card flex gap-3 items-center justify-between">
                <div class="min-w-0">
                  <div class="text-sm text-foreground font-medium">
                    键值列表
                  </div>
                  <div class="text-xs text-muted-foreground">
                    当前 {{ model.meta.auths.length }} 项，支持拖拽排序
                  </div>
                </div>
                <FaButton type="button" variant="outline" size="sm" class="rounded-full shrink-0" @click="onAuthAdd">
                  <FaIcon name="i-ep:plus" />
                  新增
                </FaButton>
              </div>
              <div
                v-if="model.meta.auths.length"
                ref="authsListRef"
                class="pr-1 flex flex-1 flex-col gap-3 overflow-y-auto"
              >
                <div
                  v-for="(item, index) in model.meta.auths"
                  :key="getAuthItemKey(item)"
                  class="group p-3 border border-border rounded-xl bg-card gap-3 grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_auto] transition-colors items-center hover:bg-accent/30"
                >
                  <FaButton
                    type="button"
                    variant="secondary"
                    size="icon"
                    class="sortable-handle rounded-lg cursor-ns-resize"
                  >
                    <FaIcon name="i-ep:d-caret" class="cursor-ns-resize" />
                  </FaButton>
                  <FaInput v-model="item.name" clearable class="w-full">
                    <template #start>
                      <span class="text-xs text-muted-foreground">名称</span>
                    </template>
                  </FaInput>
                  <FaInput v-model="item.value" clearable class="w-full">
                    <template #start>
                      <span class="text-xs text-muted-foreground">标识</span>
                    </template>
                  </FaInput>
                  <FaButton
                    type="button"
                    variant="outline"
                    size="icon"
                    class="text-muted-foreground rounded-lg hover:text-destructive hover:border-destructive/40 hover:bg-destructive/8"
                    @click="onAuthDelete(index)"
                  >
                    <FaIcon name="i-ep:delete" />
                  </FaButton>
                </div>
              </div>
              <div v-else class="px-6 py-10 text-center border border-border rounded-xl border-dashed bg-muted/30 flex flex-1 flex-col items-center justify-center">
                <FaIcon name="i-ri:key-2-line" class="text-3xl text-muted-foreground mb-3" />
                <div class="text-sm text-foreground font-medium">
                  暂无权限项
                </div>
                <div class="text-xs text-muted-foreground mt-1">
                  添加后即可在这里维护名称与标识的对应关系
                </div>
                <FaButton type="button" variant="outline" size="sm" class="mt-4 rounded-full" @click="onAuthAdd">
                  <FaIcon name="i-ep:plus" />
                  新增第一项
                </FaButton>
              </div>
            </div>
          </div>
        </div>
      </div>
    </FaForm>
    <div class="p-4 border-t border-t-dashed flex-center">
      <FaButton type="button" @click="submit">
        提交
      </FaButton>
    </div>
  </div>
</template>
