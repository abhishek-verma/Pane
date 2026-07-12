import {
  cloudAccountEnabled,
  productFeatures,
} from '@/lib/constants/product-features'
import { StepConnectApps } from './StepConnectApps'
import { StepIcp } from './StepIcp'
import { StepOne } from './StepOne'
import { StepTwo } from './StepTwo'
import { StepWidgets } from './StepWidgets'

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
  {
    id: 3,
    name: 'Starter widgets',
    component: StepWidgets,
  },
  ...(productFeatures.klavisIntegrations
    ? [
        {
          id: 4,
          name: 'Connect Apps',
          component: StepConnectApps,
        },
      ]
    : []),
  ...(cloudAccountEnabled
    ? [
        {
          id: productFeatures.klavisIntegrations ? 5 : 4,
          name: 'Sign In',
          component: StepTwo,
        },
      ]
    : []),
]
