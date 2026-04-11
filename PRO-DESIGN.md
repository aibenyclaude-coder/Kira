# Kira Pro -- Monetization Architecture Design

> v0.4: Pro subscription ($15/month) via Stripe + license key + feature gating

---

## 0. Design Thesis

Kira Proの課金設計は「DB不要・サーバーレス・検証可能」の三角形で成り立つ。

**根拠**: Kiraは現在ローカルMCPサーバーとして動く。バックエンドDBを持つと運用コストと障害点が増える。個人事業（B Button Corporation）の初期フェーズではDBゼロが正解。JWTライセンスキーがその唯一の解。

---

## 1. System Architecture

```
                                          ┌──────────────────┐
                                          │   Stripe          │
                                          │   - Product       │
                                          │   - $15/mo price  │
                                          │   - Checkout      │
                                          │   - Billing Portal│
                                          └───────┬──────────┘
                                                  │
                                                  │ webhook: checkout.session.completed
                                                  │          customer.subscription.deleted
                                                  ▼
┌────────────────┐    GET /     ┌──────────────────────────────────┐
│  Landing Page  │◄────────────►│  Vercel (or Cloudflare Workers)  │
│  (Static)      │              │                                  │
│  kira.sh       │  POST       │  /api/stripe-webhook             │
│                │─────────────►│    → Verify Stripe signature     │
│  - Hero        │              │    → Generate JWT license key    │
│  - Pricing     │              │    → Send via Stripe email /     │
│  - Checkout    │              │      Resend API                  │
│  - FAQ         │              │                                  │
└────────────────┘              │  /api/verify-key (optional)      │
                                │    → Public endpoint for         │
                                │      online validation           │
                                └──────────────────────────────────┘
                                                  │
                                                  │ JWT with expiry claim
                                                  ▼
┌──────────────────────────────────────────────────────────────────┐
│  User's Machine                                                  │
│                                                                  │
│  KIRA_PRO_KEY=eyJhbGciOiJFUzI1NiIs...                          │
│                                                                  │
│  ┌────────────────────────────────────────────┐                  │
│  │  Kira MCP Server (npx kira-mcp)            │                  │
│  │                                            │                  │
│  │  startup:                                  │                  │
│  │    1. Read KIRA_PRO_KEY env var            │                  │
│  │    2. Verify JWT signature (ES256)         │                  │
│  │    3. Check exp claim                      │                  │
│  │    4. Set tier = "pro" | "free"            │                  │
│  │                                            │                  │
│  │  kira_lookup / kira_route:                 │                  │
│  │    if tier === "pro":                      │                  │
│  │      → fetch remote latest (real-time)     │                  │
│  │    if tier === "free":                     │                  │
│  │      → use local snapshot only             │                  │
│  │                                            │                  │
│  └────────────────────────────────────────────┘                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 2. Component Inventory

### 2.1 Landing Page (Static Site)

| File | Purpose |
|---|---|
| `site/index.html` | Single page: hero, features, pricing, FAQ, footer |
| `site/styles.css` | Minimal CSS (dark theme, matches Kira branding) |
| `site/og-image.png` | OpenGraph image for social sharing |

**Hosting**: Vercel (free tier) or GitHub Pages.
**Domain**: kira.sh (or sub-path of existing domain).

**LP Structure**:
1. Hero: "Where agents shine." + one-liner + Install command
2. Demo GIF (existing asset)
3. Features: Skill / Scar / Auto-management
4. Pricing: Free vs Pro comparison table
5. CTA: "Get Pro" button -> Stripe Checkout
6. FAQ: 5-7 questions
7. Footer: B Button Corporation, links

### 2.2 Backend (Serverless Functions)

| File | Runtime | Purpose |
|---|---|---|
| `api/stripe-webhook.ts` | Vercel Edge/Serverless | Stripe webhook handler |
| `api/verify-key.ts` | Vercel Edge/Serverless | Optional: online key validation |
| `lib/jwt.ts` | Shared | JWT sign/verify with ES256 |
| `lib/email.ts` | Shared | Send license key email (Resend API) |

**Why Vercel serverless, not a full backend**:
- Zero ongoing server cost
- Zero ops burden
- Stripe webhook is the only write path
- JWT verification is stateless

### 2.3 Kira MCP Server Changes

| File | Change |
|---|---|
| `src/types.ts` | Add `KiraTier` type, `ProConfig` interface |
| `src/license.ts` | NEW: JWT verification logic |
| `src/index-loader.ts` | Gate remote fetch behind `tier === "pro"` |
| `src/server.ts` | Read KIRA_PRO_KEY at startup, set tier |

### 2.4 Secrets / Environment Variables

| Variable | Where | Purpose |
|---|---|---|
| `STRIPE_SECRET_KEY` | Vercel env | Stripe API calls |
| `STRIPE_WEBHOOK_SECRET` | Vercel env | Webhook signature verification |
| `KIRA_JWT_PRIVATE_KEY` | Vercel env | ES256 private key for signing JWTs |
| `KIRA_JWT_PUBLIC_KEY` | Bundled in kira-mcp npm | ES256 public key for verifying JWTs |
| `RESEND_API_KEY` | Vercel env | Email delivery |
| `KIRA_PRO_KEY` | User's machine env | The license key itself |

**Security note**: Private key NEVER leaves Vercel env. Only the public key ships with the npm package. This is the fundamental asymmetry that makes the system work.

---

## 3. Stripe Integration Flow

### 3.1 Checkout Flow

```
User clicks "Get Pro" on LP
  │
  ▼
