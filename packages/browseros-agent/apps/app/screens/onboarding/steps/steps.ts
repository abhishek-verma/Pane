import {
  cloudAccountEnabled,
  productFeatures,
} from '@/lib/constants/product-features'
import { StepConnectApps } from './StepConnectApps'
import { StepOne } from './StepOne'
import { StepTwo } from './StepTwo'

export const steps = [
  {
    id: 1,
    name: 'About You',
    component: StepOne,
  },
  ...(productFeatures.klavisIntegrations
    ? [
        {
          id: 2,
          name: 'Connect Apps',
          component: StepConnectApps,
        },
      ]
    : []),
  ...(cloudAccountEnabled
    ? [
        {
          id: 3,
          name: 'Sign In',
          component: StepTwo,
        },
      ]
    : []),
]
