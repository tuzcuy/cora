import { SetMetadata } from '@nestjs/common';
import type { LicenseModule } from '@cora/shared';

export const MODULE_KEY = 'requiredModule';
/** Requires the tenant's license to include the given module (LicenseGuard). */
export const RequireModule = (mod: LicenseModule) => SetMetadata(MODULE_KEY, mod);