Stripe Checkout Session (client-side redirect)
  - mode: "subscription"
  - price: price_xxxx ($15/month, recurring)
  - success_url: https://kira.sh/success?session_id={CHECKOUT_SESSION_ID}
  - cancel_url: https://kira.sh/#pricing
  - metadata: { source: "kira-pro-lp" }
  │
  ▼
User pays via Stripe UI
  │
  ▼
Stripe fires webhook: checkout.session.completed
  │
  ▼
/api/stripe-webhook receives event
  1. Verify webhook signature (stripe.webhooks.constructEvent)
  2. Extract customer_email, subscription_id, customer_id
  3. Generate JWT license key (see section 4)
  4. Send email with license key + setup instructions
  5. Return 200
  │
  ▼
User receives email:
  "Your Kira Pro key: eyJhbGciOi..."
  "Add to your environment:
   export KIRA_PRO_KEY=eyJhbGciOi...
   Then restart your MCP client."
```

### 3.2 Renewal Flow

```
Stripe auto-charges monthly
  │
  ▼
invoice.paid event fires
  │
  ▼
/api/stripe-webhook:
  1. Generate new JWT with fresh exp (+35 days)
  2. Email new key to customer
  │
  ▼
User updates KIRA_PRO_KEY (or uses same key if within grace period)
```

**Why +35 days, not +30**: 5-day grace period. If payment fails on day 30, the old key still works for 5 more days while Stripe retries. User experience > exactness.

### 3.3 Cancellation Flow

```
Stripe fires: customer.subscription.deleted
  │
  ▼
/api/stripe-webhook:
  1. Log cancellation
  2. (JWT naturally expires — no revocation needed)
  3. Optional: send "sorry to see you go" email
```

**Why no revocation list**: The JWT expires naturally. Worst case, a cancelled user gets 0-35 extra days of Pro. This is acceptable because:
- The actual cost of serving one extra Pro user is zero (all local computation)
- Building a revocation system would require a database
- Simplicity > precision at this scale

### 3.4 Webhook Events to Handle

| Event | Action |
|---|---|
| `checkout.session.completed` | Generate JWT, send email |
| `invoice.paid` | Generate fresh JWT, send email |
| `customer.subscription.deleted` | Log, optional goodbye email |
| `invoice.payment_failed` | Send "update payment" email |

---

## 4. License Key Design

### 4.1 Format: Signed JWT (ES256)

```json
{
  "header": {
    "alg": "ES256",
    "typ": "JWT",
    "kid": "kira-pro-v1"
  },
  "payload": {
    "sub": "cus_xxxxxxxxxxxx",
    "email": "user@example.com",
    "tier": "pro",
    "iss": "kira.sh",
    "iat": 1712880000,
    "exp": 1715904000
  }
}
```

### 4.2 Why JWT + ES256, not UUID

| Approach | DB needed? | Offline verify? | Forgeable? | Revocable? |
|---|---|---|---|---|
| UUID + DB lookup | Yes | No | No (random) | Yes |
| JWT HS256 (symmetric) | No | Yes | Yes (secret leaked = forge all) | No |
| **JWT ES256 (asymmetric)** | **No** | **Yes** | **No** | **No (by design)** |

**ES256 is the only choice that satisfies all three constraints**: no DB, offline verification, unforgeable.

- **Private key** (signs): stays on Vercel, never shipped
- **Public key** (verifies): bundled in npm package, safe to distribute
- Even if someone extracts the public key from the npm package, they cannot forge a valid JWT
- Verification is pure math — no network call needed

### 4.3 Key Rotation Strategy

The `kid` (key ID) in the JWT header enables key rotation:

1. Current key: `kira-pro-v1`
2. When rotating: generate new keypair, sign new JWTs with `kira-pro-v2`
3. Ship both public keys in the next npm release
4. After 35 days (all v1 JWTs expired), remove v1 public key

### 4.4 Verification Logic (src/license.ts)

```typescript
// Pseudocode — not implementation
import { createPublicKey, verify } from "node:crypto";

