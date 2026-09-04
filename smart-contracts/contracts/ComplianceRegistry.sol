// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./IComplianceRegistry.sol";

/// @title APAX compliance registry
/// @notice On-chain KYC / freeze state shared by every APAX metal token.
/// @dev One registry serves APX-Gold, APX-Silver and APX-Platinum, so a user
///      verified once is verified across the product. Deliberately dumb: it
///      stores decisions made off-chain by the compliance desk, it does not
///      make them.
contract ComplianceRegistry is AccessControl, IComplianceRegistry {
    /// @notice Can verify, revoke, freeze and unfreeze accounts.
    bytes32 public constant COMPLIANCE_ROLE = keccak256("COMPLIANCE_ROLE");

    mapping(address => bool) private _verified;
    mapping(address => bool) private _frozen;

    error ZeroAddress();

    event AccountVerified(address indexed account);
    event AccountRevoked(address indexed account);
    event AccountFrozen(address indexed account);
    event AccountUnfrozen(address indexed account);

    /// @param admin Address receiving both admin and initial compliance rights.
    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(COMPLIANCE_ROLE, admin);
    }

    /// @inheritdoc IComplianceRegistry
    function isVerified(address account) external view returns (bool) {
        return _verified[account];
    }

    /// @inheritdoc IComplianceRegistry
    function isFrozen(address account) external view returns (bool) {
        return _frozen[account];
    }

    /// @notice Marks `account` as KYC-cleared.
    /// @dev Idempotent on purpose. Batch onboarding retries should not revert
    ///      halfway through and leave the desk guessing which addresses landed.
    function verify(address account) public onlyRole(COMPLIANCE_ROLE) {
        if (account == address(0)) revert ZeroAddress();
        if (_verified[account]) return;
        _verified[account] = true;
        emit AccountVerified(account);
    }

    /// @notice Verifies several accounts in one transaction.
    function verifyBatch(address[] calldata accounts) external onlyRole(COMPLIANCE_ROLE) {
        for (uint256 i = 0; i < accounts.length; i++) {
            verify(accounts[i]);
        }
    }

    /// @notice Removes KYC clearance from `account`.
    /// @dev Balances are not touched. The holder keeps custody but can no
    ///      longer move tokens; recovery goes through the token's forced
    ///      transfer, which leaves an auditable trail.
    function revoke(address account) external onlyRole(COMPLIANCE_ROLE) {
        if (!_verified[account]) return;
        _verified[account] = false;
        emit AccountRevoked(account);
    }

    /// @notice Freezes `account` without clearing its KYC status.
    function freeze(address account) external onlyRole(COMPLIANCE_ROLE) {
        if (account == address(0)) revert ZeroAddress();
        if (_frozen[account]) return;
        _frozen[account] = true;
        emit AccountFrozen(account);
    }

    /// @notice Lifts a freeze on `account`.
    function unfreeze(address account) external onlyRole(COMPLIANCE_ROLE) {
        if (!_frozen[account]) return;
        _frozen[account] = false;
        emit AccountUnfrozen(account);
    }
}
