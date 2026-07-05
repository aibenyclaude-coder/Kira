/**
 * /v1/corpus — reciprocity gate tests.
 *
 * JWT fixtures are pre-signed (ES256, raw ieee-p1363) against the test
 * keypair whose PUBLIC pem is bound as CORPUS_PUBKEY_PEM in vitest.config.ts.
 * The corpus source is mocked via cloudflare:test fetchMock at the
 * CORPUS_SOURCE_URL binding.
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { SELF, fetchMock } from "cloudflare:test";

const JWT_CONTRIB =
  "eyJhbGciOiJFUzI1NiIsImtpZCI6ImtpcmEtcHJvLXYxIn0.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJlbWFpbCI6InRAZXhhbXBsZS5jb20iLCJpc3MiOiJraXJhLnNoIiwiaWF0IjoxNzUxMDAwMDAwLCJleHAiOjIwODI3NTg0MDAsInRpZXIiOiJjb250cmlidXRvciJ9.2vKbp2LMbDwa23-iB_Xk57dSFM71STLtaPWGbVqWnWO7slyBPDLouNzXm-U7Gbpks13HAV5EK6wwKapEGQwdFQ";
const JWT_PRO =
  "eyJhbGciOiJFUzI1NiIsImtpZCI6ImtpcmEtcHJvLXYxIn0.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJlbWFpbCI6InRAZXhhbXBsZS5jb20iLCJpc3MiOiJraXJhLnNoIiwiaWF0IjoxNzUxMDAwMDAwLCJleHAiOjIwODI3NTg0MDAsInRpZXIiOiJwcm8ifQ._ovJvFGOL7YuX-c5rfcv8HSfQrci80hBlwzyPsI5E9j9Htd7BqTNRintcafvVRlBuvDR4WzDwWIIRhk6VqqHWA";
const JWT_EXPIRED =
  "eyJhbGciOiJFUzI1NiIsImtpZCI6ImtpcmEtcHJvLXYxIn0.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJlbWFpbCI6InRAZXhhbXBsZS5jb20iLCJpc3MiOiJraXJhLnNoIiwiaWF0IjoxNzUxMDAwMDAwLCJleHAiOjEwMDAwMDAwMDAsInRpZXIiOiJjb250cmlidXRvciJ9.Ja7sqGzl7v05AS5Y9cUdyRKlwei4dkKs1t8tZ6Q9rW8oEXS_Qumr0IRR8ubdQ96xK0BS8ThMwkZaYz1o-GQhEw";
// Valid header/payload, signature from a different message → must fail verify.
const JWT_TAMPERED = JWT_CONTRIB.slice(0, -6) + "AAAAAA";

const freshDate = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();
const oldDate = new Date(Date.now() - 200 * 24 * 3600 * 1000).toISOString();

const BUNDLE = {
  skills: [
    { id: "community.old-skill.v1", updated_at: oldDate, title: "old" },
    { id: "community.fresh-skill.v1", updated_at: freshDate, title: "fresh" },
  ],
  scars: [
    { id: "scar.old.v1", updated_at: oldDate, title: "old scar" },
    { id: "scar.fresh.v1", updated_at: freshDate, title: "fresh scar" },
  ],
};

function mockSource() {
  fetchMock
    .get("https://corpus-source.test")
    .intercept({ path: "/corpus.json" })
    .reply(200, JSON.stringify(BUNDLE), {
      headers: { "Content-Type": "application/json" },
    });
}

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

afterEach(() => {
  fetchMock.assertNoPendingInterceptors();
});

async function getScars(auth?: string): Promise<{ res: Response; ids: string[] }> {
  mockSource();
  const res = await SELF.fetch("https://w/v1/corpus/scars.json", {
    headers: auth ? { Authorization: `Bearer ${auth}` } : {},
  });
  const ids = ((await res.json()) as Array<{ id: string }>).map((x) => x.id);
  return { res, ids };
}

describe("/v1/corpus reciprocity gate", () => {
  it("keyless callers get the delayed commons only", async () => {
    const { res, ids } = await getScars();
    expect(res.status).toBe(200);
    expect(ids).toEqual(["scar.old.v1"]);
    expect(res.headers.get("X-Kira-Tier")).toBe("free");
    expect(res.headers.get("X-Kira-Delay-Days")).toBe("90");
  });

  it("a contributor key unlocks the fresh feed", async () => {
    const { res, ids } = await getScars(JWT_CONTRIB);
    expect(ids).toContain("scar.fresh.v1");
    expect(ids).toContain("scar.old.v1");
    expect(res.headers.get("X-Kira-Tier")).toBe("contributor");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("a supporter (pro) key unlocks the fresh feed", async () => {
    const { res, ids } = await getScars(JWT_PRO);
    expect(ids).toContain("scar.fresh.v1");
    expect(res.headers.get("X-Kira-Tier")).toBe("pro");
  });

  it("an expired key degrades to the commons, never an error", async () => {
    const { res, ids } = await getScars(JWT_EXPIRED);
    expect(res.status).toBe(200);
    expect(ids).toEqual(["scar.old.v1"]);
    expect(res.headers.get("X-Kira-Tier")).toBe("free");
  });

  it("a tampered signature degrades to the commons", async () => {
    const { ids } = await getScars(JWT_TAMPERED);
    expect(ids).toEqual(["scar.old.v1"]);
  });

  it("skills.json is gated the same way", async () => {
    mockSource();
    const res = await SELF.fetch("https://w/v1/corpus/skills.json");
    const ids = ((await res.json()) as Array<{ id: string }>).map((x) => x.id);
    expect(ids).toEqual(["community.old-skill.v1"]);
  });

  it("the info route reports tier, delay and counts", async () => {
    mockSource();
    const res = await SELF.fetch("https://w/v1/corpus", {
      headers: { Authorization: `Bearer ${JWT_CONTRIB}` },
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.tier).toBe("contributor");
    expect(body.delay_days).toBe(0);
    expect(body.scars).toBe(2);
    expect(String(body.reciprocity)).toContain("contributor key");
  });
});
