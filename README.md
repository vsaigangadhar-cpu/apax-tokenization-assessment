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