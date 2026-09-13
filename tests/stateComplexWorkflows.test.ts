import test from 'node:test';
import assert from 'node:assert';
import { parseMermaidStateDiagram } from '../src/diagrams/state/parser';
import { serializeMermaidStateDiagram } from '../src/diagrams/state/serializer';
import { StateDiagramDriver } from '../src/diagrams/state/stateDriver';
import {
  addState,
  addStartState,
  addEndState,
  hasStartState,
  hasEndState,
  deleteStartAnchor,
  deleteEndAnchor,
  deleteState,
  deleteCompositeState,
  createCompositeState,
  moveStateToComposite,
  insertStateOnTransition,
  connectStates,
  updateStateStyle,
  clearStateStyle,
} from '../src/diagrams/state/mutations';

test('Complex State Diagram: Multi-level nested composites with dissolve and delete', () => {
  const code = `stateDiagram-v2
    state GrandParent {
        state Parent {
            state Child {
                c1 --> c2
            }
            p1
        }
        g1
    }`;

  const ast = parseMermaidStateDiagram(code);
  assert.ok(ast.compositeStates.has('GrandParent'));
  assert.ok(ast.compositeStates.has('Parent'));
  assert.ok(ast.compositeStates.has('Child'));
  assert.deepStrictEqual(ast.compositeStates.get('GrandParent')?.compositeIds, ['Parent']);
  assert.deepStrictEqual(ast.compositeStates.get('Parent')?.compositeIds, ['Child']);

  // Dissolving Parent should reparent Child and p1 to GrandParent
  deleteCompositeState(ast, 'Parent', false);
  assert.strictEqual(ast.compositeStates.has('Parent'), false);
  assert.ok(ast.compositeStates.has('GrandParent'));
  assert.ok(ast.compositeStates.has('Child'));

  const gp = ast.compositeStates.get('GrandParent')!;
  assert.ok(gp.compositeIds.includes('Child'), 'Child must be reparented to GrandParent');
  assert.ok(!gp.compositeIds.includes('Parent'), 'Parent ghost ID must be removed');
  assert.ok(gp.stateIds.includes('p1'), 'p1 must be reparented to GrandParent');
  assert.strictEqual(ast.states.get('p1')?.compositeId, 'GrandParent');

  // Deleting GrandParent with deleteInnerStates=true should recursively delete Child and all states
  deleteCompositeState(ast, 'GrandParent', true);
  assert.strictEqual(ast.compositeStates.has('GrandParent'), false);
  assert.strictEqual(ast.compositeStates.has('Child'), false);
  assert.strictEqual(ast.states.has('c1'), false);
  assert.strictEqual(ast.states.has('c2'), false);
  assert.strictEqual(ast.states.has('p1'), false);
  assert.strictEqual(ast.states.has('g1'), false);
});

test('Complex State Diagram: Root start/end anchors isolated from composite internal start/end', () => {
  const code = `stateDiagram-v2
    [*] --> Active
    state Active {
        [*] --> Inner1
        Inner1 --> [*]
    }
    Active --> [*]`;

  const ast = parseMermaidStateDiagram(code);

  // Both root and composite have start/end
  assert.strictEqual(hasStartState(ast), true);
  assert.strictEqual(hasEndState(ast), true);

  // Deleting root start anchor must NOT delete composite inner start
  deleteStartAnchor(ast);
  assert.strictEqual(hasStartState(ast), false, 'Root start should now be gone');
  assert.ok(
    ast.transitions.some((t) => t.from === '[*]' && t.to === 'Inner1'),
    'Inner start of Active must remain intact'
  );

  // Adding root start back should be allowed since root has none
  const newStartId = addStartState(ast, 'Initial');
  assert.ok(newStartId, 'Should successfully add root start');
  assert.strictEqual(hasStartState(ast), true);

  // Deleting composite Active with deleteInnerStates=true must NOT delete root start or root end
  deleteCompositeState(ast, 'Active', true);
  assert.ok(ast.states.has(newStartId), 'Initial state must survive');
  assert.ok(
    ast.transitions.some((t) => t.from === '[*]' && t.to === newStartId),
    'Root start transition must survive composite deletion'
  );
});

