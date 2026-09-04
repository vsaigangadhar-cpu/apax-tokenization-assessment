# APX-Gold — Contract Design

Blockchain Task A and Task B of the APAX technical assessment.

This document explains the design decisions behind `APAXGold.sol`,
`ComplianceRegistry.sol` and `IComplianceRegistry.sol`, and how the token would
connect to the existing Next.js frontend and Express/MongoDB backend.

---

## 1. APX-Gold design

### Purpose

APX-Gold (`APX-GOLD`) is an on-chain claim on physical gold held in an APAX
vault. It is not a synthetic or price-tracking instrument: every token in
circulation is meant to correspond to metal that a custodian is holding.

### Relationship to the physical vault

The contract deliberately does **not** try to prove custody. A smart contract
cannot observe a vault. What it does instead is make the two events that change
supply auditable and hard to fake:

- **Minting** is authorised by a *deposit reference* — an identifier for a
  specific custodian allocation record. Each reference can be used once.
- **Burning** can only happen at the end of a redemption that the token holder
  themselves opened.

Everything else — the bar list, the audit reports, the actual movement of metal
— is off-chain. The contract's job is to ensure supply only moves in step with
those off-chain events, and to leave an event trail that can be reconciled
against custodian records.

### Decimals and units

The token uses the ERC-20 default of **18 decimals**, and **one whole token
represents one gram** of allocated gold. So `1e18` base units = 1 g.

18 decimals is the ecosystem default and what wallets, explorers and DEXs
assume; deviating from it is a common source of display bugs. Gram-denomination
matches how the existing APAX dashboard already presents holdings (`156.75 g`).

Amounts are stored as `uint256` base units. Grams are never represented as
floating point on-chain.

### Minting against deposit references

```solidity
function mintAgainstDeposit(address to, uint256 amount, bytes32 depositRef)
    external onlyRole(MINTER_ROLE)
```

- `depositRef` identifies the vault deposit, e.g. the hash of the custodian's
  allocation record.
- `depositRefUsed[depositRef]` makes each reference single-use, so the same
  physical deposit cannot be minted against twice — including by a compromised
  or careless minter.
- The recipient must pass the compliance check.
- The `Minted(to, amount, depositRef)` event is what the backend indexes to
  reconcile on-chain supply against custodian records.

### Redemption lifecycle

Redemption is three steps, and the burn is deliberately last:

1. **`requestRedemption(amount, redemptionRef)`** — called by the *holder*.
   Their tokens move into escrow on the token contract itself.
2. **Off-chain**: the redemption desk verifies the request and arranges release
   of the metal. Nothing on-chain happens during this window.
3. **`settleRedemption(redemptionRef)`** — called by `REDEEMER_ROLE` after the
   metal has actually left the vault. The escrowed tokens are burned.

**`cancelRedemption(redemptionRef)`** unwinds a pending request without burning,
returning the escrowed tokens to the holder. It is callable by the holder *or*
the redeemer desk, so a request cannot be stranded if either side goes quiet.

### Why escrow before settlement

Escrow is the detail that makes the burn safe to automate.

Without it, between "holder requests redemption" and "desk settles it" the
holder still controls the tokens and could transfer or sell them while the vault
is arranging physical delivery — the desk would then burn tokens that no longer
belong to the requester, or fail to burn at all.

With escrow, the tokens are immobilised at request time. When the desk settles,
the exact amount is already held by the contract and the burn cannot fail or
hit the wrong balance.

### Why burn happens after settlement, not at request

Burning at request time would destroy the holder's claim while the gold is still
in the vault. If the redemption then failed — failed KYC re-check, delivery
refused, holder cancels — there would be no on-chain record of what they were
owed. Burning last means the token exists for exactly as long as the claim does.

---

## 2. ERC-20 vs ERC-3643 vs hybrid

### Plain ERC-20

**For:** universally supported. Every wallet, explorer, custodian, indexer and
DEX understands it with no integration work. Minimal surface area to audit.

**Against:** it has **no notion of who may hold the token**. Any address can
receive from any other. For a KYC'd claim on physical gold that is
disqualifying — there is no way to stop a sanctioned address receiving tokens,
no way to freeze an account under investigation, and no way to recover a balance
under a court order.

### ERC-3643 (T-REX)

**For:** purpose-built for regulated assets. On-chain identity via ONCHAINID,
claim issuers and verifiers, and a modular compliance contract where rules
(jurisdiction caps, investor limits, holding periods) are composed as pluggable
modules. Well-suited to a security token with genuinely complex, multi-
jurisdiction rules.

