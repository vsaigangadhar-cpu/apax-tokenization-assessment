import { Response } from "express";

import Holding, { ASSET_TYPES } from "../models/holdingModel";
import asyncErrorHandler from "../middlewares/helpers/asyncErrorHandler";
import { AuthenticatedRequest } from "../middlewares/user_actions/auth";
import { AssetType, HoldingSummary, HoldingsResponse } from "../types/api";

const UNIT = "g";

// ================= GET HOLDINGS =================
export const getHoldings = asyncErrorHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    // Ownership comes from the verified session only. Taking an id from the
    // request would let any authenticated user read another user's portfolio.
    const holdings = await Holding.find({ user: req.user._id });

    const byAsset = {} as Record<AssetType, HoldingSummary>;

    // Every metal is always present so the dashboard never handles undefined.
    for (const asset of ASSET_TYPES) {
      byAsset[asset] = { amount: 0, unit: UNIT, updatedAt: null };
    }

    for (const holding of holdings) {
      byAsset[holding.asset] = {
        amount: holding.amount,
        unit: UNIT,
        updatedAt: holding.updatedAt.toISOString(),
      };
    }

    const body: HoldingsResponse = { success: true, holdings: byAsset };

    res.status(200).json(body);
  }
);
