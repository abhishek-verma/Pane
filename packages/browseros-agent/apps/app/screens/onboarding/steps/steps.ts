import {
  cloudAccountEnabled,
  productFeatures,
} from '@/lib/constants/product-features'
import { StepConnectApps } from './StepConnectApps'
import { StepIcp } from './StepIcp'
import { StepOne } from './StepOne'
import { StepTwo } from './StepTwo'

export const steps = [
  {
    id: 1,
    name: 'About You',
    component: StepOne,
  },
  {
    id: 2,
    name: 'How you use Pane',
    component: StepIcp,
  },
  ...(productFeatures.klavisIntegrations
    ? [
        {
          id: 3,
          name: 'Connect Apps',
          component: StepConnectApps,
        },
      ]
    : []),
  ...(cloudAccountEnabled
    ? [
        {
          id: productFeatures.klavisIntegrations ? 4 : 3,
          name: 'Sign In',
          component: StepTwo,
        },
      ]
    : []),
]
