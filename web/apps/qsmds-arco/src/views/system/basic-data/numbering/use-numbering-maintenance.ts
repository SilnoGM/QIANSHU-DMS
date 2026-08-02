import type {
  NumberingIssuanceFilterModel,
  NumberingLifecycleAction,
} from './numbering-detail.logic'
import type {
  NumberingActionPermissions,
  NumberingRuleFormModel,
} from './numbering-management.logic'
import type { NumberingEditorMode } from './numbering-page.logic'
import type {
  NumberingIssuanceDto,
  NumberingRuleDetailDto,
  NumberingRuleListItemDto,
  NumberingRuleVersionDto,
  PreviewNumberingRuleResponseDto,
} from '@/api/generated/types.gen'
import type {
  NumberingIssuanceListQuery,
  NumberingVersionListQuery,
} from '@/api/modules/numbering'

import numberingApi from '@/api/modules/numbering'
import { useQsToast } from '@/components/base/QsToast/useQsToast'

import {
  buildNumberingVersionLoadQuery,
} from './numbering-detail.logic'
import { isNumberingAbortError } from './numbering-list.logic'
import {
  buildChangeNumberingRuleStatusRequest,
  buildCloneNumberingRuleRequest,
  buildCreateNumberingRuleRequest,
  buildPreviewNumberingRuleRequest,
  buildPublishNumberingRuleRequest,
  buildUpdateNumberingRuleRequest,
  createNumberingRuleFormModel,
  getNumberingMutationFailure,
  validateNumberingRuleForm,
} from './numbering-management.logic'
import {
  canApplyNumberingContextResponse,
  canApplyNumberingMutationResult,
  shouldLoadNumberingIssuances,
} from './numbering-page.logic'

export interface NumberingMaintenanceOptions {
  reloadList: (resetPage?: boolean) => Promise<void>
}

const DEFAULT_ISSUANCE_FILTERS: NumberingIssuanceFilterModel = {
  consumerCode: '',
  generatedNumber: '',
  generatedNumberMatch: 'EXACT',
  periodKey: '',
}

function cloneIssuanceFilters(
  filters: NumberingIssuanceFilterModel,
): NumberingIssuanceFilterModel {
  return { ...filters }
}

function cloneFormModel(model: NumberingRuleFormModel): NumberingRuleFormModel {
  return {
    ...model,
    segments: model.segments.map(segment => ({ ...segment })),
  }
}

/**
 * 只编排编号页面的业务请求与上下文，不引入全局 Store 或查询库。
 * 组件仍是受控的纯展示/表单边界；所有 API 副作用、取消和身份纪元
 * 均留在正式页面层。
 */
