import Basic from './_basic.vue'
import BasicRaw from './_basic.vue?raw'
import Clearable from './_clearable.vue'
import ClearableRaw from './_clearable.vue?raw'
import DisabledOption from './_disabled-option.vue'
import DisabledOptionRaw from './_disabled-option.vue?raw'
import Disabled from './_disabled.vue'
import DisabledRaw from './_disabled.vue?raw'
import Hover from './_hover.vue'
import HoverRaw from './_hover.vue?raw'
import ParentSelectable from './_parent-selectable.vue'
import ParentSelectableRaw from './_parent-selectable.vue?raw'
import Single from './_single.vue'
import SingleRaw from './_single.vue?raw'

export default [
  {
    title: '基础',
    component: Basic,
    componentRaw: BasicRaw,
  },
  {
    title: '可清除',
    component: Clearable,
    componentRaw: ClearableRaw,
  },
  {
    title: '禁用',
    component: Disabled,
    componentRaw: DisabledRaw,
  },
  {
    title: '禁用选项',
    component: DisabledOption,
    componentRaw: DisabledOptionRaw,
  },
  {
    title: '父节点可选',
    component: ParentSelectable,
    componentRaw: ParentSelectableRaw,
  },
  {
    title: '悬停展开',
    component: Hover,
    componentRaw: HoverRaw,
  },
  {
    title: '单列模式',
    component: Single,
    componentRaw: SingleRaw,
  },
]
