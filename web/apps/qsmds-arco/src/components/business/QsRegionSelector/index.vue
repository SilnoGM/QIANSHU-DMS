<script setup lang="ts">
import type {
  RegionLevel,
  RegionSelectorChange,
  RegionSelectorNode,
  RegionSelectorProvider,
  RegionSelectorSelectedPath,
  RegionSelectorValue,
} from './types'
import {
  computed,
  inject,
  nextTick,
  onBeforeUnmount,
  onMounted,
  onUpdated,
  ref,
  useAttrs,
  useId,
  watch,
  watchPostEffect,
} from 'vue'
import {
  createRegionSelectorControlBridge,
  splitRegionSelectorAttrs,
} from './control-attrs'
import {
  createEmptyRegionSelectorValue,
  createRegionRequestVersion,
  createRegionSelectOptions,
  createRegionSelectorChange,
  formatRegionPathLabel,
  isCompleteRegionSelectorValue,
  mergeSelectedRegionNode,
  normalizeRegionSelectorValue,
  validateRegionChildren,
  validateRegionSelectorPath,
} from './logic'
import { regionSelectorProviderKey } from './provider'

interface QsRegionSelectorProps {
  modelValue?: RegionSelectorValue
  provider?: RegionSelectorProvider
  clearable?: boolean
  disabled?: boolean
  readonly?: boolean
  error?: boolean
}

interface VisibleRequestError {
  readonly message: string
  readonly requestId: string | null
  readonly scope: 'path' | 'countries' | 'provinces' | 'cities'
}

interface QsRegionSelectorEvents {
  change: [detail: RegionSelectorChange]
  focus: [event: FocusEvent]
  blur: [event: FocusEvent]
}

interface QsRegionSelectorModelEvent {
  'update:modelValue': [value: RegionSelectorValue]
}

defineOptions({
  name: 'QsRegionSelector',
  inheritAttrs: false,
})

const props = withDefaults(defineProps<QsRegionSelectorProps>(), {
  clearable: true,
  disabled: false,
  error: false,
  modelValue: () => createEmptyRegionSelectorValue(),
  provider: undefined,
  readonly: false,
})

const emit = defineEmits<
  QsRegionSelectorEvents & QsRegionSelectorModelEvent
>()

const attrs = useAttrs()
// prop provider 优先于应用注入，确保 Showcase 的故障 fixture 不接触正式 API。
const provider = props.provider ?? inject(regionSelectorProviderKey)
const selectorRoot = ref<HTMLElement | null>(null)
const formControl = ref<HTMLInputElement | null>(null)
const errorStatus = ref<HTMLElement | null>(null)

const countries = ref<RegionSelectorNode<'COUNTRY_REGION'>[]>([])
const provinceStates = ref<RegionSelectorNode<'PROVINCE_STATE'>[]>([])
const cities = ref<RegionSelectorNode<'CITY'>[]>([])
const selectedPath = ref<RegionSelectorSelectedPath>([])
const currentValue = ref<RegionSelectorValue>(
  normalizeRegionSelectorValue(props.modelValue),
)
const completePathVerified = ref(false)
const nativeInvalid = ref(false)

const countryLoaded = ref(false)
const provinceParentId = ref<string | null>(null)
const cityParentId = ref<string | null>(null)

const countryLoading = ref(false)
const provinceLoading = ref(false)
const cityLoading = ref(false)
const pathLoading = ref(false)

const countryError = ref<VisibleRequestError | null>(null)
const provinceError = ref<VisibleRequestError | null>(null)
const cityError = ref<VisibleRequestError | null>(null)
const pathError = ref<VisibleRequestError | null>(null)

const countryController = ref<AbortController | null>(null)
const provinceController = ref<AbortController | null>(null)
const cityController = ref<AbortController | null>(null)
const pathController = ref<AbortController | null>(null)
const countryRequestVersion = createRegionRequestVersion()
const provinceRequestVersion = createRegionRequestVersion()
const cityRequestVersion = createRegionRequestVersion()
const pathRequestVersion = createRegionRequestVersion()

let unsubscribeInvalidation: (() => void) | undefined
let bridgeMounted = false
let compositeFocused = false
let hydrationStarted = false

const idPrefix = `qs-region-selector-${useId().replaceAll(':', '')}`
const loadingStatusId = `${idPrefix}-loading`
const errorStatusId = `${idPrefix}-error`
const stateStatusId = `${idPrefix}-state`
const labelIds = Object.freeze({
  CITY: `${idPrefix}-city-label`,
  COUNTRY_REGION: `${idPrefix}-country-region-label`,
  PROVINCE_STATE: `${idPrefix}-province-state-label`,
})

