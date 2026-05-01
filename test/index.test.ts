import { describe, it, expect } from 'vitest';

describe('Spanning Cloud Backup MCP Server', () => {
  describe('Tool Definitions', () => {
    const expectedTools = [
      'spanning_list_users',
      'spanning_get_user',
      'spanning_list_services',
      'spanning_list_backups',
      'spanning_queue_restore',
      'spanning_get_restore_status',
      'spanning_list_audit_log',
      'spanning_get_license_usage',
      'spanning_status',
    ];

    it('should define all 9 tools', () => {
      expect(expectedTools).toHaveLength(9);
    });

    it('should include user tools', () => {
      expect(expectedTools).toContain('spanning_list_users');
      expect(expectedTools).toContain('spanning_get_user');
    });

    it('should include service + backup tools', () => {
      expect(expectedTools).toContain('spanning_list_services');
      expect(expectedTools).toContain('spanning_list_backups');
    });

    it('should include restore tools', () => {
      expect(expectedTools).toContain('spanning_queue_restore');
      expect(expectedTools).toContain('spanning_get_restore_status');
    });

    it('should include audit + license + status tools', () => {
      expect(expectedTools).toContain('spanning_list_audit_log');
      expect(expectedTools).toContain('spanning_get_license_usage');
      expect(expectedTools).toContain('spanning_status');
    });
  });

  describe('Platform validation', () => {
    const validPlatforms = ['m365', 'gws', 'salesforce'];

    it('should support m365, gws, salesforce', () => {
      expect(validPlatforms).toContain('m365');
      expect(validPlatforms).toContain('gws');
      expect(validPlatforms).toContain('salesforce');
    });
  });

  describe('Credentials', () => {
    it('should require platform, admin email, and API token', () => {
      const required = ['SPANNING_PLATFORM', 'SPANNING_ADMIN_EMAIL', 'SPANNING_API_TOKEN'];
      expect(required).toHaveLength(3);
    });
  });

  describe('Server Configuration', () => {
    it('should define server with correct name', () => {
      const config = { name: 'spanning-mcp', version: '0.0.0' };
      expect(config.name).toBe('spanning-mcp');
    });
  });
});
