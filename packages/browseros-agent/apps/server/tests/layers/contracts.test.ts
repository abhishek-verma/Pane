import { describe, expect, it } from 'bun:test'
import {
  assessLayerRequirements,
  definitionCapabilityErrors,
  type LayerCapabilities,
} from '@browseros/shared/layers/capabilities'
import {
  layerDefinitionSchema,
  layerScopeSchema,
} from '@browseros/shared/layers/manifest'
import { layerMatchesUrl } from '@browseros/shared/layers/matching'
import { TranslationResultSink } from '../../src/layers/result-acceptance'

const scope = layerScopeSchema.parse({
  origin: 'https://example.com',
  paths: ['/articles/*'],
  excludePaths: ['/articles/private/*'],
})
const capabilities: LayerCapabilities = {
  revision: 'test-1',
  managed: true,
  authenticatedBroker: true,
  transform: true,
  pageTask: false,
  data: false,
  javascript: false,
  automaticInference: false,
  provider: 'ready',
}

describe('Layer scope boundaries', () => {
  it('matches the requested route family, ignoring undeclared query/hash', () => {
    expect(
      layerMatchesUrl(scope, 'https://example.com/articles/one?q=x#two'),
    ).toBe(true)
    expect(
      layerMatchesUrl(scope, 'https://example.com/articles/private/one'),
    ).toBe(false)
    expect(layerMatchesUrl(scope, 'https://example.com/article/one')).toBe(
      false,
    )
  })
  it('rejects different origins, lookalikes, credentials and special schemes', () => {
    for (const url of [
      'https://sub.example.com/articles/one',
      'https://example.com.evil.test/articles/one',
      'http://example.com/articles/one',
      'https://example.com:8443/articles/one',
      'https://user@example.com/articles/one',
      'chrome://example.com/articles/one',
    ])
      expect(layerMatchesUrl(scope, url)).toBe(false)
  })
  it('handles normalized dot segments and explicit query/hash predicates', () => {
    expect(
      layerMatchesUrl(scope, 'https://example.com/articles/../account'),
    ).toBe(false)
    const filtered = { ...scope, query: { view: 'read' }, hash: 'content' }
    expect(
      layerMatchesUrl(
        filtered,
        'https://example.com/articles/a?view=read#content',
      ),
    ).toBe(true)
    expect(
      layerMatchesUrl(
        filtered,
        'https://example.com/articles/a?view=read&view=edit#content',
      ),
    ).toBe(false)
    expect(
      layerMatchesUrl(
        filtered,
        'https://example.com/articles/a?view=read#other',
      ),
    ).toBe(false)
  })
  it('treats regex characters literally and bounds wildcard work', () => {
    const literal = { ...scope, paths: ['/articles/a+b'] }
    expect(layerMatchesUrl(literal, 'https://example.com/articles/a+b')).toBe(
      true,
    )
    expect(layerMatchesUrl(literal, 'https://example.com/articles/aaab')).toBe(
      false,
    )
    expect(
      layerMatchesUrl(
        { ...scope, paths: [`/${'*a'.repeat(300)}z`] },
        `https://example.com/${'a'.repeat(2000)}x`,
      ),
    ).toBe(false)
  })
  it('rejects origins with paths, credentials or implicit normalization', () => {
    for (const origin of [
      'https://example.com/',
      'https://example.com/path',
      'https://u@example.com',
      'HTTPS://example.com',
    ]) {
      expect(
        layerScopeSchema.safeParse({ origin, paths: ['/*'] }).success,
      ).toBe(false)
    }
  })
})

describe('Capability honesty', () => {
  it('does not promise automatic inference or universal coverage', () => {
    const result = assessLayerRequirements(
      {
        origin: scope.origin,
        execution: 'transform',
        trigger: 'document-load',
        content: 'all-content',
        languages: 'all',
      },
      capabilities,
    )
    expect(result.disposition).toBe('unsupported')
    expect(
      result.checks
        .filter((check) => check.status === 'unsupported')
        .map((check) => check.requirement),
    ).toEqual(['automatic-inference', 'content-coverage', 'language-coverage'])
    expect(result.alternatives[0]).toContain('obtain agreement')
  })
  it('does not offer a button that the runtime cannot execute', () => {
    const result = assessLayerRequirements(
      {
        origin: scope.origin,
        execution: 'transform',
        trigger: 'document-load',
        content: 'readable-text',
        languages: 'selected',
      },
      { ...capabilities, transform: false },
    )
    expect(result.alternatives).toEqual([])
  })
  it('distinguishes provider setup from unknown support', () => {
    const request = {
      origin: scope.origin,
      execution: 'transform',
      trigger: 'click',
      content: 'readable-text',
      languages: 'selected',
    } as const
    expect(
      assessLayerRequirements(request, {
        ...capabilities,
        provider: 'missing-setup',
      }).disposition,
    ).toBe('needs-input')
    expect(
      assessLayerRequirements(request, {
        ...capabilities,
        provider: 'unverified',
      }).disposition,
    ).toBe('unverified')
    expect(assessLayerRequirements(request, capabilities).disposition).toBe(
      'supported-with-limits',
    )
  })
  it('checks capability again for manifest activation', () => {
    const definition = layerDefinitionSchema.parse({
      protocol: 'pane.layers.v1',
      name: 'Quiet',
      intent: 'Collapse recommendations',
      scope,
      mode: 'managed',
      operations: [
        {
          id: 'hide',
          kind: 'collapse',
          anchor: { selector: 'aside' },
          label: 'Recommendations',
        },
      ],
    })
    expect(definitionCapabilityErrors(definition, capabilities)).toEqual([])
    expect(
      definitionCapabilityErrors(definition, {
        ...capabilities,
        authenticatedBroker: false,
      }),
    ).toContain('The authenticated Layer runtime is not available.')
  })
  it('rejects executable content and missing action bindings in managed programs', () => {
    const definition = {
      protocol: 'pane.layers.v1',
      name: 'Quiet',
      intent: 'Collapse recommendations',
      scope,
      mode: 'managed',
      operations: [
        {
          id: 'button',
          kind: 'button',
          anchor: { selector: 'article' },
          label: 'Go',
          actionId: 'missing',
        },
      ],
    }
    expect(layerDefinitionSchema.safeParse(definition).success).toBe(false)
    expect(
      layerDefinitionSchema.safeParse({
        ...definition,
        operations: [],
        source: 'alert(1)',
      }).success,
    ).toBe(false)
  })
})

