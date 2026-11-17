import { env } from 'cloudflare:workers';
import type { PlatformConfig } from '../config';
export function analyticsEngine(): NonNullable<PlatformConfig['productAnalytics']> {
  return { writeDataPoint: (point) => env.PRODUCT_ANALYTICS?.writeDataPoint(point) };
}
