# Demo APAX App

A minimal Web3 demo showcasing a portfolio vault with a modern frontend, backend API, and smart contracts.

## 🧱 Stack

- **Frontend**: Next.js
- **Backend**: Node.js + Express + ethers
- **Smart Contracts**: Solidity (Hardhat)

## 🔁 Architecture Flow

Frontend → Backend → Blockchain

- The frontend never talks directly to the blockchain
- The backend provides clean APIs and reads on-chain data
- The smart contract is the source of truth

---

## 📁 Project Structure

```text
/apax
├── /smart-contracts          # Hardhat and Smart Contracts
│   ├── /contracts
│   ├── /scripts
│   ├── /test
│   ├── hardhat.config.ts
│   ├── package.json
│   └── .env
│
├── /web                 # Web frontend (Next.js)
│   ├── /app
│   ├── /components
│   ├── /hooks
│   ├── /lib
│   ├── /public
│   ├── /src
│   ├── package.json
│   └── tsconfig.json
│
├── /shared                   # Shared resources (like ABIs)
│   ├── /abi
│   └── constants.ts
│
└── README.md                 # Project documentation

```

## Install Dependencies

From the **root of the repository**:

```bash
cd web
npm install
```

## Run the Project

From the **root of the repository**:

```bash
npm run dev
```

## Once running, open your browser and go to: http://localhost:3000 to view the app locally.

---

# Assessment Notes

Submission notes for the APAX technical assessment. Work is on the
`assessment/sai-gangadhar` branch.

**GitHub:** `vsaigangadhar-cpu`
**Availability:** approximately 40 hours per week

## What I changed

**Backend** — implemented `getJWTToken()` on the user model (signing `{ id, email }`
with an environment secret), added JSON error middleware, connected MongoDB at
startup, stopped returning the bcrypt password hash in auth responses, hardened
the session cookie, and added an authenticated `GET /api/holdings` backed by a
new `Holding` model.

**Frontend** — replaced the mocked login with a real call to `POST /user/login`
including loading and inline error states, and wired the dashboard's holdings to
the live API through the existing Zustand store without rewriting the components
that consume it.

**Blockchain** — added `APAXGold`, a compliance-gated ERC-20 representing one
gram of vaulted gold per token, backed by a shared `ComplianceRegistry`; mint is
tied to single-use vault deposit references, burn only settles a redemption the
holder opened, and transfers, roles, pause and recovery are enforced through a
single `_update` chokepoint. Covered by 73 tests, with the design, compliance
model and security analysis written up in
[`docs/CONTRACT_DESIGN.md`](docs/CONTRACT_DESIGN.md).

## Frontend B — live dashboard integration

The holdings view is wired to the live API; recent activity is not. Both are
explained below.

**Sequence.** `app/dashboard/page.tsx` calls `fetchHoldings()` from a `useEffect`
on mount → the Zustand action in `lib/store.ts` calls
`getHoldingsApi()` in `lib/services/holdings.api.ts` → that calls
`GET /api/holdings` through the shared `baseAPI` client → the result is mapped
into the store's existing `userHoldings` object.

**What I changed first, and why so little.** The four components that render
holdings (`portfolio-overview`, `asset-allocation-chart`, `zakat-view`,
`redemption-view`) all read `userHoldings` from the store. By keeping that
object's shape and populating it from the API instead of a constant, none of
them needed changing. Only `portfolio-overview` was touched, and only to render
loading and error affordances. The store is the seam: it already sat between the
components and the data, so it was the right place to introduce the fetch.

**Mapping.** The API returns metals keyed by name; the UI model uses flat gram
fields, so the action maps `holdings.gold.amount → goldGrams` and likewise for
silver and platinum. `apxiTokens` is spread through untouched — it is an index
token, not a vaulted metal, so `/api/holdings` deliberately does not provide it.

**State handling** — `holdingsStatus: 'idle' | 'loading' | 'ready' | 'error'`
plus `holdingsError: string | null`:

- **Loading** — values are dimmed via a CSS class. Cards stay mounted; blanking
  a portfolio screen reads as lost data rather than a pending request.
- **Empty** — a user with no holdings is not a special case. The API returns all
  three metals at `0` with HTTP 200, so this is ordinary `ready` data and
  renders as `0.00 g`. No empty-state branch exists, which is a direct benefit
  of the API contract always returning every metal.
- **API error** — status becomes `error`, the last known values stay on screen,
  and a small inline message appears. The portfolio is never blanked.
- **Unauthenticated (401)** — treated separately from a generic failure. The
  action returns `{ unauthenticated: true }` and the page redirects to `/login`
  rather than showing an error box. A network failure is deliberately *not*
  treated as a logout.

**Keeping types honest.** The API contract types (`AssetType`,
`HoldingSummary`, `HoldingsResponse`) live in `web/src/types/api.ts` and are
shared with the Express handler that produces the response, so the two sides
cannot drift silently. The frontend imports them with `import type`, which is
erased at build time and cannot pull server code into the client bundle. The UI
model (`UserHolding`) stays in `lib/store.ts` — it is view state, not contract.
Because TypeScript types are compile-time only, the action also validates the
response shape at runtime before mapping it; a 2xx with a malformed body falls
into the same error state rather than throwing.