**Against:** substantially more infrastructure — identity registry, identity
storage, claim topics registry, trusted issuers registry, compliance modules —
all of which must be deployed, operated, secured and explained. For a product
whose entire compliance rule today is *"is this wallet KYC-cleared and not
frozen?"*, that is a great deal of machinery for one boolean.

### Chosen approach: ERC-20 with an external compliance registry

**This implementation is not ERC-3643 and does not claim to be.** It is a
standard ERC-20 with a single compliance chokepoint.

- The token is a normal ERC-20 (OpenZeppelin v5) plus `ERC20Pausable` and
  `AccessControl`.
- Compliance state lives in a separate `ComplianceRegistry` contract behind the
  narrow `IComplianceRegistry` interface (`isVerified`, `isFrozen`).
- OpenZeppelin v5 funnels **every** balance movement — `transfer`,
  `transferFrom`, `_mint`, `_burn` — through one internal function, `_update`.
  Overriding it once gives a single place where compliance is enforced and a
  single place to audit. There is no code path around it.

**Why this is the right choice here:**

1. It delivers ERC-3643's core guarantee — no unauthorised holder — at a
   fraction of the complexity.
2. It keeps full ERC-20 compatibility, so the existing frontend can read
   balances with standard `ethers`/`wagmi` calls and no custom ABI knowledge.
3. Because compliance sits behind an interface, a real ERC-3643 identity
   registry can be adapted in later without touching the token — the migration
   path stays open.
4. One registry serves APX-Gold, APX-Silver and APX-Platinum, so a user verified
   once is verified across the product line.

**The honest trade-off:** we do not get ERC-3643's modular rule engine or its
standardised interoperability with other T-REX tooling. If APAX later needs
per-jurisdiction rules, investor caps or transfer windows, this design would
need either a richer compliance contract or a migration to ERC-3643. That is
the point at which the added complexity would start paying for itself.

---

## 3. Roles

`AccessControl` with five separated roles rather than a single owner:

| Role | Responsibility |
|---|---|
| `MINTER_ROLE` | `mintAgainstDeposit` — issue tokens against a confirmed vault deposit |
| `REDEEMER_ROLE` | `settleRedemption` / `cancelRedemption` — close out redemptions once metal has moved |
| `PAUSER_ROLE` | `pause` / `unpause` — halt all transfers in an incident |
| `RECOVERY_ROLE` | `forcedTransfer` — move tokens without holder consent (court order, lost keys, sanctioned holder) |
| `GOVERNANCE_ROLE` | `setComplianceRegistry` — repoint the compliance source |

### Why they are separated

These capabilities have very different blast radii and very different operating
tempos. Minting is routine and follows vault deposits. Pausing is an emergency
action. Forced transfer is a legal action that should be rare and reviewed.
Collapsing them into one owner key means the key that signs daily mints is also
the key that can seize any balance — so a single compromise is total.

Separation also enables sensible custody: a warm key for minting, a multisig for
recovery and governance, a fast-access key for pausing.

### ⚠️ Current centralisation — acknowledged limitation

**The constructor grants all five roles to the deploying admin address.** That
is deliberate for the assessment — a fresh deployment is immediately usable and
the tests can exercise every path — but it means the deployed contract as-is has
exactly the single-point-of-compromise problem the role split exists to avoid.

**Before any production deployment**, roles should be reassigned:

- `RECOVERY_ROLE` and `GOVERNANCE_ROLE` → multisig with a timelock; these are
  the two that can take user funds or halt the token
- `DEFAULT_ADMIN_ROLE` → multisig, and revoked from the deployer EOA
- `MINTER_ROLE` → the vault operations service key, rotated regularly
- `PAUSER_ROLE` → a fast-access key or incident-response multisig; pausing is
  the one privileged action where speed matters more than deliberation

This is an operational deployment task, not a code change — `AccessControl`
already supports it via `grantRole`/`renounceRole`.

---

## 4. Compliance model

### The two states

| State | Meaning |
|---|---|
| **Verified** | KYC completed and accepted. Set by `verify`, cleared by `revoke`. |
| **Frozen** | Verified, but temporarily blocked — sanctions screening hit, pending investigation. Set by `freeze`, cleared by `unfreeze`. |

They are separate on purpose. Freezing does not discard KYC, so lifting a freeze
does not require re-running onboarding.

