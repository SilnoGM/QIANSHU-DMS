<script setup lang="ts">
import type {
  CreateRoleRequestDto,
  RoleDto,
  UpdateRoleRequestDto,
} from '@/api/generated/types.gen'

import { countGraphemes } from '@/utils/grapheme'

defineOptions({ name: 'RoleEditorModal' })

const props = defineProps<{
  visible: boolean
  role: RoleDto | null
  loading: boolean
  errorMessage: string
}>()

const emits = defineEmits<{
  'update:visible': [value: boolean]
  'submit': [payload:
    | { mode: 'create', data: CreateRoleRequestDto }
    | { mode: 'edit', roleId: string, data: UpdateRoleRequestDto }]
}>()

const form = reactive({
  code: '',
  name: '',
  description: '',
})
const validationMessage = ref('')

const isEditing = computed(() => props.role !== null)

function resetForm(): void {
  form.code = props.role?.code ?? ''
  form.name = props.role?.name ?? ''
  form.description = props.role?.description ?? ''
  validationMessage.value = ''
}

function codePointLength(value: string): number {
  // Server/OpenAPI 已按 Unicode 码点定义字段上限；UI 字素簇计数不能改变提交契约。
  return Array.from(value).length
}

function validate(): boolean {
  const code = form.code.trim()
  const name = form.name.trim()
  const description = form.description.trim()

  if (!isEditing.value && !/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u.test(code)) {
    validationMessage.value = '角色编码只能使用小写字母、数字和下划线，且必须以字母开头'
    return false
  }
  if (!isEditing.value && codePointLength(code) > 128) {
    validationMessage.value = '角色编码不能超过 128 个字符'
    return false
  }
  if (name.length === 0 || codePointLength(name) > 128) {
    validationMessage.value = '角色名称应为 1 至 128 个字符且不能全为空白'
    return false
  }
  if (codePointLength(description) > 2_000) {
    validationMessage.value = '角色说明不能超过 2000 个字符'
    return false
  }

  validationMessage.value = ''
  return true
}

function submit(): void {
  if (props.loading || !validate()) {
    return
  }

  const name = form.name.trim()
  const description = form.description.trim()
  if (props.role === null) {
    emits('submit', {
      mode: 'create',
      data: {
        code: form.code.trim(),
        name,
        ...(description.length === 0 ? {} : { description }),
      },
    })
    return
  }

  emits('submit', {
    mode: 'edit',
    roleId: props.role.id,
    data: {
      name,
      description: description.length === 0 ? null : description,
    },
  })
}

function close(): void {
  if (!props.loading) {
    emits('update:visible', false)
  }
}

function handleVisibleChange(visible: boolean): void {
  if (!visible) {
    close()
  }
}

watch(() => [props.visible, props.role] as const, ([visible]) => {
  if (visible) {
    resetForm()
  }
})
</script>

<template>
  <FaModal
    :model-value="visible"
    :title="isEditing ? '编辑角色' : '创建角色'"
    class="sm:max-w-[520px]"
    :closable="!loading"
    :close-on-click-overlay="!loading"
    :close-on-press-escape="!loading"
    :footer="false"
    @update:model-value="handleVisibleChange"
  >
    <FaAlert
      v-if="errorMessage || validationMessage"
      variant="destructive"
      icon="i-lucide:circle-alert"
      :description="validationMessage || errorMessage"
      class="mb-4"
    />
    <FaAlert
      v-if="isEditing"
      icon="i-lucide:info"
      description="角色编码创建后不可修改。"
      class="mb-4"
    />

    <FaForm :model="form" :disabled="loading" class="gap-4" @submit="submit">
      <FaFormItem name="code" label="角色编码" required>
        <FaInput
          v-model="form.code"
          :disabled="isEditing || loading"
          class="w-full"
          maxlength="128"
          placeholder="例如 warehouse_reader"
          clearable
          @clear="form.code = ''"
        />
      </FaFormItem>
      <FaFormItem name="name" label="角色名称" required>
        <FaInput
          v-model="form.name"
          :disabled="loading"
          class="w-full"
          placeholder="请输入便于识别的名称"
          clearable
          @clear="form.name = ''"
        />
      </FaFormItem>
      <FaFormItem
        name="description"
        label="角色说明"
        :description="`${countGraphemes(form.description)} / 2000`"
        description-class="text-right"
      >
        <FaTextarea
          v-model="form.description"
          :disabled="loading"
          class="w-full"
          input-class="min-h-24 max-h-56"
          placeholder="可选；清空后保存将移除原说明"
        />
      </FaFormItem>

      <div class="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <FaButton type="button" variant="outline" :disabled="loading" @click="close">
          取消
        </FaButton>
        <FaButton type="submit" :loading="loading">
          {{ isEditing ? '保存修改' : '创建角色' }}
        </FaButton>
      </div>
    </FaForm>
  </FaModal>
</template>
