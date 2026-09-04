// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "./IComplianceRegistry.sol";

/// @title APX-Gold
/// @notice Compliance-gated ERC-20 claim on gold held in an APAX vault.
///         One whole token represents one gram of allocated gold.
/// @dev Supply is not fixed: it tracks the vault. Minting is authorised by a
///      deposit reference, burning only settles a redemption the holder
///      themselves opened. Transfers are gated on an external compliance
///      registry so KYC state is shared with the sibling silver and platinum
///      tokens rather than duplicated per contract.
contract APAXGold is ERC20, ERC20Pausable, AccessControl {
    /// @notice Mints against confirmed vault deposits.
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    /// @notice Settles or cancels redemptions once the metal has been released.
    bytes32 public constant REDEEMER_ROLE = keccak256("REDEEMER_ROLE");
    /// @notice Halts all transfers.
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    /// @notice Moves tokens without holder consent. Court orders, lost keys.
    bytes32 public constant RECOVERY_ROLE = keccak256("RECOVERY_ROLE");
    /// @notice Repoints the compliance registry.
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");

    enum RedemptionStatus {
        None,
        Pending,
        Settled,
        Cancelled
    }

    struct Redemption {
        address holder;
        uint256 amount;
        RedemptionStatus status;
    }

    /// @notice KYC and freeze state consulted on every transfer.
    IComplianceRegistry public complianceRegistry;

    /// @notice Deposit references already minted against, to block replays.
    mapping(bytes32 => bool) public depositRefUsed;

    /// @notice Redemptions by reference. Escrowed tokens live on this contract.
    mapping(bytes32 => Redemption) public redemptions;

    /// @notice Total tokens currently escrowed against pending redemptions.
    uint256 public escrowedForRedemption;

    error ZeroAddress();
    error ZeroAmount();
    error NotAContract(address target);
    error EscrowNotRecoverable();
    error DepositRefAlreadyUsed(bytes32 depositRef);
    error RedemptionRefAlreadyUsed(bytes32 redemptionRef);
    error RedemptionNotPending(bytes32 redemptionRef);
    error NotRedemptionHolder(bytes32 redemptionRef);
    error SenderNotAllowed(address from);
    error RecipientNotAllowed(address to);

    event Minted(address indexed to, uint256 amount, bytes32 indexed depositRef);
    event RedemptionRequested(bytes32 indexed redemptionRef, address indexed holder, uint256 amount);
    event RedemptionSettled(bytes32 indexed redemptionRef, address indexed holder, uint256 amount);
    event RedemptionCancelled(bytes32 indexed redemptionRef, address indexed holder, uint256 amount);
    event ForcedTransfer(address indexed from, address indexed to, uint256 amount, string reason);
    event ComplianceRegistryUpdated(address indexed previous, address indexed current);

    /// @param admin Root admin. Receives every operational role at deploy time
    ///        so a fresh deployment is usable; production splits these across
    ///        separate multisigs before the token goes live.
    /// @param registry Compliance registry to consult on transfers.
    constructor(
        address admin,
        IComplianceRegistry registry
    ) ERC20("APAX Gold", "APX-GOLD") {
        if (admin == address(0) || address(registry) == address(0)) revert ZeroAddress();

        complianceRegistry = registry;
        emit ComplianceRegistryUpdated(address(0), address(registry));

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
        _grantRole(REDEEMER_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(RECOVERY_ROLE, admin);
        _grantRole(GOVERNANCE_ROLE, admin);
    }

    // =====================================================
    // MINT — tied to vault deposit
    // =====================================================

    /// @notice Mints `amount` grams to `to` against a confirmed vault deposit.
    /// @param to Recipient. Must be verified and unfrozen.
    /// @param amount Grams, in wei-scale units.
    /// @param depositRef Identifier of the vault deposit, e.g. the hash of the
    ///        custodian's bar allocation record. Single use.
    /// @dev The custodian attestation lives off-chain; this only records that a
    ///      given deposit has been drawn down exactly once.
    function mintAgainstDeposit(
        address to,
        uint256 amount,
        bytes32 depositRef
    ) external onlyRole(MINTER_ROLE) {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (depositRefUsed[depositRef]) revert DepositRefAlreadyUsed(depositRef);

        depositRefUsed[depositRef] = true;
        _mint(to, amount);

        emit Minted(to, amount, depositRef);
    }

    // =====================================================
    // REDEEM — burn only after the holder asks and the desk settles
    // =====================================================

    /// @notice Opens a redemption, escrowing the holder's tokens on this
    ///         contract until the physical metal is released or the request is
    ///         cancelled.
    /// @dev Holder-initiated by design: no role can unilaterally burn a
    ///      balance. The escrow is what makes the burn safe to automate — the
    ///      tokens are already immobilised when the desk acts, so the holder
    ///      cannot spend them while the vault is arranging delivery.
    function requestRedemption(uint256 amount, bytes32 redemptionRef) external {
        if (amount == 0) revert ZeroAmount();
        if (redemptions[redemptionRef].status != RedemptionStatus.None) {
            revert RedemptionRefAlreadyUsed(redemptionRef);
        }

        redemptions[redemptionRef] = Redemption({
            holder: msg.sender,
            amount: amount,
            status: RedemptionStatus.Pending
        });
        escrowedForRedemption += amount;

        // Reverts through _update if the caller is not transfer-eligible.
        _transfer(msg.sender, address(this), amount);

        emit RedemptionRequested(redemptionRef, msg.sender, amount);
    }

    /// @notice Burns the escrowed tokens for a redemption the vault has
    ///         fulfilled.
    /// @dev Called only after off-chain confirmation that the metal left the
    ///      vault. Burning earlier would destroy the holder's claim while the
    ///      bar is still in custody.
    function settleRedemption(bytes32 redemptionRef) external onlyRole(REDEEMER_ROLE) {
        Redemption storage redemption = redemptions[redemptionRef];
        if (redemption.status != RedemptionStatus.Pending) {
            revert RedemptionNotPending(redemptionRef);
        }

        redemption.status = RedemptionStatus.Settled;
        uint256 amount = redemption.amount;
        escrowedForRedemption -= amount;

        _burn(address(this), amount);

        emit RedemptionSettled(redemptionRef, redemption.holder, amount);
    }

    /// @notice Returns escrowed tokens to the holder without burning.
    /// @dev Open to the redeemer desk and to the holder, so a request cannot be
    ///      left stranded if the desk goes quiet.
    function cancelRedemption(bytes32 redemptionRef) external {
        Redemption storage redemption = redemptions[redemptionRef];
        if (redemption.status != RedemptionStatus.Pending) {
            revert RedemptionNotPending(redemptionRef);
        }
        if (msg.sender != redemption.holder && !hasRole(REDEEMER_ROLE, msg.sender)) {
            revert NotRedemptionHolder(redemptionRef);
        }

        redemption.status = RedemptionStatus.Cancelled;
        uint256 amount = redemption.amount;
        escrowedForRedemption -= amount;

        _transfer(address(this), redemption.holder, amount);

        emit RedemptionCancelled(redemptionRef, redemption.holder, amount);
    }

    // =====================================================
    // ADMIN
    // =====================================================

    /// @notice Halts every transfer, mint and redemption movement.
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /// @notice Resumes transfers.
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    /// @notice Moves tokens between addresses without the holder's signature.
    /// @dev Exists because a revoked or frozen holder can otherwise strand
    ///      their balance forever. Deliberately loud: it takes a dedicated
    ///      role, records a human-readable reason, and bypasses the compliance
    ///      gate on `from` (the whole point is that `from` is blocked) while
    ///      still enforcing it on `to`.
    ///
    ///      Tokens escrowed against pending redemptions are explicitly out of
    ///      reach: draining them would leave `settleRedemption` unable to burn
    ///      and `escrowedForRedemption` disagreeing with the real balance. A
    ///      redemption is unwound through settle or cancel, never through here.
    function forcedTransfer(
        address from,
        address to,
        uint256 amount,
        string calldata reason
    ) external onlyRole(RECOVERY_ROLE) {
        if (from == address(0) || to == address(0)) revert ZeroAddress();
        if (from == address(this)) revert EscrowNotRecoverable();
        if (amount == 0) revert ZeroAmount();
        _checkRecipient(to);

        // super._update skips the compliance gate in _update.
        super._update(from, to, amount);

        emit ForcedTransfer(from, to, amount, reason);
    }

    /// @notice Points the token at a different compliance registry.
    /// @dev Every transfer calls into this address, so an EOA or an empty
    ///      address here halts the token until governance repoints it. The
    ///      code-size check rejects the most likely mistake cheaply; it cannot
    ///      prove the target implements the interface correctly, which stays a
    ///      governance responsibility.
    function setComplianceRegistry(
        IComplianceRegistry registry
    ) external onlyRole(GOVERNANCE_ROLE) {
        if (address(registry) == address(0)) revert ZeroAddress();
        if (address(registry).code.length == 0) {
            revert NotAContract(address(registry));
        }
        address previous = address(complianceRegistry);
        complianceRegistry = registry;
        emit ComplianceRegistryUpdated(previous, address(registry));
    }

    // =====================================================
    // VIEWS
    // =====================================================

    /// @notice Whether `account` may currently send or receive tokens.
    function canTransfer(address account) public view returns (bool) {
        if (account == address(this)) return true;
        return complianceRegistry.isVerified(account) && !complianceRegistry.isFrozen(account);
    }

    // =====================================================
    // INTERNAL
    // =====================================================

    function _checkRecipient(address to) private view {
        if (to != address(0) && !canTransfer(to)) revert RecipientNotAllowed(to);
    }

    /// @dev Single chokepoint for compliance. Mint (`from == 0`) checks only
    ///      the recipient, burn (`to == 0`) only the sender, and this contract
    ///      is always eligible so redemption escrow can move.
    function _update(
        address from,
        address to,
        uint256 value
    ) internal override(ERC20, ERC20Pausable) {
        if (from != address(0) && !canTransfer(from)) revert SenderNotAllowed(from);
        _checkRecipient(to);

        super._update(from, to, value);
    }
}
