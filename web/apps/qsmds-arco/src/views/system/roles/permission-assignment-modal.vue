<script setup lang="ts">
import type { PermissionDto, RoleDto } from '@/api/generated/types.gen'
import { groupPermissions, sanitizePermissionSelection } from '../permissions/catalog'

defineOptions({ name: 'PermissionAssignmentModal' })

const props = defineProps<{
  visible: boolean
  role: RoleDto | null
  permissions: PermissionDto[]
  loading: boolean
  errorMessage: string
}>()

const emits = defineEmits<{
  'update:visible': [value: boolean]
  'submit': [roleId: string, permissionIds: string[]]
}>()

const selectedIds = ref<string[]>([])
const groups = computed(() => groupPermissions(props.permissions).map(group => ({
  ...group,
  options: group.permissions.map(permission => ({
    label: permission.name,
    value: permission.id,
    description: permission.description || permission.name,
    disabled: permission.systemOnly,
    code: permission.code,
    systemOnly: permission.systemOnly,
  })),
})))

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

function submit(): void {
  if (props.loading || props.role === null || props.role.isSystem) {
    return
  }
  emits(
    'submit',
    props.role.id,
    sanitizePermissionSelection(selectedIds.value, props.permissions),
  )
}

watch(() => [props.visible, props.role] as const, ([visible, role]) => {
  if (visible) {
    selectedIds.value = role === null
      ? []
      : sanitizePermissionSelection(role.permissionIds, props.permissions)
  }
})
</script>

<template>
  <FaModal
    :model-value="visible"
    :title="role === null ? '分配权限' : `为「${role.name}」分配权限`"
    class="sm:max-w-[760px]"
    :closable="!loading"
    :close-on-click-overlay="!loading"
    :close-on-press-escape="!loading"
    :footer="false"
    @update:model-value="handleVisibleChange"
  >
    <FaAlert
      v-if="errorMessage"
      variant="destructive"
      icon="i-lucide:circle-alert"
      :description="errorMessage"
      class="mb-4"
    />
    <FaAlert
      icon="i-lucide:triangle-alert"
      description="提交会替换该角色的完整权限集合；不勾选任何权限表示清空。系统专用权限不可分配给普通角色。"
      class="mb-4"
    />

    <FaEmpty
      v-if="permissions.length === 0"
      icon="i-lucide:shield-off"
      title="暂无可分配权限"
      description="请先确认权限目录已正常加载。"
    />
    <div v-else class="pr-1 gap-3 grid max-h-[min(60vh,640px)] overflow-y-auto">
      <section v-for="group in groups" :key="group.key" class="p-3.5 border border-border rounded-lg">
        <div class="text-foreground mb-3 flex gap-3 items-center justify-between">
          <strong>{{ group.label }}</strong>
          <span class="text-sm text-muted-foreground">{{ group.permissions.length }} 项</span>
        </div>
        <FaCheckboxGroup
          v-model="selectedIds"
          :options="group.options"
          :disabled="loading"
          class="gap-2.5"
          option-class="rounded-lg border border-border p-3 transition-colors hover:border-primary/40"
        >
          <template #option="{ option, checked, disabled }">
            <div
              class="gap-1 grid min-w-0 w-full"
              :class="[
                checked && 'text-foreground',
                disabled && 'opacity-60',
              ]"
            >
              <div class="flex flex-wrap gap-2 min-w-0 items-center">
                <code class="min-w-0 [overflow-wrap:anywhere]">{{ option.code }}</code>
                <FaTag v-if="option.systemOnly" variant="outline">
                  系统专用
                </FaTag>
                <span class="text-xs font-medium ml-auto" :class="checked ? 'text-primary' : 'text-muted-foreground'">
                  {{ checked ? '已选中' : disabled ? '不可分配' : '可选择' }}
                </span>
              </div>
              <span class="text-xs text-muted-foreground leading-5 whitespace-normal">
                {{ option.description }}
              </span>
            </div>
          </template>
        </FaCheckboxGroup>
      </section>
    </div>

    <div class="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <FaButton variant="outline" :disabled="loading" @click="close">
        取消
      </FaButton>
      <FaButton :loading="loading" :disabled="role?.isSystem" @click="submit">
        保存权限
      </FaButton>
    </div>
  </FaModal>
</template>