const countryOptions = computed(() => createRegionSelectOptions(countries.value))
const provinceStateOptions = computed(() =>
  createRegionSelectOptions(provinceStates.value),
)
const cityOptions = computed(() => createRegionSelectOptions(cities.value))
// FaSelect 在 modelValue 不存在于 options 时会回退展示第一项。可见选择必须只来自
// Provider 已验证的 path，不能把外部畸形 UUID 伪装成某个真实地区。
const selectedCountryRegionId = computed(
  () => selectedPath.value[0]?.id ?? null,
)
const selectedProvinceStateId = computed(
  () => selectedPath.value[1]?.id ?? null,
)
const selectedCityId = computed(
  () => selectedPath.value[2]?.id ?? null,
)
const countryEmpty = computed(() =>
  countryLoaded.value
  && !countryLoading.value
  && countryError.value === null
  && countries.value.length === 0,
)
const provinceStateEmpty = computed(() =>
  provinceParentId.value !== null
  && !provinceLoading.value
  && provinceError.value === null
  && provinceStates.value.length === 0,
)
const cityEmpty = computed(() =>
  cityParentId.value !== null
  && !cityLoading.value
  && cityError.value === null
  && cities.value.length === 0,
)
const busy = computed(() =>
  countryLoading.value
  || provinceLoading.value
  || cityLoading.value
  || pathLoading.value,
)
const visibleError = computed(() =>
  pathError.value
  ?? countryError.value
  ?? provinceError.value
  ?? cityError.value,
)
const requiredFeedbackVisible = computed(() =>
  nativeInvalid.value
  && hasRequiredAttr()
  && !props.readonly
  && !props.disabled
  && !completePathVerified.value,
)
const stoppedPath = computed(() =>
  selectedPath.value.some(node =>
    !node.enabled || !node.effectiveEnabled,
  ),
)
const hasAnyValue = computed(() =>
  currentValue.value.countryRegionId !== null
  || currentValue.value.provinceStateId !== null
  || currentValue.value.cityId !== null,
)
const provinceStateDisabled = computed(() =>
  props.disabled
  || countryLoading.value
  || provinceLoading.value
  || provinceStateEmpty.value
  || selectedPath.value.length < 1,
)
const cityDisabled = computed(() =>
  props.disabled
  || provinceLoading.value
  || cityLoading.value
  || cityEmpty.value
  || selectedPath.value.length < 2,
)
const readonlyPathLabel = computed(() => {
  if (selectedPath.value.length > 0) {
    return formatRegionPathLabel(selectedPath.value)
  }
  if (pathError.value) {
    return '已选地区无法回显'
  }
  if (pathLoading.value) {
    return '正在回显已选地区…'
  }
  return '未选择地区'
})
const describedBy = computed(() => [
  busy.value ? loadingStatusId : null,
  visibleError.value || requiredFeedbackVisible.value
    ? errorStatusId
    : null,
  stoppedPath.value || props.readonly || props.disabled
    ? stateStatusId
    : null,
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readRequestId(error: unknown): string | null {
  try {
    if (!isRecord(error)) {
      return null
    }
    if (typeof error.requestId === 'string') {
      return error.requestId
    }
    if (isRecord(error.body) && typeof error.body.requestId === 'string') {
      return error.body.requestId
    }
  }
  catch {
    // 不可信错误 getter 不能破坏安全错误呈现。
  }
  return null
}

function createVisibleError(
  scope: VisibleRequestError['scope'],
  message: string,
  error: unknown,
): VisibleRequestError {
  return {
    message,
    requestId: readRequestId(error),
    scope,
  }
}

function isAbortError(error: unknown): boolean {
  try {
    return (
      error instanceof DOMException && error.name === 'AbortError'
    ) || (
      isRecord(error)
      && (error.name === 'AbortError' || error.code === 'ERR_CANCELED')
    )
  }
  catch {
    return false
  }
}

function cancelCountryRequest(): void {
  countryController.value?.abort()
  countryController.value = null
  countryRequestVersion.invalidate()
  countryLoading.value = false
}

function cancelProvinceRequest(): void {
  provinceController.value?.abort()
  provinceController.value = null
  provinceRequestVersion.invalidate()
  provinceLoading.value = false
}

function cancelCityRequest(): void {
  cityController.value?.abort()
  cityController.value = null
  cityRequestVersion.invalidate()
  cityLoading.value = false
}

function cancelPathRequest(): void {
  pathController.value?.abort()
  pathController.value = null
  pathRequestVersion.invalidate()
  pathLoading.value = false
}

function cancelAllRequests(): void {
  cancelCountryRequest()
  cancelProvinceRequest()
  cancelCityRequest()
  cancelPathRequest()
}

function validateCountries(
  nodes: readonly RegionSelectorNode[],
): readonly RegionSelectorNode<'COUNTRY_REGION'>[] {
  if (nodes.some(node =>
    node.level !== 'COUNTRY_REGION' || node.parentId !== null,
  )) {
    throw new Error('Invalid region root hierarchy')
  }
  return nodes as readonly RegionSelectorNode<'COUNTRY_REGION'>[]
}

async function loadCountries(
  force = false,
  selected: RegionSelectorNode<'COUNTRY_REGION'> | null = null,
): Promise<readonly RegionSelectorNode<'COUNTRY_REGION'>[] | null> {
  if (!force && countryLoaded.value) {
    countries.value = mergeSelectedRegionNode(countries.value, selected)
    return countries.value
  }

  cancelCountryRequest()
  countryError.value = null
  const controller = new AbortController()
  const version = countryRequestVersion.next()
  countryController.value = controller
  countryLoading.value = true

  try {
    if (!provider) {
      throw new Error('Region selector provider is unavailable')
    }
    const response = await provider.listChildren({
      parentId: null,
      signal: controller.signal,
    })
    if (
      controller.signal.aborted
      || !countryRequestVersion.isCurrent(version)
    ) {
      return null
    }
    const valid = validateCountries(response)
    countries.value = mergeSelectedRegionNode(valid, selected)
    countryLoaded.value = true
    return countries.value
  }
  catch (error) {
    if (
      controller.signal.aborted
      || !countryRequestVersion.isCurrent(version)
      || isAbortError(error)
    ) {
      return null
    }
    countryError.value = createVisibleError(
      'countries',
      '国家/地区列表加载失败。',
      error,
    )
    return null
  }
  finally {
    if (countryRequestVersion.isCurrent(version)) {
      countryLoading.value = false
      countryController.value = null
    }
  }
}

async function loadProvinceStates(
  country: RegionSelectorNode<'COUNTRY_REGION'>,
  force = false,
  selected: RegionSelectorNode<'PROVINCE_STATE'> | null = null,
): Promise<readonly RegionSelectorNode<'PROVINCE_STATE'>[] | null> {
  if (
    !force
    && provinceParentId.value === country.id
  ) {
    provinceStates.value = mergeSelectedRegionNode(
      provinceStates.value,
      selected,
    )
    return provinceStates.value
  }

  cancelProvinceRequest()
  provinceError.value = null
  provinceStates.value = []
  provinceParentId.value = null
  const controller = new AbortController()
  const version = provinceRequestVersion.next()
  provinceController.value = controller
  provinceLoading.value = true

  try {
    if (!provider) {
      throw new Error('Region selector provider is unavailable')
    }
    const response = await provider.listChildren({
      parentId: country.id,
      signal: controller.signal,
    })
    if (
      controller.signal.aborted
      || !provinceRequestVersion.isCurrent(version)
      || currentValue.value.countryRegionId !== country.id
    ) {
      return null
    }
    const valid = validateRegionChildren(
      country,
      response,
    ) as readonly RegionSelectorNode<'PROVINCE_STATE'>[]
    provinceStates.value = mergeSelectedRegionNode(valid, selected)
    provinceParentId.value = country.id
    return provinceStates.value
  }
  catch (error) {
    if (
      controller.signal.aborted
      || !provinceRequestVersion.isCurrent(version)
      || isAbortError(error)
    ) {
      return null
    }
    provinceError.value = createVisibleError(
      'provinces',
      `${country.name}的省/州加载失败。`,
      error,
    )
    return null
  }
  finally {
    if (provinceRequestVersion.isCurrent(version)) {
      provinceLoading.value = false
      provinceController.value = null
    }
  }
}

async function loadCities(
  province: RegionSelectorNode<'PROVINCE_STATE'>,
  force = false,
  selected: RegionSelectorNode<'CITY'> | null = null,
): Promise<readonly RegionSelectorNode<'CITY'>[] | null> {
  if (!force && cityParentId.value === province.id) {
    cities.value = mergeSelectedRegionNode(cities.value, selected)
    return cities.value
  }

  cancelCityRequest()
  cityError.value = null
  cities.value = []
  cityParentId.value = null
  const controller = new AbortController()
  const version = cityRequestVersion.next()
  cityController.value = controller
  cityLoading.value = true

  try {
    if (!provider) {
      throw new Error('Region selector provider is unavailable')
    }
    const response = await provider.listChildren({
      parentId: province.id,
      signal: controller.signal,
    })
    if (
      controller.signal.aborted
      || !cityRequestVersion.isCurrent(version)
      || currentValue.value.provinceStateId !== province.id
    ) {
      return null
    }
    const valid = validateRegionChildren(
      province,
      response,
    ) as readonly RegionSelectorNode<'CITY'>[]
    cities.value = mergeSelectedRegionNode(valid, selected)
    cityParentId.value = province.id
    return cities.value
  }
  catch (error) {
    if (
      controller.signal.aborted
      || !cityRequestVersion.isCurrent(version)
      || isAbortError(error)
    ) {
      return null
    }
    cityError.value = createVisibleError(
      'cities',
      `${province.name}的城市加载失败。`,
      error,
    )
    return null
  }
  finally {
    if (cityRequestVersion.isCurrent(version)) {
      cityLoading.value = false
      cityController.value = null
    }
  }
}

function sameValue(
  left: RegionSelectorValue,
  right: RegionSelectorValue,
): boolean {
  return left.countryRegionId === right.countryRegionId
    && left.provinceStateId === right.provinceStateId
    && left.cityId === right.cityId
}

function hasValidValueShape(value: RegionSelectorValue): boolean {
  if (value.countryRegionId === null) {
    return value.provinceStateId === null && value.cityId === null
  }
  if (value.provinceStateId === null) {
    return value.cityId === null
  }
  return true
}

function setResolvedPath(path: RegionSelectorSelectedPath): void {
  selectedPath.value = Object.freeze([...path]) as RegionSelectorSelectedPath
  completePathVerified.value = path.length === 3
  if (completePathVerified.value) {
    nativeInvalid.value = false
  }
}

async function hydrateCompleteValue(
  value: RegionSelectorValue,
  countriesPromise: Promise<
    readonly RegionSelectorNode<'COUNTRY_REGION'>[] | null
  >,
): Promise<void> {
  cancelPathRequest()
  const controller = new AbortController()
  const version = pathRequestVersion.next()
  pathController.value = controller
  pathLoading.value = true

  try {
    if (!provider || value.cityId === null) {
      throw new Error('Region selector provider is unavailable')
    }
    const path = await provider.resolvePath({
      cityId: value.cityId,
      signal: controller.signal,
    })
    if (
      controller.signal.aborted
      || !pathRequestVersion.isCurrent(version)
      || !sameValue(currentValue.value, value)
    ) {
      return
    }
    if (!validateRegionSelectorPath(path, value)) {
      throw new Error('Invalid resolved region path')
    }

    setResolvedPath(path)
    const [country, province, city] = path
    countries.value = mergeSelectedRegionNode(countries.value, country)
    provinceStates.value = mergeSelectedRegionNode(
      provinceStates.value,
      province,
    )
    cities.value = mergeSelectedRegionNode(cities.value, city)
    /*
     * root 与 path 独立并发：path 失败也不能阻断国家列表；root 较晚返回时
     * 重新合并历史国家，避免正常 options 覆盖停用回显节点。
     */
    void countriesPromise.then((loadedCountries) => {
      if (
        loadedCountries
        && sameValue(currentValue.value, value)
      ) {
        countries.value = mergeSelectedRegionNode(
          loadedCountries,
          country,
        )
      }
    })
    void loadProvinceStates(country, false, province)
    void loadCities(province, false, city)
  }
  catch (error) {
    if (
      controller.signal.aborted
      || !pathRequestVersion.isCurrent(version)
      || isAbortError(error)
    ) {
      return
    }
    pathError.value = createVisibleError(
      'path',
      '已选地区回显失败，原值已保留。',
      error,
    )
  }
  finally {
    if (pathRequestVersion.isCurrent(version)) {
      pathLoading.value = false
      pathController.value = null
    }
  }
}

async function hydratePartialValue(
  value: RegionSelectorValue,
  countriesPromise: Promise<
    readonly RegionSelectorNode<'COUNTRY_REGION'>[] | null
  >,
): Promise<void> {
  const loadedCountries = await countriesPromise
  if (
    !loadedCountries
    || !sameValue(currentValue.value, value)
    || value.countryRegionId === null
  ) {
    return
  }
  const country = loadedCountries.find(
    node => node.id === value.countryRegionId,
  )
  if (!country) {
    pathError.value = createVisibleError(
      'path',
      '已选国家/地区无法回显，原值已保留。',
      null,
    )
    return
  }
  setResolvedPath([country])

  const loadedProvinces = await loadProvinceStates(country)
  if (
    value.provinceStateId === null
    || !loadedProvinces
    || !sameValue(currentValue.value, value)
  ) {
    return
  }
  const province = loadedProvinces.find(
    node => node.id === value.provinceStateId,
  )
  if (!province) {
    pathError.value = createVisibleError(
      'path',
      '已选省/州无法回显，原值已保留。',
      null,
    )
    return
  }
  setResolvedPath([country, province])
  await loadCities(province)
}

async function hydrateCurrentValue(force = false): Promise<void> {
  const value = normalizeRegionSelectorValue(props.modelValue)
  currentValue.value = value
  setResolvedPath([])
  pathError.value = null
  provinceError.value = null
  cityError.value = null

  if (force) {
    countryLoaded.value = false
    provinceParentId.value = null
    cityParentId.value = null
  }

  // 根列表对空值、部分值和完整值始终独立启动，不能被 path 成败门控。
  const countriesPromise = loadCountries(force)

  if (!hasValidValueShape(value)) {
    pathError.value = createVisibleError(
      'path',
      '地区值层级不完整，原值已保留。',
      null,
    )
    return
  }

  if (isCompleteRegionSelectorValue(value)) {
    await hydrateCompleteValue(value, countriesPromise)
    return
  }

  if (value.countryRegionId !== null) {
    await hydratePartialValue(value, countriesPromise)
    return
  }

  await countriesPromise
}

function findActiveNode<L extends RegionLevel>(
  nodes: readonly RegionSelectorNode<L>[],
  value: unknown,
): RegionSelectorNode<L> | null {
  if (typeof value !== 'string') {
    return null
  }
  const node = nodes.find(candidate => candidate.id === value)
  return node?.enabled && node.effectiveEnabled ? node : null
}

function emitUserChange(change: RegionSelectorChange): void {
  currentValue.value = change.value
  setResolvedPath(change.path)
  emit('update:modelValue', change.value)
  emit('change', change)
}

function handleCountryRegionChange(value: unknown): void {
  const country = findActiveNode(countries.value, value)
  if (!country || country.id === selectedCountryRegionId.value) {
    return
  }

  cancelPathRequest()
  cancelProvinceRequest()
  cancelCityRequest()
  provinceStates.value = []
  cities.value = []
  provinceParentId.value = null
  cityParentId.value = null
  provinceError.value = null
  cityError.value = null
  pathError.value = null
  emitUserChange(createRegionSelectorChange('countryRegion', [country]))
  void loadProvinceStates(country)
}

function handleProvinceStateChange(value: unknown): void {
  const country = selectedPath.value[0]
  const province = findActiveNode(provinceStates.value, value)
  if (
    !country
    || !province
    || province.parentId !== country.id
    || province.id === selectedProvinceStateId.value
  ) {
    return
  }

  cancelPathRequest()
  cancelCityRequest()
  cities.value = []
  cityParentId.value = null
  cityError.value = null
  pathError.value = null
  emitUserChange(
    createRegionSelectorChange('provinceState', [country, province]),
  )
  void loadCities(province)
}

function handleCityChange(value: unknown): void {
  const [country, province] = selectedPath.value
  const city = findActiveNode(cities.value, value)
  if (
    !country
    || !province
    || !city
    || city.parentId !== province.id
    || city.id === selectedCityId.value
  ) {
    return
  }

  cancelPathRequest()
  pathError.value = null
  emitUserChange(
    createRegionSelectorChange('city', [country, province, city]),
  )
}

function handleClear(): void {
  if (
    props.readonly
    || props.disabled
    || !hasAnyValue.value
  ) {
    return
  }

  cancelPathRequest()
  cancelProvinceRequest()
  cancelCityRequest()
  provinceStates.value = []
  cities.value = []
  provinceParentId.value = null
  cityParentId.value = null
  provinceError.value = null
  cityError.value = null
  pathError.value = null
  emitUserChange(createRegionSelectorChange('clear', []))
}

function retryVisibleError(): void {
  const error = visibleError.value
  if (!error) {
    return
  }
  /*
   * 重试必须从调用方仍持有的三级 UUID 重新进入 hydration，不能只补 options。
   * 否则合法部分 value 在瞬时失败后会留下“原值存在、可见路径为空”的静默分叉。
   * 只有根列表失败需要强制跳过 root 缓存；其余层级仍复用已验证的上级数据。
   */
  void hydrateCurrentValue(error.scope === 'countries')
}

function handleInvalidation(): void {
  cancelAllRequests()
  countries.value = []
  provinceStates.value = []
  cities.value = []
  countryLoaded.value = false
  provinceParentId.value = null
  cityParentId.value = null
  countryError.value = null
  provinceError.value = null
  cityError.value = null
  pathError.value = null
  setResolvedPath([])
  void hydrateCurrentValue(true)
}

// 先订阅失效，再启动 immediate hydration，避免 setup 到 mounted 的通知窗口。
unsubscribeInvalidation = provider?.subscribeInvalidation?.(
  handleInvalidation,
)

const controlBridge = createRegionSelectorControlBridge()

function controlIds() {
  const callerId = splitRegionSelectorAttrs(attrs).controlAttrs.id
  const base = (
    typeof callerId === 'string' || typeof callerId === 'number'
  )
    ? String(callerId)
    : idPrefix
  return {
    CITY: `${base}-city`,
    COUNTRY_REGION: base,
    PROVINCE_STATE: `${base}-province-state`,
  } as const
}

function getWrapperAttrs(): Readonly<Record<string, unknown>> {
  return splitRegionSelectorAttrs(attrs).wrapperAttrs
}

function getFormAttrs(): Readonly<Record<string, unknown>> {
  return splitRegionSelectorAttrs(attrs).formAttrs
}

function hasRequiredAttr(): boolean {
  const required = getFormAttrs().required
  return required !== false && required !== null && required !== undefined
}

function updateControlBridge(): void {
  if (!bridgeMounted) {
    return
  }
  controlBridge.update({
    attrs,
    busy: {
      CITY: cityLoading.value || pathLoading.value,
      COUNTRY_REGION: countryLoading.value || pathLoading.value,
      PROVINCE_STATE: provinceLoading.value || pathLoading.value,
    },
    controlIds: controlIds(),
    describedBy: describedBy.value,
    invalid: props.error
      || pathError.value !== null
      || requiredFeedbackVisible.value,
    readonly: props.readonly,
    root: selectorRoot.value,
  })

  const proxy = formControl.value
  if (proxy) {
    const required = hasRequiredAttr()
    proxy.setCustomValidity(
      required
      && !props.readonly
      && !props.disabled
      && !completePathVerified.value
        ? '请选择完整地区'
        : '',
    )
  }
}

function firstIncompleteLevel(): RegionLevel {
  if (selectedPath.value.length === 0) {
    return 'COUNTRY_REGION'
  }
  if (selectedPath.value.length === 1) {
    return 'PROVINCE_STATE'
  }
  if (selectedPath.value.length === 2) {
    return 'CITY'
  }
  return 'COUNTRY_REGION'
}

function focus(): void {
  if (!props.disabled) {
    controlBridge.focus(firstIncompleteLevel())
  }
}

function blur(): void {
  controlBridge.blur()
}

function focusInvalidTarget(): void {
  const level = firstIncompleteLevel()
  const unavailable = level === 'COUNTRY_REGION'
    ? countryLoading.value || countryEmpty.value
    : level === 'PROVINCE_STATE'
      ? provinceStateDisabled.value
      : cityDisabled.value

  if (unavailable) {
    errorStatus.value?.focus()
    return
  }
  controlBridge.focus(level)
}

function handleInvalid(event: Event): void {
  event.preventDefault()
  nativeInvalid.value = true
  /*
   * validation alert 由本次状态变化渲染；nextTick 后才能在加载导致目标 Select
   * 禁用时把焦点落到可见错误，否则浏览器只会静默阻止提交。
   */
  void nextTick(() => focusInvalidTarget())
}

function isOwnedPopupTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false
  }
  const content = target.closest('[data-slot="select-content"]')
  if (!content?.id) {
    return false
  }
  return Object.values(controlIds()).some((id) => {
    const trigger = selectorRoot.value?.querySelector(`#${CSS.escape(id)}`)
    return trigger?.getAttribute('aria-controls') === content.id
  })
}

