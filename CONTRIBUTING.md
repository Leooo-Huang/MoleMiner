# Contributing to MoleMiner

Thanks for your interest in contributing!

## Development Setup

```bash
git clone https://github.com/YOUR_USERNAME/MoleMiner.git
cd MoleMiner/ts
npm install
npm run dev      # vitest watch mode
npm run build    # esbuild bundle
npm test         # vitest run
```

## Adding a New Search Source

1. Create `ts/src/sources/yoursource.ts` extending `BaseSource`
2. Implement `name`, `sourceType`, `requiresAuth`, `searchOne()`, `enabled()`
3. Register in `ts/src/sources/index.ts` ALL_SOURCES array
4. Add tests in `ts/tests/sources/yoursource.test.ts`
5. Run `npm test` to verify

## Code Style

- TypeScript strict mode, ESM imports with `.js` suffix
- camelCase for variables/functions, PascalCase for types
- Named exports only (no default export)
- async/await, no callbacks

## Pull Requests

- One feature per PR
- Include tests for new functionality
- All tests must pass (`npm test`)
- Follow existing code patterns

## Issues

Bug reports and feature requests welcome! Please include:
- Steps to reproduce (for bugs)
- Expected vs actual behavior
- Node.js version and OS
