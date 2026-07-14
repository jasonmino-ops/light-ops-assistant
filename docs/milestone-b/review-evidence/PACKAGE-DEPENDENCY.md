# Package Dependency Matrix

| Area | Depends On | Evidence |
| --- | --- | --- |
| Web / Next app | No HRT runtime dependency | Web build excludes HRT packages; no app/lib/components dependency on @eshop/hrt-contract found |
| Root tests | @eshop/hrt-contract; ProviderSimulator source | tests/hrt-contract.test.ts |
| Desktop Runtime HRT Core | @eshop/hrt-contract | desktop/package.json and desktop/src/main/hrt imports |
| Provider Simulator | @eshop/hrt-contract | packages/hrt-provider-simulator/src/index.ts |
| Contract Package | TypeScript only | packages/hrt-contract/package.json |

## Forbidden Direction Check

| Direction | Exists | Notes |
| --- | --- | --- |
| Contract -> Desktop | No | Contract has no Desktop imports |
| Simulator -> Desktop | No | Simulator imports only @eshop/hrt-contract |
| Desktop -> Simulator | No | Desktop Runtime does not import simulator; desktop test uses local TestProvider |
| Web -> Contract | No runtime dependency | Root package has file dependency for tests, Web tsconfig excludes HRT package sources |
| Web -> Simulator | No | No Web source imports simulator |
| Simulator -> Contract | Yes | Uses public @eshop/hrt-contract package |
| Desktop -> Contract | Yes | Uses public @eshop/hrt-contract package |
