import { expect } from "chai";
import { network } from "hardhat";

const DEPOSIT_REF = "0x" + "11".repeat(32);
const DEPOSIT_REF_2 = "0x" + "22".repeat(32);
const REDEMPTION_REF = "0x" + "aa".repeat(32);
const REDEMPTION_REF_2 = "0x" + "bb".repeat(32);

describe("APAXGold", function () {
    /**
     * Deploys a registry plus token, with `holder1` and `holder2` already
     * KYC-verified and `holder1` funded with 100 grams. `outsider` is
     * deliberately left unverified.
     */
    async function deployFixture() {
        const { ethers } = await network.connect();

        const [admin, holder1, holder2, outsider, attacker] =
            await ethers.getSigners();

        const Registry = await ethers.getContractFactory("ComplianceRegistry");
        const registry = await Registry.deploy(admin.address);
        await registry.waitForDeployment();

        const APAXGold = await ethers.getContractFactory("APAXGold");
        const token = await APAXGold.deploy(
            admin.address,
            await registry.getAddress()
        );
        await token.waitForDeployment();

        await registry.verifyBatch([
            admin.address,
            holder1.address,
            holder2.address
        ]);

        const grams = (n: string) => ethers.parseEther(n);

        await token.mintAgainstDeposit(holder1.address, grams("100"), DEPOSIT_REF);

        return {
            token,
            registry,
            admin,
            holder1,
            holder2,
            outsider,
            attacker,
            ethers,
            grams
        };
    }

    // =====================================================
    // DEPLOYMENT
    // =====================================================
    describe("Deployment", function () {
        it("Should set name, symbol and decimals", async function () {
            const { token } = await deployFixture();
            expect(await token.name()).to.equal("APAX Gold");
            expect(await token.symbol()).to.equal("APX-GOLD");
            expect(await token.decimals()).to.equal(18n);
        });

        it("Should grant every operational role to the admin", async function () {
            const { token, admin } = await deployFixture();
            for (const role of [
                await token.DEFAULT_ADMIN_ROLE(),
                await token.MINTER_ROLE(),
                await token.REDEEMER_ROLE(),
                await token.PAUSER_ROLE(),
                await token.RECOVERY_ROLE(),
                await token.GOVERNANCE_ROLE()
            ]) {
                expect(await token.hasRole(role, admin.address)).to.equal(true);
            }
        });

        it("Should start with no supply beyond what was minted", async function () {
            const { token, grams } = await deployFixture();
            expect(await token.totalSupply()).to.equal(grams("100"));
        });

        it("Should reject a zero-address registry", async function () {
            const { ethers, admin } = await deployFixture();
            const APAXGold = await ethers.getContractFactory("APAXGold");
            await expect(
                APAXGold.deploy(admin.address, ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(APAXGold, "ZeroAddress");
        });
    });

    // =====================================================
    // MINT — tied to vault deposit
    // =====================================================
    describe("Mint", function () {
        it("Should mint to a verified holder and emit Minted", async function () {
            const { token, holder2, grams } = await deployFixture();
            await expect(
                token.mintAgainstDeposit(holder2.address, grams("50"), DEPOSIT_REF_2)
            )
                .to.emit(token, "Minted")
                .withArgs(holder2.address, grams("50"), DEPOSIT_REF_2);

            expect(await token.balanceOf(holder2.address)).to.equal(grams("50"));
            expect(await token.totalSupply()).to.equal(grams("150"));
        });

        it("Should mark the deposit reference as used", async function () {
            const { token } = await deployFixture();
            expect(await token.depositRefUsed(DEPOSIT_REF)).to.equal(true);
            expect(await token.depositRefUsed(DEPOSIT_REF_2)).to.equal(false);
        });

        it("Should reject a replayed deposit reference", async function () {
            const { token, holder1, grams } = await deployFixture();
            await expect(
                token.mintAgainstDeposit(holder1.address, grams("1"), DEPOSIT_REF)
            )
                .to.be.revertedWithCustomError(token, "DepositRefAlreadyUsed")
                .withArgs(DEPOSIT_REF);
        });

        it("Should reject minting from a non-minter", async function () {
            const { token, attacker, holder1, grams } = await deployFixture();
            await expect(
                token
                    .connect(attacker)
                    .mintAgainstDeposit(holder1.address, grams("1"), DEPOSIT_REF_2)
            ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
        });

        it("Should reject minting to an unverified recipient", async function () {
            const { token, outsider, grams } = await deployFixture();
            await expect(
                token.mintAgainstDeposit(outsider.address, grams("1"), DEPOSIT_REF_2)
            )
                .to.be.revertedWithCustomError(token, "RecipientNotAllowed")
                .withArgs(outsider.address);
        });

        it("Should reject a zero amount", async function () {
            const { token, holder1 } = await deployFixture();
            await expect(
                token.mintAgainstDeposit(holder1.address, 0, DEPOSIT_REF_2)
            ).to.be.revertedWithCustomError(token, "ZeroAmount");
        });
    });

    // =====================================================
    // TRANSFER RESTRICTIONS
    // =====================================================
    describe("Transfer restrictions", function () {
        it("Should allow transfer between two verified holders", async function () {
            const { token, holder1, holder2, grams } = await deployFixture();
            await token.connect(holder1).transfer(holder2.address, grams("10"));
            expect(await token.balanceOf(holder2.address)).to.equal(grams("10"));
        });

        it("Should block transfer to an unverified recipient", async function () {
            const { token, holder1, outsider, grams } = await deployFixture();
            await expect(
                token.connect(holder1).transfer(outsider.address, grams("10"))
            )
                .to.be.revertedWithCustomError(token, "RecipientNotAllowed")
                .withArgs(outsider.address);
        });

        it("Should block transfer from a revoked sender", async function () {
            const { token, registry, holder1, holder2, grams } = await deployFixture();
            await registry.revoke(holder1.address);
            await expect(
                token.connect(holder1).transfer(holder2.address, grams("10"))
            )
                .to.be.revertedWithCustomError(token, "SenderNotAllowed")
                .withArgs(holder1.address);
        });

        it("Should block transfer from a frozen sender that is still verified", async function () {
            const { token, registry, holder1, holder2, grams } = await deployFixture();
            await registry.freeze(holder1.address);
            expect(await registry.isVerified(holder1.address)).to.equal(true);
            await expect(
                token.connect(holder1).transfer(holder2.address, grams("10"))
            )
                .to.be.revertedWithCustomError(token, "SenderNotAllowed")
                .withArgs(holder1.address);
        });

        it("Should block transfer to a frozen recipient", async function () {
            const { token, registry, holder1, holder2, grams } = await deployFixture();
            await registry.freeze(holder2.address);
            await expect(
                token.connect(holder1).transfer(holder2.address, grams("10"))
            )
                .to.be.revertedWithCustomError(token, "RecipientNotAllowed")
                .withArgs(holder2.address);
        });

        it("Should allow transfer again after an unfreeze", async function () {
            const { token, registry, holder1, holder2, grams } = await deployFixture();
            await registry.freeze(holder2.address);
            await registry.unfreeze(holder2.address);
            await token.connect(holder1).transfer(holder2.address, grams("10"));
            expect(await token.balanceOf(holder2.address)).to.equal(grams("10"));
        });

        it("Should apply the same gate to transferFrom", async function () {
            const { token, holder1, holder2, outsider, grams } = await deployFixture();
            await token.connect(holder1).approve(holder2.address, grams("10"));
            await expect(
                token
                    .connect(holder2)
                    .transferFrom(holder1.address, outsider.address, grams("10"))
            )
                .to.be.revertedWithCustomError(token, "RecipientNotAllowed")
                .withArgs(outsider.address);
        });

        it("Should report eligibility through canTransfer", async function () {
            const { token, holder1, outsider } = await deployFixture();
            expect(await token.canTransfer(holder1.address)).to.equal(true);
            expect(await token.canTransfer(outsider.address)).to.equal(false);
        });
    });

    // =====================================================
    // REDEMPTION — burn is gated on a holder-opened request
    // =====================================================
    describe("Redemption", function () {
        it("Should escrow tokens on request without changing supply", async function () {
            const { token, holder1, grams } = await deployFixture();
            await expect(
                token.connect(holder1).requestRedemption(grams("30"), REDEMPTION_REF)
            )
                .to.emit(token, "RedemptionRequested")
                .withArgs(REDEMPTION_REF, holder1.address, grams("30"));

            expect(await token.balanceOf(holder1.address)).to.equal(grams("70"));
            expect(await token.balanceOf(await token.getAddress())).to.equal(grams("30"));
            expect(await token.escrowedForRedemption()).to.equal(grams("30"));
            expect(await token.totalSupply()).to.equal(grams("100"));
        });

        it("Should burn escrowed tokens on settle", async function () {
            const { token, holder1, grams } = await deployFixture();
            await token.connect(holder1).requestRedemption(grams("30"), REDEMPTION_REF);

            await expect(token.settleRedemption(REDEMPTION_REF))
                .to.emit(token, "RedemptionSettled")
                .withArgs(REDEMPTION_REF, holder1.address, grams("30"));

            expect(await token.totalSupply()).to.equal(grams("70"));
            expect(await token.escrowedForRedemption()).to.equal(0);
            expect(await token.balanceOf(await token.getAddress())).to.equal(0);
        });

        it("Should reject settle from a non-redeemer", async function () {
            const { token, holder1, attacker, grams } = await deployFixture();
            await token.connect(holder1).requestRedemption(grams("30"), REDEMPTION_REF);
            await expect(
                token.connect(attacker).settleRedemption(REDEMPTION_REF)
            ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
        });

        it("Should reject settling the same redemption twice", async function () {
            const { token, holder1, grams } = await deployFixture();
            await token.connect(holder1).requestRedemption(grams("30"), REDEMPTION_REF);
            await token.settleRedemption(REDEMPTION_REF);
            await expect(token.settleRedemption(REDEMPTION_REF))
                .to.be.revertedWithCustomError(token, "RedemptionNotPending")
                .withArgs(REDEMPTION_REF);
        });

        it("Should reject settling an unknown reference", async function () {
            const { token } = await deployFixture();
            await expect(token.settleRedemption(REDEMPTION_REF_2))
                .to.be.revertedWithCustomError(token, "RedemptionNotPending")
                .withArgs(REDEMPTION_REF_2);
        });

        it("Should reject a reused redemption reference", async function () {
            const { token, holder1, grams } = await deployFixture();
            await token.connect(holder1).requestRedemption(grams("10"), REDEMPTION_REF);
            await expect(
                token.connect(holder1).requestRedemption(grams("10"), REDEMPTION_REF)
            )
                .to.be.revertedWithCustomError(token, "RedemptionRefAlreadyUsed")
                .withArgs(REDEMPTION_REF);
        });

        it("Should return escrowed tokens on cancel by the holder", async function () {
            const { token, holder1, grams } = await deployFixture();
            await token.connect(holder1).requestRedemption(grams("30"), REDEMPTION_REF);

            await expect(token.connect(holder1).cancelRedemption(REDEMPTION_REF))
                .to.emit(token, "RedemptionCancelled")
                .withArgs(REDEMPTION_REF, holder1.address, grams("30"));

            expect(await token.balanceOf(holder1.address)).to.equal(grams("100"));
            expect(await token.escrowedForRedemption()).to.equal(0);
        });

        it("Should allow the redeemer desk to cancel", async function () {
            const { token, holder1, grams } = await deployFixture();
            await token.connect(holder1).requestRedemption(grams("30"), REDEMPTION_REF);
            await token.cancelRedemption(REDEMPTION_REF);
            expect(await token.balanceOf(holder1.address)).to.equal(grams("100"));
        });

        it("Should reject cancel by an unrelated account", async function () {
            const { token, holder1, attacker, grams } = await deployFixture();
            await token.connect(holder1).requestRedemption(grams("30"), REDEMPTION_REF);
            await expect(
                token.connect(attacker).cancelRedemption(REDEMPTION_REF)
            )
                .to.be.revertedWithCustomError(token, "NotRedemptionHolder")
                .withArgs(REDEMPTION_REF);
        });

        it("Should reject a request from an unverified holder", async function () {
            const { token, registry, holder1, grams } = await deployFixture();
            await registry.revoke(holder1.address);
            await expect(
                token.connect(holder1).requestRedemption(grams("10"), REDEMPTION_REF)
            )
                .to.be.revertedWithCustomError(token, "SenderNotAllowed")
                .withArgs(holder1.address);
        });

        it("Should still settle a redemption opened before the holder was revoked", async function () {
            const { token, registry, holder1, grams } = await deployFixture();
            await token.connect(holder1).requestRedemption(grams("30"), REDEMPTION_REF);
            await registry.revoke(holder1.address);

            // The metal is leaving the vault regardless of the holder's later
            // compliance status; the tokens are already escrowed.
            await token.settleRedemption(REDEMPTION_REF);
            expect(await token.totalSupply()).to.equal(grams("70"));
        });

        it("Should block cancel back to a revoked holder until compliance is restored", async function () {
            const { token, registry, holder1, grams } = await deployFixture();
            await token.connect(holder1).requestRedemption(grams("30"), REDEMPTION_REF);
            await registry.revoke(holder1.address);

            await expect(token.cancelRedemption(REDEMPTION_REF))
                .to.be.revertedWithCustomError(token, "RecipientNotAllowed")
                .withArgs(holder1.address);

            // The escrow is not an admin escape hatch; re-verifying the holder
            // is the route back, and settleRedemption stays available meanwhile.
            await registry.verify(holder1.address);
            await token.cancelRedemption(REDEMPTION_REF);

            expect(await token.balanceOf(holder1.address)).to.equal(grams("100"));
            expect(await token.escrowedForRedemption()).to.equal(0);
        });
    });

    // =====================================================
    // PAUSE
    // =====================================================
    describe("Pause", function () {
        it("Should block transfers while paused", async function () {
            const { token, holder1, holder2, grams } = await deployFixture();
            await token.pause();
            await expect(
                token.connect(holder1).transfer(holder2.address, grams("10"))
            ).to.be.revertedWithCustomError(token, "EnforcedPause");
        });

        it("Should block minting while paused", async function () {
            const { token, holder2, grams } = await deployFixture();
            await token.pause();
            await expect(
                token.mintAgainstDeposit(holder2.address, grams("10"), DEPOSIT_REF_2)
            ).to.be.revertedWithCustomError(token, "EnforcedPause");
        });

        it("Should resume transfers after unpause", async function () {
            const { token, holder1, holder2, grams } = await deployFixture();
            await token.pause();
            await token.unpause();
            await token.connect(holder1).transfer(holder2.address, grams("10"));
            expect(await token.balanceOf(holder2.address)).to.equal(grams("10"));
        });

        it("Should reject pause from a non-pauser", async function () {
            const { token, attacker } = await deployFixture();
            await expect(
                token.connect(attacker).pause()
            ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
        });
    });

    // =====================================================
    // RECOVERY
    // =====================================================
    describe("Forced transfer", function () {
        it("Should move tokens out of a revoked holder", async function () {
            const { token, registry, holder1, holder2, grams } = await deployFixture();
            await registry.revoke(holder1.address);

            await expect(
                token.forcedTransfer(
                    holder1.address,
                    holder2.address,
                    grams("100"),
                    "court order 2026-114"
                )
            )
                .to.emit(token, "ForcedTransfer")
                .withArgs(
                    holder1.address,
                    holder2.address,
                    grams("100"),
                    "court order 2026-114"
                );

            expect(await token.balanceOf(holder1.address)).to.equal(0);
            expect(await token.balanceOf(holder2.address)).to.equal(grams("100"));
        });

        it("Should still enforce compliance on the recipient", async function () {
            const { token, holder1, outsider, grams } = await deployFixture();
            await expect(
                token.forcedTransfer(
                    holder1.address,
                    outsider.address,
                    grams("10"),
                    "attempted exfiltration"
                )
            )
                .to.be.revertedWithCustomError(token, "RecipientNotAllowed")
                .withArgs(outsider.address);
        });

        it("Should reject forced transfer from a non-recovery account", async function () {
            const { token, attacker, holder1, holder2, grams } = await deployFixture();
            await expect(
                token
                    .connect(attacker)
                    .forcedTransfer(holder1.address, holder2.address, grams("10"), "theft")
            ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
        });

        it("Should not let recovery drain tokens escrowed for a pending redemption", async function () {
            const { token, holder1, holder2, admin, grams } = await deployFixture();
            await token.connect(holder1).requestRedemption(grams("30"), REDEMPTION_REF);

            const tokenAddress = await token.getAddress();
            expect(await token.balanceOf(tokenAddress)).to.equal(grams("30"));

            // admin holds RECOVERY_ROLE, so this fails on the escrow guard
            // rather than on authorisation.
            expect(await token.hasRole(await token.RECOVERY_ROLE(), admin.address)).to.equal(true);
            await expect(
                token.forcedTransfer(tokenAddress, holder2.address, grams("30"), "drain attempt")
            ).to.be.revertedWithCustomError(token, "EscrowNotRecoverable");

            // Escrow and accounting are untouched, and settlement still works.
            expect(await token.balanceOf(tokenAddress)).to.equal(grams("30"));
            expect(await token.escrowedForRedemption()).to.equal(grams("30"));

            await token.settleRedemption(REDEMPTION_REF);
            expect(await token.totalSupply()).to.equal(grams("70"));
            expect(await token.escrowedForRedemption()).to.equal(0);
        });

        it("Should be blocked while the token is paused", async function () {
            const { token, registry, holder1, holder2, grams } = await deployFixture();
            await registry.revoke(holder1.address);
            await token.pause();

            // Recovery routes through the same _update as everything else, so a
            // pause halts it too. Unpause first if recovery is needed.
            await expect(
                token.forcedTransfer(holder1.address, holder2.address, grams("10"), "court order")
            ).to.be.revertedWithCustomError(token, "EnforcedPause");

            await token.unpause();
            await token.forcedTransfer(holder1.address, holder2.address, grams("10"), "court order");
            expect(await token.balanceOf(holder2.address)).to.equal(grams("10"));
        });
    });

    // =====================================================
    // ALLOWANCE SEMANTICS
    // =====================================================
    describe("Allowance semantics", function () {
        it("Should let an unverified account hold an allowance but never spend it", async function () {
            const { token, holder1, outsider, holder2, grams } = await deployFixture();

            // approve is deliberately not compliance-gated: an allowance moves
            // no value, so gating it adds surface without adding safety.
            await token.connect(holder1).approve(outsider.address, grams("10"));
            expect(await token.allowance(holder1.address, outsider.address)).to.equal(grams("10"));

            // The gate is at transferFrom, where value actually moves.
            await expect(
                token.connect(outsider).transferFrom(holder1.address, outsider.address, grams("10"))
            )
                .to.be.revertedWithCustomError(token, "RecipientNotAllowed")
                .withArgs(outsider.address);

            // A compliant spender moving to a compliant recipient succeeds, and
            // the allowance is consumed exactly once.
            await token.connect(holder1).approve(holder2.address, grams("10"));
            await token.connect(holder2).transferFrom(holder1.address, holder2.address, grams("10"));
            expect(await token.allowance(holder1.address, holder2.address)).to.equal(0);
        });
    });

    // =====================================================
    // GOVERNANCE
    // =====================================================
    describe("Governance", function () {
        it("Should swap the compliance registry", async function () {
            const { token, admin, holder1, ethers } = await deployFixture();
            const Registry = await ethers.getContractFactory("ComplianceRegistry");
            const replacement = await Registry.deploy(admin.address);
            await replacement.waitForDeployment();

            await expect(token.setComplianceRegistry(await replacement.getAddress()))
                .to.emit(token, "ComplianceRegistryUpdated");

            // Nobody is verified in the fresh registry, so transfers stop.
            expect(await token.canTransfer(holder1.address)).to.equal(false);
        });

        it("Should reject a registry swap from a non-governor", async function () {
            const { token, attacker, registry } = await deployFixture();
            await expect(
                token
                    .connect(attacker)
                    .setComplianceRegistry(await registry.getAddress())
            ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
        });

        it("Should reject a zero-address registry", async function () {
            const { token, ethers } = await deployFixture();
            await expect(
                token.setComplianceRegistry(ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(token, "ZeroAddress");
        });

        it("Should reject an EOA as the registry", async function () {
            const { token, outsider } = await deployFixture();
            // Every transfer calls the registry, so an EOA here would halt the
            // token until governance noticed and repointed it.
            await expect(token.setComplianceRegistry(outsider.address))
                .to.be.revertedWithCustomError(token, "NotAContract")
                .withArgs(outsider.address);
        });

        it("Should keep the previous registry in force after a rejected swap", async function () {
            const { token, holder1, outsider, grams } = await deployFixture();
            await expect(
                token.setComplianceRegistry(outsider.address)
            ).to.be.revertedWithCustomError(token, "NotAContract");

            // The original registry is still authoritative.
            expect(await token.canTransfer(holder1.address)).to.equal(true);
            await token.connect(holder1).transfer(holder1.address, grams("1"));
        });
    });

    // =====================================================
    // COMPLIANCE REGISTRY ACCESS CONTROL
    // =====================================================
    describe("ComplianceRegistry access control", function () {
        it("Should reject verify, revoke, freeze and unfreeze from a non-compliance account", async function () {
            const { registry, attacker, holder1 } = await deployFixture();
            const asAttacker = registry.connect(attacker);

            // Built lazily: creating all five promises up front would reject
            // before they are awaited.
            const calls = [
                () => asAttacker.verify(holder1.address),
                () => asAttacker.revoke(holder1.address),
                () => asAttacker.freeze(holder1.address),
                () => asAttacker.unfreeze(holder1.address),
                () => asAttacker.verifyBatch([holder1.address]),
            ];

            for (const call of calls) {
                await expect(call()).to.be.revertedWithCustomError(
                    registry,
                    "AccessControlUnauthorizedAccount"
                );
            }
        });

        it("Should verify a batch of accounts in one call", async function () {
            const { registry, outsider, attacker } = await deployFixture();
            expect(await registry.isVerified(outsider.address)).to.equal(false);

            await registry.verifyBatch([outsider.address, attacker.address]);

            expect(await registry.isVerified(outsider.address)).to.equal(true);
            expect(await registry.isVerified(attacker.address)).to.equal(true);
        });

        it("Should treat repeated verify and freeze calls as idempotent", async function () {
            const { registry, outsider } = await deployFixture();
            await registry.verify(outsider.address);
            await registry.verify(outsider.address);
            expect(await registry.isVerified(outsider.address)).to.equal(true);

            await registry.freeze(outsider.address);
            await registry.freeze(outsider.address);
            expect(await registry.isFrozen(outsider.address)).to.equal(true);
        });

        it("Should reject verifying the zero address", async function () {
            const { registry, ethers } = await deployFixture();
            await expect(
                registry.verify(ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(registry, "ZeroAddress");
        });
    });

    // =====================================================
    // ESCROW ACCOUNTING INVARIANT
    // =====================================================
    describe("Escrow accounting", function () {
        it("Should keep escrowedForRedemption equal to the contract balance across the lifecycle", async function () {
            const { token, holder1, holder2, grams } = await deployFixture();
            const tokenAddress = await token.getAddress();
            const invariant = async () =>
                expect(await token.escrowedForRedemption()).to.equal(
                    await token.balanceOf(tokenAddress)
                );

            await invariant();

            await token.connect(holder1).requestRedemption(grams("30"), REDEMPTION_REF);
            await invariant();

            // An ordinary transfer must not disturb the escrow figure.
            await token.connect(holder1).transfer(holder2.address, grams("10"));
            await invariant();

            await token.connect(holder1).requestRedemption(grams("20"), REDEMPTION_REF_2);
            await invariant();

            await token.settleRedemption(REDEMPTION_REF);
            await invariant();

            await token.cancelRedemption(REDEMPTION_REF_2);
            await invariant();

            expect(await token.escrowedForRedemption()).to.equal(0);
        });
    });
});