function handleFocusIn(event: FocusEvent): void {
  if (compositeFocused) {
    return
  }
  compositeFocused = true
  emit('focus', event)
}

function handleFocusOut(event: FocusEvent): void {
  const next = event.relatedTarget
  if (
    selectorRoot.value?.contains(next as Node)
    || isOwnedPopupTarget(next)
  ) {
    return
  }
  compositeFocused = false
  emit('blur', event)
}

defineExpose({
  focus,
  blur,
})

watch(
  () => [
    props.modelValue?.countryRegionId,
    props.modelValue?.provinceStateId,
    props.modelValue?.cityId,
  ] as const,
  () => {
    const next = normalizeRegionSelectorValue(props.modelValue)
    if (hydrationStarted && sameValue(next, currentValue.value)) {
      return
    }
    hydrationStarted = true
    cancelProvinceRequest()
    cancelCityRequest()
    cancelPathRequest()
    provinceStates.value = []
    cities.value = []
    provinceParentId.value = null
    cityParentId.value = null
    void hydrateCurrentValue()
  },
  { immediate: true },
)

watch(
  [() => props.readonly, () => props.disabled],
  () => {
    compositeFocused = false
    if (props.readonly || props.disabled) {
      nativeInvalid.value = false
    }
  },
)

watchPostEffect(updateControlBridge)
onUpdated(updateControlBridge)