export function useNumberingMaintenance(
  permissions: ComputedRef<NumberingActionPermissions>,
  options: NumberingMaintenanceOptions,
) {
  const appAccountStore = useAppAccountStore()
  const toast = useQsToast()

  const editorVisible = ref(false)
  const editorMode = ref<NumberingEditorMode>('create')
  const editorFormModel = ref<NumberingRuleFormModel>(
    createNumberingRuleFormModel(null),
  )
  const editorRule = ref<NumberingRuleDetailDto | null>(null)
  const editorLoading = ref(false)
  const editorSubmitting = ref(false)
  const editorError = ref<string | null>(null)
  const editorRequestId = ref<string | null>(null)
  const editorFieldErrors = ref<Readonly<Record<string, string>>>({})
  const editorPreview = ref<PreviewNumberingRuleResponseDto | null>(null)
  const editorPreviewLoading = ref(false)
  const editorPreviewError = ref<string | null>(null)
  const editorPreviewRequestId = ref<string | null>(null)
  let editorRequestVersion = 0
  let editorAbortController: AbortController | null = null
  let previewRequestVersion = 0
  let previewAbortController: AbortController | null = null
  let previewTimer: ReturnType<typeof setTimeout> | undefined
  let editorMutationGeneration = 0

  const detailVisible = ref(false)
  const detailRuleId = ref<string | null>(null)
  const detail = ref<NumberingRuleDetailDto | null>(null)
  const detailLoading = ref(false)
  const detailError = ref<string | null>(null)
  const detailRequestId = ref<string | null>(null)
  const detailActionError = ref<string | null>(null)
  const detailActionRequestId = ref<string | null>(null)
  let detailRequestVersion = 0
  let detailAbortController: AbortController | null = null

  const versions = ref<NumberingRuleVersionDto[]>([])
  const versionsPage = ref(1)
  const versionsPageSize = ref(20)
  const versionsTotal = ref(0)
  const versionsLoading = ref(false)
  const versionsError = ref<string | null>(null)
  const versionsRequestId = ref<string | null>(null)
  let versionsRequestVersion = 0
  let versionsAbortController: AbortController | null = null

  const issuances = ref<NumberingIssuanceDto[]>([])
  const issuancesPage = ref(1)
  const issuancesPageSize = ref(20)
  const issuancesTotal = ref(0)
  const issuanceFilters = ref<NumberingIssuanceFilterModel>(
    cloneIssuanceFilters(DEFAULT_ISSUANCE_FILTERS),
  )
  const issuancesLoading = ref(false)
  const issuancesError = ref<string | null>(null)
  const issuancesRequestId = ref<string | null>(null)
  let issuancesRequestVersion = 0
  let issuancesAbortController: AbortController | null = null

  const lifecycleVisible = ref(false)
  const lifecycleAction = ref<NumberingLifecycleAction>('publish')
  const lifecycleDetail = ref<NumberingRuleDetailDto | null>(null)
  const lifecycleSubmitting = ref(false)
  const lifecycleError = ref<string | null>(null)
  const lifecycleRequestId = ref<string | null>(null)
  let lifecycleRequestVersion = 0
  let lifecycleAbortController: AbortController | null = null
  let lifecycleMutationGeneration = 0

  function resetEditorFailure(): void {
    editorError.value = null
    editorRequestId.value = null
    editorFieldErrors.value = {}
  }

  function resetPreview(): void {
    if (previewTimer !== undefined) {
      clearTimeout(previewTimer)
      previewTimer = undefined
    }
    previewAbortController?.abort()
    previewRequestVersion += 1
    editorPreview.value = null
    editorPreviewLoading.value = false
    editorPreviewError.value = null
    editorPreviewRequestId.value = null
  }

  function resetLifecycleFailure(): void {
    lifecycleError.value = null
    lifecycleRequestId.value = null
  }

  function contextIsCurrent(input: {
    authorized: boolean
    authEpoch: number
    controller: AbortController
    latestRequestVersion: number
    requestVersion: number
  }): boolean {
    return canApplyNumberingContextResponse({
      aborted: input.controller.signal.aborted,
      authorized: input.authorized,
      authEpoch: input.authEpoch,
      currentAuthEpoch: appAccountStore.authEpoch,
      latestRequestVersion: input.latestRequestVersion,
      requestVersion: input.requestVersion,
    })
  }

  function editorMutationIsCurrent(input: {
    authEpoch: number
    generation: number
    mode: NumberingEditorMode
    targetId: string | null
  }): boolean {
    const authorized = permissions.value.canRead && (
      input.mode === 'edit'
        ? permissions.value.canUpdate
        : permissions.value.canCreate
    )
    const currentTargetId = editorMode.value === 'create'
      ? null
      : editorRule.value?.id ?? null
    return canApplyNumberingMutationResult({
      authorized,
      authEpoch: input.authEpoch,
      currentAuthEpoch: appAccountStore.authEpoch,
      currentGeneration: editorMutationGeneration,
      currentTargetId,
      generation: input.generation,
      targetId: input.targetId,
    })
  }

  function lifecycleMutationIsCurrent(input: {
    action: NumberingLifecycleAction
    authEpoch: number
    generation: number
    targetId: string
  }): boolean {
    const authorized = permissions.value.canRead
      && lifecycleAction.value === input.action
      && (input.action === 'publish'
        ? permissions.value.canPublish
        : input.action === 'enable'
          ? permissions.value.canEnable
          : permissions.value.canDisable)
    return canApplyNumberingMutationResult({
      authorized,
      authEpoch: input.authEpoch,
      currentAuthEpoch: appAccountStore.authEpoch,
      currentGeneration: lifecycleMutationGeneration,
      currentTargetId: lifecycleDetail.value?.id ?? null,
      generation: input.generation,
      targetId: input.targetId,
    })
  }

  async function fetchRuleForEditor(
    ruleId: string,
    mode: Extract<NumberingEditorMode, 'clone' | 'edit'>,
  ): Promise<void> {
    editorAbortController?.abort()
    const controller = new AbortController()
    editorAbortController = controller
    const requestVersion = ++editorRequestVersion
    const authEpoch = appAccountStore.authEpoch
    editorLoading.value = true

    try {
      const response = await numberingApi.rules.get(ruleId, controller.signal)
      if (!contextIsCurrent({
        authorized: permissions.value.canRead,
        authEpoch,
        controller,
        latestRequestVersion: editorRequestVersion,
        requestVersion,
      })) {
        return
      }
      editorRule.value = response.data
      const model = createNumberingRuleFormModel(response.data)
      if (mode === 'clone') {
        model.ruleCode = ''
        model.name = `${response.data.name}副本`
      }
      editorFormModel.value = cloneFormModel(model)
    }
    catch (error) {
      if (isNumberingAbortError(error) || !contextIsCurrent({
        authorized: permissions.value.canRead,
        authEpoch,
        controller,
        latestRequestVersion: editorRequestVersion,
        requestVersion,
      })) {
        return
      }
      const failure = getNumberingMutationFailure(error)
      editorError.value = failure.message
      editorRequestId.value = failure.requestId ?? null
    }
    finally {
      if (requestVersion === editorRequestVersion) {
        editorLoading.value = false
      }
    }
  }

  function openCreateEditor(): void {
    if (!permissions.value.canRead || !permissions.value.canCreate) {
      return
    }
    editorMutationGeneration += 1
    editorAbortController?.abort()
    editorRequestVersion += 1
    editorMode.value = 'create'
    editorRule.value = null
    editorFormModel.value = createNumberingRuleFormModel(null)
    editorLoading.value = false
    resetEditorFailure()
    resetPreview()
    editorVisible.value = true
  }

  function openRuleEditor(
    rule: Pick<NumberingRuleListItemDto, 'id'> | NumberingRuleDetailDto,
    mode: Extract<NumberingEditorMode, 'clone' | 'edit'>,
  ): void {
    const allowed = mode === 'edit'
      ? permissions.value.canRead && permissions.value.canUpdate
      : permissions.value.canRead && permissions.value.canCreate
    if (!allowed) {
      return
    }
    editorMutationGeneration += 1
    editorMode.value = mode
    editorRule.value = null
    editorFormModel.value = createNumberingRuleFormModel(null)
    resetEditorFailure()
    resetPreview()
    editorVisible.value = true
    void fetchRuleForEditor(rule.id, mode)
  }

  function updateEditorFormModel(model: NumberingRuleFormModel): void {
    editorFormModel.value = cloneFormModel(model)
    editorFieldErrors.value = {}
  }

  function runPreview(model: NumberingRuleFormModel): void {
    previewAbortController?.abort()
    const controller = new AbortController()
    previewAbortController = controller
    const requestVersion = ++previewRequestVersion
    const authEpoch = appAccountStore.authEpoch
    editorPreviewLoading.value = true
    editorPreviewError.value = null
    editorPreviewRequestId.value = null

    void numberingApi.rules.preview(
      buildPreviewNumberingRuleRequest(
        model,
        editorMode.value === 'edit' ? editorRule.value?.id : undefined,
      ),
      controller.signal,
    ).then((response) => {
      if (contextIsCurrent({
        authorized: permissions.value.canRead,
        authEpoch,
        controller,
        latestRequestVersion: previewRequestVersion,
        requestVersion,
      })) {
        editorPreview.value = response.data
      }
    }).catch((error: unknown) => {
      if (isNumberingAbortError(error) || !contextIsCurrent({
        authorized: permissions.value.canRead,
        authEpoch,
        controller,
        latestRequestVersion: previewRequestVersion,
        requestVersion,
      })) {
        return
      }
      const failure = getNumberingMutationFailure(error)
      editorPreviewError.value = failure.message
      editorPreviewRequestId.value = failure.requestId ?? null
      editorFieldErrors.value = failure.fieldErrors
    }).finally(() => {
      if (requestVersion === previewRequestVersion) {
        editorPreviewLoading.value = false
      }
    })
  }

  /** 组件负责本地校验和触发，页面用单一计时器合并快速输入。 */
  function requestPreview(model: NumberingRuleFormModel): void {
    if (!permissions.value.canRead || Object.keys(
      validateNumberingRuleForm(model),
    ).length > 0) {
      resetPreview()
      return
    }
    if (previewTimer !== undefined) {
      clearTimeout(previewTimer)
    }
    const snapshot = cloneFormModel(model)
    previewTimer = setTimeout(() => {
      previewTimer = undefined
      runPreview(snapshot)
    }, 250)
  }

  async function refreshEditorRuleContext(): Promise<void> {
    const current = editorRule.value
    if (current === null || editorMode.value === 'create') {
      return
    }
    // 保留用户表单模型，只刷新 expectedVersion 所需的 Server 快照。
    const preserved = cloneFormModel(editorFormModel.value)
    await fetchRuleForEditor(current.id, editorMode.value)
    editorFormModel.value = preserved
  }

  async function submitEditor(model: NumberingRuleFormModel): Promise<boolean> {
    if (editorSubmitting.value || !permissions.value.canRead) {
      return false
    }
    const localErrors = validateNumberingRuleForm(model)
    if (Object.keys(localErrors).length > 0) {
      editorFieldErrors.value = localErrors
      editorError.value = '请先修正表单中的错误'
      return false
    }
    if (
      (editorMode.value === 'create' && !permissions.value.canCreate)
      || (editorMode.value === 'clone' && !permissions.value.canCreate)
      || (editorMode.value === 'edit' && !permissions.value.canUpdate)
    ) {
      return false
    }

    const mode = editorMode.value
    const ruleSnapshot = mode === 'create' ? null : editorRule.value
    if (mode !== 'create' && ruleSnapshot === null) {
      return false
    }
    const targetId = ruleSnapshot?.id ?? null
    const authEpoch = appAccountStore.authEpoch
    const generation = ++editorMutationGeneration
    const mutationIsCurrent = () => editorMutationIsCurrent({
      authEpoch,
      generation,
      mode,
      targetId,
    })

    editorSubmitting.value = true
    resetEditorFailure()
    try {
      if (mode === 'create') {
        await numberingApi.rules.create(buildCreateNumberingRuleRequest(model))
      }
      else if (mode === 'clone' && ruleSnapshot !== null) {
        await numberingApi.rules.clone(
          ruleSnapshot.id,
          buildCloneNumberingRuleRequest(model, ruleSnapshot),
        )
      }
      else if (ruleSnapshot !== null) {
        await numberingApi.rules.update(
          ruleSnapshot.id,
          buildUpdateNumberingRuleRequest(model, ruleSnapshot),
        )
      }
      if (!mutationIsCurrent()) {
        return false
      }
      toast.success({
        create: '编号规则已创建',
        edit: '编号规则已更新',
        clone: '编号规则已克隆',
      }[mode])
      await options.reloadList(mode !== 'edit')
      if (!mutationIsCurrent()) {
        return false
      }
      if (detailVisible.value && detailRuleId.value !== null) {
        await loadDetail(detailRuleId.value)
      }
      return mutationIsCurrent()
    }
    catch (error) {
      if (!mutationIsCurrent()) {
        return false
      }
      const failure = getNumberingMutationFailure(error)
      editorError.value = failure.unknownResult
        ? '操作结果未知，已重新读取列表与详情；请核对当前规则后再继续。'
        : failure.requiresRefresh
          ? '规则已被其他操作更新，已读取最新版本并保留当前输入。'
          : failure.message
      editorRequestId.value = failure.requestId ?? null
      editorFieldErrors.value = failure.fieldErrors
      if (failure.unknownResult || failure.requiresRefresh) {
        await options.reloadList(false)
        if (!mutationIsCurrent()) {
          return false
        }
        await refreshEditorRuleContext()
      }
      return false
    }
    finally {
      if (generation === editorMutationGeneration) {
        editorSubmitting.value = false
      }
    }
  }

  async function loadDetail(ruleId = detailRuleId.value): Promise<void> {
    if (ruleId === null || !permissions.value.canRead) {
      return
    }
    detailAbortController?.abort()
    const controller = new AbortController()
    detailAbortController = controller
    const requestVersion = ++detailRequestVersion
    const authEpoch = appAccountStore.authEpoch
    detailLoading.value = true
    detailError.value = null
    detailRequestId.value = null
    try {
      const response = await numberingApi.rules.get(ruleId, controller.signal)
      if (!contextIsCurrent({
        authorized: permissions.value.canRead,
        authEpoch,
        controller,
        latestRequestVersion: detailRequestVersion,
        requestVersion,
      })) {
        return
      }
      detail.value = response.data
      detailRuleId.value = response.data.id
      if (lifecycleVisible.value && lifecycleDetail.value?.id === response.data.id) {
        lifecycleDetail.value = response.data
      }
    }
    catch (error) {
      if (isNumberingAbortError(error) || !contextIsCurrent({
        authorized: permissions.value.canRead,
        authEpoch,
        controller,
        latestRequestVersion: detailRequestVersion,
        requestVersion,
      })) {
        return
      }
      const failure = getNumberingMutationFailure(error)
      detailError.value = failure.message
      detailRequestId.value = failure.requestId ?? null
    }
    finally {
      if (requestVersion === detailRequestVersion) {
        detailLoading.value = false
      }
    }
  }

  async function loadVersions(
    input: NumberingVersionListQuery = {
      page: versionsPage.value,
      pageSize: versionsPageSize.value,
    },
  ): Promise<void> {
    const ruleId = detailRuleId.value
    if (ruleId === null || !permissions.value.canRead) {
      return
    }
    const query = buildNumberingVersionLoadQuery({
      page: input.page ?? versionsPage.value,
      pageSize: input.pageSize ?? versionsPageSize.value,
    })
    // 先记录本次尝试，失败后的重试必须复用用户刚选择的页码和 pageSize。
    versionsPage.value = query.page ?? 1
    versionsPageSize.value = query.pageSize ?? 20
    versionsAbortController?.abort()
    const controller = new AbortController()
    versionsAbortController = controller
    const requestVersion = ++versionsRequestVersion
    const authEpoch = appAccountStore.authEpoch
    versionsLoading.value = true
    versionsError.value = null
    versionsRequestId.value = null
    try {
      const response = await numberingApi.rules.versions(
        ruleId,
        query,
        controller.signal,
      )
      if (!contextIsCurrent({
        authorized: permissions.value.canRead,
        authEpoch,
        controller,
        latestRequestVersion: versionsRequestVersion,
        requestVersion,
      })) {
        return
      }
      versions.value = response.data.items
      versionsPage.value = response.data.page
      versionsPageSize.value = response.data.pageSize
      versionsTotal.value = response.data.total
    }
    catch (error) {
      if (isNumberingAbortError(error) || !contextIsCurrent({
        authorized: permissions.value.canRead,
        authEpoch,
        controller,
        latestRequestVersion: versionsRequestVersion,
        requestVersion,
      })) {
        return
      }
      const failure = getNumberingMutationFailure(error)
      versionsError.value = failure.message
      versionsRequestId.value = failure.requestId ?? null
    }
    finally {
      if (requestVersion === versionsRequestVersion) {
        versionsLoading.value = false
      }
    }
  }

  async function loadIssuances(
    query: NumberingIssuanceListQuery,
  ): Promise<void> {
    const ruleId = detailRuleId.value
    if (
      ruleId === null
      || !shouldLoadNumberingIssuances(permissions.value)
    ) {
      return
    }
    issuanceFilters.value = {
      consumerCode: query.consumerCode ?? '',
      generatedNumber: query.generatedNumber ?? '',
      generatedNumberMatch: query.generatedNumberMatch ?? 'EXACT',
      periodKey: query.periodKey ?? '',
    }
    issuancesPage.value = query.page ?? 1
    issuancesPageSize.value = query.pageSize ?? 20
    issuancesAbortController?.abort()
    const controller = new AbortController()
    issuancesAbortController = controller
    const requestVersion = ++issuancesRequestVersion
    const authEpoch = appAccountStore.authEpoch
    issuancesLoading.value = true
    issuancesError.value = null
    issuancesRequestId.value = null
    try {
      const response = await numberingApi.rules.issuances(
        ruleId,
        query,
        controller.signal,
      )
      if (!contextIsCurrent({
        authorized: shouldLoadNumberingIssuances(permissions.value),
        authEpoch,
        controller,
        latestRequestVersion: issuancesRequestVersion,
        requestVersion,
      })) {
        return
      }
      issuances.value = response.data.items
      issuancesPage.value = response.data.page
      issuancesPageSize.value = response.data.pageSize
      issuancesTotal.value = response.data.total
    }
    catch (error) {
      if (isNumberingAbortError(error) || !contextIsCurrent({
        authorized: shouldLoadNumberingIssuances(permissions.value),
        authEpoch,
        controller,
        latestRequestVersion: issuancesRequestVersion,
        requestVersion,
      })) {
        return
      }
      const failure = getNumberingMutationFailure(error)
      issuancesError.value = failure.message
      issuancesRequestId.value = failure.requestId ?? null
    }
    finally {
      if (requestVersion === issuancesRequestVersion) {
        issuancesLoading.value = false
      }
    }
  }

  function openDetail(rule: Pick<NumberingRuleListItemDto, 'id'>): void {
    if (!permissions.value.canRead) {
      return
    }
    detailRuleId.value = rule.id
    detail.value = null
    detailActionError.value = null
    detailActionRequestId.value = null
    versions.value = []
    versionsPage.value = 1
    versionsTotal.value = 0
    issuances.value = []
    issuancesPage.value = 1
    issuancesTotal.value = 0
    issuanceFilters.value = cloneIssuanceFilters(DEFAULT_ISSUANCE_FILTERS)
    detailVisible.value = true
    void loadDetail(rule.id)
  }

  async function fetchRuleForLifecycle(
    ruleId: string,
    action: NumberingLifecycleAction,
  ): Promise<void> {
    lifecycleAbortController?.abort()
    const controller = new AbortController()
    lifecycleAbortController = controller
    const requestVersion = ++lifecycleRequestVersion
    const authEpoch = appAccountStore.authEpoch
    try {
      const response = await numberingApi.rules.get(ruleId, controller.signal)
      const allowed = action === 'publish'
        ? permissions.value.canPublish
        : action === 'enable'
          ? permissions.value.canEnable
          : permissions.value.canDisable
      if (!contextIsCurrent({
        authorized: permissions.value.canRead && allowed,
        authEpoch,
        controller,
        latestRequestVersion: lifecycleRequestVersion,
        requestVersion,
      })) {
        return
      }
      lifecycleAction.value = action
      lifecycleDetail.value = response.data
      resetLifecycleFailure()
      lifecycleVisible.value = true
    }
    catch (error) {
      if (isNumberingAbortError(error) || requestVersion !== lifecycleRequestVersion) {
        return
      }
      const failure = getNumberingMutationFailure(error)
      detailActionError.value = failure.message
      detailActionRequestId.value = failure.requestId ?? null
      toast.error('无法读取最新规则详情', {
        description: failure.requestId === undefined
          ? failure.message
          : `${failure.message}（requestId: ${failure.requestId}）`,
      })
    }
  }

  function openLifecycle(
    rule: Pick<NumberingRuleListItemDto, 'id'> | NumberingRuleDetailDto,
    action: NumberingLifecycleAction,
  ): void {
    const allowed = action === 'publish'
      ? permissions.value.canPublish
      : action === 'enable'
        ? permissions.value.canEnable
        : permissions.value.canDisable
    if (!permissions.value.canRead || !allowed) {
      return
    }
    lifecycleMutationGeneration += 1
    if ('activeVersion' in rule) {
      lifecycleAction.value = action
      lifecycleDetail.value = rule
      resetLifecycleFailure()
      lifecycleVisible.value = true
      return
    }
    void fetchRuleForLifecycle(rule.id, action)
  }

  async function submitLifecycle(action: NumberingLifecycleAction): Promise<void> {
    const target = lifecycleDetail.value
    if (target === null || lifecycleSubmitting.value || !permissions.value.canRead) {
      return
    }
    const allowed = action === 'publish'
      ? permissions.value.canPublish
      : action === 'enable'
        ? permissions.value.canEnable
        : permissions.value.canDisable
    if (!allowed) {
      return
    }
    const authEpoch = appAccountStore.authEpoch
    const generation = ++lifecycleMutationGeneration
    const targetId = target.id
    const mutationIsCurrent = () => lifecycleMutationIsCurrent({
      action,
      authEpoch,
      generation,
      targetId,
    })
    lifecycleSubmitting.value = true
    resetLifecycleFailure()
    try {
      if (action === 'publish') {
        await numberingApi.rules.publish(
          target.id,
          buildPublishNumberingRuleRequest(target),
        )
      }
      else if (action === 'enable') {
        await numberingApi.rules.enable(
          target.id,
          buildChangeNumberingRuleStatusRequest(target),
        )
      }
      else {
        await numberingApi.rules.disable(
          target.id,
          buildChangeNumberingRuleStatusRequest(target),
        )
      }
      if (!mutationIsCurrent()) {
        return
      }
      await options.reloadList(false)
      if (!mutationIsCurrent()) {
        return
      }
      if (detailVisible.value && detailRuleId.value === target.id) {
        await Promise.all([loadDetail(target.id), loadVersions()])
      }
      if (!mutationIsCurrent()) {
        return
      }
      toast.success({
        publish: '编号规则版本已发布',
        enable: '编号规则已启用',
        disable: '编号规则已停用',
      }[action])
      lifecycleSubmitting.value = false
      await nextTick()
      lifecycleVisible.value = false
    }
    catch (error) {
      if (!mutationIsCurrent()) {
        return
      }
      const failure = getNumberingMutationFailure(error)
      lifecycleError.value = failure.unknownResult
        ? '操作结果未知，已重新读取列表与详情；请核查当前状态，不会自动重放。'
        : failure.requiresRefresh
          ? '规则状态已变化，已重新读取最新详情；请核对后再操作。'
          : failure.message
      lifecycleRequestId.value = failure.requestId ?? null
      if (failure.unknownResult || failure.requiresRefresh) {
        await options.reloadList(false)
        if (!mutationIsCurrent()) {
          return
        }
        if (detailVisible.value && detailRuleId.value === target.id) {
          await loadDetail(target.id)
        }
        if (!mutationIsCurrent()) {
          return
        }
        // 不保留可再次点击的高影响弹窗，防止用户把未知结果当成失败重放。
        detailActionError.value = lifecycleError.value
        detailActionRequestId.value = lifecycleRequestId.value
        toast.warning('编号规则状态需要人工核查', {
          description: lifecycleRequestId.value === null
            ? lifecycleError.value
            : `${lifecycleError.value}（requestId: ${lifecycleRequestId.value}）`,
        })
        lifecycleSubmitting.value = false
        await nextTick()
        lifecycleVisible.value = false
      }
    }
    finally {
      if (generation === lifecycleMutationGeneration) {
        lifecycleSubmitting.value = false
      }
    }
  }

  function clearIssuanceContext(): void {
    issuancesAbortController?.abort()
    issuancesRequestVersion += 1
    issuances.value = []
    issuancesPage.value = 1
    issuancesTotal.value = 0
    issuanceFilters.value = cloneIssuanceFilters(DEFAULT_ISSUANCE_FILTERS)
    issuancesLoading.value = false
    issuancesError.value = null
    issuancesRequestId.value = null
  }

  function clearEditorContext(): void {
    editorMutationGeneration += 1
    editorAbortController?.abort()
    editorRequestVersion += 1
    resetPreview()
    editorVisible.value = false
    editorRule.value = null
    editorLoading.value = false
    editorSubmitting.value = false
    resetEditorFailure()
  }

  function clearLifecycleContext(): void {
    lifecycleMutationGeneration += 1
    lifecycleAbortController?.abort()
    lifecycleRequestVersion += 1
    lifecycleVisible.value = false
    lifecycleDetail.value = null
    lifecycleSubmitting.value = false
    resetLifecycleFailure()
  }

  function clearDetailContext(): void {
    detailAbortController?.abort()
    versionsAbortController?.abort()
    detailRequestVersion += 1
    versionsRequestVersion += 1
    clearIssuanceContext()
    detailVisible.value = false
    detailRuleId.value = null
    detail.value = null
    detailLoading.value = false
    detailError.value = null
    detailRequestId.value = null
    detailActionError.value = null
    detailActionRequestId.value = null
    versions.value = []
    versionsPage.value = 1
    versionsTotal.value = 0
    versionsLoading.value = false
    versionsError.value = null
    versionsRequestId.value = null
  }

  function clearMaintenanceContexts(): void {
    clearEditorContext()
    clearDetailContext()
    clearLifecycleContext()
  }

  return {
    clearIssuanceContext,
    clearEditorContext,
    clearDetailContext,
    clearLifecycleContext,
    clearMaintenanceContexts,
    detail,
    detailActionError,
    detailActionRequestId,
    detailError,
    detailLoading,
    detailRequestId,
    detailVisible,
    editorError,
    editorFieldErrors,
    editorFormModel,
    editorLoading,
    editorMode,
    editorPreview,
    editorPreviewError,
    editorPreviewLoading,
    editorPreviewRequestId,
    editorRequestId,
    editorRule,
    editorSubmitting,
    editorVisible,
    issuanceFilters,
    issuances,
    issuancesError,
    issuancesLoading,
    issuancesPage,
    issuancesPageSize,
    issuancesRequestId,
    issuancesTotal,
    lifecycleAction,
    lifecycleDetail,
    lifecycleError,
    lifecycleRequestId,
    lifecycleSubmitting,
    lifecycleVisible,
    loadDetail,
    loadIssuances,
    loadVersions,
    openCreateEditor,
    openDetail,
    openLifecycle,
    openRuleEditor,
    requestPreview,
    submitEditor,
    submitLifecycle,
    updateEditorFormModel,
    versions,
    versionsError,
    versionsLoading,
    versionsPage,
    versionsPageSize,
    versionsRequestId,
    versionsTotal,
  }
}
