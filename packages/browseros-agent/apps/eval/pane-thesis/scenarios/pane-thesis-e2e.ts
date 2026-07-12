/**
 * Pane-thesis E2E scenario: proves the moat of browser + workspace + context +
 * memory + trust in a single multi-step agent flow.
 *
 * Steps:
 * 1. Browse example.com and extract the heading
 * 2. Write the heading to a workspace file via filesystem_write
 * 3. Use context_search to recall the page visited in step 1
 * 4. Add a memory entry about the task
 * 5. Verify action log contains the write from step 2
 */
export const PaneThesisE2E = {
  id: 'pane-thesis-e2e',
  description:
    'Multi-step task proving Pane remembers what you read, writes to your files with consent, and knows what it did',
  tasks: [
    {
      query_id: 'pt-e2e-1',
      dataset: 'pane-thesis',
      query: `Do the following steps in order:
1. Navigate to https://example.com and tell me the exact text of the main heading on the page.
2. Write the heading text to a file called "heading.txt" in the workspace using filesystem_write.
3. Use context_search to search for "Example Domain" and tell me what you find.
4. Add a memory note: "I extracted the heading from example.com for the user."
5. Tell me the tool name and consequence class of the write action from step 2 that appeared in your action log.

Report all results clearly.`,
      start_url: 'about:blank',
      graders: ['pane-thesis-e2e'],
      metadata: {
        original_task_id: 'pt-e2e-1',
        expected_heading: 'Example Domain',
        expected_file: 'heading.txt',
        expected_memory_substring: 'extracted the heading from example.com',
        trust_gate_mode: 'auto-approve',
      },
    },
  ],
}