**Recent activity remains mocked, deliberately.** The dashboard's audit log is
still seeded from a constant and appended to by a timer. There is no suitable
backend endpoint to wire it to: the existing `GET /activity` is unauthenticated,
backed by in-memory arrays that reset on restart, has no per-user scoping, and
returns a `{deposits, withdrawals}` shape with no overlap with the `AuditLog`
fields the view renders. Pointing the UI at it would show an empty list for
every user. Making it live would require an authenticated, persisted `Activity`
model and a `GET /api/activity` endpoint scoped to the session user — at which
point it would follow exactly the same component → store → API path as holdings.

## Authentication and JWT storage

The assessment says "store the JWT". This implementation stores it as an
**HttpOnly cookie set by the backend**, and deliberately does not persist it in
`localStorage` or any JavaScript-accessible store.

The template had the mismatch the assessment asks candidates to watch for: the
Express middleware read the token from `req.cookies`, while the frontend `fetch`
sent no credentials and CORS used a wildcard origin — three independent reasons
the cookie could never complete a round trip. Rather than replace the backend's
cookie design with client-side token storage, I standardised on the approach the
backend already used and fixed the client to match: `credentials: 'include'` on
requests, and an explicit CORS origin with `Access-Control-Allow-Credentials`.

`HttpOnly` means JavaScript cannot read the session token, so an XSS flaw
anywhere in the app cannot exfiltrate it. The trade-off accepted in exchange is
CSRF exposure, mitigated here with `SameSite=Lax`. The token is still returned
in the login response body so the endpoint is testable with `curl`, but the
frontend does not persist it.

This is an intentional reading of the requirement: the browser does store the
JWT — as an HttpOnly cookie — and the frontend and Express middleware use one
consistent strategy, which is what the assessment asks for.

## Security basics to add next

- **CORS — already implemented.** `app.use(cors({ origin: CLIENT_URL, credentials: true }))`
  in `web/src/index.ts`. An explicit origin is required rather than a wildcard,
  because credentialed requests are rejected by browsers against `*`.
- **Helmet — not installed; a production follow-up.** It would set
  `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options` and
  HSTS. Not added here because the assessment asks not to introduce unnecessary
  dependencies, and this is a note rather than a requirement.
- **Rate limiting — not installed; a production follow-up.** Most valuable on
  the authentication-sensitive endpoints: `POST /user/login` against credential
  stuffing, and `POST /user/password/forgot` against email bombing and account
  enumeration. Per-IP and per-account limits with progressive backoff.

Also worth doing before production: move `/activity` and `/balance` behind
authentication (they are currently open, including their `POST` routes), and fix
the host-header injection in the password-reset URL, which builds the link from
`req.get("host")`.

## Week one priorities

The optional full-stack note — what I would ship first across auth, live
holdings and a safe contract path — is in
[§8 of the contract design doc](docs/CONTRACT_DESIGN.md#8-week-one-ship-plan).

## Implemented vs designed

The distinction matters for reviewing this submission honestly:

| Area | Status |
|---|---|
| JWT auth, holdings API, login flow, dashboard holdings | **Implemented** and verified against a local MongoDB |
| `APAXGold` + `ComplianceRegistry` contracts and tests | **Implemented** and passing locally |
| Frontend/backend blockchain integration | **Designed** — architecture note only, no contract calls exist in the app |
| Event indexing into MongoDB | **Designed** — not built |
| Testnet deployment, role split, monitoring | **Week One plan** — see §8 of the design doc |

## Important implementation note

MongoDB is treated as **application and indexing state**, not as the source of
truth for token balances. Where blockchain and database disagree about token
movements, the chain is authoritative and the database is the thing to repair.
The current `holdings` collection is deliberately shaped so it could become a
projection of on-chain balances.

To be explicit about what this branch does *not* do: the frontend does not make
any contract calls, no blockchain events are indexed into MongoDB, physical gold
custody is not and cannot be enforced by the contract, this is **not** an
ERC-3643 implementation, and nothing is deployed to any network.

## Security finding in the supplied template

During the initial security review of the supplied template, I identified an
unsafe remote-code-execution pattern in the user controller: an
immediately-invoked function that fetched a remote value at module import time
and executed it. Because it ran on import rather than on request, starting the
development server was sufficient to trigger it. A committed environment file
supplied the values it used, and the repository's ignore rules did not cover
that filename.

Handling:

- Identified during repository review, before running any application code.
- The unsafe code and the committed configuration file were removed on this
  branch, in a dedicated commit that documents the reasoning.
- The ignore rules were corrected so a file of that shape cannot be committed
  again.
- **No suspicious endpoint was contacted, and no payload was fetched, decoded or
  executed** at any point during the review.
- No secrets remain in the submitted branch. Note that the original values are
  still present in the upstream history this branch was forked from, which is
  outside my control.

I have kept the detail here deliberately brief. Happy to walk through the
specifics in a review conversation.

## Running the tests

```bash
# contracts
cd smart-contracts && npm install && npm test

# web (Next.js app + Express API share this package)
cd web && npm install && npm run lint && npm run build
```

The contract suite runs without any `.env` present. The Express API needs
`MONGO_URI`, `JWT_SECRET`, `JWT_EXPIRE`, `COOKIE_EXPIRE`, `PORT` and
`CLIENT_URL` — see [`web/src/config/config.env.example`](web/src/config/config.env.example).