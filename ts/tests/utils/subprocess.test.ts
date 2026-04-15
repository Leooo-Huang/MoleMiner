import { describe, it, expect, vi, beforeEach } from 'vitest';

// We test the exported functions by mocking child_process
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

import { commandExists, execCommand } from '../../src/utils/subprocess.js';
import { execFileSync } from 'node:child_process';

const mockExecFileSync = vi.mocked(execFileSync);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('commandExists', () => {
  it('should return true when command is found', () => {
    mockExecFileSync.mockReturnValueOnce(Buffer.from('/usr/bin/node'));
    expect(commandExists('node')).toBe(true);
  });

  it('should return false when command is not found', () => {
    mockExecFileSync.mockImplementationOnce(() => {
      throw new Error('not found');
    });
    expect(commandExists('nonexistent-cmd')).toBe(false);
  });
});

describe('execCommand', () => {
  it('should return trimmed stdout', () => {
    mockExecFileSync.mockReturnValueOnce('  hello world  \n');
    const result = execCommand('echo', ['hello']);
    expect(result).toBe('hello world');
  });

  it('should return null on error', () => {
    mockExecFileSync.mockImplementationOnce(() => {
      throw new Error('command failed');
    });
    expect(execCommand('bad', ['cmd'])).toBeNull();
  });

  it('should pass timeout option', () => {
    mockExecFileSync.mockReturnValueOnce('ok');
    execCommand('cmd', ['arg'], { timeout: 5000 });
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'cmd',
      ['arg'],
      expect.objectContaining({ timeout: 5000 }),
    );
  });
});
