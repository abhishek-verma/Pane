/**
 * Labels for background / scheduled agent conversations in chat lists and banners.
 */

export function backgroundAgentLabel(source?: string | null): string {
  switch (source) {
    case 'pi-harvest':
      return 'Background harvest'
    case 'pi-materialize':
      return 'Background page fill'
    case 'trigger':
      return 'Background trigger'
    case 'schedule':
      return 'Scheduled agent'
    case 'keepalive':
      return 'Background keep-alive'
    case 'digest':
      return 'Background digest'
    default:
      return 'Background agent'
  }
}
