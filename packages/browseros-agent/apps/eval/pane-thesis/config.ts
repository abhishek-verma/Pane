export const config = {
  name: 'pane-thesis',
  scenarios: [
    import('./scenarios/browsing-quality'),
    import('./scenarios/pane-thesis-e2e'),
  ],
}