interface ProClaims {
  sub: string;       // Stripe customer ID
  email: string;
  tier: "pro";
  iss: string;       // "kira.sh"
  iat: number;
  exp: number;
}

type KiraTier = "free" | "pro";

function verifyProKey(key: string | undefined): KiraTier {
  if (!key) return "free";

  try {
    // 1. Decode header, find kid
    // 2. Look up matching public key
    // 3. Verify signature (ES256)
    // 4. Check exp > now
    // 5. Check iss === "kira.sh"
    const claims = verifyJwt(key);
    if (claims.exp < Date.now() / 1000) return "free";
    if (claims.iss !== "kira.sh") return "free";
    return "pro";
  } catch {
    return "free";  // Invalid key = graceful degradation to free
  }
}
```

**Critical design decision**: Invalid or expired key = free tier, NEVER an error. The user's agent must not break because of a billing issue.

### 4.5 Early Contributor Keys

For the first 1000 GitHub contributors who earn permanent Pro:

```json
{
  "sub": "contributor_github_username",
  "email": "contributor@example.com",
  "tier": "pro",
  "iss": "kira.sh",
  "iat": 1712880000,
  "exp": 4102444800
}
```

`exp: 4102444800` = January 1, 2100. Effectively permanent.
Signed with the same private key. Same verification path.

---

## 5. Feature Gating Logic

### 5.1 Free Tier Behavior

```
Kira MCP starts
  → KIRA_PRO_KEY not set or invalid
  → tier = "free"
  → loadAllSkills():
      local JSON only (skills/community/*.json + skills/vendor/*.json)
      remote fetch SKIPPED
  → loadAllScars():
      local JSON only (skills/scars/*.json)
      remote fetch SKIPPED
  → All 3 tools work normally (kira_lookup, kira_route, kira_report)
  → Data = whatever was in the npm package at install time
  → User can `npm update kira-mcp` to get newer snapshots
```

### 5.2 Pro Tier Behavior

```
Kira MCP starts
  → KIRA_PRO_KEY set and valid JWT
  → tier = "pro"
  → loadAllSkills():
      local JSON + remote fetch (KIRA_REMOTE_URL auto-set to pro endpoint)
      cache TTL = 1 hour (configurable)
  → loadAllScars():
      local JSON + remote fetch
  → All 3 tools work normally
  → Data = local + latest from remote (merged, newest wins)
  → Real-time updates without npm update
```

### 5.3 Concrete Code Change in index-loader.ts

Current behavior:
```
REMOTE_URL = process.env.KIRA_REMOTE_URL ?? "";
// If KIRA_REMOTE_URL is empty, remote fetch returns []
```

New behavior:
```
// Pro tier: auto-set remote URL to Kira's Pro CDN
// Free tier: remote URL stays empty (local only)
if (tier === "pro" && !process.env.KIRA_REMOTE_URL) {
  REMOTE_URL = "https://cdn.kira.sh/v1";
}
```

This is a 3-line change. The entire remote fetch infrastructure already exists. Feature gating is just "set the URL or don't".

### 5.4 Gating Summary Table

| Feature | Free | Pro |
|---|---|---|
| kira_lookup | Local snapshot | Local + remote latest |
| kira_route | Local snapshot | Local + remote latest |
| kira_report | Works (local log) | Works (local log) |
| Skill data freshness | npm publish time | Real-time (1h cache) |
| Scar data freshness | npm publish time | Real-time (1h cache) |
| New skills between releases | Not available | Auto-delivered |
| New scars between releases | Not available | Auto-delivered |
| MCP instructions auto-fire | Yes | Yes |
| Fuzzy keyword search | Yes | Yes |

**What is NOT gated** (deliberate):
- All 3 tools are always available
- Search quality is identical
- Report functionality works for everyone (we want all usage data)
- Free users are not degraded — they just get data that's days/weeks old instead of hours old

---

## 6. Data Flow for Pro Content Delivery

### 6.1 CDN Structure

```
https://cdn.kira.sh/v1/
  skills.json    ← All skills (community + vendor), single file
  scars.json     ← All scars, single file
  meta.json      ← Version, last_updated, skill_count, scar_count
```

**Why single files, not per-skill endpoints**: Kira loads all skills at startup, not on demand. A single fetch is simpler, faster, and cacheable. At 100 skills * ~2KB each = ~200KB. Trivial.

### 6.2 CDN Hosting Options (in order of preference)

1. **GitHub Raw + Cloudflare CDN**: Zero cost. skills.json lives in a repo, Cloudflare caches it. Pro users fetch from Cloudflare URL.
2. **Vercel Edge Config / KV**: If we need faster updates. ~$0/month at this scale.
3. **R2 (Cloudflare)**: If files get large. $0.015/million reads.

Phase 1 recommendation: **GitHub Raw + Cloudflare CDN**. Upgrade later if needed.

### 6.3 Update Pipeline

```
Skill merged to GitHub repo
  │
  ▼
GitHub Action: build-index
  1. Read all skills/community/*.json + skills/vendor/*.json
  2. Read all skills/scars/*.json
  3. Concatenate into skills.json, scars.json
  4. Push to cdn branch (or R2)
  │
  ▼
Cloudflare CDN invalidates cache (or 1h TTL naturally expires)
  │
  ▼
Pro users' next MCP restart picks up new data
```

---

## 7. Implementation Order

### Phase A: Foundation (Day 1-2)

1. **Generate ES256 keypair**
   - Store private key securely (Vercel env, 1Password)
   - Create `src/keys/kira-pro-v1.pub.pem` for npm bundle

2. **Implement `src/license.ts`**
   - JWT decode + ES256 verify using Node.js `crypto` (zero dependencies)
   - Export `verifyProKey(key: string | undefined): KiraTier`
   - Test with hand-signed test JWTs

3. **Modify `src/server.ts`**
   - Read `KIRA_PRO_KEY` at startup
   - Call `verifyProKey`, log tier
   - Pass tier to `loadAllSkills` / `loadAllScars`

4. **Modify `src/index-loader.ts`**
   - Accept tier parameter
   - Gate remote fetch behind `tier === "pro"`

### Phase B: Stripe Backend (Day 3-4)

5. **Create Stripe product + price**
   - Product: "Kira Pro"
   - Price: $15/month, recurring
   - Metadata: `{ product: "kira-pro" }`

6. **Implement `/api/stripe-webhook.ts`**
   - Verify Stripe signature
   - On `checkout.session.completed`: sign JWT, send email
   - On `invoice.paid`: sign fresh JWT, send email
   - On `customer.subscription.deleted`: log

7. **Set up email delivery**
   - Resend API (free tier: 100 emails/day, more than enough)
   - Template: key + install instructions

### Phase C: Landing Page (Day 5-6)

8. **Build static LP**
   - Single HTML file with inline CSS or minimal stylesheet
   - Stripe Checkout redirect (client-side `stripe.redirectToCheckout`)
   - Success page with "check your email" message

9. **Deploy to Vercel**
   - Static site + serverless functions in one project
   - Configure env vars

### Phase D: CDN + Integration (Day 7)

10. **Set up Pro CDN endpoint**
    - GitHub Action to build skills.json / scars.json
    - Deploy to Cloudflare CDN (or GitHub Raw as interim)

11. **End-to-end test**
    - Stripe test mode purchase
    - Receive JWT in email
    - Set KIRA_PRO_KEY, start kira-mcp
    - Verify remote fetch activates
    - Verify expired key falls back to free

### Phase E: Ship (Day 8)

12. **npm publish kira-mcp@0.4.0**
    - Includes public key, license verification, feature gating
    - KIRA_REMOTE_URL defaults to Pro CDN when tier is pro

13. **Update docs**
    - README: add Pro section
    - USAGE.md: add KIRA_PRO_KEY setup instructions

---

## 8. File Tree (New/Modified)

```
Kira/
  src/
    license.ts          ← NEW: JWT verification (ES256, zero deps)
    types.ts            ← MODIFY: add KiraTier, ProClaims
    server.ts           ← MODIFY: read KIRA_PRO_KEY, set tier
    index-loader.ts     ← MODIFY: gate remote fetch by tier
    keys/
      kira-pro-v1.pub.pem  ← NEW: ES256 public key (ships with npm)

  site/                 ← NEW: Landing page (separate deploy)
    index.html
    success.html
    styles.css

  api/                  ← NEW: Vercel serverless functions
    stripe-webhook.ts
    verify-key.ts       ← Optional: online validation

  lib/                  ← NEW: Shared utilities for api/
    jwt.ts              ← JWT signing (ES256 private key)
    email.ts            ← Resend email delivery
```

---

## 9. Dependency Decisions

### In kira-mcp (npm package)

| Dependency | Decision | Reason |
|---|---|---|
| JWT library (jsonwebtoken, jose) | **NO** — use Node.js `crypto` directly | Zero dependency principle. ES256 verify is ~30 lines with `crypto.createVerify`. Adding jose would double kira-mcp's dependency count. |
| Stripe SDK | **NO** — not needed in MCP server | Stripe interaction is server-side only (api/). |

### In site + api (Vercel project)

| Dependency | Decision | Reason |
|---|---|---|
| `stripe` | Yes | Webhook signature verification, customer API |
| `resend` | Yes | Email delivery |
| `jose` or raw `crypto` | Either | JWT signing — jose is fine here since it's server-side |

---

## 10. Threat Model

| Threat | Mitigation |
|---|---|
| JWT private key leaked | Key rotation via `kid`. Generate new keypair, sign new JWTs, ship new public key in next npm release. Old keys expire naturally in 35 days. |
| User shares JWT with others | Acceptable risk. JWT is tied to email but not machine. At $15/month, the incentive to share is low. If it becomes a problem, add machine fingerprint claim later. |
| Forged JWT | Impossible without private key. ES256 is asymmetric — public key cannot sign. |
| Expired JWT used | Verification checks `exp` claim. Expired = free tier. |
| Webhook replay attack | Stripe signature verification (timestamp + HMAC). Stripe SDK handles this. |
| Man-in-the-middle on CDN | HTTPS only. CDN data is public-readable anyway (skills are not secret — the secret is _getting them in real-time_). |
| User reverse-engineers feature gating | The gating is "do you fetch remote or not". Even if someone patches the code, they'd need to know the CDN URL and it could be auth-gated later. For now, the URL existing is not a secret worth protecting — the JWT is the business model, not the data. |

---

## 11. Contributor Permanent Pro

### Flow

```
User contributes to Kira (PR merged)
  │
  ▼
GitHub Action: check contributor count
  if contributor_count <= 1000:
    → Add to CONTRIBUTORS.md
    → Assign "early-contributor" label
  │
  ▼
Contributor emails pro@kira.sh (or uses a form)
  with GitHub username
  │
  ▼
Manual (Phase 1) or automated JWT generation
  → exp = 4102444800 (year 2100)
  → sub = "contributor_github_username"
  │
  ▼
Email permanent Pro key
```

### Why Manual Initially

Automating contributor-to-JWT is overengineering for Phase 1. At 1000 contributors max, each one is a valuable relationship. A personal email from Beny builds more loyalty than an automated flow.

---

## 12. Open Decisions (For Beny)

| # | Question | Recommendation | Reason |
|---|---|---|---|
| 1 | Domain for LP? | `kira.sh` or `kira-mcp.dev` | .sh is clever (shell), .dev is standard |
| 2 | Email provider? | Resend | Free tier covers early scale, great DX, Japanese founder |
| 3 | LP hosting? | Vercel (site + api in one project) | Simplest. One deploy. Free tier. |
| 4 | CDN for Pro data? | GitHub Raw + Cloudflare (start), R2 (scale) | Zero cost to start |
| 5 | Billing portal? | Stripe Customer Portal (hosted) | Zero implementation, Stripe handles cancellation/update |
| 6 | Should free users see "Pro available" in MCP output? | Yes, subtle one-liner in lookup response | Non-intrusive upsell that reaches the developer through the agent |

---

## 13. Self-Assessment

| Axis | Score | Note |
|---|---|---|
| Simplicity | 92 | JWT + Vercel serverless + static LP. No DB. Minimal moving parts. |
| Security | 88 | ES256 asymmetric, Stripe webhook sig, no secrets in npm. -12 for no revocation (acceptable trade-off). |
| User experience | 85 | One env var to activate Pro. Graceful degradation. No breaking changes. |
| Scalability | 80 | Works to ~10K users without changes. CDN upgrade path clear. |
| Revenue integrity | 75 | No revocation means up to 35 days free after cancellation. Acceptable at this scale. |
| Implementation speed | 90 | 8 days estimated. Most infrastructure already exists (remote fetch, merge logic). |
| PLAN.md alignment | 95 | Matches Phase 3 spec exactly. $15/month, Stripe, license key, free tier preserved. |

**Total: 86/100**

Gaps to address post-launch:
- Machine fingerprinting if key sharing becomes a problem
- Revocation endpoint if cancellation abuse appears
- Usage analytics (how many Pro vs Free lookups)

---

*Design by Tetra for B Button Corporation. 2026-04-11.*
*Implements PLAN.md Phase 3: Pro subscription.*
*Next step: Hand to implementer with this document as spec.*
