import Basic from './_basic.vue'
import BasicRaw from './_basic.vue?raw'
import Disabled from './_disabled.vue'
import DisabledRaw from './_disabled.vue?raw'
import Fixed from './_fixed.vue'
import FixedRaw from './_fixed.vue?raw'
import Heading from './_heading.vue'
import HeadingRaw from './_heading.vue?raw'
import Maximum from './_maximum.vue'
import MaximumRaw from './_maximum.vue?raw'
import NonContiguous from './_non-contiguous.vue'
import NonContiguousRaw from './_non-contiguous.vue?raw'
import PickerControlled from './_picker-controlled.vue'
import PickerControlledRaw from './_picker-controlled.vue?raw'
import PickerDisabled from './_picker-disabled.vue'
import PickerDisabledRaw from './_picker-disabled.vue?raw'
import PickerLabel from './_picker-label.vue'
import PickerLabelRaw from './_picker-label.vue?raw'
import PickerTrigger from './_picker-trigger.vue'
import PickerTriggerRaw from './_picker-trigger.vue?raw'
import Selector from './_picker.vue'
import SelectorRaw from './_picker.vue?raw'

export default [
  {
    title: '基础',
    component: Basic,
    componentRaw: BasicRaw,
  },
  {
    title: '月份范围限制',
    component: Disabled,
    componentRaw: DisabledRaw,
  },
  {
    title: '最大月份数',
    component: Maximum,
    componentRaw: MaximumRaw,
  },
  {
    title: '固定起始月份',
    component: Fixed,
    componentRaw: FixedRaw,
  },
  {
    title: '非连续范围',
    component: NonContiguous,
    componentRaw: NonContiguousRaw,
  },
  {
    title: '自定义标题',
    component: Heading,
    componentRaw: HeadingRaw,
  },
  {
    title: '选择器',
    component: Selector,
    componentRaw: SelectorRaw,
  },
  {
    title: '禁用选择器',
    component: PickerDisabled,
    componentRaw: PickerDisabledRaw,
  },
  {
    title: '选择器文案',
    component: PickerLabel,
    componentRaw: PickerLabelRaw,
  },
  {
    title: '自定义触发器',
    component: PickerTrigger,
    componentRaw: PickerTriggerRaw,
  },
  {
    title: '受控选择器',
    component: PickerControlled,
    componentRaw: PickerControlledRaw,
  },
]
