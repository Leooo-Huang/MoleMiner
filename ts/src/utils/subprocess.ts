/**
 * Shared subprocess utilities for calling external CLI tools.
 *
 * Used by: x/twitter (twitter-cli).
 * Uses execFileSync (not execSync) to avoid shell injection.
 */

import { execFileSync } from 'node:child_process';
import { platform } from 'node:os';

/** Check if a command exists on PATH. */
export function commandExists(cmd: string): boolean {
  try {
    const which = platform() === 'win32' ? 'where' : 'which';
    execFileSync(which, [cmd], { stdio: 'pipe', timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Run a command and return stdout as string, or null on error/timeout.
 * Uses execFileSync — args are passed directly, no shell involved.
 * Pass `env` to inject extra environment variables (merged with process.env).
 */
export function execCommand(
  cmd: string,
  args: string[],
  opts?: { timeout?: number; env?: Record<string, string> },
): string | null {
  const timeout = opts?.timeout ?? 15_000;
  try {
    return execFileSync(cmd, args, {
      timeout,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: opts?.env ? { ...process.env, ...opts.env } : undefined,
    }).trim();
  } catch {
    return null;
  }
}
