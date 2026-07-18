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
const groups = computed(() => groupPermissions(props.permissions))

function close(): void {
  if (!props.loading) {
    emits('update:visible', false)
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
  <AModal
    :visible="visible"
    :title="role === null ? '分配权限' : `为「${role.name}」分配权限`"
    width="min(760px, calc(100vw - 24px))"
    :mask-closable="!loading"
    :esc-to-close="!loading"
    :closable="!loading"
    unmount-on-close
    @cancel="close"
  >
    <AAlert v-if="errorMessage" type="error" class="mb-4">
      {{ errorMessage }}
    </AAlert>
    <AAlert type="warning" class="mb-4">
      提交会替换该角色的完整权限集合；不勾选任何权限表示清空。系统专用权限不可分配给普通角色。
    </AAlert>

    <AEmpty v-if="permissions.length === 0" description="暂无可分配权限" />
    <div v-else class="permission-groups">
      <section v-for="group in groups" :key="group.key" class="permission-group">
        <div class="permission-group__header">
          <strong>{{ group.label }}</strong>
          <span>{{ group.permissions.length }} 项</span>
        </div>
        <ACheckboxGroup v-model="selectedIds" direction="vertical" class="permission-group__items">
          <ACheckbox
            v-for="permission in group.permissions"
            :key="permission.id"
            :value="permission.id"
            :disabled="loading || permission.systemOnly"
          >
            <span class="permission-option">
              <span>
                <code>{{ permission.code }}</code>
                <ATag v-if="permission.systemOnly" size="small" color="orangered" class="ml-2">
                  系统专用
                </ATag>
              </span>
              <small>{{ permission.description || permission.name }}</small>
            </span>
          </ACheckbox>
        </ACheckboxGroup>
      </section>
    </div>

    <template #footer>
      <AButton :disabled="loading" @click="close">
        取消
      </AButton>
      <AButton type="primary" :loading="loading" :disabled="role?.isSystem" @click="submit">
        保存权限
      </AButton>
    </template>
  </AModal>
</template>

<style scoped>
.permission-groups {
  display: grid;
  gap: 12px;
  max-height: min(60vh, 640px);
  padding-right: 4px;
  overflow-y: auto;
}

.permission-group {
  padding: 14px;
  border: 1px solid var(--color-border-2);
  border-radius: 8px;
}

.permission-group__header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 12px;
  color: var(--color-text-2);
}

.permission-group__items {
  gap: 10px;
  width: 100%;
}

.permission-option {
  display: inline-flex;
  flex-direction: column;
  gap: 3px;
}

.permission-option small {
  color: var(--color-text-3);
  white-space: normal;
}
</style>