test('Complex State Diagram: insertStateOnTransition inside composite preserves composite scope', () => {
  const code = `stateDiagram-v2
    state Processing {
        Validate --> Charge : ok
    }`;

  const ast = parseMermaidStateDiagram(code);
  const tr = ast.transitions[0];
  const insertedId = insertStateOnTransition(ast, tr.id, 'FraudCheck');

  assert.ok(insertedId);
  const insertedState = ast.states.get(insertedId);
  assert.strictEqual(
    insertedState?.compositeId,
    'Processing',
    'Inserted state must be placed inside the Processing composite'
  );
  assert.ok(
    ast.compositeStates.get('Processing')?.stateIds.includes(insertedId),
    'Processing composite must contain inserted state in stateIds'
  );

  const serialized = serializeMermaidStateDiagram(ast);
  assert.match(serialized, /state Processing \{[\s\S]*FraudCheck[\s\S]*\}/);
});

test('Complex State Diagram: parse state S1 : Description syntax', () => {
  const code = `stateDiagram-v2
    state S1 : User Authentication
    state S2 : Process Payment
    S1 --> S2`;

  const ast = parseMermaidStateDiagram(code);
  assert.strictEqual(ast.states.get('S1')?.label, 'User Authentication');
  assert.strictEqual(ast.states.get('S2')?.label, 'Process Payment');
});

test('Complex State Diagram: direction tokens (LR, TB, RL, BT) used as state identifiers', () => {
  const code = `stateDiagram-v2
    [*] --> LR
    LR --> TB : step
    TB --> [*]`;

  const ast = parseMermaidStateDiagram(code);
  assert.strictEqual(ast.states.has('LR'), true);
  assert.strictEqual(ast.states.has('TB'), true);
  assert.strictEqual(ast.transitions.length, 3);

  const serialized = serializeMermaidStateDiagram(ast);
  assert.match(serialized, /\[\*\] --> LR/);
  assert.match(serialized, /LR --> TB : step/);
  assert.match(serialized, /TB --> \[\*\]/);
});

test('Complex State Diagram: quoted string endpoints in transitions', () => {
  const code = `stateDiagram-v2
    "Start Step" --> "Next Step" : continue
    "Next Step" --> End`;

  const ast = parseMermaidStateDiagram(code);
  assert.strictEqual(ast.states.has('Start Step'), true);
  assert.strictEqual(ast.states.has('Next Step'), true);
  assert.strictEqual(ast.states.has('End'), true);
  assert.strictEqual(ast.transitions.length, 2);
});

test('Complex State Diagram: multi-line note block produces no junk states', () => {
  const code = `stateDiagram-v2
    [*] --> Idle
    note right of Idle
        First line of note
        Second line of note
    end note
    Idle --> [*]`;

  const ast = parseMermaidStateDiagram(code);
  assert.strictEqual(ast.states.has('First'), false);
  assert.strictEqual(ast.states.has('Second'), false);
  assert.strictEqual(ast.states.has('line'), false);
  assert.strictEqual(ast.states.has('end'), false);
  assert.strictEqual(ast.states.size, 2); // [*] and Idle

  const serialized = serializeMermaidStateDiagram(ast);
  assert.match(serialized, /note right of Idle/);
  assert.match(serialized, /First line of note/);
  assert.match(serialized, /end note/);
});