`canTransfer(account)` returns `isVerified(account) && !isFrozen(account)`.

The registry is deliberately dumb: it records decisions the compliance desk has
already made off-chain. It does not make them.

### Enforcement point

```solidity
function _update(address from, address to, uint256 value)
    internal override(ERC20, ERC20Pausable)
{
    if (from != address(0) && !canTransfer(from)) revert SenderNotAllowed(from);
    _checkRecipient(to);
    super._update(from, to, value);
}
```

- **Transfers**: both sender and recipient must pass.
- **Mint** (`from == address(0)`): only the recipient is checked — there is no
  sender.
- **Burn** (`to == address(0)`): only the sender is checked — there is no
  recipient.
- **The token contract itself** is always eligible (`canTransfer` returns true
  for `address(this)`), so redemption escrow can move in and out.
- `super._update` resolves through `ERC20Pausable`, so **the pause check applies
  to everything above** — including mint, burn and forced transfer.

### Why `approve` is not compliance-gated but `transferFrom` is

`approve` moves no value. It records an allowance. An unverified address holding
an allowance it can never exercise is harmless.

The gate belongs where value actually moves — `transferFrom`, which routes
through `_update` like everything else. Gating `approve` would add surface
without adding safety, and would break a legitimate pattern: a user can approve
a contract or spender *before* their KYC completes, and the approval simply
cannot be used until they are verified.

This is tested explicitly: an unverified account can hold an allowance, and
`transferFrom` to it still reverts with `RecipientNotAllowed`.

---

## 5. Redemption model

```
holder                     token contract                 APAX desk (off-chain)
  │                              │                                │
  ├─ requestRedemption(amt,ref) ─►                                │
  │                              ├─ tokens escrowed on contract   │
  │                              ├─ RedemptionRequested event ───►│
  │                              │                                │
  │                              │        verify request, arrange │
  │                              │        release of metal        │
  │                              │        (entirely off-chain)    │
  │                              │                                │
  │                              ◄──── settleRedemption(ref) ─────┤
  │                              ├─ burn escrowed tokens          │
  │                              ├─ RedemptionSettled event ─────►│
```

**Cancellation:** `cancelRedemption(ref)` returns escrowed tokens to the holder
without burning. Callable by the holder or by `REDEEMER_ROLE`. If the holder's
compliance status was revoked while the request was pending, the return transfer
fails the recipient check — the resolution is to restore their compliance status
(or settle the redemption), **not** to force-move the escrow. This is tested.

### What the contract does *not* guarantee

**The contract cannot enforce that gold actually left the vault.**
`settleRedemption` burns tokens because an authorised role asserted that the
physical release happened. If that role lies or is compromised, tokens are
burned without metal moving.

That risk is managed operationally — custodian attestations, independent audit,
segregation of the redeemer role — not by the contract. The contract's
contribution is that the burn is *recorded*, *attributable to a specific
redemption reference*, and *reconcilable* against the custodian's records.

---

## 6. Security risks

### Addressed by this implementation

| Risk | Mitigation |
|---|---|
| **Unauthorised minting** | `MINTER_ROLE` gated; every mint consumes a single-use `depositRef` |
| **Mint replay against one deposit** | `depositRefUsed` mapping; second use reverts `DepositRefAlreadyUsed` |
| **Unauthorised burning** | No public burn. Burns happen only via `settleRedemption` on a redemption the *holder* opened |
| **Unauthorised holders** | Single `_update` chokepoint checks the registry on every movement |
| **Compliance bypass via `transferFrom`** | Same chokepoint; tested |
| **Escrow theft by a privileged role** | `forcedTransfer` rejects `from == address(this)` (`EscrowNotRecoverable`). Escrow is unwound only via settle or cancel; tested |
| **Registry misconfiguration bricking the token** | `setComplianceRegistry` rejects the zero address and any non-contract (`NotAContract`); tested |
| **Accounting drift** | `escrowedForRedemption` is asserted equal to `balanceOf(address(this))` across the full lifecycle in tests |
| **Reentrancy** | No ETH handling, no untrusted callbacks in state-changing paths. State is written before the single internal transfer in each flow |
| **Emergency stop** | `ERC20Pausable`; the pause applies to transfers, mints, burns and forced transfers alike |

### Remaining operational and design risks

