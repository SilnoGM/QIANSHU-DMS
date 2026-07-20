import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const serverRoot = resolve(__dirname, '../../..')
const schemaPath = resolve(serverRoot, 'prisma/schema.prisma')
const migrationPath = resolve(
  serverRoot,
  'prisma/migrations/20260720090000_user_profiles/migration.sql',
)

function readSchema(): string {
  return readFileSync(schemaPath, 'utf8')
}

function readMigration(): string {
  return readFileSync(migrationPath, 'utf8')
}

function extractModel(schema: string, modelName: string): string {
  const match = schema.match(
    new RegExp(`model ${modelName} \\{([\\s\\S]*?)\\n\\}`),
  )

  if (!match?.[1]) {
    throw new Error(`Missing Prisma model ${modelName}`)
  }

  return match[1]
}

describe('user profile database schema', () => {
  it('defines the mapped one-to-one Prisma relation and confirmed fields', () => {
    const schema = readSchema()
    const user = extractModel(schema, 'User')
    const profile = extractModel(schema, 'UserProfile')

    expect(user).toMatch(/\n\s*profile\s+UserProfile\?\s*$/mu)
    expect(profile).toContain(
      'userId          String   @id @map("user_id") @db.Uuid',
    )
    expect(profile).toContain('email           String?  @db.VarChar(254)')
    expect(profile).toContain(
      'emailNormalized String?  @unique(map: "user_profiles_email_normalized_key") @map("email_normalized") @db.VarChar(254)',
    )
    expect(profile).toContain(
      'mobileE164      String?  @unique(map: "user_profiles_mobile_e164_key") @map("mobile_e164") @db.VarChar(16)',
    )
    expect(profile).toContain(
      'avatarUrl       String?  @map("avatar_url") @db.VarChar(2048)',
    )
    expect(profile).toContain('remark          String?  @db.Text')
    expect(profile).toContain(
      'createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz(6)',
    )
    expect(profile).toContain(
      'updatedAt       DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)',
    )
    expect(profile).toContain(
      'user User @relation(fields: [userId], references: [id], onDelete: Cascade)',
    )
    expect(profile).toContain('@@map("user_profiles")')
  })

  it('creates named constraints, nullable uniqueness and historical backfill', () => {
    const migration = readMigration()

    expect(migration).toContain('CREATE TABLE "user_profiles"')
    for (const constraintName of [
      'user_profiles_pkey',
      'user_profiles_email_pair_check',
      'user_profiles_mobile_e164_check',
      'user_profiles_user_id_fkey',
    ]) {
      expect(migration).toContain(`CONSTRAINT "${constraintName}"`)
    }
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "user_profiles_email_normalized_key"',
    )
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "user_profiles_mobile_e164_key"',
    )
    expect(migration).toMatch(
      /INSERT INTO "user_profiles"[\s\S]*?SELECT[\s\S]*?FROM "users";/u,
    )
    expect(migration).toMatch(
      /CONSTRAINT "user_profiles_user_id_fkey"[\s\S]*?ON DELETE CASCADE ON UPDATE CASCADE;/u,
    )
    expect(migration).toContain(
      '"mobile_e164" ~ E\'^\\\\+[1-9][0-9]{7,14}$\'',
    )
  })
})
