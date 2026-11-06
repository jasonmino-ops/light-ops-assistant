# Commit scope audit

Trusted main c1041533abca99657edc09c2e69e2c18d9df13d5 unchanged after fresh fetch; Production 9e717439569c0485c703367b668b31ed8a7505e6. Product b558dcd197f166936610b5c7c140c0acb5f55a86 changes only existing service.ts and its existing service test relative to reviewed continuation parent b5d8d683. Full main-to-product code delta includes prior reviewed ca7e04ec timeout fix; that fix's transaction options, CAS block and reviewQueueRows are byte-identical (PRESERVED-INVARIANTS.json).

{
  "app/api/ops/tenants/[tenantId]/stores/[storeId]/v3-print-control-plane/service.ts": "7fbcf5ce177e482668f34fc3fe00cbc752c8dff0ba26c387f089b4111fd28113",
  "tests/v3-print-control-plane-service.test.ts": "7c4c8fc250ea1488fc8066da89839061c5d761b55060370052fdfa9d95e174e3"
}

Governance/docs commits are identified separately; no shipping entire main-descendant tree. New local release source mapping skips unrelated governance history and includes exactly ca7e04ec then b558dcd1 with exact -x mappings. No main/release remote update. User's original dirty checkout and prior sealed evidence untouched.
