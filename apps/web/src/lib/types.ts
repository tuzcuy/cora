export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  tenantName: string;
  repCode: string | null;
  permissions: string[];
  modules: string[];
}
