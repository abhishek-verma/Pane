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

/**
 * Same navigate task with context-graph ingest enabled.
 * Latency budget: within +25% of the Phase 1 baseline absolute cap.
 * Absolute CI cap (ms) is conservative for headless CI machines.
 */
export const BrowsingQualityWithGraph = {
  id: 'browsing-quality-with-graph',
  description:
    'Same navigate task as browsing-quality-baseline with context graph ingest on; assert latency stays within budget',
  tasks: [
    {
      query_id: 'bq-graph-1',
      dataset: 'pane-thesis',
      query:
        'Navigate to example.com and report the exact text of the main heading.',
      start_url: 'about:blank',
      graders: ['exact-match'],
      metadata: {
        original_task_id: 'bq-graph-1',
        expected_answer: 'Example Domain',
        // Absolute ms cap for CI (baseline + 25% headroom). Recorded in PHASE-3-REPORT.
        max_latency_ms: 45_000,
        latency_budget_vs_baseline: '1.25x',
        graph_ingest: true,
      },
    },
  ],
}