onMounted(() => {
  bridgeMounted = true
  updateControlBridge()
})

onBeforeUnmount(() => {
  bridgeMounted = false
  unsubscribeInvalidation?.()
  unsubscribeInvalidation = undefined
  cancelAllRequests()
  controlBridge.dispose()
})
</script>

<template>
  <div
    v-bind="getWrapperAttrs()"
    ref="selectorRoot"
    data-slot="qs-region-selector"
    class="qs-region-selector min-w-0 w-full"
    role="group"
    @focusin="handleFocusIn"
    @focusout="handleFocusOut"
  >
    <input
      v-if="readonly"
      data-slot="qs-region-selector-readonly"
      class="qs-region-selector__readonly text-sm px-3 py-2 border border-input rounded-md bg-muted/30 min-h-9 w-full"
      type="text"
      :value="readonlyPathLabel"
      readonly
      :disabled="disabled"
      aria-readonly="true"
    >

    <div
      v-else
      class="gap-3 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.15fr)]"
    >
      <div
        data-region-level="COUNTRY_REGION"
        class="min-w-0"
      >
        <label
          :id="labelIds.COUNTRY_REGION"
          :for="controlIds().COUNTRY_REGION"
          class="qs-type-compact-label mb-1.5 block"
        >
          国家/地区
        </label>
        <FaSelect
          class="w-full"
          :model-value="selectedCountryRegionId ?? undefined"
          :options="countryOptions"
          :placeholder="
            countryLoading
              ? '正在加载国家/地区…'
              : countryError
                ? '加载失败，请重试'
                : countryEmpty
                  ? '暂无可选国家/地区'
                  : '请选择国家/地区'
          "
          :disabled="disabled || countryLoading || countryEmpty"
          @update:model-value="handleCountryRegionChange"
        />
      </div>

      <div
        data-region-level="PROVINCE_STATE"
        class="min-w-0"
      >
        <label
          :id="labelIds.PROVINCE_STATE"
          :for="controlIds().PROVINCE_STATE"
          class="qs-type-compact-label mb-1.5 block"
        >
          省/州
        </label>
        <FaSelect
          class="w-full"
          :model-value="selectedProvinceStateId ?? undefined"
          :options="provinceStateOptions"
          :placeholder="
            selectedPath.length < 1
              ? '请先选择国家/地区'
              : provinceLoading
                ? '正在加载省/州…'
                : provinceError
                  ? '加载失败，请重试'
                  : provinceStateEmpty
                    ? '暂无可选省/州'
                    : '请选择省/州'
          "
          :disabled="provinceStateDisabled"
          @update:model-value="handleProvinceStateChange"
        />
      </div>

      <div
        data-region-level="CITY"
        class="min-w-0"
      >
        <label
          :id="labelIds.CITY"
          :for="controlIds().CITY"
          class="qs-type-compact-label mb-1.5 block"
        >
          城市
        </label>
        <FaSelect
          class="w-full"
          :model-value="selectedCityId ?? undefined"
          :options="cityOptions"
          :placeholder="
            selectedPath.length < 2
              ? '请先选择省/州'
              : cityLoading
                ? '正在加载城市…'
                : cityError
                  ? '加载失败，请重试'
                  : cityEmpty
                    ? '暂无可选城市'
                    : '请选择城市'
          "
          :disabled="cityDisabled"
          @update:model-value="handleCityChange"
        />
      </div>
    </div>

    <input
      v-bind="getFormAttrs()"
      ref="formControl"
      data-slot="qs-region-selector-form-control"
      class="qs-region-selector__form-control"
      type="text"
      :value="currentValue.cityId ?? ''"
      :readonly="readonly"
      :disabled="disabled"
      tabindex="-1"
      aria-hidden="true"
      @invalid="handleInvalid"
    >

    <p
      v-if="selectedPath.length > 0 && !readonly"
      data-slot="qs-region-selector-path"
      class="text-xs text-muted-foreground m-0 mt-2 break-words"
    >
      {{ formatRegionPathLabel(selectedPath) }}
    </p>

    <div
      v-if="clearable && !readonly && !disabled && hasAnyValue"
      class="mt-2 flex justify-end"
    >
      <button
        type="button"
        data-slot="qs-region-selector-clear"
        class="qs-region-selector__clear"
        aria-label="清空地区选择"
        @click="handleClear"
      >
        清空地区
      </button>
    </div>

    <p
      v-if="busy"
      :id="loadingStatusId"
      data-slot="qs-region-selector-loading"
      class="text-xs text-muted-foreground m-0 mt-1.5"
      role="status"
      aria-live="polite"
    >
      {{
        pathLoading
          ? '正在回显已选地区…'
          : countryLoading
            ? '正在加载国家/地区…'
            : provinceLoading
              ? '正在加载省/州…'
              : '正在加载城市…'
      }}
    </p>

    <div
      v-if="visibleError || requiredFeedbackVisible"
      :id="errorStatusId"
      ref="errorStatus"
      data-slot="qs-region-selector-error"
      class="text-xs text-destructive mt-1.5 flex flex-wrap gap-x-2 gap-y-1 items-center"
      role="alert"
      tabindex="-1"
    >
      <span v-if="requiredFeedbackVisible">请选择完整地区。</span>
      <span v-if="visibleError">{{ visibleError.message }}</span>
      <code
        v-if="visibleError?.requestId"
        class="qs-type-data-mono break-all"
      >
        requestId: {{ visibleError.requestId }}
      </code>
      <button
        v-if="visibleError"
        type="button"
        class="qs-region-selector__retry"
        @click="retryVisibleError"
      >
        重试加载
      </button>
    </div>

    <div
      v-if="stoppedPath || readonly || disabled"
      :id="stateStatusId"
      data-slot="qs-region-selector-state"
      class="text-xs text-muted-foreground mt-1.5 flex flex-wrap gap-x-2 gap-y-1"
      role="status"
      aria-live="polite"
    >
      <span v-if="stoppedPath">当前历史地区已停用，仅供回显。</span>
      <span v-if="readonly">只读</span>
      <span v-if="disabled">已禁用</span>
    </div>
  </div>
