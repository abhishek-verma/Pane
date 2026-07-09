import { productFeatures } from '@/lib/constants/product-features'

export async function syncOnboardingProfile(_userId: string): Promise<void> {
  if (!productFeatures.cloudSync) return
}
