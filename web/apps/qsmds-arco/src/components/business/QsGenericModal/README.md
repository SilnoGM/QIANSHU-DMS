# QsGenericModal 维护说明

`QsGenericModal` 是千树 DMS 的声明式业务模态框。底层使用已经加固为真正模态语义的 `FaModal`；本目录只统一聚焦任务的尺寸、稳定状态、关闭守卫和视觉分区，不请求 API、不读取 Store，也不内置确认、保存或删除动作。

## 生命周期

组件使用 `localOpen` 隔离父级 `modelValue` 与 `FaModal` 内部状态：

1. 父级打开时，把受控值传给 `FaModal`。
2. 自定义关闭按钮先以 `close-button` 执行守卫，通过后再更新 `v-model`。
3. `FaModal` 原生关闭只可能来自遮罩或 `Escape`。组件在 `document` 的 capture 阶段短暂记录 `Escape`，其余原生关闭归为 `overlay`。
4. 父级把 `modelValue` 改为 `false` 时，以 `programmatic` 执行同一守卫；拒绝后回写 `true`，避免父级状态与实际可见状态分叉。
5. `opened`、`closed` 透传底层动画生命周期；关闭后的焦点恢复由 `FaModal` / Reka Dialog 负责，包装层不得重复抢焦点。

`submitting` 会在守卫之前拒绝所有关闭方式，同时把 Footer 设为 `inert`。调用方必须保证异步流程最终释放该状态；组件不会设置超时或擅自取消业务请求。

## 公共接口

必要 Prop 只有 `title`。其余 Props 为：

- `modelValue?: boolean`
- `description?: string`
- `size?: "sm" | "md" | "lg" | "xl"`
- `loading?: boolean`
- `error?: string | null`
- `submitting?: boolean`
- `closable?: boolean`
- `destroyOnClose?: boolean`
- `dismissOnOverlay?: boolean`
- `dismissOnEscape?: boolean`
- `beforeClose?: (reason) => boolean | Promise<boolean>`
- `zIndex?: number`（默认 `2000`，与 `FaDrawer` 相同）

Events 仅提供 `update:modelValue`、`opened`、`closed`。Slots 仅提供 `default`、`header-leading`、`header-extra`、`loading`、`error-actions` 和 `footer`。

不要新增固定的取消、确定、保存或删除事件。业务按钮、权限、校验和写入副作用属于 Footer 调用方。

`zIndex` 只用于“弹窗从抽屉内打开、必须压住同页抽屉”这一种场景。全站浮层默认同为 `2000`，平级时的绘制顺序由 `Teleport` 的挂载顺序决定，与打开先后无关；因此抽屉内弹窗不能依赖模板声明顺序，需要显式抬高。抬高后该弹窗内不能再放 `FaSelect`、`FaDropdown` 等同样是 `2000` 的浮层，否则它们会掉到弹窗下面。当前唯一使用方是采购金额修订弹窗（`views/workbenches/purchase-reviews/amount-revision-modal.vue`）。

## 响应式规则

- 窄屏宽度为 `calc(100vw - 24px)`，最大高度为 `calc(100dvh - 24px)`。
- 从 `640px` 开始，`sm`、`md`、`lg`、`xl` 最大宽度分别为 `480px`、`560px`、`720px`、`896px`。
- Header、正文与 Footer 分区独立；只有正文滚动。
- Footer 使用 `env(safe-area-inset-bottom)`，移动端按钮是否全宽由调用方声明。
- `prefers-reduced-motion` 下保留 `0.01ms` 动画，以维持底层 `opened` / `closed` 事件。

组件库 Showcase 提供“长内容滚动”状态，使用十条本地费用数据主动撑高正文。维护滚动布局时应同时验证桌面和窄屏：Header 与 Footer 必须持续可见，滚动容器只能是正文分区。

## 底层约束

- `FaModal` 必须继续保持 `modal=true`、单一 Reka Overlay、焦点约束、背景滚动锁和关闭焦点恢复。
- 自定义 Header 时仍必须把真实 `title` 与 `description` 传入 `FaModal`，由隐藏的 `DialogTitle` / `DialogDescription` 提供可访问名称。
- `FaModal` 的 `beforeClose` 只把遮罩和 `Escape` 表示为 `close`，来源区分由本组件的真实键盘捕获完成。
- 不读取 `data-modal-id` 等私有 DOM，不自行实现第二套 Overlay、焦点锁或滚动锁。
- `zIndex` 不是浮层栈管理：组件不按打开顺序分配序号、不改 `FaDrawer` 的层级，也不接管 `FaSelect` / `FaDropdown` 的 `2000` 基准。
- 第一版不支持命令式 Service、嵌套模态框栈、拖拽、最大化或可变 class 逃生口。

## 验证

```bash
pnpm -C web exec tsx --test \
  apps/qsmds-arco/test/views/fa-modal.test.ts \
  apps/qsmds-arco/test/views/generic-modal.test.ts \
  apps/qsmds-arco/test/views/generic-modal-showcase.test.ts \
  apps/qsmds-arco/test/api/component-library-routes.test.ts

pnpm -C web typecheck
pnpm -C web build
```
