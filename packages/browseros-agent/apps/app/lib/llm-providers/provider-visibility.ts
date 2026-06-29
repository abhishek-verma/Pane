import { Feature } from '../browseros/capabilities'
import { productFeatures } from '../constants/product-features'
import type { ProviderTemplate } from './providerTemplates'
import { type ProviderType, REMOTE_HERMES_PROVIDER_TYPE } from './types'

export type FeatureSupport = (feature: Feature) => boolean

function isProviderTypeVisible(
  type: ProviderType,
  supports: FeatureSupport,
): boolean {
  if (type === 'browseros') {
    return productFeatures.hostedInference
  }
  if (type === REMOTE_HERMES_PROVIDER_TYPE) {
    return (
      productFeatures.remoteHermes && supports(Feature.HERMES_AGENT_SUPPORT)
    )
  }
  return true
}

export function visibleProviderTemplates(
  templates: ProviderTemplate[],
  supports: FeatureSupport,
): ProviderTemplate[] {
  return templates.filter((template) =>
    isProviderTypeVisible(template.id, supports),
  )
}

export function visibleProviderTypeOptions<
  T extends { value: ProviderType; label: string },
>(options: T[], supports: FeatureSupport): T[] {
  return options.filter((option) =>
    isProviderTypeVisible(option.value, supports),
  )
}
