import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Test-only ES256 keypair: the corpus tests sign with the matching private
// key (fixtures baked into corpus.test.ts) and the worker verifies against
// this binding instead of the embedded production key.
const TEST_PUBKEY_PEM = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEr/9J7heZ5VkSy9ie7nAVqMoiFSNM
SExznEROk0+4wMbkTwu0nRcH2ZKZCF+E5LXGYEZ2tAtFaHqTBV1y1YcY9A==
-----END PUBLIC KEY-----`;

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        d1Databases: ["DB"],
        bindings: {
          DAILY_SALT: "test-salt",
          CORPUS_PUBKEY_PEM: TEST_PUBKEY_PEM,
          CORPUS_SOURCE_URL: "https://corpus-source.test/corpus.json",
        },
      },
    }),
  ],
});
