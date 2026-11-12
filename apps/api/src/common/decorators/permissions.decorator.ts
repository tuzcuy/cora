import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@cora/shared';

export const PERMISSIONS_KEY = 'requiredPermissions';
/** Requires the current user to hold all listed permission codes. */
export const RequirePermission = (...perms: Permission[]) => SetMetadata(PERMISSIONS_KEY, perms);
