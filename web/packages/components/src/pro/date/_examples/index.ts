import Basic from './_basic.vue'
import BasicRaw from './_basic.vue?raw'
import Birthday from './_birthday.vue'
import BirthdayRaw from './_birthday.vue?raw'
import ControlledView from './_controlled-view.vue'
import ControlledViewRaw from './_controlled-view.vue?raw'
import Disabled from './_disabled.vue'
import DisabledRaw from './_disabled.vue?raw'
import Labels from './_labels.vue'
import LabelsRaw from './_labels.vue?raw'
import Multiple from './_multiple.vue'
import MultipleRaw from './_multiple.vue?raw'
import Picker from './_picker.vue'
import PickerRaw from './_picker.vue?raw'
import Trigger from './_trigger.vue'
import TriggerRaw from './_trigger.vue?raw'

export default [
  {
    title: '基础',
    component: Basic,
    componentRaw: BasicRaw,
  },
  {
    title: '选择器',
    component: Picker,
    componentRaw: PickerRaw,
  },
  {
    title: '生日选择',
    component: Birthday,
    componentRaw: BirthdayRaw,
  },
  {
    title: '多选选择器',
    component: Multiple,
    componentRaw: MultipleRaw,
  },
  {
    title: '受控视图',
    component: ControlledView,
    componentRaw: ControlledViewRaw,
  },
  {
    title: '自定义标题文案',
    component: Labels,
    componentRaw: LabelsRaw,
  },
  {
    title: '日期限制',
    component: Disabled,
    componentRaw: DisabledRaw,
  },
  {
    title: '自定义触发器',
    component: Trigger,
    componentRaw: TriggerRaw,
  },
]