describe('Invocation-private structured results', () => {
  const binding = {
    profileId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    invocationId: 'run1',
    layerId: 'layer1',
    layerVersion: 'a'.repeat(64),
    actionId: 'translate',
    tabId: 1,
    frameId: 0 as const,
    documentId: 'document1',
    instanceId: 'instance1',
    routeEpoch: 1,
    snapshotId: 'snapshot1',
    revocationGeneration: 0,
  }
  const input = {
    targetLanguage: 'en',
    blocks: [
      { blockId: 'b1', text: 'Bonjour' },
      { blockId: 'b2', text: 'Monde' },
    ],
  }
  const result = {
    schema: 'pane.translation.v1',
    targetLanguage: 'en',
    blocks: [
      { blockId: 'b1', translatedText: 'Hello' },
      { blockId: 'b2', translatedText: 'World' },
    ],
  }
  const makeSink = () =>
    new TranslationResultSink(binding, input, 1000, () => 0)
  it('accepts data once, tolerates identical retries, rejects conflicting output', () => {
    const sink = makeSink()
    expect(sink.submit(result, binding)).toMatchObject({
      accepted: true,
      duplicate: false,
    })
    expect(
      sink.submit({ ...result, blocks: [...result.blocks].reverse() }, binding),
    ).toMatchObject({ accepted: true, duplicate: true })
    expect(
      sink.submit(
        {
          ...result,
          blocks: result.blocks.map((block) => ({
            ...block,
            translatedText: 'Changed',
          })),
        },
        binding,
      ),
    ).toMatchObject({ accepted: false, code: 'CONFLICT' })
  })
  it('rejects prose, unknown fields, duplicate/missing IDs and wrong languages', () => {
    for (const invalid of [
      'Here is the translation',
      { ...result, html: '<script />' },
      { ...result, blocks: [result.blocks[0]] },
      { ...result, blocks: [result.blocks[0], result.blocks[0]] },
      { ...result, targetLanguage: 'fr' },
    ]) {
      expect(makeSink().submit(invalid, binding)).toMatchObject({
        accepted: false,
        code: 'INVALID_RESULT',
      })
    }
  })
  it('rejects every changed target/authority field', () => {
    for (const field of Object.keys(binding) as Array<keyof typeof binding>) {
      const changed = {
        ...binding,
        [field]:
          typeof binding[field] === 'number'
            ? Number(binding[field]) + 1
            : `${binding[field]}-changed`,
      }
      expect(makeSink().submit(result, changed)).toMatchObject({
        accepted: false,
        code: 'STALE_CONTEXT',
      })
    }
  })
  it('never revives cancelled or expired invocations', () => {
    const sink = makeSink()
    sink.cancel()
    expect(sink.submit(result, binding)).toMatchObject({
      accepted: false,
      code: 'CANCELLED',
    })
    expect(
      new TranslationResultSink(binding, input, 0, () => 0).submit(
        result,
        binding,
      ),
    ).toMatchObject({ accepted: false, code: 'EXPIRED' })
  })
})

it('does not promise generic data enrichment without a registered source or supported trigger', () => {
  const request = {
    origin: 'https://example.com',
    execution: 'data' as const,
    trigger: 'document-load' as const,
    content: 'page-elements' as const,
    languages: 'selected' as const,
  }
  const ready = { ...capabilities, data: true }
  expect(assessLayerRequirements(request, ready).disposition).toBe('unverified')
  expect(
    assessLayerRequirements(
      { ...request, dataOperationId: 'linkedin.followers' },
      ready,
    ).disposition,
  ).toBe('unsupported')
  expect(
    assessLayerRequirements(
      { ...request, dataOperationId: 'github.repository.stats' },
      ready,
    ).disposition,
  ).toBe('supported-with-limits')
  expect(
    assessLayerRequirements(
      {
        ...request,
        dataOperationId: 'github.repository.stats',
        trigger: 'click',
      },
      ready,
    ).disposition,
  ).toBe('unsupported')
})

it('assesses generated scripts independently from static engine access and rejects automatic model execution', () => {
  const request = {
    origin: scope.origin,
    execution: 'generated-script' as const,
    trigger: 'click' as const,
    content: 'page-elements' as const,
    languages: 'selected' as const,
  }
  expect(
    assessLayerRequirements(request, {
      ...capabilities,
      javascript: true,
      pageTask: true,
    }).disposition,
  ).toBe('unsupported')
  const available = { ...capabilities, javascript: true, generatedScript: true }
  expect(assessLayerRequirements(request, available).disposition).toBe(
    'supported-with-limits',
  )
  expect(
    assessLayerRequirements({ ...request, trigger: 'document-load' }, available)
      .disposition,
  ).toBe('unsupported')
})
