# QsPartConfigurator 货件配置器

业务组件负责当前产品与货件之间的数量分配，不发起 HTTP、不读取供应商、不生成编号，也不派发唛头。产品历史行由父页面展示，不传入此组件。

采购创建时仅保存配置并进入审核中，订单及货件唛头均为空。审核通过后，一采购单仅申请一个基础唛头：单货件直接使用基础唛头，多货件分别保存 `基础唛头/货件-01` 等货件唛头。组件只提示“审核通过后生成”，不预演或拼接正式唛头。显示标题“货件-01”只是内部顺序标签，不是正式货件编号。

## 接入

```vue
<QsPartConfigurator
  v-model="parts"
  :products="products"
  :disabled="submitting"
  @warning="toast.warning($event)"
/>
<QsPartConfigurator :model-value="parts" :products="products" readonly />
```

`types.ts` 导出 `PartConfiguratorProduct` 与 `PartConfiguration`。产品 `key` 对应当前业务明细行；货件 `key` 是创建时生成的 UUID v4，显示序号变化不会修改该 key。

| 属性或事件 | 契约 |
| --- | --- |
| `products` | 只读产品数组：`key`、`productNo`、`name`、`description`、`quantity`、`mainImage` |
| `modelValue` | 只读货件数组：`key`、`items: { productKey, quantity }[]` |
| `disabled` | 禁止选择、输入、创建、移除；仍允许展开核对 |
| `readonly` | 隐藏待装产品、创建按钮和所有移除控件，仅展示货件 |
| `update:modelValue` | 一次性提交完整配置副本，不修改传入数组 |
| `warning` | 创建时重验失败的信息，由调用方负责 Toast |

## 数量和身份规则

- 多产品可以合为一件，同一产品可以按正整数拆入不同货件。
- 本次装入数量默认为 1，允许手动修改；创建货件或退回已分配数量后恢复默认值。选择多产品后，一次创建一件货件。
- 待装产品支持「全选」与「取消全选」，只改变勾选状态，不改写本次装入数量（保留默认值或用户已填值）；全部产品装完后按钮隐藏。
- 产品数量与装入数量必须为 `1..2147483647` 的整数；最多 1000 件货件、全单最多 10000 项分配明细。达到上限后仍可移除已有货件或产品，再重新合件。
- 同一货件内同一 `productKey` 只能出现一次，不接受空件、未知产品和重复 UUID。
- 删除整件退回全部数量；移除单项只退回该项数量；移除最后一项同时移除货件。
- 全部数量已分配的产品退出待配置列表，退回数量后重新显示。
- 父级产品删除或减量产生的配置冲突必须由父级明确处理，组件显示错误并阻止继续创建，不自动截断已有分配。
- 标题默认折叠，最多同时展开一件；先显示 50 件标题，可继续加载，产品内容只在展开时挂载。

`logic.ts` 导出 `MAX_PART_CONFIGURATIONS`、`MAX_PART_ITEMS`、`MAX_PART_QUANTITY`、`formatPartLabel(index)` 和 `validatePartConfigurations(products, parts)`。`formatPartLabel` 接受从零开始的数组位置，仅用于显示。

完整校验返回 `{ valid, remainingQuantity, errors }`：`valid` 仅在结构合法且所有产品数量恰好全部分配时为 `true`。`remainingQuantity` 累计尚未分配的正数，超量独立列为错误，不能以总量抵销。内部 `getPartAllocationState` 保留各产品负剩余数用于报错。

## 验证

```bash
pnpm -C web exec tsx --test apps/qsmds-arco/test/views/qs-part-configurator.logic.test.ts
```

组件库入口：`/component-library/business/part-configurator`。示例 A5 可拆为 2+3，第二件再合入 B3，支持清空、恢复配置、禁用与只读模式。
