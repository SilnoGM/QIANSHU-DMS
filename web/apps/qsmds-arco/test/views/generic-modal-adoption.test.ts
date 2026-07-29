import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 弹窗迁移契约使用 Node.js 内置 runner。
import test from 'node:test'

interface ModalSourceContract {
  file: string
  label: string
  minimumGenericModalCount?: number
}

const systemModalContracts: ModalSourceContract[] = [
  {
    file: '../../src/views/system/roles/role-editor-modal.vue',
    label: '角色编辑弹窗',
  },
  {
    file: '../../src/views/system/users/user-form-modal.vue',
    label: '用户表单弹窗',
  },
  {
    file: '../../src/views/system/users/password-reset-modal.vue',
    label: '密码重置弹窗',
  },
  {
    file: '../../src/views/system/users/role-assignment-modal.vue',
    label: '角色分配弹窗',
  },
  {
    file: '../../src/views/system/users/status-change-modal.vue',
    label: '用户状态弹窗',
  },
]

const accountModalContracts: ModalSourceContract[] = [
  {
    file: '../../src/components/AppAccountButton/index.vue',
    label: '账户菜单反馈与退出弹窗',
    minimumGenericModalCount: 2,
  },
  {
    file: '../../src/components/AppAccountButton/profile.vue',
    label: '个人资料弹窗',
  },
  {
    file: '../../src/components/AppAccountForm/edit-password.vue',
    label: '修改密码弹窗',
  },
]

const layoutModalContracts: ModalSourceContract[] = [
  {
    file: '../../src/layouts/components/AppSetting/index.vue',
    label: '应用设置弹窗',
  },
  {
    file: '../../src/layouts/components/Hotkeys/index.vue',
    label: '快捷键说明弹窗',
  },
  {
    file: '../../src/layouts/components/Topbar/Toolbar/MenuSearch/search.vue',
    label: '菜单搜索弹窗',
  },
]

const programmaticModalContracts: ModalSourceContract[] = [
  {
    file: '../../src/components/AppCheckUpdates/index.vue',
    label: '版本更新确认弹窗',
  },
]

function readRelativeSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

function assertUsesOnlyGenericModal(contract: ModalSourceContract): void {
  const source = readRelativeSource(contract.file)
  const genericModalCount = source.match(/<QsGenericModal\b/gu)?.length ?? 0

  assert.match(
    source,
    /import QsGenericModal from '@\/components\/business\/QsGenericModal\/index\.vue'/u,
    `${contract.label}必须显式导入 QsGenericModal`,
  )
  assert.ok(
    genericModalCount >= (contract.minimumGenericModalCount ?? 1),
    `${contract.label}缺少声明式 QsGenericModal`,
  )
  assert.doesNotMatch(
    source,
    /<FaModal\b|<AModal\b|\buseFaModal\s*\(/u,
    `${contract.label}不得绕过 QsGenericModal`,
  )
}

test('系统管理业务弹窗统一使用 QsGenericModal', () => {
  systemModalContracts.forEach(assertUsesOnlyGenericModal)
})

test.skip('账户相关弹窗统一使用 QsGenericModal', () => {
  accountModalContracts.forEach(assertUsesOnlyGenericModal)
})

test.skip('全局布局弹窗统一使用 QsGenericModal', () => {
  layoutModalContracts.forEach(assertUsesOnlyGenericModal)
})

test.skip('版本更新确认改为声明式 QsGenericModal', () => {
  programmaticModalContracts.forEach(assertUsesOnlyGenericModal)
})
