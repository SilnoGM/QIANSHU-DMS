<script setup lang="ts">
import type { FundApiFailure } from '../shared/fund-request.logic'
import type {
  CreateFundBusinessSourceRequestDto,
  CreateFundPostingTypeRequestDto,
  FundBusinessSourceDto,
  FundPostingTypeDto,
  ReplaceFundDraftRuleRequestDto,
  UpdateFundBusinessSourceRequestDto,
  UpdateFundPostingTypeRequestDto,
} from '@/api/generated/types.gen'

import fundAccountsApi from '@/api/modules/fund-accounts'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericDrawer from '@/components/business/QsGenericDrawer/index.vue'

import {
  canApplyFundResponse,
  getFundApiFailure,
  isFundAbortError,
} from '../shared/fund-request.logic'
import FundBusinessSourceFormModal from './fund-business-source-form-modal.vue'
import FundBusinessSourcePanel from './fund-business-source-panel.vue'
import FundConfigurationConfirmModal from './fund-configuration-confirm-modal.vue'
import {
  matchesFundBusinessSource,
  matchesFundPostingTypeDraft,
  matchesFundPostingTypeStatus,
} from './fund-configuration.logic'
import FundPostingRuleModal from './fund-posting-rule-modal.vue'
import FundPostingTypeFormModal from './fund-posting-type-form-modal.vue'
import FundPostingTypePanel from './fund-posting-type-panel.vue'

defineOptions({ name: 'FundConfigurationDrawer' })

