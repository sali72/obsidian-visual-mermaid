import test from 'node:test';
import assert from 'node:assert';
import { parseMermaidStateDiagram } from '../src/diagrams/state/parser';
import { serializeMermaidStateDiagram } from '../src/diagrams/state/serializer';
import {
  addChildState,
  addState,
  connectStates,
  createCompositeState,
  deleteState,
  deleteTransition,
  moveStateToComposite,
  updateStateLabel,
  updateStateType,
  updateTransitionLabel,
  updateStateStyle,
  clearStateStyle,
  updateStatesStyle,
  clearStatesStyle,
  updateCompositeStateStyle,
  duplicateStates,
  hasStartState,
  hasEndState,
  addStartState,
  addEndState,
  deleteStartAnchor,
  deleteEndAnchor,
} from '../src/diagrams/state/mutations';

test('State Mutations: addState and addChildState sprouting', () => {
  const ast = parseMermaidStateDiagram('stateDiagram-v2\n    [*] --> Idle');
  const s2 = addChildState(ast, 'Idle', 'Processing', 'submit');

  assert.strictEqual(ast.states.has(s2), true);
  assert.strictEqual(ast.states.get(s2)?.label, 'Processing');
  const tr = ast.transitions.find((t) => t.from === 'Idle' && t.to === s2);
  assert.ok(tr);
  assert.strictEqual(tr?.label, 'submit');

  const serialized = serializeMermaidStateDiagram(ast);
  assert.match(serialized, /Idle --> s_.* : submit/);
});

test('State Mutations: connectStates and deleteTransition', () => {
  const ast = parseMermaidStateDiagram('stateDiagram-v2\n    [*] --> S1\n    S2 --> [*]');
  const tr = connectStates(ast, 'S1', 'S2', 'transition');
  assert.ok(tr);
  assert.strictEqual(ast.transitions.length, 3);

  deleteTransition(ast, tr!.id);
  assert.strictEqual(ast.transitions.length, 2);
});

test('State Mutations: deleteState cascades transitions', () => {
  const ast = parseMermaidStateDiagram(`stateDiagram-v2
    [*] --> A
    A --> B : to B
    B --> C : to C
    C --> [*]`);

  assert.strictEqual(ast.transitions.length, 4);
  deleteState(ast, 'B');

  assert.strictEqual(ast.states.has('B'), false);
  // Transitions connected to B (A --> B and B --> C) should be deleted
  assert.strictEqual(ast.transitions.length, 2);
  assert.strictEqual(ast.transitions.some((t) => t.from === 'B' || t.to === 'B'), false);
});

test('State Mutations: updateStateLabel and updateStateType morphing', () => {
  const ast = parseMermaidStateDiagram('stateDiagram-v2\n    [*] --> Decision');
  updateStateLabel(ast, 'Decision', 'Check Condition');
  assert.strictEqual(ast.states.get('Decision')?.label, 'Check Condition');

  updateStateType(ast, 'Decision', 'choice');
  assert.strictEqual(ast.states.get('Decision')?.stateType, 'choice');
  // Choice diamonds carry no text (label reset to id)
  assert.strictEqual(ast.states.get('Decision')?.label, 'Decision');

  const serialized = serializeMermaidStateDiagram(ast);
  assert.match(serialized, /state Decision <<choice>>/);
});

