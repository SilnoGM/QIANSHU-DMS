<script setup lang="ts">
import type { FormExpose } from '@fantastic-admin/components'
import type { RouteRecordMainRaw } from '@fantastic-admin/types'
import type { RouteRecordRaw } from 'vue-router'
import { ref } from 'vue'
import apiMenu from '@/api/modules/menu'
import apiRole from '@/api/modules/role'

export interface Props {
  id?: number | string
}
const props = withDefaults(
  defineProps<Props>(),
  {
    id: '',
  },
)

const appRouteStore = useAppRouteStore()

const { generateI18nTitle } = useAppMenu()

const loading = ref(false)
const formRef = useTemplateRef<FormExpose>('formRef')

interface DetailFormModel {
  id: number | string
  name: string
  remark: string
  auths: string[]
}

const model = ref<DetailFormModel>({
  id: props.id,
  name: '',
  remark: '',
  auths: [],
})

const validationSchema = {
  name(value: string) {
    return value.trim() ? true : '请输入角色名称'
  },
}

const routesFrom = ref<'frontend' | 'backend'>('frontend')
const isBackendRoutes = computed({
  get() {
    return routesFrom.value === 'backend'
  },
  set(value: boolean) {
    routesFrom.value = value ? 'backend' : 'frontend'
  },
})
const routes = ref<RouteRecordMainRaw[]>([])
const routesWithAuths = computed(() => {
  function filterRoutes(arr: RouteRecordRaw[]) {
    return arr
      .map((item) => {
        const newItem = { ...item }
        if (Array.isArray(item.children) && item.children.length > 0) {
          const filteredChildren = filterRoutes(item.children)
          if (filteredChildren.length > 0 && filteredChildren.every(child => !!child)) {
            newItem.children = filteredChildren
          }
          else {
            delete newItem.children
          }
        }
        // 只要自己有 meta.auths，或者 children 过滤后还有内容，就保留
        if (!!item.meta?.auths?.length || (newItem.children && newItem.children.length > 0)) {
          return newItem
        }
        return undefined
      })
      .filter(Boolean)
  }
  return filterRoutes(routes.value as any)
})
const authsFlat = ref<any>([])

onMounted(() => {
  getAuths()
  if (model.value.id !== '') {
    getInfo()
  }
})

watch(routesFrom, () => {
  getAuths()
})

function getAuths() {
  authsFlat.value = []

  if (routesFrom.value === 'frontend') {
    routes.value = appRouteStore.routesRaw
    let id = 1
    const flat = (arr: any[]) => {
      arr.forEach((item: any, index) => {
        arr[index].id = id
        id++
        authsFlat.value.push({
          id: item.id,
          auths: item.meta.auths || [],
        })
        if (item?.children?.length > 0) {
          flat(item.children)
        }
      })
    }
    flat(routes.value)
  }
  else {
    apiMenu.list().then((res: any) => {
      routes.value = res.data
      const flat = (arr: any[]) => {
        arr.forEach((item: any) => {
          authsFlat.value.push({
            id: item.id,
            auths: item.meta.auths,
          })
          if (item?.children?.length > 0) {
            flat(item.children)
          }
        })
      }
      flat(routes.value)
    })
  }
}

function getInfo() {
  loading.value = true
  apiRole.detail(model.value.id).then((res: any) => {
    loading.value = false
    model.value.name = res.data.name
    model.value.remark = res.data.remark
    model.value.auths = res.data.auths
  }).catch(() => {
    loading.value = false
  })
}