</template>

<style scoped>
.qs-region-selector :deep([data-slot="select-trigger"]) {
  width: 100%;
  min-width: 0;
}

.qs-region-selector__form-control {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  white-space: nowrap;
  border: 0;
  clip-path: inset(50%);
}

.qs-region-selector__readonly {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qs-region-selector__clear,
.qs-region-selector__retry {
  min-height: 28px;
  padding: 0 0.625rem;
  color: oklch(var(--foreground));
  cursor: pointer;
  background: transparent;
  border: 1px solid oklch(var(--border));
  border-radius: var(--radius);
}

.qs-region-selector__clear:hover,
.qs-region-selector__retry:hover {
  background: oklch(var(--muted));
}

.qs-region-selector__clear:focus-visible,
.qs-region-selector__retry:focus-visible,
.qs-region-selector__readonly:focus-visible {
  outline: 2px solid oklch(var(--ring));
  outline-offset: 2px;
}

@media (width <= 640px) {
  .qs-region-selector :deep([data-slot="select-trigger"]),
  .qs-region-selector__clear,
  .qs-region-selector__retry,
  .qs-region-selector__readonly {
    min-height: 44px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .qs-region-selector :deep(*),
  .qs-region-selector__clear,
  .qs-region-selector__retry {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
</style>