test('Complex State Diagram: composite state styling round-trip and driver projection', () => {
  const code = `stateDiagram-v2
    state Workflow {
        s1 --> s2
    }
    style Workflow fill:#fef3c7,stroke:#d97706`;

  const ast = parseMermaidStateDiagram(code);
  const comp = ast.compositeStates.get('Workflow');
  assert.ok(comp?.style, 'Composite must have style object populated');
  assert.strictEqual(comp?.style?.fill, '#fef3c7');
  assert.strictEqual(comp?.style?.stroke, '#d97706');

  // Projection through driver must carry the style
  const projection = StateDiagramDriver.project(ast);
  const sub = projection.subgraphs.get('Workflow');
  assert.strictEqual(sub?.style?.fill, '#fef3c7');

  const serialized = serializeMermaidStateDiagram(ast);
  assert.match(serialized, /style Workflow fill:#fef3c7,stroke:#d97706/);
});

test('Complex State Diagram: multi-target style statement', () => {
  const code = `stateDiagram-v2
    s1 --> s2
    style s1, s2 fill:#ff0000,stroke:#00ff00`;

  const ast = parseMermaidStateDiagram(code);
  assert.strictEqual(ast.states.get('s1')?.style?.fill, '#ff0000');
  assert.strictEqual(ast.states.get('s2')?.style?.fill, '#ff0000');
});

test('Complex State Diagram: escapeString safely handles newlines and quotes', () => {
  const ast = parseMermaidStateDiagram('stateDiagram-v2\n    s1');
  const state = ast.states.get('s1')!;
  state.label = 'Line 1\nLine 2 with "quotes"';

  const serialized = serializeMermaidStateDiagram(ast);
  assert.match(serialized, /state "Line 1\\nLine 2 with \\"quotes\\"" as s1/);
});

test('Complex State Diagram: createGroupWithMembers guarantees non-empty composite', () => {
  const ast = StateDiagramDriver.createEmpty();
  // Pass empty list or non-existent IDs
  const compId = StateDiagramDriver.mutations.createGroupWithMembers(ast, 'EmptyGroup', ['[*]']);
  assert.ok(ast.compositeStates.has(compId));
  const comp = ast.compositeStates.get(compId)!;
  assert.ok(comp.stateIds.length > 0, 'Must have at least one member to prevent empty braces');

  const serialized = StateDiagramDriver.serialize(ast);
  assert.doesNotMatch(serialized, /\{\s*\}/, 'Must never emit empty braces');
});

test('Complex State Diagram: nesting composite in another composite via moveNodeToGroup and cycle prevention', () => {
  const code = `stateDiagram-v2
    state CompA {
        s1 --> s2
    }
    state CompB {
        s3 --> s4
    }`;
  const ast = StateDiagramDriver.parse(code);

  // Nest CompB inside CompA via moveNodeToGroup
  StateDiagramDriver.mutations.moveNodeToGroup(ast, 'CompB', 'CompA');
  assert.ok(ast.compositeStates.get('CompA')?.compositeIds.includes('CompB'));

  // Attempt cycle: try nesting CompA into CompB
  StateDiagramDriver.mutations.moveNodeToGroup(ast, 'CompA', 'CompB');
  // CompB must NOT contain CompA (cycle prevented)
  assert.strictEqual(ast.compositeStates.get('CompB')?.compositeIds.includes('CompA'), false);

  // Serialized diagram should have CompB inside CompA
  const serialized = StateDiagramDriver.serialize(ast);
  assert.match(serialized, /state CompA \{[\s\S]*state CompB \{/);

  // Unnest CompB back to root
  StateDiagramDriver.mutations.moveNodeToGroup(ast, 'CompB', null as any);
  assert.strictEqual(ast.compositeStates.get('CompA')?.compositeIds.includes('CompB'), false);
});

test('Complex State Diagram: deleting nested composite never produces syntax errors or empty braces', () => {
  // Case A: Parent composite only contained the nested composite
  const codeA = `stateDiagram-v2
    state Parent {
        state Child {
            c1 --> c2
        }
    }`;
  const astA = StateDiagramDriver.parse(codeA);
  // Deleting Child with inner states
  StateDiagramDriver.mutations.deleteGroup(astA, 'Child', true);
  const serA = StateDiagramDriver.serialize(astA);
  assert.doesNotMatch(serA, /\{\s*\}/, 'Parent must not be emitted as empty braces { }');
  assert.strictEqual(astA.compositeStates.has('Parent'), false, 'Emptied parent must be pruned');

  // Case B: Parent composite had another standalone state
  const codeB = `stateDiagram-v2
    state Parent {
        state Child {
            c1 --> c2
        }
        state s3
    }`;
  const astB = StateDiagramDriver.parse(codeB);
  StateDiagramDriver.mutations.deleteGroup(astB, 'Child', true);
  const serB = StateDiagramDriver.serialize(astB);
  assert.match(serB, /state Parent \{[\s\S]*s3[\s\S]*\}/, 'Standalone state must be preserved in parent');
  assert.doesNotMatch(serB, /state s3/, 'Must not use state keyword for bare state inside composite');
  assert.doesNotMatch(serB, /\{\s*\}/, 'Must never emit empty braces');

  // Case C: Dissolving Child reparents inner states and declares them properly
  const codeC = `stateDiagram-v2
    state Parent {
        state Child {
            c1 --> c2
        }
    }`;
  const astC = StateDiagramDriver.parse(codeC);
  StateDiagramDriver.mutations.deleteGroup(astC, 'Child', false);
  const serC = StateDiagramDriver.serialize(astC);
  assert.match(serC, /state Parent \{[\s\S]*c1 --> c2[\s\S]*\}/);
});

test('Complex State Diagram: only outer nodes can point to composites', () => {
  const code = `stateDiagram-v2
    state OuterComp {
        state InnerComp {
            c1 --> c2
        }
        s1
    }
    rootNode`;
  const ast = StateDiagramDriver.parse(code);

  // 1. Root node (outer) connecting to OuterComp: ALLOWED
  StateDiagramDriver.mutations.connect(ast, 'rootNode', 'OuterComp');
  assert.ok(ast.transitions.some((t) => t.from === 'rootNode' && t.to === 'OuterComp'));

  // 2. Direct inner node (s1) connecting to OuterComp: BLOCKED
  StateDiagramDriver.mutations.connect(ast, 's1', 'OuterComp');
  assert.strictEqual(ast.transitions.some((t) => t.from === 's1' && t.to === 'OuterComp'), false);

  // 3. Deep inner node (c1) connecting to OuterComp: BLOCKED
  StateDiagramDriver.mutations.connect(ast, 'c1', 'OuterComp');
  assert.strictEqual(ast.transitions.some((t) => t.from === 'c1' && t.to === 'OuterComp'), false);

  // 4. Nested composite (InnerComp) connecting to OuterComp: BLOCKED
  StateDiagramDriver.mutations.connect(ast, 'InnerComp', 'OuterComp');
  assert.strictEqual(ast.transitions.some((t) => t.from === 'InnerComp' && t.to === 'OuterComp'), false);

  // 5. Outer node connecting to nested composite (s1 -> InnerComp): ALLOWED
  StateDiagramDriver.mutations.connect(ast, 's1', 'InnerComp');
  assert.ok(ast.transitions.some((t) => t.from === 's1' && t.to === 'InnerComp'));

  // 6. Moving an outer node with existing transition to OuterComp purges the invalid transition
  const astMove = StateDiagramDriver.parse(`stateDiagram-v2
    state OuterComp {
        state s1
    }
    outerNode --> OuterComp`);
  // Move outerNode into OuterComp
  StateDiagramDriver.mutations.moveNodeToGroup(astMove, 'outerNode', 'OuterComp');
  assert.strictEqual(
    astMove.transitions.some((t) => t.from === 'outerNode' && t.to === 'OuterComp'),
    false,
    'Transition from newly-nested node to enclosing composite must be purged'
  );
});
