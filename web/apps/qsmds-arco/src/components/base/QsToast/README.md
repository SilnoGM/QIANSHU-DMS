# QsToast 轻提示

`QsToast` 是千树 DMS 的项目级轻提示基础组件。它通过
`useFaToast().custom()` 复用 `FaToast` 的队列、计时、堆叠、悬停暂停、
移动端滑动关闭和安全区能力，只接管项目视觉与受控调用 API。

## 使用

```ts
import { useQsToast } from '@/components/base/QsToast/useQsToast'

const toast = useQsToast()

toast.success('保存成功', {
  description: '内容已同步到服务器',
})

toast.error('保存失败', {
  description: '请检查网络连接后重试',
})
```

## 操作与关闭

```ts
toast.show('文件已移入回收站', {
  action: {
    label: '撤销',
    onClick: () => restoreFile(),
  },
  description: '你可以在 30 天内恢复该文件',
})
```

错误提示默认提供关闭按钮；加载和其他 `duration: Infinity` 的永久提示始终提供
关闭按钮。`closable: false` 只会覆盖有限时长提示，不能移除永久提示的键盘关闭入口。

## Promise

```ts
await toast.promise(saveDraft(), {
  loading: '正在保存草稿',
  success: result => ({
    title: '草稿已保存',
    description: `版本 ${result.version}`,
  }),
  error: error => ({
    title: '保存失败',
    description: getErrorMessage(error),
  }),
})
```

由于 `vue-sonner@2.0.9` 不会在 custom toast 同 id 更新时重置剩余时长，Promise
完成后会先关闭永久 loading，再创建具有正常自动关闭时长的成功或失败提示。
`useQsToast().promise()` 保留原 Promise 的返回值和异常，提示层不会吞掉业务失败。

## API 边界

- `show / success / info / warning / error / loading`
- `promise / dismiss`
- `description / duration / action / closable`
- 各展示方法返回 `QsToastId`，该 id 只用于 `dismiss(id)`

组件不接受任意 `class`、`style`、`icon` 或自定义 Vue 组件，避免业务页面破坏统一
视觉。标题与说明由调用方提供，组件不内置业务文案、权限、Store 或 API。

## 视觉与无障碍

- 中性浮层只在状态岛和左侧细线使用语义色。
- 错误提示使用 `role="alert"`，其他状态使用 `role="status"`。
- 操作和关闭按钮均提供键盘焦点样式与明确标签。
- `prefers-reduced-motion` 下停止加载旋转和局部交互动效；FaToast 继续负责外层
  进入、退出与堆叠的 reduced-motion 行为。
