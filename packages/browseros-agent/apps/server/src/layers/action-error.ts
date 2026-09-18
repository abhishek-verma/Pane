import {
  type LayerActionFailureCode,
  layerActionFailureMessage,
} from '@browseros/shared/layers/action-failure'

/** Construct only from a fixed code, never from raw provider/page output. */
export class LayerActionError extends Error {
  constructor(readonly code: LayerActionFailureCode) {
    super(layerActionFailureMessage(code))
  }
}
