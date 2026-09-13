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

test('State Composite: three-level nesting round-trips and renders cleanly', async () => {
  const input = [
    'stateDiagram-v2',
    '    [*] --> A',
    '    A --> B',
    '    B --> C',
    '    C --> [*]',
  ].join('\n');

  const ast = parseMermaidStateDiagram(input);
  const m = StateDiagramDriver.mutations;

  // Nest via the same driver paths the canvas uses (group HUD actions)
  const mid = m.createGroupWithMembers!(ast, 'Mid Composite', ['B']);
  const outer = m.createGroupWithMembers!(ast, 'Outer Composite', ['A']);
  m.moveNodeToGroup!(ast, mid, outer);
  const inner = m.createGroupWithMembers!(ast, 'Inner Composite', ['C']);
  m.moveNodeToGroup!(ast, inner, mid);

  const serialized = serializeMermaidStateDiagram(ast);

  // Nested braces: outer opens first, inner opens last
  const outerIdx = serialized.indexOf(`as ${outer} {`);
  const midIdx = serialized.indexOf(`as ${mid} {`);
  const innerIdx = serialized.indexOf(`as ${inner} {`);
  assert.ok(outerIdx !== -1 && midIdx !== -1 && innerIdx !== -1);
  assert.ok(outerIdx < midIdx && midIdx < innerIdx);

  const reparsed = parseMermaidStateDiagram(serialized);
  assert.deepEqual(reparsed.compositeStates.get(outer)?.compositeIds, [mid]);
  assert.deepEqual(reparsed.compositeStates.get(mid)?.compositeIds, [inner]);
  assert.deepEqual(reparsed.compositeStates.get(mid)?.stateIds, ['B']);
  assert.deepEqual(reparsed.compositeStates.get(inner)?.stateIds, ['C']);

  const mermaid = (await import('mermaid')).default;
  mermaid.initialize({ startOnLoad: false });
  const { svg } = await mermaid.render('test_nested_composites', serialized);
  assert.ok(svg.length > 0, 'SVG must render cleanly');
});

test('State Composite: grouping a state of a composite nests inside it', () => {
  const ast = parseMermaidStateDiagram(
    ['stateDiagram-v2', '    [*] --> A', '    A --> B', '    B --> [*]'].join('\n')
  );
  const m = StateDiagramDriver.mutations;
  const comp = m.createGroupWithMembers!(ast, 'Comp', ['A', 'B']);

  const nested = m.createGroupWithMembers!(ast, 'Nested', ['A']);

  assert.deepEqual(ast.compositeStates.get(comp)?.stateIds, ['B']);
  assert.ok(ast.compositeStates.get(comp)?.compositeIds.includes(nested));

  const reparsed = parseMermaidStateDiagram(serializeMermaidStateDiagram(ast));
  assert.ok(reparsed.compositeStates.get(comp)?.compositeIds.includes(nested));
  assert.deepEqual(reparsed.compositeStates.get(nested)?.stateIds, ['A']);
});

test('State Composite: grouping every state of a composite replaces it', () => {
  const ast = parseMermaidStateDiagram(
    ['stateDiagram-v2', '    [*] --> A', '    A --> B', '    B --> [*]'].join('\n')
  );
  const m = StateDiagramDriver.mutations;
  const comp = m.createGroupWithMembers!(ast, 'Comp', ['A', 'B']);

  const replacement = m.createGroupWithMembers!(ast, 'Replacement', ['A', 'B']);

  assert.ok(!ast.compositeStates.has(comp), 'emptied parent must be dissolved');
  assert.deepEqual(ast.compositeStates.get(replacement)?.stateIds, ['A', 'B']);

  const reparsed = parseMermaidStateDiagram(serializeMermaidStateDiagram(ast));
  assert.ok(!reparsed.compositeStates.has(comp));
});

test('State Composite: members from different parents yield a broader composite', () => {
  const ast = parseMermaidStateDiagram(
    ['stateDiagram-v2', '    [*] --> A', '    A --> B', '    B --> C'].join('\n')
  );
  const m = StateDiagramDriver.mutations;
  m.createGroupWithMembers!(ast, 'CompA', ['A']);

  const broad = m.createGroupWithMembers!(ast, 'Broad', ['A', 'C']);

  assert.deepEqual(ast.compositeStates.get(broad)?.stateIds, ['A', 'C']);
  // Top-level: no composite lists it as a child
  for (const c of ast.compositeStates.values()) {
    assert.ok(!(c.compositeIds || []).includes(broad));
  }

  const reparsed = parseMermaidStateDiagram(serializeMermaidStateDiagram(ast));
  assert.deepEqual(reparsed.compositeStates.get(broad)?.stateIds, ['A', 'C']);
});

test('State Composite: mixed members dissolve a fully drained composite', () => {
  const ast = parseMermaidStateDiagram(
    ['stateDiagram-v2', '    [*] --> A', '    A --> C'].join('\n')
  );
  const m = StateDiagramDriver.mutations;
  const compA = m.createGroupWithMembers!(ast, 'CompA', ['A']);

  const broad = m.createGroupWithMembers!(ast, 'Broad', ['A', 'C']);

  assert.deepEqual(ast.compositeStates.get(broad)?.stateIds, ['A', 'C']);
  assert.ok(!ast.compositeStates.has(compA), 'drained composite must dissolve');

  const reparsed = parseMermaidStateDiagram(serializeMermaidStateDiagram(ast));
  assert.ok(!reparsed.compositeStates.has(compA));
});

test('State Composite: partially drained composite survives', () => {
  const ast = parseMermaidStateDiagram(
    ['stateDiagram-v2', '    [*] --> A', '    A --> B', '    B --> C'].join('\n')
  );
  const m = StateDiagramDriver.mutations;
  const comp = m.createGroupWithMembers!(ast, 'Comp', ['A', 'B']);

  m.createGroupWithMembers!(ast, 'Broad', ['A', 'C']);

  assert.deepEqual(ast.compositeStates.get(comp)?.stateIds, ['B']);
});

test('State Composite: dissolved shell transitions retarget onto the new composite', () => {
  const ast = parseMermaidStateDiagram(
    ['stateDiagram-v2', '    [*] --> A', '    A --> B', '    B --> C'].join('\n')
  );
  const m = StateDiagramDriver.mutations;
  const compA = m.createGroupWithMembers!(ast, 'CompA', ['A']);
  m.connect(ast, 'C', compA);
  assert.ok(ast.transitions.some((t) => t.to === compA));

  const broad = m.createGroupWithMembers!(ast, 'Broad', ['A', 'B']);

  assert.ok(!ast.compositeStates.has(compA));
  assert.ok(
    ast.transitions.some((t) => t.from === 'C' && t.to === broad),
    'transition must follow the members, not drop with the shell'
  );

  const serialized = serializeMermaidStateDiagram(ast);
  assert.ok(!serialized.includes(compA));
  const reparsed = parseMermaidStateDiagram(serialized);
  assert.ok(reparsed.transitions.some((t) => t.from === 'C' && t.to === broad));
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