test('State Mutations: composite state creation and grouping', () => {
  const ast = parseMermaidStateDiagram('stateDiagram-v2\n    [*] --> S1\n    S1 --> S2');
  const compId = createCompositeState(ast, 'MainFlow');
  moveStateToComposite(ast, 'S1', compId);
  moveStateToComposite(ast, 'S2', compId);

  const comp = ast.compositeStates.get(compId)!;
  assert.deepStrictEqual(comp.stateIds, ['S1', 'S2']);
  assert.strictEqual(ast.states.get('S1')?.compositeId, compId);
  assert.strictEqual(ast.states.get('S2')?.compositeId, compId);

  const serialized = serializeMermaidStateDiagram(ast);
  assert.match(serialized, /state "MainFlow" as comp_1 \{/);
  assert.match(serialized, /S1/);
  assert.match(serialized, /S2/);
  assert.match(serialized, /S1 --> S2/);
});

test('State Mutations: single state in group never loses state or emits empty braces', () => {
  const ast = parseMermaidStateDiagram('stateDiagram-v2\n    [*] --> Solo');
  const compId = createCompositeState(ast, 'SoloGroup');
  moveStateToComposite(ast, 'Solo', compId);

  const serialized = serializeMermaidStateDiagram(ast);
  assert.match(serialized, /state "SoloGroup" as comp_1 \{/);
  assert.match(serialized, /Solo/);
  // Braces must NOT be empty
  assert.doesNotMatch(serialized, /state "SoloGroup" as comp_1 \{\s*\}/);

  // Ungrouping auto-dissolves the composite state
  moveStateToComposite(ast, 'Solo', undefined);
  assert.strictEqual(ast.compositeStates.has(compId), false);
  const ungrouped = serializeMermaidStateDiagram(ast);
  assert.doesNotMatch(ungrouped, /SoloGroup/);
  assert.match(ungrouped, /Solo/);
});

test('State Mutations: unconnected normal state is never dropped', () => {
  const ast = parseMermaidStateDiagram('stateDiagram-v2\n    [*] --> S1');
  addState(ast, 'OrphanState', 'normal');

  const serialized = serializeMermaidStateDiagram(ast);
  assert.match(serialized, /OrphanState/);
});

test('State Mutations: state and composite styling round-trip', () => {
  const ast = parseMermaidStateDiagram(`stateDiagram-v2
    [*] --> Active
    Active --> Done
    Done --> [*]`);

  // Apply theme style
  updateStateStyle(ast, 'Active', { fill: '#d1fae5', stroke: '#059669', color: '#065f46' });
  const compId = createCompositeState(ast, 'SubFlow');
  updateCompositeStateStyle(ast, compId, { fill: '#fef3c7', stroke: '#d97706' });

  const serialized = serializeMermaidStateDiagram(ast);
  // Diagram should NOT be wiped! All states, transitions, and styles preserved
  assert.match(serialized, /\[\*\] --> Active/);
  assert.match(serialized, /Active --> Done/);
  assert.match(serialized, /style Active fill:#d1fae5,stroke:#059669,color:#065f46/);
  assert.match(serialized, /style comp_1 fill:#fef3c7,stroke:#d97706/);

  // Clear style
  clearStateStyle(ast, 'Active');
  const cleared = serializeMermaidStateDiagram(ast);
  assert.doesNotMatch(cleared, /style Active/);
  assert.match(cleared, /Active --> Done/);
});

test('State Mutations: start/end are added via actions, never by morphing nodes', () => {
  const ast = parseMermaidStateDiagram(`stateDiagram-v2
    StartNode --> S1
    S1 --> EndNode`);

  // Morphing a node to start/end is a no-op (anchors are added explicitly)
  updateStateType(ast, 'StartNode', 'start');
  updateStateType(ast, 'EndNode', 'end');
  assert.strictEqual(ast.states.has('StartNode'), true);
  assert.strictEqual(ast.states.has('EndNode'), true);
  assert.strictEqual(
    ast.transitions.some((t) => t.from === '[*]' && t.to === '[*]'),
    false
  );

  const serialized = serializeMermaidStateDiagram(ast);
  // Must NOT emit state "[*]" as id, nor invalid [*] --> [*] self-loops
  assert.doesNotMatch(serialized, /state "\[\*\]" as/);
  assert.doesNotMatch(serialized, /state \[\*\] as/);
  assert.doesNotMatch(serialized, /\[\*\] --> \[\*\]/);
});

test('State Mutations: add start/end anchors exactly once', () => {
  const ast = parseMermaidStateDiagram('stateDiagram-v2\n    A --> B');
  const { addStartState, addEndState, hasStartState, hasEndState } = require('../src/diagrams/state/mutations');

  assert.strictEqual(hasStartState(ast), false);
  assert.strictEqual(hasEndState(ast), false);

  const startId = addStartState(ast, 'First');
  assert.ok(startId);
  assert.strictEqual(hasStartState(ast), true);
  assert.strictEqual(addStartState(ast, 'Again'), null);

  const endId = addEndState(ast, 'Last');
  assert.ok(endId);
  assert.strictEqual(hasEndState(ast), true);
  assert.strictEqual(addEndState(ast, 'Again'), null);

  const serialized = serializeMermaidStateDiagram(ast);
  assert.match(serialized, /\[\*\] -->/);
  assert.match(serialized, /--> \[\*\]/);
  assert.doesNotMatch(serialized, /\[\*\] --> \[\*\]/);
});

test('State Mutations: only normal states carry editable text (choice/fork/join do not)', () => {
  const ast = parseMermaidStateDiagram('stateDiagram-v2\n    [*] --> C');
  const { updateStateLabel, isStateTextEditable } = require('../src/diagrams/state/mutations');

  updateStateLabel(ast, 'C', 'Hello');
  assert.strictEqual(ast.states.get('C')?.label, 'Hello');
  assert.strictEqual(isStateTextEditable(ast.states.get('C')), true);

  updateStateType(ast, 'C', 'choice');
  assert.strictEqual(isStateTextEditable(ast.states.get('C')), false);
  assert.strictEqual(ast.states.get('C')?.label, 'C');
  updateStateLabel(ast, 'C', 'Pick One');
  assert.notStrictEqual(ast.states.get('C')?.label, 'Pick One');
  assert.doesNotMatch(serializeMermaidStateDiagram(ast), /Pick One/);

  updateStateType(ast, 'C', 'fork');
  assert.strictEqual(isStateTextEditable(ast.states.get('C')), false);
  updateStateLabel(ast, 'C', 'Ignored');
  assert.notStrictEqual(ast.states.get('C')?.label, 'Ignored');

  updateStateType(ast, 'C', 'normal');
  assert.strictEqual(isStateTextEditable(ast.states.get('C')), true);
  updateStateLabel(ast, 'C', 'Back To Normal');
  assert.strictEqual(ast.states.get('C')?.label, 'Back To Normal');
});

test('State Mutations: duplicate states clones states and internal transitions', () => {
  const ast = parseMermaidStateDiagram(`stateDiagram-v2
    [*] --> A
    A --> B : next
    B --> [*]`);

  const result = duplicateStates(ast, ['A', 'B']);
  assert.strictEqual(result.stateIds.length, 2);
  assert.strictEqual(result.transitionIds.length, 1);

  const serialized = serializeMermaidStateDiagram(ast);
  assert.match(serialized, /A --> B : next/);
  assert.match(serialized, /Copy/);
});

test('State Mutations: composite start and end states independently managed from root', () => {
  const ast = parseMermaidStateDiagram(`stateDiagram-v2
    [*] --> Active
    Active --> [*]
    state Active {
        Idle --> Running : start
    }`);

  // Root has start & end, Active does not
  assert.strictEqual(hasStartState(ast), true);
  assert.strictEqual(hasEndState(ast), true);
  assert.strictEqual(hasStartState(ast, 'Active'), false);
  assert.strictEqual(hasEndState(ast, 'Active'), false);

  // Add start to Active
  const innerStartId = addStartState(ast, 'Initial', 'Active');
  assert.ok(innerStartId);
  assert.strictEqual(hasStartState(ast, 'Active'), true);
  assert.strictEqual(ast.states.get(innerStartId)?.compositeId, 'Active');

  // Second add start to Active must be blocked
  const dupStart = addStartState(ast, 'SecondInitial', 'Active');
  assert.strictEqual(dupStart, null);

  // Add end to Active
  const innerEndId = addEndState(ast, 'Final', 'Active');
  assert.ok(innerEndId);
  assert.strictEqual(hasEndState(ast, 'Active'), true);
  assert.strictEqual(ast.states.get(innerEndId)?.compositeId, 'Active');

  // Verify serialization produces 100% valid Mermaid syntax with [*] inside Active
  const serialized = serializeMermaidStateDiagram(ast);
  assert.ok(serialized.includes(`[*] --> ${innerStartId}`));
  assert.ok(serialized.includes(`${innerEndId} --> [*]`));
  assert.match(serialized, /state "Initial" as/);
  assert.match(serialized, /state "Final" as/);
  assert.match(serialized, /\[\*\] --> Active/);
  assert.match(serialized, /Active --> \[\*\]/);

  // Deleting composite start does not delete root start
  deleteStartAnchor(ast, 'Active');
  assert.strictEqual(hasStartState(ast, 'Active'), false);
  assert.strictEqual(hasStartState(ast), true);

  // Deleting root end does not delete composite end
  deleteEndAnchor(ast);
  assert.strictEqual(hasEndState(ast), false);
  assert.strictEqual(hasEndState(ast, 'Active'), true);
});

test('State Mutations: driver projection and DOM adapter for composite anchors', () => {
  const { getDriver } = require('../src/diagrams/registry');
  const driver = getDriver('stateDiagram')!;

  const code = `stateDiagram-v2
    [*] --> CompA
    state CompA {
        [*] --> s1
        s1 --> [*]
    }`;

  const ast = driver.parse(code);
  const proj = driver.project(ast);

  // Root start anchor projected
  assert.ok(proj.nodes.has('[*]'));
  assert.strictEqual(proj.nodes.get('[*]')?.subgraphId, undefined);

  // CompA anchor projected with composite scope
  assert.ok(proj.nodes.has('[*]:CompA'));
  assert.strictEqual(proj.nodes.get('[*]:CompA')?.subgraphId, 'CompA');
  assert.ok(proj.subgraphs.get('CompA')?.nodeIds.includes('[*]:CompA'));

  // Driver anchor API
  assert.strictEqual(driver.mutations.anchors?.isAnchor('[*]'), true);
  assert.strictEqual(driver.mutations.anchors?.isAnchor('[*]:CompA'), true);
  assert.strictEqual(driver.mutations.anchors?.isAnchor('s1'), false);
  assert.strictEqual(driver.mutations.anchors?.has(ast, 'start', 'CompA'), true);
  assert.strictEqual(driver.mutations.anchors?.has(ast, 'end', 'CompA'), true);

  // Mock DOM elements to test driver.dom adapter
  const mockCompStartEl = {
    getAttribute: (name: string) => (name === 'id' ? 'state-CompA_start-3' : null),
    classList: { contains: () => false },
    closest: () => null,
    querySelector: () => null,
  } as any;

  const mockCompEndEl = {
    getAttribute: (name: string) => (name === 'id' ? 'state-CompA_end-4' : null),
    classList: { contains: () => false },
    closest: () => null,
    querySelector: () => null,
  } as any;

  const mockRootStartEl = {
    getAttribute: (name: string) => (name === 'id' ? 'state-root_start-0' : null),
    classList: { contains: () => false },
    closest: () => null,
    querySelector: () => null,
  } as any;

  assert.strictEqual(driver.dom.getAnchorKind?.(mockCompStartEl), 'start');
  assert.strictEqual(driver.dom.getAnchorCompositeId?.(mockCompStartEl), 'CompA');

  assert.strictEqual(driver.dom.getAnchorKind?.(mockCompEndEl), 'end');
  assert.strictEqual(driver.dom.getAnchorCompositeId?.(mockCompEndEl), 'CompA');

  assert.strictEqual(driver.dom.getAnchorKind?.(mockRootStartEl), 'start');
  assert.strictEqual(driver.dom.getAnchorCompositeId?.(mockRootStartEl), null);
});

test('State Mutations: scoped anchor drag-connection guard', () => {
  const ast = parseMermaidStateDiagram(`stateDiagram-v2
    state CompA {
        a1
    }
    state CompB {
        b1
    }`);

  // Connecting CompA start anchor to a1 (inside CompA) must succeed
  const tr1 = connectStates(ast, '[*]:CompA', 'a1');
  assert.ok(tr1);
  assert.strictEqual(tr1.from, '[*]');
  assert.strictEqual(tr1.to, 'a1');

  // Connecting CompA start anchor to b1 (inside CompB) must be blocked
  const tr2 = connectStates(ast, '[*]:CompA', 'b1');
  assert.strictEqual(tr2, null);

  // Connecting a1 to CompA end anchor must succeed
  const tr3 = connectStates(ast, 'a1', '[*]:CompA');
  assert.ok(tr3);
  assert.strictEqual(tr3.from, 'a1');
  assert.strictEqual(tr3.to, '[*]');

  // Connecting b1 to CompA end anchor must be blocked
  const tr4 = connectStates(ast, 'b1', '[*]:CompA');
  assert.strictEqual(tr4, null);
});
