import type { Prisma } from '../../generated/prisma/client'

/**
 * 业务 DTO 中的人员引用统一携带资料头像。
 * 人员主数据与用户资料是一对一关系，这里只读 `avatar_url`，不暴露资料表的其它字段。
 */
export const PERSON_REFERENCE_SELECT = {
  id: true,
  displayName: true,
  profile: { select: { avatarUrl: true } },
} satisfies Prisma.UserSelect

export interface PersonReferenceRow {
  readonly id: string
  readonly displayName: string
  readonly profile: { readonly avatarUrl: string | null } | null
}

export interface PersonReference {
  readonly id: string
  readonly displayName: string
  readonly avatarUrl: string | null
}

export function toPersonReference(person: PersonReferenceRow): PersonReference {
  return {
    id: person.id,
    displayName: person.displayName,
    avatarUrl: person.profile?.avatarUrl ?? null,
  }
}

export function toNullablePersonReference(
  person: PersonReferenceRow | null | undefined,
): PersonReference | null {
  return person == null ? null : toPersonReference(person)
}
