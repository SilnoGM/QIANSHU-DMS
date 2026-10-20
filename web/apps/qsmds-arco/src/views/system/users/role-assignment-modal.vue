<script setup lang="ts">
import type { RoleDto, UserDto } from '@/api/generated/types.gen'

import managementApi from '@/api/modules/management'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'

import { canSubmitRoleAssignment, getApiFailure } from './users.logic'

const props = defineProps<{
  modelValue: boolean
  user: UserDto | null
  roles: RoleDto[]
  rolesLoading?: boolean
  rolesErrorMessage?: string
}>()

const emits = defineEmits<{
  'update:modelValue': [value: boolean]
  'success': [user: UserDto]
}>()

const loading = ref(false)
const errorMessage = ref('')
const requestId = ref<string>()
const roleSearch = ref('')
const model = reactive({
  username: '',
  roleIds: [] as string[],
})
const filteredRoleOptions = computed(() => {
  const keyword = roleSearch.value.trim().toLocaleLowerCase()
  return props.roles
    .filter(role => keyword === '' || `${role.name} ${role.code}`.toLocaleLowerCase().includes(keyword))
    .map(role => ({
      label: role.name,
      value: role.id,
      description: role.isSystem ? `系统角色 · ${role.code}` : role.code,
    }))
})

function initialize(): void {
  model.username = props.user?.username ?? ''
  model.roleIds = [...(props.user?.roleIds ?? [])]
  roleSearch.value = ''
  errorMessage.value = ''
  requestId.value = undefined
}

function close(): void {
  if (loading.value) {
    return
  }
  model.username = ''
  model.roleIds = []
  roleSearch.value = ''
  errorMessage.value = ''
  requestId.value = undefined
  emits('update:modelValue', false)
}

async function submit(): Promise<void> {
  if (
    loading.value
    || !canSubmitRoleAssignment(
      props.rolesLoading ?? false,
      props.rolesErrorMessage ?? '',
    )
    || props.user === null
  ) {
    return
  }
  loading.value = true
  errorMessage.value = ''
  requestId.value = undefined
  try {
    const response = await managementApi.users.replaceRoles(props.user.id, {
      roleIds: [...model.roleIds],
    })
    model.roleIds = []
    useQsToast().success('用户角色已更新')
    emits('success', response.data)
    // QsGenericModal 在提交态拒绝程序化关闭，必须先让提交锁完成一次渲染。
    loading.value = false
    await nextTick()
    emits('update:modelValue', false)
  }
  catch (error) {
    const failure = getApiFailure(error)
    requestId.value = failure.requestId
    errorMessage.value = failure.unknownResult
      ? '更新结果未知，请刷新用户列表核查当前角色后再决定是否重试。'
      : failure.message
  }
  finally {
    loading.value = false
  }
}

function updateVisible(value: boolean): void {
  if (value) {
    emits('update:modelValue', true)
    return
  }
  close()
}

watch(() => props.modelValue, (visible) => {
  if (visible) {
    initialize()
  }
  else {
    model.username = ''
    model.roleIds = []
    roleSearch.value = ''
  }
})
</script>

<template>
  <QsGenericModal
    :model-value="modelValue"
    title="分配角色"
    size="md"
    :submitting="loading"
    @update:model-value="updateVisible"
  >
    <FaAlert v-if="errorMessage" variant="destructive" icon="i-lucide:circle-alert" class="mb-4">
      <template #description>
        <div class="flex flex-wrap gap-2 items-center justify-between">
          <span>{{ errorMessage }}</span>
          <span v-if="requestId" class="text-xs font-mono">requestId: {{ requestId }}</span>
        </div>
      </template>
    </FaAlert>
    <FaAlert v-if="rolesErrorMessage" variant="destructive" icon="i-lucide:circle-alert" class="mb-4">
      <template #description>
        角色目录加载失败：{{ rolesErrorMessage }}。请关闭弹窗后重试，当前不会提交空角色集合。
      </template>
    </FaAlert>
    <FaAlert v-if="model.roleIds.length === 0" icon="i-lucide:triangle-alert" class="mb-4 border-primary/30 bg-primary/5">
      <template #description>
        提交空集合会移除该用户的全部角色，用户将没有业务权限。
      </template>
    </FaAlert>

    <FaForm :model="model" :disabled="loading" class="gap-4" @submit="submit">
      <FaFormItem name="username" label="用户名">
        <FaInput v-model="model.username" class="w-full" disabled />
      </FaFormItem>
      <FaFormItem name="roleIds" label="角色" :auto-bind="false">
        <div class="gap-3 grid">
          <FaInput
            v-model="roleSearch"
            type="search"
            :disabled="loading"
            class="w-full"
            clearable
            placeholder="搜索角色名称或编码"
            @clear="roleSearch = ''"
          >
            <template #start>
              <FaIcon name="i-lucide:search" />
            </template>
          </FaInput>

          <div v-if="rolesLoading" class="py-8 flex-center">
            <FaIcon name="i-lucide:loader-circle" class="text-primary size-6 animate-spin" />
            <span class="sr-only">正在加载角色目录</span>
          </div>
          <FaEmpty
            v-else-if="filteredRoleOptions.length === 0"
            icon="i-lucide:search-x"
            title="没有匹配角色"
            description="可调整关键词后重试；留空提交表示移除全部角色。"
            class="py-6"
          />
          <FaCheckboxGroup
            v-else
            v-model="model.roleIds"
            :options="filteredRoleOptions"
            :disabled="loading"
            class="pr-1 max-h-64 overflow-y-auto"
          />
        </div>
      </FaFormItem>
    </FaForm>

    <template #footer>
      <FaButton
        type="button"
        variant="outline"
        class="min-h-11 w-full sm:min-h-9 sm:w-auto"
        :disabled="loading"
        @click="close"
      >
        取消
      </FaButton>
      <FaButton
        type="button"
        class="min-h-11 w-full sm:min-h-9 sm:w-auto"
        :loading="loading"
        :disabled="loading || !canSubmitRoleAssignment(rolesLoading ?? false, rolesErrorMessage ?? '')"
        @click="submit"
      >
        替换角色集合
      </FaButton>
    </template>
  </QsGenericModal>
</template>
