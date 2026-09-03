'use client'

import { create } from 'zustand'

import { getHoldingsApi } from './services/holdings.api'

// Types
export type HoldingsStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface MetalPrice {
  gold: number
  silver: number
  platinum: number
  lastUpdated: Date
}

export interface UserHolding {
  goldGrams: number
  silverGrams: number
  platinumGrams: number
  apxiTokens: number
}

export interface VaultData {
  totalGoldGrams: number
  totalSilverGrams: number
  totalPlatinumGrams: number
  totalTokensMinted: number
  lastAuditDate: Date
  verificationStatus: 'verified' | 'pending' | 'syncing'
}

export interface ZakatCalculation {
  totalAssetValue: number
  nisabThreshold: number
  zakatDue: number
  isAboveNisab: boolean
}

export interface AuditLog {
  id: string
  timestamp: Date
  event: string
  details: string
  txHash: string
}

interface APAXStore {
  // Metal Prices (Mock data with live simulation)
  metalPrices: MetalPrice
  setMetalPrices: (prices: MetalPrice) => void
  
  // User Holdings
  userHoldings: UserHolding
  setUserHoldings: (holdings: UserHolding) => void
  holdingsStatus: HoldingsStatus
  holdingsError: string | null
  /** Resolves with `unauthenticated: true` when the session is missing or expired. */
  fetchHoldings: () => Promise<{ unauthenticated: boolean }>

  // Vault Data
  vaultData: VaultData
  setVaultData: (data: VaultData) => void
  
  // Audit Logs
  auditLogs: AuditLog[]
  addAuditLog: (log: AuditLog) => void
  
  // Zakat
  zakatCalculation: ZakatCalculation | null
  calculateZakat: () => void
  
  // UI State
  activeView: 'dashboard' | 'por' | 'zakat' | 'redemption' | 'sharia'
  setActiveView: (view: 'dashboard' | 'por' | 'zakat' | 'redemption' | 'sharia') => void
}

// Initial mock data
const initialMetalPrices: MetalPrice = {
  gold: 2342.50,
  silver: 27.85,
  platinum: 1024.30,
  lastUpdated: new Date()
}

const initialUserHoldings: UserHolding = {
  goldGrams: 156.75,
  silverGrams: 892.40,
  platinumGrams: 45.20,
  apxiTokens: 1250.00
}

const initialVaultData: VaultData = {
  totalGoldGrams: 15678.50,
  totalSilverGrams: 89240.75,
  totalPlatinumGrams: 4520.25,
  totalTokensMinted: 125000,
  lastAuditDate: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2), // 2 days ago
  verificationStatus: 'verified'
}

const initialAuditLogs: AuditLog[] = [
  {
    id: '1',
    timestamp: new Date(Date.now() - 1000 * 60 * 5),
    event: 'Vault Verification',
    details: 'All reserves verified against token supply',
    txHash: '0x8f4e...3a2b'
  },
  {
    id: '2',
    timestamp: new Date(Date.now() - 1000 * 60 * 15),
    event: 'Token Mint',
    details: '250 APX-i tokens minted',
    txHash: '0x7c3d...9e1f'
  },
  {
    id: '3',
    timestamp: new Date(Date.now() - 1000 * 60 * 32),
    event: 'Gold Deposit',
    details: '100g gold added to vault',
    txHash: '0x2a5b...7d4c'
  },
  {
    id: '4',
    timestamp: new Date(Date.now() - 1000 * 60 * 48),
    event: 'Reserve Audit',
    details: 'Quarterly audit completed successfully',
    txHash: '0x9f1e...8b3a'
  },
  {
    id: '5',
    timestamp: new Date(Date.now() - 1000 * 60 * 67),
    event: 'Redemption Request',
    details: '50g silver redeemed for physical delivery',
    txHash: '0x4c6d...2e5f'
  }
]

