import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DotfileManager } from './dotfile-manager';

describe('DotfileManager', () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'dotfiles-test-'));
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
  });

  function writeConfig(content: string) {
    writeFileSync(join(tempHome, '.dotfilesrc.toml'), content);
  }

  function createFile(relativePath: string, content = 'test') {
    const fullPath = join(tempHome, relativePath);
    mkdirSync(join(fullPath, '..'), { recursive: true });
    writeFileSync(fullPath, content);
  }

  describe('backup', () => {
    it('should copy files to backup directory', () => {
      writeConfig(`
[files]
list = [".testrc"]
`);
      createFile('.testrc', 'my config');

      const manager = new DotfileManager(tempHome);
      manager.backup();

      const backupPath = join(tempHome, '.dotfiles', '.testrc');
      expect(existsSync(backupPath)).toBe(true);
      expect(readFileSync(backupPath, 'utf8')).toBe('my config');
    });

    it('should copy directories recursively', () => {
      writeConfig(`
[files]
list = [".config/myapp"]
`);
      mkdirSync(join(tempHome, '.config', 'myapp'), { recursive: true });
      writeFileSync(join(tempHome, '.config', 'myapp', 'settings.json'), '{}');

      const manager = new DotfileManager(tempHome);
      manager.backup();

      const backupPath = join(tempHome, '.dotfiles', '.config', 'myapp', 'settings.json');
      expect(existsSync(backupPath)).toBe(true);
      expect(readFileSync(backupPath, 'utf8')).toBe('{}');
    });

    it('should use custom backup_dir from config', () => {
      writeConfig(`
[settings]
backup_dir = ".my-backup"

[files]
list = [".testrc"]
`);
      createFile('.testrc', 'data');

      const manager = new DotfileManager(tempHome);
      manager.backup();

      const backupPath = join(tempHome, '.my-backup', '.testrc');
      expect(existsSync(backupPath)).toBe(true);
    });

    it('should log failure for missing source files', () => {
      writeConfig(`
[files]
list = [".nonexistent"]
`);

      const manager = new DotfileManager(tempHome);
      expect(() => manager.backup()).not.toThrow();
    });
  });

  describe('restore', () => {
    it('should copy files from backup to home', () => {
      writeConfig(`
[files]
list = [".testrc"]
`);
      // Create backup file (not in home)
      mkdirSync(join(tempHome, '.dotfiles'), { recursive: true });
      writeFileSync(join(tempHome, '.dotfiles', '.testrc'), 'restored config');

      const manager = new DotfileManager(tempHome);
      manager.restore();

      const restoredPath = join(tempHome, '.testrc');
      expect(existsSync(restoredPath)).toBe(true);
      expect(readFileSync(restoredPath, 'utf8')).toBe('restored config');
    });

    it('should skip files not in backup', () => {
      writeConfig(`
[files]
list = [".missing"]
`);
      mkdirSync(join(tempHome, '.dotfiles'), { recursive: true });

      const manager = new DotfileManager(tempHome);
      expect(() => manager.restore()).not.toThrow();
    });

    it('should fail if file already exists at destination', () => {
      writeConfig(`
[files]
list = [".testrc"]
`);
      mkdirSync(join(tempHome, '.dotfiles'), { recursive: true });
      writeFileSync(join(tempHome, '.dotfiles', '.testrc'), 'backup');
      writeFileSync(join(tempHome, '.testrc'), 'existing');

      const manager = new DotfileManager(tempHome);
      // Should not throw (error is caught internally), but file should NOT be overwritten
      manager.restore();

      expect(readFileSync(join(tempHome, '.testrc'), 'utf8')).toBe('existing');
    });
  });

  describe('config parsing', () => {
    it('should handle empty file list', () => {
      writeConfig(`
[files]
list = []
`);

      const manager = new DotfileManager(tempHome);
      expect(() => manager.backup()).not.toThrow();
    });

    it('should exit if config file is missing', () => {
      const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit');
      });

      expect(() => new DotfileManager(tempHome)).toThrow('process.exit');
      expect(mockExit).toHaveBeenCalledWith(1);

      mockExit.mockRestore();
    });
  });
});
