<script setup lang="ts">
import type { PermissionDto, RoleDto } from '@/api/generated/types.gen'
import QsGenericDrawer from '@/components/business/QsGenericDrawer/index.vue'
import { groupPermissions, sanitizePermissionSelection } from '../permissions/catalog'

defineOptions({ name: 'PermissionAssignmentDrawer' })

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
  <QsGenericDrawer
    :model-value="visible"
    title="分配权限"
    :description="role === null
      ? '选择角色需要的业务权限。'
      : `正在为「${role.name}」配置权限，保存后立即生效。`"
    placement="right"
    size="xl"
    :submitting="loading"
    @update:model-value="handleVisibleChange"
  >
    <template #header-leading>
      <FaIcon name="i-lucide:shield-check" class="size-4" />
    </template>

    <div data-testid="permission-assignment-drawer-content" class="gap-4 grid">
      <!-- 保存错误属于业务提交反馈，不复用通用抽屉固定的“加载失败”内容状态。 -->
      <FaAlert
        v-if="errorMessage"
        variant="destructive"
        icon="i-lucide:circle-alert"
        title="权限保存失败"
        :description="errorMessage"
      />
      <FaAlert
        icon="i-lucide:triangle-alert"
        description="提交会替换该角色的完整权限集合；不勾选任何权限表示清空。系统专用权限不可分配给普通角色。"
      />

      <FaEmpty
        v-if="permissions.length === 0"
        icon="i-lucide:shield-off"
        title="暂无可分配权限"
        description="请先确认权限目录已正常加载。"
      />
      <div v-else class="gap-3 grid">
        <section
          v-for="group in groups"
          :key="group.key"
          class="p-3.5 border border-border rounded-lg bg-muted/10"
        >
          <div class="text-foreground mb-3 flex gap-3 items-center justify-between">
            <strong>{{ group.label }}</strong>
            <span class="text-sm text-muted-foreground">{{ group.permissions.length }} 项</span>
          </div>
          <FaCheckboxGroup
            v-model="selectedIds"
            :options="group.options"
            :disabled="loading"
            class="gap-2.5"
            option-class="rounded-lg border border-border bg-background p-3 transition-colors hover:border-primary/40"
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
    </div>

    <template #footer>
      <span class="qs-type-meta text-muted-foreground md:me-auto">
        已选择 {{ selectedIds.length }} 项
      </span>
      <FaButton
        variant="outline"
        class="w-full md:w-auto"
        :disabled="loading"
        @click="close"
      >
        取消
      </FaButton>
      <FaButton
        class="w-full md:w-auto"
        :loading="loading"
        :disabled="role?.isSystem"
        @click="submit"
      >
        保存权限
      </FaButton>
    </template>
  </QsGenericDrawer>
</template>