const props = defineProps<{
  canManageBusinessSources: boolean
  canManagePostingTypes: boolean
  modelValue: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()
type ActiveTab = 'business-sources' | 'posting-types'
type ConfigurationKind = 'business-source' | 'posting-type'
type ConfirmAction = 'disable' | 'enable' | 'publish'
type FormMode = 'create' | 'edit'

const appAccountStore = useAppAccountStore()
const toast = useQsToast()

const activeTab = ref<ActiveTab>('posting-types')
const postingTypes = ref<FundPostingTypeDto[]>([])
const businessSources = ref<FundBusinessSourceDto[]>([])
const postingTypesLoading = ref(false)
const businessSourcesLoading = ref(false)
const postingTypesFailure = ref<FundApiFailure | null>(null)
const businessSourcesFailure = ref<FundApiFailure | null>(null)

const postingTypeFormVisible = ref(false)
const postingTypeFormMode = ref<FormMode>('create')
const postingTypeTarget = ref<FundPostingTypeDto | null>(null)
const ruleFormVisible = ref(false)
const ruleTarget = ref<FundPostingTypeDto | null>(null)
const businessSourceFormVisible = ref(false)
const businessSourceFormMode = ref<FormMode>('create')
const businessSourceTarget = ref<FundBusinessSourceDto | null>(null)

const confirmVisible = ref(false)
const confirmAction = ref<ConfirmAction>('enable')
const confirmKind = ref<ConfigurationKind>('posting-type')
const confirmPostingType = ref<FundPostingTypeDto | null>(null)
const confirmBusinessSource = ref<FundBusinessSourceDto | null>(null)

const mutationSubmitting = ref(false)
const mutationFailure = ref<FundApiFailure | null>(null)
const unknownResult = ref(false)

let postingTypeRequestVersion = 0
let postingTypeAbortController: AbortController | null = null
let businessSourceRequestVersion = 0
let businessSourceAbortController: AbortController | null = null
let mutationVersion = 0

const hasAnyPermission = computed(() => (
  props.canManagePostingTypes || props.canManageBusinessSources
))
const tabs = computed(() => [
  ...(props.canManagePostingTypes
    ? [{ label: `业务类型 ${postingTypes.value.length}`, value: 'posting-types' }]
    : []),
  ...(props.canManageBusinessSources
    ? [{ label: `业务来源 ${businessSources.value.length}`, value: 'business-sources' }]
    : []),
])
const postingTypesErrorDisplay = computed(() => formatFailure(postingTypesFailure.value))
const businessSourcesErrorDisplay = computed(() => formatFailure(businessSourcesFailure.value))
const confirmTargetName = computed(() => (
  confirmKind.value === 'posting-type'
    ? confirmPostingType.value?.name ?? ''
    : confirmBusinessSource.value?.name ?? ''
))
const confirmTargetCode = computed(() => (
  confirmKind.value === 'posting-type'
    ? confirmPostingType.value?.code ?? ''
    : confirmBusinessSource.value?.code ?? ''
))

function formatFailure(failure: FundApiFailure | null): string | undefined {
  if (failure === null) {
    return undefined
  }
  return failure.requestId === undefined
    ? failure.message
    : `${failure.message}（requestId: ${failure.requestId}）`
}

function currentTab(): ActiveTab {
  if (props.canManagePostingTypes) {
    return 'posting-types'
  }
  return 'business-sources'
}

function responseIsCurrent(
  requestVersion: number,
  latestRequestVersion: number,
  authEpoch: number,
  controller: AbortController,
  authorized: boolean,
): boolean {
  return canApplyFundResponse({
    aborted: controller.signal.aborted,
    authEpoch,
    authorized,
    currentAuthEpoch: appAccountStore.authEpoch,
    latestRequestVersion,
    requestVersion,
  })
}

function mutationResponseIsCurrent(
  requestVersion: number,
  authEpoch: number,
  authorized: boolean,
): boolean {
  return canApplyFundResponse({
    aborted: false,
    authEpoch,
    authorized,
    currentAuthEpoch: appAccountStore.authEpoch,
    latestRequestVersion: mutationVersion,
    requestVersion,
  })
}

async function readAllPostingTypes(signal: AbortSignal): Promise<FundPostingTypeDto[]> {
  const items: FundPostingTypeDto[] = []
  let page = 1
  while (!signal.aborted) {
    const response = await fundAccountsApi.postingTypes.list({
      page,
      pageSize: 100,
      sortBy: 'code',
      sortOrder: 'asc',
    }, signal)
    items.push(...response.data.items)
    if (items.length >= response.data.total || response.data.items.length === 0) {
      break
    }
    page += 1
  }
  return items
}

async function readAllBusinessSources(signal: AbortSignal): Promise<FundBusinessSourceDto[]> {
  const items: FundBusinessSourceDto[] = []
  let page = 1
  while (!signal.aborted) {
    const response = await fundAccountsApi.businessSources.list({
      page,
      pageSize: 100,
      sortBy: 'code',
      sortOrder: 'asc',
    }, signal)
    items.push(...response.data.items)
    if (items.length >= response.data.total || response.data.items.length === 0) {
      break
    }
    page += 1
  }
  return items
}

async function loadPostingTypes(): Promise<boolean> {
  if (!props.modelValue || !props.canManagePostingTypes) {
    return false
  }
  postingTypeAbortController?.abort()
  const controller = new AbortController()
  postingTypeAbortController = controller
  const requestVersion = ++postingTypeRequestVersion
  const authEpoch = appAccountStore.authEpoch
  postingTypesLoading.value = true
  postingTypesFailure.value = null
  try {
    const items = await readAllPostingTypes(controller.signal)
    if (!responseIsCurrent(
      requestVersion,
      postingTypeRequestVersion,
      authEpoch,
      controller,
      props.modelValue && props.canManagePostingTypes,
    )) {
      return false
    }
    postingTypes.value = items
    return true
  }
  catch (error) {
    if (
      !isFundAbortError(error)
      && responseIsCurrent(
        requestVersion,
        postingTypeRequestVersion,
        authEpoch,
        controller,
        props.modelValue && props.canManagePostingTypes,
      )
    ) {
      postingTypes.value = []
      postingTypesFailure.value = getFundApiFailure(error)
    }
    return false
  }
  finally {
    if (requestVersion === postingTypeRequestVersion) {
      postingTypesLoading.value = false
    }
  }
}

async function loadBusinessSources(): Promise<boolean> {
  if (!props.modelValue || !props.canManageBusinessSources) {
    return false
  }
  businessSourceAbortController?.abort()
  const controller = new AbortController()
  businessSourceAbortController = controller
  const requestVersion = ++businessSourceRequestVersion
  const authEpoch = appAccountStore.authEpoch
  businessSourcesLoading.value = true
  businessSourcesFailure.value = null
  try {
    const items = await readAllBusinessSources(controller.signal)
    if (!responseIsCurrent(
      requestVersion,
      businessSourceRequestVersion,
      authEpoch,
      controller,
      props.modelValue && props.canManageBusinessSources,
    )) {
      return false
    }
    businessSources.value = items
    return true
  }
  catch (error) {
    if (
      !isFundAbortError(error)
      && responseIsCurrent(
        requestVersion,
        businessSourceRequestVersion,
        authEpoch,
        controller,
        props.modelValue && props.canManageBusinessSources,
      )
    ) {
      businessSources.value = []
      businessSourcesFailure.value = getFundApiFailure(error)
    }
    return false
  }
  finally {
    if (requestVersion === businessSourceRequestVersion) {
      businessSourcesLoading.value = false
    }
  }
}

function loadPermittedConfiguration(): void {
  if (props.canManagePostingTypes) {
    void loadPostingTypes()
  }
  if (props.canManageBusinessSources) {
    void loadBusinessSources()
  }
}

function closeChildDialogs(): void {
  postingTypeFormVisible.value = false
  postingTypeTarget.value = null
  ruleFormVisible.value = false
  ruleTarget.value = null
  businessSourceFormVisible.value = false
  businessSourceTarget.value = null
  confirmVisible.value = false
  confirmPostingType.value = null
  confirmBusinessSource.value = null
  mutationFailure.value = null
  unknownResult.value = false
}

/** 身份或配置权限变化时，不允许目录、草稿或 mutation 结果跨边界存活。 */
function clearConfigurationState(): void {
  postingTypeRequestVersion += 1
  postingTypeAbortController?.abort()
  businessSourceRequestVersion += 1
  businessSourceAbortController?.abort()
  mutationVersion += 1
  postingTypes.value = []
  businessSources.value = []
  postingTypesLoading.value = false
  businessSourcesLoading.value = false
  postingTypesFailure.value = null
  businessSourcesFailure.value = null
  mutationSubmitting.value = false
  closeChildDialogs()
}

function updateVisible(value: boolean): void {
  if (value) {
    emit('update:modelValue', true)
    return
  }
  if (!mutationSubmitting.value) {
    clearConfigurationState()
    emit('update:modelValue', false)
  }
}

function handleOpened(): void {
  activeTab.value = currentTab()
  loadPermittedConfiguration()
}

function updateActiveTab(value: unknown): void {
  if (value === 'posting-types' && props.canManagePostingTypes) {
    activeTab.value = value
  }
  if (value === 'business-sources' && props.canManageBusinessSources) {
    activeTab.value = value
  }
}

function openPostingTypeCreate(): void {
  if (!props.canManagePostingTypes) {
    return
  }
  postingTypeFormMode.value = 'create'
  postingTypeTarget.value = null
  mutationFailure.value = null
  postingTypeFormVisible.value = true
}

function openPostingTypeEdit(target: FundPostingTypeDto): void {
  if (!props.canManagePostingTypes) {
    return
  }
  postingTypeFormMode.value = 'edit'
  postingTypeTarget.value = target
  mutationFailure.value = null
  postingTypeFormVisible.value = true
}

function openRuleEdit(target: FundPostingTypeDto): void {
  if (!props.canManagePostingTypes || target.inputMode !== 'STANDARD') {
    return
  }
  ruleTarget.value = target
  mutationFailure.value = null
  ruleFormVisible.value = true
}

function openBusinessSourceCreate(): void {
  if (!props.canManageBusinessSources) {
    return
  }
  businessSourceFormMode.value = 'create'
  businessSourceTarget.value = null
  mutationFailure.value = null
  businessSourceFormVisible.value = true
}

function openBusinessSourceEdit(target: FundBusinessSourceDto): void {
  if (!props.canManageBusinessSources) {
    return
  }
  businessSourceFormMode.value = 'edit'
  businessSourceTarget.value = target
  mutationFailure.value = null
  businessSourceFormVisible.value = true
}

function openPostingTypeConfirm(target: FundPostingTypeDto, action: ConfirmAction): void {
  if (!props.canManagePostingTypes) {
    return
  }
  confirmKind.value = 'posting-type'
  confirmAction.value = action
  confirmPostingType.value = target
  confirmBusinessSource.value = null
  mutationFailure.value = null
  confirmVisible.value = true
}

function openBusinessSourceConfirm(target: FundBusinessSourceDto, action: Exclude<ConfirmAction, 'publish'>): void {
  if (!props.canManageBusinessSources) {
    return
  }
  confirmKind.value = 'business-source'
  confirmAction.value = action
  confirmBusinessSource.value = target
  confirmPostingType.value = null
  mutationFailure.value = null
  confirmVisible.value = true
}

async function refreshConfiguration(kind: ConfigurationKind): Promise<boolean> {
  if (kind === 'business-source') {
    return loadBusinessSources()
  }
  const typeLoaded = await loadPostingTypes()
  if (props.canManageBusinessSources) {
    void loadBusinessSources()
  }
  return typeLoaded
}

/**
 * 配置 mutation 没有幂等键。网络或 5xx 时只重新读取目录并比对期望状态，
 * 绝不自动重放原 mutation；无法证明成功时保留明确的结果未知提示。
 */
async function reconcileUnknownMutation(
  kind: ConfigurationKind,
  matches: () => boolean,
): Promise<boolean> {
  unknownResult.value = true
  const loaded = await refreshConfiguration(kind)
  return loaded && matches()
}

async function executeMutation(input: {
  authorized: () => boolean
  close: () => void
  kind: ConfigurationKind
  matches: () => boolean
  operation: () => Promise<unknown>
  successMessage: string
}): Promise<void> {
  if (!props.modelValue || !input.authorized() || mutationSubmitting.value) {
    return
  }
  const requestVersion = ++mutationVersion
  const authEpoch = appAccountStore.authEpoch
  mutationSubmitting.value = true
  mutationFailure.value = null
  unknownResult.value = false
  try {
    await input.operation()
    if (!mutationResponseIsCurrent(
      requestVersion,
      authEpoch,
      props.modelValue && input.authorized(),
    )) {
      return
    }
    // QsGenericModal / Drawer 在 submitting=true 时拒绝受控关闭；先释放再关闭，
    // 防止成功响应后父子可见状态分叉或关闭守卫锁死。
    mutationSubmitting.value = false
    await nextTick()
    input.close()
    toast.success(input.successMessage)
    await refreshConfiguration(input.kind)
  }
  catch (error) {
    if (!mutationResponseIsCurrent(
      requestVersion,
      authEpoch,
      props.modelValue && input.authorized(),
    )) {
      return
    }
    const failure = getFundApiFailure(error)
    mutationFailure.value = failure
    if (failure.unknownResult) {
      const matched = await reconcileUnknownMutation(input.kind, input.matches)
      if (!mutationResponseIsCurrent(
        requestVersion,
        authEpoch,
        props.modelValue && input.authorized(),
      )) {
        return
      }
      if (matched) {
        mutationSubmitting.value = false
        await nextTick()
        input.close()
        mutationFailure.value = null
        toast.success(`${input.successMessage}（已重新读取确认）`)
      }
      else {
        mutationFailure.value = {
          ...failure,
          message: '提交结果未知；已重新读取最新配置，但当前状态无法证明本次写入成功。请核对后再操作。',
        }
        toast.warning('配置结果未知，已重新读取但未自动重放请求。')
      }
    }
  }
  finally {
    if (requestVersion === mutationVersion) {
      mutationSubmitting.value = false
      unknownResult.value = false
    }
  }
}

function postingTypeProfileMatches(
  item: FundPostingTypeDto,
  expected: CreateFundPostingTypeRequestDto | UpdateFundPostingTypeRequestDto,
): boolean {
  return item.name === expected.name
    && item.description === (expected.description ?? null)
}

function submitPostingType(
  payload: CreateFundPostingTypeRequestDto | UpdateFundPostingTypeRequestDto,
): void {
  if (postingTypeFormMode.value === 'create') {
    const request = payload as CreateFundPostingTypeRequestDto
    void executeMutation({
      authorized: () => props.canManagePostingTypes,
      close: () => {
        postingTypeFormVisible.value = false
      },
      kind: 'posting-type',
      matches: () => {
        const latest = postingTypes.value.find(item => item.code === request.code)
        return latest !== undefined
          && postingTypeProfileMatches(latest, request)
          && latest.businessCategory === request.businessCategory
          && latest.amountSignPolicy === request.amountSignPolicy
          && matchesFundPostingTypeDraft(latest, request.legs)
      },
      operation: () => fundAccountsApi.postingTypes.create(request),
      successMessage: '业务类型草稿已创建',
    })
    return
  }

  const target = postingTypeTarget.value
  if (target === null) {
    return
  }
  const request = payload as UpdateFundPostingTypeRequestDto
  void executeMutation({
    authorized: () => props.canManagePostingTypes,
    close: () => {
      postingTypeFormVisible.value = false
    },
    kind: 'posting-type',
    matches: () => {
      const latest = postingTypes.value.find(item => item.id === target.id)
      return latest !== undefined && postingTypeProfileMatches(latest, request)
    },
    operation: () => fundAccountsApi.postingTypes.update(target.id, request),
    successMessage: '业务类型基本信息已更新',
  })
}

function submitRuleDraft(payload: ReplaceFundDraftRuleRequestDto): void {
  const target = ruleTarget.value
  if (target === null) {
    return
  }
  const expectedLegs = payload.legs.map(leg => ({ ...leg }))
  void executeMutation({
    authorized: () => props.canManagePostingTypes,
    close: () => {
      ruleFormVisible.value = false
    },
    kind: 'posting-type',
    matches: () => {
      const latest = postingTypes.value.find(item => item.id === target.id)
      return latest !== undefined && matchesFundPostingTypeDraft(latest, expectedLegs)
    },
    operation: () => fundAccountsApi.postingTypes.replaceDraftRule(target.id, payload),
    successMessage: '规则草稿已保存',
  })
}

function submitBusinessSource(
  payload: CreateFundBusinessSourceRequestDto | UpdateFundBusinessSourceRequestDto,
): void {
  if (businessSourceFormMode.value === 'create') {
    const request = payload as CreateFundBusinessSourceRequestDto
    void executeMutation({
      authorized: () => props.canManageBusinessSources,
      close: () => {
        businessSourceFormVisible.value = false
      },
      kind: 'business-source',
      matches: () => {
        const latest = businessSources.value.find(item => item.code === request.code)
        return latest !== undefined && matchesFundBusinessSource(latest, {
          ...request,
          description: request.description ?? null,
        })
      },
      operation: () => fundAccountsApi.businessSources.create(request),
      successMessage: '业务来源已创建',
    })
    return
  }

  const target = businessSourceTarget.value
  if (target === null) {
    return
  }
  const request = payload as UpdateFundBusinessSourceRequestDto
  void executeMutation({
    authorized: () => props.canManageBusinessSources,
    close: () => {
      businessSourceFormVisible.value = false
    },
    kind: 'business-source',
    matches: () => {
      const latest = businessSources.value.find(item => item.id === target.id)
      return latest !== undefined && matchesFundBusinessSource(latest, {
        ...request,
        description: request.description ?? null,
        enabled: target.enabled,
      })
    },
    operation: () => fundAccountsApi.businessSources.update(target.id, request),
    successMessage: '业务来源已更新',
  })
}

function confirmMutation(): void {
  if (confirmKind.value === 'posting-type') {
    const target = confirmPostingType.value
    if (target === null) {
      return
    }
    if (confirmAction.value === 'publish') {
      const draft = target.draftRule
      if (draft === null) {
        return
      }
      void executeMutation({
        authorized: () => props.canManagePostingTypes,
        close: () => {
          confirmVisible.value = false
        },
        kind: 'posting-type',
        matches: () => postingTypes.value.some(item => (
          item.id === target.id && item.activeRule?.id === draft.id
        )),
        operation: () => fundAccountsApi.postingTypes.publish(target.id, {
          draftRuleVersionId: draft.id,
          expectedVersion: target.version,
        }),
        successMessage: '规则版本已发布',
      })
      return
    }
    const enabled = confirmAction.value === 'enable'
    void executeMutation({
      authorized: () => props.canManagePostingTypes,
      close: () => {
        confirmVisible.value = false
      },
      kind: 'posting-type',
      matches: () => {
        const latest = postingTypes.value.find(item => item.id === target.id)
        return latest !== undefined && matchesFundPostingTypeStatus(latest, enabled)
      },
      operation: () => enabled
        ? fundAccountsApi.postingTypes.enable(target.id, { expectedVersion: target.version })
        : fundAccountsApi.postingTypes.disable(target.id, { expectedVersion: target.version }),
      successMessage: enabled ? '业务类型已启用' : '业务类型已停用',
    })
    return
  }

  const target = confirmBusinessSource.value
  if (target === null || confirmAction.value === 'publish') {
    return
  }
  const enabled = confirmAction.value === 'enable'
  void executeMutation({
    authorized: () => props.canManageBusinessSources,
    close: () => {
      confirmVisible.value = false
    },
    kind: 'business-source',
    matches: () => {
      const latest = businessSources.value.find(item => item.id === target.id)
      return latest !== undefined && latest.enabled === enabled
    },
    operation: () => enabled
      ? fundAccountsApi.businessSources.enable(target.id, { expectedVersion: target.version })
      : fundAccountsApi.businessSources.disable(target.id, { expectedVersion: target.version }),
    successMessage: enabled ? '业务来源已启用' : '业务来源已停用',
  })
}

watch(
  [
    () => appAccountStore.authEpoch,
    () => props.canManagePostingTypes,
    () => props.canManageBusinessSources,
  ],
  () => {
    if (!props.modelValue) {
      return
    }
    clearConfigurationState()
    if (!hasAnyPermission.value) {
      emit('update:modelValue', false)
      return
    }
    activeTab.value = currentTab()
    loadPermittedConfiguration()
  },
)

watch(() => props.modelValue, (visible) => {
  if (!visible) {
    clearConfigurationState()
  }
})

onBeforeUnmount(clearConfigurationState)
</script>

<template>
  <QsGenericDrawer
    :model-value="modelValue"
    title="资金业务配置"
    description="维护业务类型规则版本与可信业务来源授权；历史批次配置快照保持不变。"
    size="xl"
    :submitting="mutationSubmitting"
    @opened="handleOpened"
    @update:model-value="updateVisible"
  >
    <template #header-leading>
      <FaIcon name="i-lucide:sliders-horizontal" class="size-5" />
    </template>

    <FaAlert
      v-if="unknownResult"
      icon="i-lucide:refresh-cw"
      title="配置提交结果未知，正在重新读取"
      description="系统只核对最新服务端状态，不会自动重放 mutation。"
      class="mb-4"
      role="status"
    />

    <FaEmpty
      v-if="!hasAnyPermission"
      icon="i-lucide:shield-alert"
      title="配置权限已撤销"
      description="当前身份已不再拥有资金类型或业务来源管理权限。"
      class="py-12"
    />

    <FaTabs
      v-else
      :model-value="activeTab"
      :list="tabs"
      data-testid="fund-configuration-tabs"
      list-class="h-auto w-full gap-1 border border-border/60 bg-muted/60 p-1 sm:w-fit"
      content-class="mt-4 min-w-0"
      @update:model-value="updateActiveTab"
    >
      <template #posting-types>
        <FundPostingTypePanel
          v-if="canManagePostingTypes"
          :items="postingTypes"
          :loading="postingTypesLoading"
          :error="postingTypesErrorDisplay"
          :state-key="appAccountStore.authEpoch"
          @create="openPostingTypeCreate"
          @edit="openPostingTypeEdit"
          @edit-rule="openRuleEdit"
          @publish="target => openPostingTypeConfirm(target, 'publish')"
          @refresh="loadPostingTypes"
          @status="openPostingTypeConfirm"
        />
      </template>

      <template #business-sources>
        <FundBusinessSourcePanel
          v-if="canManageBusinessSources"
          :items="businessSources"
          :loading="businessSourcesLoading"
          :error="businessSourcesErrorDisplay"
          :state-key="appAccountStore.authEpoch"
          @create="openBusinessSourceCreate"
          @edit="openBusinessSourceEdit"
          @refresh="loadBusinessSources"
          @status="openBusinessSourceConfirm"
        />
      </template>
    </FaTabs>

    <template #footer>
      <FaButton variant="outline" class="min-h-11 w-full sm:min-h-9 sm:w-auto" :disabled="mutationSubmitting" @click="updateVisible(false)">
        关闭
      </FaButton>
    </template>

    <FundPostingTypeFormModal
      v-model="postingTypeFormVisible"
      :mode="postingTypeFormMode"
      :target="postingTypeTarget"
      :submitting="mutationSubmitting"
      :error="mutationFailure?.message"
      :request-id="mutationFailure?.requestId"
      @submit="submitPostingType"
    />
    <FundPostingRuleModal
      v-model="ruleFormVisible"
      :target="ruleTarget"
      :submitting="mutationSubmitting"
      :error="mutationFailure?.message"
      :request-id="mutationFailure?.requestId"
      @submit="submitRuleDraft"
    />
    <FundBusinessSourceFormModal
      v-model="businessSourceFormVisible"
      :mode="businessSourceFormMode"
      :target="businessSourceTarget"
      :posting-types="postingTypes"
      :submitting="mutationSubmitting"
      :error="mutationFailure?.message"
      :request-id="mutationFailure?.requestId"
      @submit="submitBusinessSource"
    />
    <FundConfigurationConfirmModal
      v-model="confirmVisible"
      :action="confirmAction"
      :target-name="confirmTargetName"
      :target-code="confirmTargetCode"
      :submitting="mutationSubmitting"
      :error="mutationFailure?.message"
      :request-id="mutationFailure?.requestId"
      @confirm="confirmMutation"
    />
  </QsGenericDrawer>
</template>
