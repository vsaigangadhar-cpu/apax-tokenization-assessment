import type { HoldingsResponse } from '@/src/types/api';
import { baseAPI } from './base.api';

export const getHoldingsApi = () =>
  baseAPI<HoldingsResponse>('/api/holdings', 'GET');
