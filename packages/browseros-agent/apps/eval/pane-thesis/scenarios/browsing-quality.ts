export const BrowsingQualityBaseline = {
  id: 'browsing-quality-baseline',
  description:
    'Navigate to a simple page and verify its title to establish a baseline for browser-agent quality',
  tasks: [
    {
      query_id: 'bq-1',
      dataset: 'pane-thesis',
      query:
        'Navigate to example.com and report the exact text of the main heading.',
      start_url: 'about:blank',
      graders: ['exact-match'],
      metadata: {
        original_task_id: 'bq-1',
        expected_answer: 'Example Domain',
      },
    },
  ],
}
