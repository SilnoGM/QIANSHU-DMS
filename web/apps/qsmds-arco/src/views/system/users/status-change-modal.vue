<script setup lang="ts">
import type { UserDto } from '@/api/generated/types.gen'

import managementApi from '@/api/modules/management'

import { getApiFailure } from './users.logic'

const props = defineProps<{
  modelValue: boolean
  user: UserDto | null
  action: 'enable' | 'disable'
}>()

const emits = defineEmits<{
  'update:modelValue': [value: boolean]
  'success': [user: UserDto]
}>()

const loading = ref(false)
const errorMessage = ref('')
const requestId = ref<string>()
const isDisable = computed(() => props.action === 'disable')

function close(): void {
  if (loading.value) {
    return
  }
  errorMessage.value = ''
  requestId.value = undefined
  emits('update:modelValue', false)
}

async function submit(): Promise<void> {
  if (loading.value || props.user === null) {
    return
  }
  loading.value = true
  errorMessage.value = ''
  requestId.value = undefined
  try {
    const response = isDisable.value
      ? await managementApi.users.disable(props.user.id)
      : await managementApi.users.enable(props.user.id)
    useFaToast().success(isDisable.value ? '用户已禁用' : '用户已启用')
    emits('success', response.data)
    emits('update:modelValue', false)
  }
  catch (error) {
    const failure = getApiFailure(error)
    requestId.value = failure.requestId
    errorMessage.value = failure.unknownResult
      ? '操作结果未知，请刷新用户列表核查当前状态。'
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
  if (!visible) {
    errorMessage.value = ''
    requestId.value = undefined
  }
})
</script>

<template>
  <FaModal
    :model-value="modelValue"
    :title="isDisable ? '确认禁用用户' : '确认启用用户'"
    class="max-w-[calc(100%-1.5rem)] min-h-auto sm:max-w-[480px]"
    :closable="!loading"
    :close-on-click-overlay="!loading"
    :close-on-press-escape="!loading"
    :footer="false"
    destroy-on-close
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
    <p class="leading-6 m-0">
      确认{{ isDisable ? '禁用' : '启用' }}用户
      <strong class="font-mono mx-1">{{ user?.username }}</strong>？
    </p>
    <p v-if="isDisable" class="text-sm text-destructive mb-0 mt-3">
      禁用后，该用户的全部现有 Session 将立即撤销。
    </p>

    <div class="mt-6 flex gap-3 justify-end">
      <FaButton variant="outline" :disabled="loading" @click="close">
        取消
      </FaButton>
      <FaButton
        :variant="isDisable ? 'destructive' : 'default'"
        :loading="loading"
        :disabled="loading"
        @click="submit"
      >
        确认{{ isDisable ? '禁用' : '启用' }}
      </FaButton>
    </div>
  </FaModal>
</template>
