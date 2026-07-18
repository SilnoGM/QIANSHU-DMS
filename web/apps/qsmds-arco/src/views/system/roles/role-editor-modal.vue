<script setup lang="ts">
import type {
  CreateRoleRequestDto,
  RoleDto,
  UpdateRoleRequestDto,
} from '@/api/generated/types.gen'

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

watch(() => [props.visible, props.role] as const, ([visible]) => {
  if (visible) {
    resetForm()
  }
})
</script>

<template>
  <AModal
    :visible="visible"
    :title="isEditing ? '编辑角色' : '创建角色'"
    width="min(520px, calc(100vw - 24px))"
    :mask-closable="!loading"
    :esc-to-close="!loading"
    :closable="!loading"
    unmount-on-close
    @cancel="close"
  >
    <AAlert v-if="errorMessage || validationMessage" type="error" class="mb-4">
      {{ validationMessage || errorMessage }}
    </AAlert>
    <AAlert v-if="isEditing" type="info" class="mb-4">
      角色编码创建后不可修改。
    </AAlert>

    <AForm :model="form" layout="vertical" @submit-success="submit">
      <AFormItem field="code" label="角色编码" required>
        <AInput
          v-model="form.code"
          :disabled="isEditing || loading"
          :max-length="128"
          placeholder="例如 warehouse_reader"
          allow-clear
        />
      </AFormItem>
      <AFormItem field="name" label="角色名称" required>
        <AInput
          v-model="form.name"
          :disabled="loading"
          :max-length="128"
          placeholder="请输入便于识别的名称"
          allow-clear
        />
      </AFormItem>
      <AFormItem field="description" label="角色说明">
        <ATextarea
          v-model="form.description"
          :disabled="loading"
          :max-length="2000"
          :auto-size="{ minRows: 3, maxRows: 7 }"
          placeholder="可选；清空后保存将移除原说明"
          show-word-limit
        />
      </AFormItem>
    </AForm>

    <template #footer>
      <AButton :disabled="loading" @click="close">
        取消
      </AButton>
      <AButton type="primary" :loading="loading" @click="submit">
        {{ isEditing ? '保存修改' : '创建角色' }}
      </AButton>
    </template>
  </AModal>
</template>
