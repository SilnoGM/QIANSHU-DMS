import Basic from './_basic.vue'
import BasicRaw from './_basic.vue?raw'
import Deselect from './_deselect.vue'
import DeselectRaw from './_deselect.vue?raw'
import Disabled from './_disabled.vue'
import DisabledRaw from './_disabled.vue?raw'
import Heading from './_heading.vue'
import HeadingRaw from './_heading.vue?raw'
import Multiple from './_multiple.vue'
import MultipleRaw from './_multiple.vue?raw'
import Navigation from './_navigation.vue'
import NavigationRaw from './_navigation.vue?raw'
import PickerControlled from './_picker-controlled.vue'
import PickerControlledRaw from './_picker-controlled.vue?raw'
import PickerDisabled from './_picker-disabled.vue'
import PickerDisabledRaw from './_picker-disabled.vue?raw'
import PickerLabel from './_picker-label.vue'
import PickerLabelRaw from './_picker-label.vue?raw'
import PickerMultiple from './_picker-multiple.vue'
import PickerMultipleRaw from './_picker-multiple.vue?raw'
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
    title: '月份限制',
    component: Disabled,
    componentRaw: DisabledRaw,
  },
  {
    title: '多选',
    component: Multiple,
    componentRaw: MultipleRaw,
  },
  {
    title: '可取消选择',
    component: Deselect,
    componentRaw: DeselectRaw,
  },
  {
    title: '自定义翻页',
    component: Navigation,
    componentRaw: NavigationRaw,
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
  {
    title: '多选选择器',
    component: PickerMultiple,
    componentRaw: PickerMultipleRaw,
  },
]
