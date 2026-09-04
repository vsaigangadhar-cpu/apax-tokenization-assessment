// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Compliance registry interface
/// @notice Minimal surface a metal token needs from whatever holds KYC state.
/// @dev Kept deliberately narrow so the registry can be swapped for an
///      ERC-3643 identity registry later without touching the token.
interface IComplianceRegistry {
    /// @notice Whether `account` is cleared to send or receive tokens.
    function isVerified(address account) external view returns (bool);

    /// @notice Whether `account` is frozen despite being verified.
    /// @dev Sanctions hits and pending investigations land here, so a freeze
    ///      can be lifted without re-running KYC.
    function isFrozen(address account) external view returns (bool);
}
