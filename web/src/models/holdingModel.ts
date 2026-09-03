import mongoose, { Document, Model, Schema, Types } from "mongoose";
import { AssetType } from "../types/api";

export const ASSET_TYPES: AssetType[] = ["gold", "silver", "platinum"];

/**
 * Holding interface
 *
 * One document per user per metal, so a new metal needs no migration and each
 * asset carries its own updatedAt.
 */
export interface IHolding extends Document {
  user: Types.ObjectId;
  asset: AssetType;
  amount: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Holding Schema
 *
 * `amount` is grams as a double. Production accounting for precious metals
 * would use Decimal128 to avoid binary floating point drift.
 */
const holdingSchema: Schema<IHolding> = new mongoose.Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    asset: {
      type: String,
      required: true,
      enum: ASSET_TYPES,
      lowercase: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
  },
  { timestamps: true }
);

// A user holds at most one row per metal.
holdingSchema.index({ user: 1, asset: 1 }, { unique: true });

const Holding: Model<IHolding> = mongoose.model<IHolding>(
  "Holding",
  holdingSchema
);
export default Holding;