function getCheckAllState(id: number, selectedAuths: string[]) {
  const item = authsFlat.value.find((item: any) => item.id === id)
  if (!item?.auths?.length) {
    return {
      checkAll: false,
      indeterminate: false,
    }
  }

  const checkCount = item.auths.filter((auth: any) => selectedAuths.includes(auth.value)).length
  return {
    checkAll: checkCount === item.auths.length,
    indeterminate: checkCount > 0 && checkCount < item.auths.length,
  }
}
function handleCheckAll(flag: any, id: number) {
  let nextValue = [...model.value.auths]
  if (flag) {
    authsFlat.value.forEach((item: any) => {
      if (item.id === id) {
        item.auths.forEach((auth: any) => {
          if (!nextValue.includes(auth.value)) {
            nextValue.push(auth.value)
          }
        })
      }
    })
  }
  else {
    authsFlat.value.forEach((item: any) => {
      if (item.id === id) {
        item.auths.forEach((auth: any) => {
          nextValue = nextValue.filter(item => item !== auth.value)
        })
      }
    })
  }
  model.value.auths = nextValue
}
function handleAuthChange(authValue: string, checked: boolean | 'indeterminate' | null | undefined) {
  let nextValue = [...model.value.auths]
  if (checked === true) {
    if (!nextValue.includes(authValue)) {
      nextValue.push(authValue)
    }
  }
  else {
    nextValue = nextValue.filter(item => item !== authValue)
  }
  model.value.auths = nextValue
}

async function submit() {
  const result = await formRef.value?.validate()

  if (!result?.valid) {
    return false
  }

  if (model.value.id === '') {
    await apiRole.create(model.value)
    useFaToast().success('模拟新增成功')
  }
  else {
    await apiRole.edit(model.value)
    useFaToast().success('模拟编辑成功')
  }

  return true
}

defineExpose({
  submit,
})
</script>

<template>
  <div v-loading="loading">
    <FaForm
      ref="formRef"
      :model="model"
      :validation-schema="validationSchema"
      label-placement="right"
      :label-width="80"
    >
      <FaFormItem name="name" label="名称" required>
        <FaInput placeholder="请输入角色名称" class="w-full" />
      </FaFormItem>
      <FaFormItem name="remark" label="备注">
        <FaTextarea placeholder="请输入备注" class="w-full" />
      </FaFormItem>
      <FaFormItem name="auths" label="权限" :auto-bind="false">
        <div class="gap-2 grid">
          <div>
            <div class="inline-flex gap-2 items-center">
              <span class="text-sm text-muted-foreground">前端路由数据</span>
              <FaSwitch v-model="isBackendRoutes" />
              <span class="text-sm text-muted-foreground">后端路由数据</span>
            </div>
            <FaTooltip text="为方便演示，提供了路由数据分别从前端获取和后端获取的切换" side="top">
              <FaIcon name="i-ri:question-line" class="ms-4" />
            </FaTooltip>
          </div>
          <FaTable
            :key="routesFrom"
            :columns="[
              { accessorKey: 'module', header: '模块' },
              { accessorKey: 'auths', header: '权限' },
            ]"
            :data="routesWithAuths"
            row-key="id"
            tree
            stripe
            border
            :default-expanded="true"
            class="w-full"
          >
            <template #cell-module="{ row }">
              {{ generateI18nTitle((row.original as any)?.meta?.title) }}
            </template>
            <template #cell-auths="{ row }">
              <div v-if="(row.original as any)?.meta?.auths?.length" class="flex flex-col gap-2">
                <label class="flex gap-2 cursor-pointer items-center" @click.prevent="handleCheckAll(!getCheckAllState((row.original as any).id, model.auths).checkAll, (row.original as any).id)">
                  <FaCheckbox
                    :model-value="getCheckAllState((row.original as any).id, model.auths).checkAll ? true : getCheckAllState((row.original as any).id, model.auths).indeterminate ? 'indeterminate' : false"
                  />
                  <span class="text-sm">全选</span>
                </label>
                <div class="flex flex-wrap gap-x-4 gap-y-1">
                  <label
                    v-for="auth in (row.original as any)?.meta?.auths"
                    :key="auth.value"
                    class="flex gap-2 cursor-pointer items-center"
                    @click.prevent="handleAuthChange(auth.value, !model.auths.includes(auth.value))"
                  >
                    <FaCheckbox
                      :model-value="model.auths.includes(auth.value)"
                    />
                    <span class="text-sm">{{ auth.name }}</span>
                  </label>
                </div>
              </div>
            </template>
          </FaTable>
        </div>
      </FaFormItem>
    </FaForm>
  </div>
</template>
