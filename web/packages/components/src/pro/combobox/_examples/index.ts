import Basic from './_basic.vue'
import BasicRaw from './_basic.vue?raw'
import Clearable from './_clearable.vue'
import ClearableRaw from './_clearable.vue?raw'
import CustomFilter from './_custom-filter.vue'
import CustomFilterRaw from './_custom-filter.vue?raw'
import Disabled from './_disabled.vue'
import DisabledRaw from './_disabled.vue?raw'
import Group from './_group.vue'
import GroupRaw from './_group.vue?raw'
import Virtual from './_virtual.vue'
import VirtualRaw from './_virtual.vue?raw'

export default [
  {
    title: '基础',
    component: Basic,
    componentRaw: BasicRaw,
  },
  {
    title: '分组',
    component: Group,
    componentRaw: GroupRaw,
  },
  {
    title: '可清空',
    component: Clearable,
    componentRaw: ClearableRaw,
  },
  {
    title: '禁用',
    component: Disabled,
    componentRaw: DisabledRaw,
  },
  {
    title: '虚拟化',
    component: Virtual,
    componentRaw: VirtualRaw,
  },
  {
    title: '自定义筛选',
    component: CustomFilter,
    componentRaw: CustomFilterRaw,
  },
]
