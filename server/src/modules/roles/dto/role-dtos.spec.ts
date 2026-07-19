import { validate } from 'class-validator'

import { CreateRoleRequestDto } from './create-role-request.dto'
import { ReplaceRolePermissionsRequestDto } from './replace-role-permissions-request.dto'
import { UpdateRoleRequestDto } from './update-role-request.dto'

const PERMISSION_ID = '00000000-0000-4000-8000-000000000001'

describe('role request DTOs', () => {
  it('accepts a canonical lower-snake-case role code', async () => {
    const dto = Object.assign(new CreateRoleRequestDto(), {
      code: 'inventory_manager2',
      name: '库存管理员',
      description: '负责库存管理',
    })

    await expect(validate(dto)).resolves.toHaveLength(0)

    const withoutDescription = Object.assign(new CreateRoleRequestDto(), {
      code: 'inventory_reader',
      name: '库存只读角色',
    })
    await expect(validate(withoutDescription)).resolves.toHaveLength(0)
  })

  it.each(['SystemAdmin', 'system-admin', ' system_admin', 'system admin'])(
    'rejects a non-canonical role code: %s',
    async (code) => {
      const dto = Object.assign(new CreateRoleRequestDto(), {
        code,
        name: '管理员',
      })

      await expect(validate(dto)).resolves.not.toHaveLength(0)
    },
  )

  it('rejects a blank role name and an empty supplied description', async () => {
    const dto = Object.assign(new CreateRoleRequestDto(), {
      code: 'inventory_manager',
      name: '   ',
      description: '',
    })

    const errors = await validate(dto)

    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['name', 'description']),
    )
  })

  it('requires at least one field for an update and accepts explicit null to clear description', async () => {
    const empty = new UpdateRoleRequestDto()
    const clearDescription = Object.assign(new UpdateRoleRequestDto(), {
      description: null,
    })

    await expect(validate(empty)).resolves.not.toHaveLength(0)
    await expect(validate(clearDescription)).resolves.toHaveLength(0)
  })

  it('does not whitelist code or isSystem as update fields', async () => {
    const dto = Object.assign(new UpdateRoleRequestDto(), {
      name: '新名称',
      code: 'renamed_role',
      isSystem: true,
    })

    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    })

    expect(errors.map(error => error.property)).toEqual(
      expect.arrayContaining(['code', 'isSystem']),
    )
  })

  it('accepts unique UUID permission ids including an empty replacement', async () => {
    const populated = Object.assign(new ReplaceRolePermissionsRequestDto(), {
      permissionIds: [PERMISSION_ID],
    })
    const empty = Object.assign(new ReplaceRolePermissionsRequestDto(), {
      permissionIds: [],
    })

    await expect(validate(populated)).resolves.toHaveLength(0)
    await expect(validate(empty)).resolves.toHaveLength(0)
  })

  it.each([
    [[PERMISSION_ID, PERMISSION_ID]],
    [['not-a-uuid']],
    [[null]],
  ])('rejects an invalid permission id set: %j', async (permissionIds) => {
    const dto = Object.assign(new ReplaceRolePermissionsRequestDto(), {
      permissionIds,
    })

    await expect(validate(dto)).resolves.not.toHaveLength(0)
  })
})
