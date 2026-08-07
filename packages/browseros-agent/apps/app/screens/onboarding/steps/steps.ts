import {
  cloudAccountEnabled,
  productFeatures,
} from '@/lib/constants/product-features'
import { StepConnectApps } from './StepConnectApps'
import { StepOne } from './StepOne'
import { StepProvider } from './StepProvider'
import { StepSoul } from './StepSoul'
import { StepTwo } from './StepTwo'
import { StepVoice } from './StepVoice'
import { StepWorkspace } from './StepWorkspace'

export const steps = [
  {
    id: 1,
    name: 'About You',
    component: StepOne,
  },
  {
    id: 2,
    name: 'Provider',
    component: StepProvider,
  },
  {
    id: 3,
    name: 'Soul',
    component: StepSoul,
  },
  {
    id: 4,
    name: 'Workspace',
    component: StepWorkspace,
  },
  {
    id: 5,
    name: 'Voice',
    component: StepVoice,
  },
  ...(productFeatures.klavisIntegrations
    ? [
        {
          id: 6,
          name: 'Connect Apps',
          component: StepConnectApps,
        },
      ]
    : []),
  ...(cloudAccountEnabled
    ? [
        {
          id: productFeatures.klavisIntegrations ? 7 : 6,
          name: 'Sign In',
          component: StepTwo,
        },
      ]
    : []),
]
