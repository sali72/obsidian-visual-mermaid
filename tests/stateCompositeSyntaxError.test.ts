import test from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import { parseMermaidStateDiagram } from '../src/diagrams/state/parser';
import { serializeMermaidStateDiagram } from '../src/diagrams/state/serializer';
import { StateDiagramDriver } from '../src/diagrams/state/stateDriver';

// Setup DOM mock for mermaid.render
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="container"></div></body></html>');
(global as any).window = dom.window;
(global as any).document = dom.window.document;
(global as any).SVGElement = dom.window.SVGElement;
dom.window.SVGElement.prototype.getBBox = () => ({ x: 0, y: 0, width: 100, height: 100 });
(global as any).CSSStyleSheet = class CSSStyleSheet {
  cssRules = [];
  replaceSync() {}
  insertRule() {}
};

test('State Composite: single state without start/end anchor renders without roundedWithTitle error', async () => {
  const input = [
    'stateDiagram-v2',
    '    state "New Composite" as comp_1 {',
    '        Idle',
    '        [*] --> Idle',
    '    }',
    '    Idle --> Processing : Submit',
    '    Processing --> Success : Approve',
    '    Processing --> Failed : Reject',
    '    Failed --> Idle : Retry',
    '    Success --> [*]',
  ].join('\n');

  const ast = parseMermaidStateDiagram(input);

  // Group 'Processing' (which is NOT connected to start or end)
  StateDiagramDriver.mutations.createGroupWithMembers!(ast, 'New Composite', ['Processing']);

  const serialized = serializeMermaidStateDiagram(ast);

  // Must emit bare identifier "Processing", NOT "state Processing" which crashes Mermaid
  assert.match(serialized, /state "New Composite" as comp_2 \{[\s\S]*Processing[\s\S]*\}/);
  assert.doesNotMatch(serialized, /state Processing/);

  // Cross-composite transitions must NOT be dropped
  assert.match(serialized, /Idle --> Processing : Submit/);
  assert.match(serialized, /Processing --> Success : Approve/);
  assert.match(serialized, /Processing --> Failed : Reject/);
  assert.match(serialized, /Failed --> Idle : Retry/);
  assert.match(serialized, /Success --> \[\*\]/);

  // Must render in Mermaid without "No such shape: roundedWithTitle"
  const mermaid = (await import('mermaid')).default;
  mermaid.initialize({ startOnLoad: false });
  const { svg } = await mermaid.render('test_comp_processing', serialized);
  assert.ok(svg.length > 0, 'SVG must render cleanly');
});

test('State Composite: multiple states without start/end anchors render cleanly', async () => {
  const input = [
    'stateDiagram-v2',
    '    [*] --> Idle',
    '    Idle --> Processing : Submit',
    '    Processing --> Success : Approve',
    '    Processing --> Failed : Reject',
    '    Failed --> Idle : Retry',
    '    Success --> [*]',
  ].join('\n');

  const ast = parseMermaidStateDiagram(input);

  // Group both Processing and Failed into a composite
  StateDiagramDriver.mutations.createGroupWithMembers!(ast, 'Worker Composite', ['Processing', 'Failed']);

  const serialized = serializeMermaidStateDiagram(ast);

  assert.match(serialized, /state "Worker Composite" as comp_1 \{/);
  assert.doesNotMatch(serialized, /state Processing/);
  assert.doesNotMatch(serialized, /state Failed/);

  const mermaid = (await import('mermaid')).default;
  mermaid.initialize({ startOnLoad: false });
  const { svg } = await mermaid.render('test_worker_comp', serialized);
  assert.ok(svg.length > 0, 'SVG must render cleanly');
});

test('State Composite: getAnchorCompositeId correctly parses diagram-prefixed IDs', () => {
  const getCompId = StateDiagramDriver.dom.getAnchorCompositeId!;

  const makeMockEl = (id: string) => {
    const el = dom.window.document.createElement('div');
    el.setAttribute('id', id);
    return el as any;
  };

  assert.strictEqual(getCompId(makeMockEl('dmermaid-0-state-comp_1_start-0')), 'comp_1');
  assert.strictEqual(getCompId(makeMockEl('test_id-state-comp_1_end-2')), 'comp_1');
  assert.strictEqual(getCompId(makeMockEl('state-comp_2_start-0')), 'comp_2');
  assert.strictEqual(getCompId(makeMockEl('dmermaid-0-state-root_start-0')), null);
  assert.strictEqual(getCompId(makeMockEl('dmermaid-0-state-root_end-0')), null);
});