export const useAPAXStore = create<APAXStore>((set, get) => ({
  // Metal Prices
  metalPrices: initialMetalPrices,
  setMetalPrices: (prices) => set({ metalPrices: prices }),
  
  // User Holdings
  userHoldings: initialUserHoldings,
  setUserHoldings: (holdings) => set({ userHoldings: holdings }),
  holdingsStatus: 'idle',
  holdingsError: null,
  fetchHoldings: async () => {
    set({ holdingsStatus: 'loading', holdingsError: null })

    const res = await getHoldingsApi()

    if (res.success) {
      const holdings = res.data?.holdings

      // A 2xx with a payload that does not match the contract is still a
      // failure; without this the destructure below would throw.
      if (
        typeof holdings?.gold?.amount !== 'number' ||
        typeof holdings?.silver?.amount !== 'number' ||
        typeof holdings?.platinum?.amount !== 'number'
      ) {
        set({
          holdingsStatus: 'error',
          holdingsError: 'Unexpected holdings response from server',
        })
        return { unauthenticated: false }
      }

      const { gold, silver, platinum } = holdings

      set((state) => ({
        userHoldings: {
          // apxiTokens is an index token, not a vaulted metal, so
          // /api/holdings does not provide it and the existing value stands.
          ...state.userHoldings,
          goldGrams: gold.amount,
          silverGrams: silver.amount,
          platinumGrams: platinum.amount,
        },
        holdingsStatus: 'ready',
        holdingsError: null,
      }))

      return { unauthenticated: false }
    }

    // No inline message for 401; the caller redirects to the login page.
    if (res.status === 401) {
      set({ holdingsStatus: 'error', holdingsError: null })
      return { unauthenticated: true }
    }

    // Last known holdings are kept so the portfolio does not blank out.
    set({ holdingsStatus: 'error', holdingsError: res.message })
    return { unauthenticated: false }
  },
  
  // Vault Data
  vaultData: initialVaultData,
  setVaultData: (data) => set({ vaultData: data }),
  
  // Audit Logs
  auditLogs: initialAuditLogs,
  addAuditLog: (log) => set((state) => ({ 
    auditLogs: [log, ...state.auditLogs].slice(0, 50) 
  })),
  
  // Zakat Calculation
  zakatCalculation: null,
  calculateZakat: () => {
    const { metalPrices, userHoldings } = get()
    
    // Calculate total asset value in USD
    const goldValue = userHoldings.goldGrams * (metalPrices.gold / 31.1035) // Price per gram
    const silverValue = userHoldings.silverGrams * (metalPrices.silver / 31.1035)
    const platinumValue = userHoldings.platinumGrams * (metalPrices.platinum / 31.1035)
    const totalAssetValue = goldValue + silverValue + platinumValue
    
    // Nisab threshold (approximately 85g of gold or 595g of silver)
    const nisabInGold = 85 * (metalPrices.gold / 31.1035)
    const nisabInSilver = 595 * (metalPrices.silver / 31.1035)
    const nisabThreshold = Math.min(nisabInGold, nisabInSilver)
    
    const isAboveNisab = totalAssetValue >= nisabThreshold
    const zakatDue = isAboveNisab ? totalAssetValue * 0.025 : 0
    
    set({
      zakatCalculation: {
        totalAssetValue,
        nisabThreshold,
        zakatDue,
        isAboveNisab
      }
    })
  },
  
  // UI State
  activeView: 'dashboard',
  setActiveView: (view) => set({ activeView: view })
}))

// Utility function to format currency
export function formatCurrency(value: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value)
}

// Utility function to format weight
export function formatWeight(grams: number): string {
  if (grams >= 1000) {
    return `${(grams / 1000).toFixed(2)} kg`
  }
  return `${grams.toFixed(2)} g`
}

// Calculate APX-i token breakdown (60% Gold, 30% Silver, 10% Platinum)
export function calculateAPXiBreakdown(tokens: number) {
  return {
    goldWeight: tokens * 0.60,
    silverWeight: tokens * 0.30,
    platinumWeight: tokens * 0.10
  }
}
