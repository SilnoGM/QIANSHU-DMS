import Basic from './_basic.vue'
import BasicRaw from './_basic.vue?raw'
import Checkbox from './_checkbox.vue'
import CheckboxRaw from './_checkbox.vue?raw'
import CustomNode from './_custom-node.vue'
import CustomNodeRaw from './_custom-node.vue?raw'
import Events from './_events.vue'
import EventsRaw from './_events.vue?raw'
import Filter from './_filter.vue'
import FilterRaw from './_filter.vue?raw'
import Virtual from './_virtual.vue'
import VirtualRaw from './_virtual.vue?raw'

export default [
  {
    title: '基础',
    component: Basic,
    componentRaw: BasicRaw,
  },
  {
    title: '复选框',
    component: Checkbox,
    componentRaw: CheckboxRaw,
  },
  {
    title: '自定义过滤',
    component: Filter,
    componentRaw: FilterRaw,
  },
  {
    title: '外部事件',
    component: Events,
    componentRaw: EventsRaw,
  },
  {
    title: '自定义节点',
    component: CustomNode,
    componentRaw: CustomNodeRaw,
  },
  {
    title: '虚拟化',
    component: Virtual,
    componentRaw: VirtualRaw,
  },
]