| Risk | Status |
|---|---|
| **Privileged-role centralisation** | **Open by design in this build.** The deployer holds all five roles. Production must move them to multisig/timelock (§3) |
| **Forced-transfer authority** | `RECOVERY_ROLE` can move any non-escrowed balance without consent. Intentional — it is the only way to recover a frozen or key-lost balance — but it is real seizure power. Mitigations are operational: multisig, timelock, and the on-chain `ForcedTransfer` event with a human-readable reason |
| **Compliance-registry dependency** | The token trusts the registry completely. A compromised `COMPLIANCE_ROLE` can verify an attacker or freeze legitimate holders |
| **External call on the transfer path** | Every movement calls into the registry. A malicious or broken registry could revert or burn gas on all transfers — a denial of service. Bounded by the code-size check plus governance control of the address; recoverable by repointing |
| **Pause and recovery interact** | A pause blocks `forcedTransfer` too. Deliberate — one chokepoint means one behaviour — but responders must unpause before recovering. Tested so the behaviour is explicit, not a surprise |
| **Off-chain custody trust** | The contract cannot verify the vault. Minting and settlement both rest on off-chain attestation. This is the single largest trust assumption in the system |
| **No on-chain pricing** | Deliberately no oracle. Valuation happens in the application layer. This avoids oracle-manipulation risk entirely, at the cost of on-chain price data |
| **Not upgradeable** | No proxy. Fixing a contract bug means deploying a new token and migrating balances. The trade-off is deliberate: no proxy admin, no storage-layout hazard, no upgrade key to compromise. For a production issuance, an upgrade path would need an explicit decision |
| **`verifyBatch` gas bound** | Unbounded loop; a caller can exceed the block gas limit. Caller-side concern, no funds at risk |
| **Unaccounted transfers to the token contract** | **Low severity.** The contract accepts ordinary ERC-20 transfers to its own address, and those tokens are invisible to `escrowedForRedemption`. See below |

### Unaccounted transfers to the token contract (low severity)

`requestRedemption` legitimately transfers tokens to `address(this)` — that is how
escrow works — so `canTransfer(address(this))` returns `true` and the token
contract is a valid transfer recipient.

The side effect is that an **ordinary ERC-20 transfer can also send tokens to
`address(this)`**, whether by user error or deliberately. Those tokens are not
part of any redemption, so they are **not represented in
`escrowedForRedemption`**, and the contract has **no recovery path for them**:
`settleRedemption` and `cancelRedemption` only move amounts recorded against a
redemption reference, and `forcedTransfer` refuses `from == address(this)`. Such
tokens are effectively stuck.

The practical consequence is that the accounting invariant can diverge in one
direction: `balanceOf(address(this))` may **exceed** `escrowedForRedemption`.
Redemptions are unaffected — settlement and cancellation still find sufficient
balance — and no user's funds can be taken, which is why this is classified as a
design limitation rather than a vulnerability. It is also the familiar ERC-20
footgun of sending tokens to a token contract, not something specific to this
design.

This is a **known limitation of the current assessment implementation** and is
deliberately left unfixed here to keep the escrow path simple. Production
hardening would explicitly separate legitimate escrow deposits from arbitrary
inbound transfers — for example by rejecting `address(this)` as a recipient in
the general transfer path and having `requestRedemption` perform the escrow
movement through a dedicated internal route that checks the sender directly.

---

## 7. Frontend / backend integration (Task B)

> This section is an architecture note. **The current Next.js frontend and
> Express backend do not implement any of these blockchain calls yet** — the
> dashboard reads holdings from `GET /api/holdings`, which is backed by MongoDB.

### Frontend (Next.js + ethers/wagmi)

Because APX-Gold is a standard ERC-20, reads need no custom tooling:

- **`balanceOf(address)`** — the user's on-chain gram balance. With `wagmi`,
  `useReadContract`; with `ethers`, a `Contract` instance against a provider.
- **`allowance(owner, spender)`** — needed before any flow where a contract
  spends on the user's behalf; drives the familiar "approve then act" UX.
- **Token metadata** — `name`, `symbol`, `decimals`. Read `decimals()` rather
  than hardcoding 18, and format with `formatUnits`. Never use JavaScript
  floating point for balances; keep `bigint` to the display boundary.
- **Redemption state** — `redemptions(ref)` for a specific request, plus
  `RedemptionRequested` / `RedemptionSettled` / `RedemptionCancelled` events for
  history.

