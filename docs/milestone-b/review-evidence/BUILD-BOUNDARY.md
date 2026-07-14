# Build Boundary

## Web / Vercel

Root `tsconfig.json` excludes Desktop and HRT packages from Next.js Web typecheck. Web build no longer typechecks `packages/hrt-provider-simulator/src/index.ts`, which removed the Vercel Preview failure.

## Desktop / Windows CI

Desktop consumes Contract through `@eshop/hrt-contract`. Windows CI builds Contract first, installs Desktop dependencies, then runs typecheck, tests, compile, Electron Builder, and artifact upload.

## HRT Contract

Contract remains a standalone package with its own `package.json`, `tsconfig.json`, schemas, validators, fixtures, and tests.

## Provider Simulator

Simulator consumes Contract through the public `@eshop/hrt-contract` package and is excluded from Web build.
