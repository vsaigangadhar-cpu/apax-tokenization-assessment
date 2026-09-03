export interface Deposit {
  id: number;
  user: string;
  amount: number;
  date: string;
}

export interface Withdrawal {
  id: number;
  user: string;
  amount: number;
  date: string;
}

export type AssetType = "gold" | "silver" | "platinum";

export interface HoldingSummary {
  amount: number;
  unit: string;
  /** null when the user holds none of this metal. */
  updatedAt: string | null;
}

export interface HoldingsResponse {
  success: boolean;
  holdings: Record<AssetType, HoldingSummary>;
}
