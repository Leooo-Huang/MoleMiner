import { describe, it, expect } from 'vitest';
import { preprocessArgs } from '../src/index.js';

describe('CLI preprocessArgs', () => {
  it('should prepend "search" for unknown first argument', () => {
    const result = preprocessArgs(['node', 'moleminer', 'AI hackathon']);
    expect(result).toEqual(['node', 'moleminer', 'search', 'AI hackathon']);
  });

  it('should not modify known commands', () => {
    const result = preprocessArgs(['node', 'moleminer', 'sources']);
    expect(result).toEqual(['node', 'moleminer', 'sources']);
  });

  it('should not modify flags', () => {
    const result = preprocessArgs(['node', 'moleminer', '--version']);
    expect(result).toEqual(['node', 'moleminer', '--version']);
  });

  it('should not modify "search" command', () => {
    const result = preprocessArgs(['node', 'moleminer', 'search', 'query']);
    expect(result).toEqual(['node', 'moleminer', 'search', 'query']);
  });

  it('should not modify "config" command', () => {
    const result = preprocessArgs(['node', 'moleminer', 'config', 'list']);
    expect(result).toEqual(['node', 'moleminer', 'config', 'list']);
  });

  it('should not modify "doctor" command', () => {
    const result = preprocessArgs(['node', 'moleminer', 'doctor']);
    expect(result).toEqual(['node', 'moleminer', 'doctor']);
  });

  it('should handle no arguments beyond program name', () => {
    const result = preprocessArgs(['node', 'moleminer']);
    expect(result).toEqual(['node', 'moleminer']);
  });

  it('should not modify "help" command', () => {
    const result = preprocessArgs(['node', 'moleminer', 'help']);
    expect(result).toEqual(['node', 'moleminer', 'help']);
  });
});
