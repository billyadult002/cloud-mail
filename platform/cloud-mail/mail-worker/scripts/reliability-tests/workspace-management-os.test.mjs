import { describe, expect, it } from 'vitest';
import workspaceManagementService from '../../src/service/workspace-management-service.js';
import { safeMetadata } from '../../src/service/cloudmail-v2-service.js';

describe('GPT68 workspace management OS', () => {
 it('defines scoped workspace roles without an implicit global administrator', () => {
  expect(workspaceManagementService.PERMISSIONS.OWNER).toContain('provider_grant:manage');
  expect(workspaceManagementService.PERMISSIONS.MAIL_ADMIN).not.toContain('provider_grant:manage');
  expect(workspaceManagementService.PERMISSIONS.VIEWER).not.toContain('domain:write');
 });
 it('keeps raw authority material out of workspace audit metadata', () => {
  const safe = safeMetadata({ provider: 'cloudflare', token: 'canary', password: 'canary', authority_state: 'AUTHORIZED' });
  expect(safe).toEqual({ provider: 'cloudflare', authority_state: 'AUTHORIZED' });
 });
});
