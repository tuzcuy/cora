import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator.js';

export interface WriteRoute {
  controller: string;
  handler: string;
  method: string;
  path: string;
  guarded: boolean;
  /** @Public routes (login/refresh/logout) are exempt by design. */
  isPublic: boolean;
}

const WRITE_METHODS = new Set([
  RequestMethod.POST,
  RequestMethod.PUT,
  RequestMethod.PATCH,
  RequestMethod.DELETE,
]);

/**
 * Enumerates every POST/PUT/PATCH/DELETE handler on the given controller
 * classes and reports whether it carries @RequirePermission (or @Public).
 * Pure metadata reflection — no DI, no app boot — so the same function serves
 * the bootstrap check in main.ts and the static test in security.spec.ts.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export function scanWriteRoutes(controllers: Function[]): WriteRoute[] {
  const out: WriteRoute[] = [];
  for (const ctrl of controllers) {
    const basePath: string = Reflect.getMetadata(PATH_METADATA, ctrl) ?? '';
    const classPerms = Reflect.getMetadata(PERMISSIONS_KEY, ctrl);
    const classPublic = Reflect.getMetadata(IS_PUBLIC_KEY, ctrl);
    const proto = ctrl.prototype;
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === 'constructor') continue;
      const fn = proto[name];
      if (typeof fn !== 'function') continue;
      const method: RequestMethod | undefined = Reflect.getMetadata(METHOD_METADATA, fn);
      if (method === undefined || !WRITE_METHODS.has(method)) continue;
      const perms = Reflect.getMetadata(PERMISSIONS_KEY, fn) ?? classPerms;
      const isPublic = Boolean(Reflect.getMetadata(IS_PUBLIC_KEY, fn) ?? classPublic);
      out.push({
        controller: ctrl.name,
        handler: name,
        method: RequestMethod[method],
        path: `/${basePath}/${Reflect.getMetadata(PATH_METADATA, fn) ?? ''}`.replace(/\/+/g, '/'),
        guarded: Array.isArray(perms) && perms.length > 0,
        isPublic,
      });
    }
  }
  return out;
}

/**
 * Fail fast: a write route with neither @RequirePermission nor @Public is a
 * bug that must never reach production. Called at bootstrap (main.ts) — the
 * process refuses to start — and from the test suite.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export function assertWriteRoutesGuarded(controllers: Function[]): WriteRoute[] {
  const routes = scanWriteRoutes(controllers);
  const offenders = routes.filter((r) => !r.guarded && !r.isPublic);
  if (offenders.length > 0) {
    const list = offenders.map((r) => `  ${r.method} ${r.path} (${r.controller}.${r.handler})`).join('\n');
    throw new Error(
      `@RequirePermission olmayan yazma uçları var — bu bir hata, uygulama başlatılmıyor:\n${list}`,
    );
  }
  return routes;
}
