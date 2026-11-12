/**
 * seed-permissions.ts — idempotent catch-up for the permission catalogue.
 *
 * When a package adds a permission code to @cora/shared PERMISSIONS, the
 * Permission table and the Yönetici role must learn it. prisma/seed.ts does
 * that, but it also rewrites demo data and role permissions wholesale (and
 * imports argon2), so it must not be re-run on a live tenant. This script only
 * ADDS: missing Permission rows, and the missing grants for every role whose
 * SYSTEM_ROLES spec is '*'. It never removes anything.
 *
 * Run:  pnpm --filter @cora/api exec tsx prisma/seed-permissions.ts
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { PERMISSIONS, PERMISSION_GROUPS, SYSTEM_ROLES } from '@cora/shared';

try {
  process.loadEnvFile();
} catch {
  /* env injected in CI */
}

const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL as string) });

const groupOf = (code: string): string =>
  Object.entries(PERMISSION_GROUPS as Record<string, readonly string[]>).find(([, codes]) =>
    codes.includes(code),
  )?.[0] ?? 'other';

async function main() {
  let added = 0;
  for (const code of PERMISSIONS) {
    const r = await prisma.permission.upsert({
      where: { code },
      update: {},
      create: { code, group: groupOf(code) },
    });
    if (r) added += 1;
  }

  const wildcardRoles = Object.entries(SYSTEM_ROLES)
    .filter(([, spec]) => spec.permissions === '*')
    .map(([name]) => name);

  let granted = 0;
  const roles = await prisma.role.findMany({ where: { name: { in: wildcardRoles } } });
  for (const role of roles) {
    const have = new Set(
      (await prisma.rolePermission.findMany({ where: { roleId: role.id } })).map((rp) => rp.permissionCode),
    );
    const missing = PERMISSIONS.filter((c) => !have.has(c));
    if (missing.length) {
      await prisma.rolePermission.createMany({
        data: missing.map((permissionCode) => ({ roleId: role.id, permissionCode })),
        skipDuplicates: true,
      });
      granted += missing.length;
      console.log(`  ${role.name} (${role.tenantId}): +${missing.length} → ${missing.join(', ')}`);
    }
  }
  return { catalogue: PERMISSIONS.length, upserted: added, granted, roles: roles.length };
}

main()
  .then(async (r) => {
    await prisma.$disconnect();
    console.log(`Permission kataloğu: ${r.catalogue} kod · ${r.roles} '*' rolüne ${r.granted} yeni yetki.`);
  })
  .catch(async (e) => {
    console.error('seed-permissions hatası:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
