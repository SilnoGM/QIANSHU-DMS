<script setup lang="ts">
import type { RoleDto, UserDto } from '@/api/generated/types.gen'

import { useMediaQuery } from '@vueuse/core'

import managementApi from '@/api/modules/management'

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

const isNarrow = useMediaQuery('(max-width: 767px)')
const loading = ref(false)
const errorMessage = ref('')
const requestId = ref<string>()
const selectedRoleIds = ref<string[]>([])
const roleOptions = computed(() => props.roles.map(role => ({
  label: role.isSystem ? `${role.name}（系统角色）` : role.name,
  value: role.id,
})))

function initialize(): void {
  selectedRoleIds.value = [...(props.user?.roleIds ?? [])]
  errorMessage.value = ''
  requestId.value = undefined
}

function close(): void {
  if (loading.value) {
    return
  }
  selectedRoleIds.value = []
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
      roleIds: [...selectedRoleIds.value],
    })
    selectedRoleIds.value = []
    useFaToast().success('用户角色已更新')
    emits('success', response.data)
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

watch(() => props.modelValue, (visible) => {
  if (visible) {
    initialize()
  }
  else {
    selectedRoleIds.value = []
  }
})
</script>

<template>
  <AModal
    :visible="modelValue"
    title="分配角色"
    :width="isNarrow ? 'calc(100vw - 24px)' : 560"
    :closable="!loading"
    :mask-closable="!loading"
    :esc-to-close="!loading"
    :footer="false"
    unmount-on-close
    @cancel="close"
  >
    <AAlert v-if="errorMessage" type="error" class="mb-4">
      {{ errorMessage }}
      <template v-if="requestId" #action>
        <span class="text-xs font-mono">requestId: {{ requestId }}</span>
      </template>
    </AAlert>
    <AAlert v-if="rolesErrorMessage" type="error" class="mb-4">
      角色目录加载失败：{{ rolesErrorMessage }}。请关闭弹窗后重试，当前不会提交空角色集合。
    </AAlert>
    <AAlert v-if="selectedRoleIds.length === 0" type="warning" class="mb-4">
      提交空集合会移除该用户的全部角色，用户将没有业务权限。
    </AAlert>

    <AForm :model="{ roleIds: selectedRoleIds }" layout="vertical" @submit-success="submit">
      <AFormItem label="用户名">
        <AInput :model-value="user?.username ?? ''" disabled />
      </AFormItem>
      <AFormItem label="角色">
        <ASelect
          v-model="selectedRoleIds"
          :options="roleOptions"
          :loading="rolesLoading"
          multiple
          allow-clear
          allow-search
          placeholder="选择角色；留空表示移除全部角色"
        />
      </AFormItem>

      <div class="mt-6 flex gap-3 justify-end">
        <AButton :disabled="loading" @click="close">
          取消
        </AButton>
        <AButton
          type="primary"
          html-type="submit"
          :loading="loading"
          :disabled="loading || !canSubmitRoleAssignment(rolesLoading ?? false, rolesErrorMessage ?? '')"
        >
          替换角色集合
        </AButton>
      </div>
    </AForm>
  </AModal>
</template>