**Transaction status must be modelled separately from database state.** A
submitted transaction is not a settled fact: it can be pending, mined, reorged
out, or replaced. The UI should track `idle → signing → pending → confirmed →
failed` for the transaction itself, and treat the backend's view as a separate,
eventually-consistent source. Showing a redemption as complete because a wallet
returned a transaction hash would be wrong.

### Backend (Express + MongoDB)

**The chain is authoritative for token balances and supply. MongoDB is an index,
not a substitute.**

- **On-chain events are the source of truth for token movements.** An indexer
  subscribes to `Minted`, `Transfer`, `RedemptionRequested`, `RedemptionSettled`,
  `RedemptionCancelled` and `ForcedTransfer`, and writes them to MongoDB keyed
  by transaction hash and log index (idempotent, so replays are safe).
- **MongoDB provides query-friendly application state** — per-user history,
  dashboard aggregates, redemption workflow status, KYC records. These are
  things you cannot practically query from an RPC node, and they are what the
  existing `/api/holdings` endpoint is for.
- **Confirmations before trust**: events should only be treated as final after a
  chain-appropriate confirmation depth, and the indexer must handle reorgs by
  rolling back and re-applying from the last safe block.
- **Reconciliation must be possible and routine**: a periodic job compares
  indexed balances against `balanceOf` on-chain, and `totalSupply` against the
  custodian's reported vault holdings. Any divergence is an alert. If MongoDB
  and the chain disagree, **the chain wins and MongoDB is repaired**.

The current `holdings` collection is exactly the right shape for this: it would
become a projection of on-chain balances rather than independently maintained
data.

### Redemption — what must be true before burn

The backend should only mark a redemption **settled** when **both** conditions
hold:

1. **The off-chain checks have completed** — the request is validated, the
   holder's compliance status is current, and the custodian has confirmed the
   metal has been released.
2. **The on-chain `settleRedemption` transaction has succeeded** and reached the
   required confirmation depth, evidenced by the `RedemptionSettled` event.

Either one alone is insufficient. Marking it settled on the off-chain approval
alone would show a burn that never happened; marking it on transaction
submission alone would ignore the possibility of failure or reorg. Until both
are true, the redemption stays `pending` — which is also exactly the state the
escrow reflects on-chain.

---

## 8. Week One ship plan

The optional full-stack note. Working auth, a live holdings endpoint and the
contract suite already exist on this branch; **none of the items below are
implemented**, and they are ordered by what unblocks the most.

1. **Harden the auth that already works.** Add Helmet and rate limiting on
   `POST /user/login` and `/user/password/forgot`, put `/activity` and
   `/balance` behind `isAuthenticatedUser`, fix the host-header injection in
   the password-reset link, and add a route guard so `/dashboard` cannot be
   opened without a session.
2. **Make holdings writable and real.** Add the authenticated write paths that
   maintain the `holdings` collection, and back it with the vault operations
   feed rather than seeded data — the read endpoint and its dashboard wiring
   are done, but nothing populates it in production.
3. **Ship recent activity.** Add a persisted, per-user `Activity` model and
   `GET /api/activity`, then wire the Proof-of-Reserve view through the same
   component → store → API path already used for holdings.
4. **Deploy the contracts to a testnet.** `ComplianceRegistry` first, then
   `APAXGold` pointing at it, verified on Etherscan so the compliance logic is
   publicly auditable.
5. **Split the privileged roles immediately after deploy.** Move recovery,
   governance and admin to a multisig, minting to the vault operations key,
   pausing to a fast-access key, then renounce the deployer's roles — the
   constructor grants all five to one address, which is right for tests and
   wrong for staging.
6. **Stand up an event indexer** for `Minted`, `Transfer`, the redemption
   events and `ForcedTransfer`, writing to MongoDB keyed by transaction hash
   and log index so replays are idempotent, with reorg rollback and a
   confirmation threshold — then repoint `GET /api/holdings` at indexed
   on-chain balances so the dashboard reads a projection of chain state rather
   than a parallel source of truth.
7. **Add wallet reads and reconciliation.** `balanceOf`, `allowance` and
   `decimals` via wagmi with transaction lifecycle modelled separately from
   backend state; plus a scheduled job comparing indexed balances against
   `balanceOf` and `totalSupply` against custodian-reported vault holdings,
   alerting on divergence and on every `ForcedTransfer` and `Paused`.
8. **Run a security pass before anything touches production.** Test suite in
   CI, Slither or an equivalent static analyser, and an external review of the
   role split and the redemption escrow before real metal is represented
   on-chain.
