import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { parseMermaidFlowchart } from '../src/diagrams/flowchart/parser';
import { serializeMermaidFlowchart } from '../src/diagrams/flowchart/serializer';
import {
  createSubgraph,
  deleteSubgraph,
  findParentSubgraphId,
  renameSubgraph,
  moveNodeToSubgraph,
  moveNodesToSubgraph,
  moveSubgraphToSubgraph,
  duplicateNodes,
  updateSubgraphStyle,
  clearSubgraphStyle,
  getSubgraphStyle,
} from '../src/diagrams/flowchart/mutations';

// DOM mock for mermaid.render (same harness as stateCompositeSyntaxError.test.ts)
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

test('Subgraph Mutations: createSubgraph, moveNode, renameSubgraph, dissolve', () => {
  const code = `flowchart TD
    A["Node A"] --> B["Node B"]
    B --> C["Node C"]
`;
  const ast = parseMermaidFlowchart(code);
  assert.equal(ast.subgraphs.size, 0);

  // 1. Create subgraph grouping A and B
  const subId = createSubgraph(ast, 'Service Alpha', ['A', 'B']);
  assert.ok(ast.subgraphs.has(subId));
  assert.equal(ast.subgraphs.get(subId)?.label, 'Service Alpha');
  assert.deepEqual(ast.subgraphs.get(subId)?.nodeIds, ['A', 'B']);
  assert.equal(ast.nodes.get('A')?.subgraphId, subId);
  assert.equal(ast.nodes.get('B')?.subgraphId, subId);

  // 2. Move C into the subgraph
  const moved = moveNodeToSubgraph(ast, 'C', subId);
  assert.ok(moved);
  assert.deepEqual(ast.subgraphs.get(subId)?.nodeIds, ['A', 'B', 'C']);
  assert.equal(ast.nodes.get('C')?.subgraphId, subId);

  // 3. Move A out of the subgraph (ungroup)
  moveNodeToSubgraph(ast, 'A', null);
  assert.deepEqual(ast.subgraphs.get(subId)?.nodeIds, ['B', 'C']);
  assert.equal(ast.nodes.get('A')?.subgraphId, undefined);

  // 4. Rename subgraph
  renameSubgraph(ast, subId, 'Renamed Service');
  assert.equal(ast.subgraphs.get(subId)?.label, 'Renamed Service');

  // 5. Serialize and check syntax
  const serialized = serializeMermaidFlowchart(ast);
  assert.ok(serialized.includes('subgraph ' + subId + ' ["Renamed Service"]'));
  assert.ok(serialized.includes('B["Node B"]'));
  assert.ok(serialized.includes('C["Node C"]'));

  // 6. Dissolve subgraph (delete container, keep inner nodes)
  deleteSubgraph(ast, subId, false);
  assert.equal(ast.subgraphs.size, 0);
  assert.equal(ast.nodes.size, 3);
  assert.equal(ast.nodes.get('B')?.subgraphId, undefined);
  assert.equal(ast.nodes.get('C')?.subgraphId, undefined);
});

test('Subgraph Mutations: deleteSubgraph with deleteInnerNodes = true', () => {
  const code = `flowchart LR
    subgraph S1 ["Group 1"]
        A["Node A"]
        B["Node B"]
    end
    C["Node C"]
    A --> B
    B --> C
`;
  const ast = parseMermaidFlowchart(code);
  assert.equal(ast.subgraphs.size, 1);
  assert.equal(ast.nodes.size, 3);
  assert.equal(ast.edges.length, 2);

  deleteSubgraph(ast, 'S1', true);
  assert.equal(ast.subgraphs.size, 0);
  assert.equal(ast.nodes.size, 1);
  assert.ok(ast.nodes.has('C'));
  // Edges connecting to A or B should be removed
  assert.equal(ast.edges.length, 0);
});

test('Subgraph Mutations: batch moveNodesToSubgraph', () => {
  const code = `flowchart TD
    A["A"]
    B["B"]
    C["C"]
`;
  const ast = parseMermaidFlowchart(code);
  const subId = createSubgraph(ast, 'Batch Group');
  moveNodesToSubgraph(ast, ['A', 'C'], subId);

  assert.deepEqual(ast.subgraphs.get(subId)?.nodeIds, ['A', 'C']);
  assert.equal(ast.nodes.get('A')?.subgraphId, subId);
  assert.equal(ast.nodes.get('B')?.subgraphId, undefined);
  assert.equal(ast.nodes.get('C')?.subgraphId, subId);
});

test('Duplication Mutations: duplicateNodes clones nodes and internal edges', () => {
  const code = `flowchart TD
    A["Step 1"] --> B["Step 2"]
    B --> C["Step 3"]
`;
  const ast = parseMermaidFlowchart(code);
  const result = duplicateNodes(ast, ['A', 'B']);

  assert.equal(result.nodeIds.length, 2);
  assert.equal(result.edgeIds.length, 1); // Edge A -> B duplicated

  const [dupA, dupB] = result.nodeIds;
  assert.equal(ast.nodes.get(dupA)?.label, 'Step 1 (copy)');
  assert.equal(ast.nodes.get(dupB)?.label, 'Step 2 (copy)');

  const dupEdge = ast.edges.find((e) => e.id === result.edgeIds[0]);
  assert.ok(dupEdge);
  assert.equal(dupEdge?.from, dupA);
  assert.equal(dupEdge?.to, dupB);
});

test('Subgraph Style Mutations: update/get/clear round-trips through serializer', () => {
  const code = `flowchart TD
    subgraph sub_1 ["Group 1"]
        A["Node A"]
    end
    subgraph sub_2 ["Empty Group"]
    end
`;
  const ast = parseMermaidFlowchart(code);
  assert.equal(ast.subgraphs.size, 2);
  assert.deepEqual(ast.subgraphs.get('sub_2')?.nodeIds, []);

  // Empty groups are valid AST entries
  assert.equal(getSubgraphStyle(ast, 'sub_1'), undefined);

  // Update style on non-empty and empty groups alike
  assert.ok(updateSubgraphStyle(ast, 'sub_1', { fill: '#ff0000', stroke: '#00ff00' }));
  assert.deepEqual(getSubgraphStyle(ast, 'sub_1'), { fill: '#ff0000', stroke: '#00ff00' });
  assert.ok(updateSubgraphStyle(ast, 'sub_2', { fill: '#0000ff' }));
  assert.deepEqual(getSubgraphStyle(ast, 'sub_2'), { fill: '#0000ff' });

  // Unknown subgraph id fails cleanly
  assert.equal(updateSubgraphStyle(ast, 'nope', { fill: '#fff' }), false);
  assert.equal(getSubgraphStyle(ast, 'nope'), undefined);
  assert.equal(clearSubgraphStyle(ast, 'nope'), false);

  // Serializer emits style statements for subgraphs
  const serialized = serializeMermaidFlowchart(ast);
  assert.ok(serialized.includes('style sub_1 fill:#ff0000,stroke:#00ff00'));
  assert.ok(serialized.includes('style sub_2 fill:#0000ff'));

  // Re-parsing restores subgraph styles onto definitions
  const reparsed = parseMermaidFlowchart(serialized);
  assert.deepEqual(getSubgraphStyle(reparsed, 'sub_1'), { fill: '#ff0000', stroke: '#00ff00' });
  assert.deepEqual(getSubgraphStyle(reparsed, 'sub_2'), { fill: '#0000ff' });

  // Clearing removes both the def style and the style statement
  assert.ok(clearSubgraphStyle(ast, 'sub_1'));
  assert.equal(getSubgraphStyle(ast, 'sub_1'), undefined);
  assert.ok(!serializeMermaidFlowchart(ast).includes('style sub_1'));

  // Empty style object clears as well
  assert.ok(updateSubgraphStyle(ast, 'sub_2', { fill: '#111' }));
  assert.ok(updateSubgraphStyle(ast, 'sub_2', {}));
  assert.equal(getSubgraphStyle(ast, 'sub_2'), undefined);
});

test('Nested Subgraphs: group nested in group survives serialize/reparse round-trip', () => {
  const ast = parseMermaidFlowchart(`flowchart LR
    A["A"] --> B["B"]
`);
  const outer = createSubgraph(ast, 'Outer', ['A']);
  const inner = createSubgraph(ast, 'Inner', ['B']);
  assert.ok(moveSubgraphToSubgraph(ast, inner, outer));

  const serialized = serializeMermaidFlowchart(ast);
  // Nested syntax: the inner block must sit inside the outer block
  const outerIdx = serialized.indexOf(`subgraph ${outer}`);
  const innerIdx = serialized.indexOf(`subgraph ${inner}`);
  assert.ok(outerIdx !== -1 && innerIdx !== -1 && outerIdx < innerIdx);

  const reparsed = parseMermaidFlowchart(serialized);
  assert.ok(reparsed.subgraphs.get(outer)?.subgraphIds.includes(inner));
  assert.deepEqual(reparsed.subgraphs.get(outer)?.nodeIds, ['A']);
  assert.deepEqual(reparsed.subgraphs.get(inner)?.nodeIds, ['B']);
  assert.strictEqual(reparsed.nodes.get('A')?.subgraphId, outer);
  assert.strictEqual(reparsed.nodes.get('B')?.subgraphId, inner);
});

test('Nested Subgraphs: three levels round-trip with member edges intact', () => {
  const ast = parseMermaidFlowchart(`flowchart LR
    A["A"] --> B["B"]
    B --> C["C"]
`);
  const outer = createSubgraph(ast, 'Outer', ['A']);
  const mid = createSubgraph(ast, 'Mid', ['B']);
  const inner = createSubgraph(ast, 'Inner', ['C']);
  assert.ok(moveSubgraphToSubgraph(ast, mid, outer));
  assert.ok(moveSubgraphToSubgraph(ast, inner, mid));
  // Cycles and self-nesting are refused
  assert.equal(moveSubgraphToSubgraph(ast, outer, inner), false);
  assert.equal(moveSubgraphToSubgraph(ast, outer, outer), false);

  const serialized = serializeMermaidFlowchart(ast);
  const reparsed = parseMermaidFlowchart(serialized);
  assert.deepEqual(reparsed.subgraphs.get(outer)?.subgraphIds, [mid]);
  assert.deepEqual(reparsed.subgraphs.get(mid)?.subgraphIds, [inner]);
  assert.deepEqual(reparsed.subgraphs.get(mid)?.nodeIds, ['B']);
  assert.deepEqual(reparsed.subgraphs.get(inner)?.nodeIds, ['C']);
  // Edges crossing group boundaries survive
  assert.strictEqual(reparsed.edges.length, 2);
  assert.ok(reparsed.edges.some((e) => e.from === 'A' && e.to === 'B'));
  assert.ok(reparsed.edges.some((e) => e.from === 'B' && e.to === 'C'));
});

test('Nested Subgraphs: "create parent group" nests the group instead of an empty sibling', () => {
  const ast = parseMermaidFlowchart(`flowchart LR
    A["A"] --> B["B"]
`);
  // Mirror the group-HUD "Create New Group" action on a selected group
  const inner = createSubgraph(ast, 'Inner', ['A', 'B']);
  const parent = createSubgraph(ast, 'Parent', [inner]);

  // Parent owns the child, child keeps its members — no empty group
  assert.deepEqual(ast.subgraphs.get(parent)?.subgraphIds, [inner]);
  assert.deepEqual(ast.subgraphs.get(parent)?.nodeIds, []);
  assert.deepEqual(ast.subgraphs.get(inner)?.nodeIds, ['A', 'B']);

  const serialized = serializeMermaidFlowchart(ast);
  const parentIdx = serialized.indexOf(`subgraph ${parent}`);
  const innerIdx = serialized.indexOf(`subgraph ${inner}`);
  assert.ok(parentIdx !== -1 && innerIdx !== -1 && parentIdx < innerIdx);

  const reparsed = parseMermaidFlowchart(serialized);
  assert.ok(reparsed.subgraphs.get(parent)?.subgraphIds.includes(inner));
  assert.deepEqual(reparsed.subgraphs.get(inner)?.nodeIds, ['A', 'B']);
});

test('Grouping: members of one group nest the new group inside it', () => {
  const ast = parseMermaidFlowchart(`flowchart LR
    A["A"] --> B["B"]
`);
  const g = createSubgraph(ast, 'G', ['A', 'B']);
  const nested = createSubgraph(ast, 'Nested', ['A']);

  assert.deepEqual(ast.subgraphs.get(g)?.nodeIds, ['B']);
  assert.deepEqual(ast.subgraphs.get(g)?.subgraphIds, [nested]);
  assert.deepEqual(ast.subgraphs.get(nested)?.nodeIds, ['A']);

  const reparsed = parseMermaidFlowchart(serializeMermaidFlowchart(ast));
  assert.ok(reparsed.subgraphs.get(g)?.subgraphIds.includes(nested));
  assert.deepEqual(reparsed.subgraphs.get(nested)?.nodeIds, ['A']);
});

test('Grouping: grouping every node of a group replaces it, no empty shell', () => {
  const ast = parseMermaidFlowchart(`flowchart LR
    A["A"] --> B["B"]
`);
  const g = createSubgraph(ast, 'G', ['A', 'B']);
  const replacement = createSubgraph(ast, 'Replacement', ['A', 'B']);

  assert.ok(!ast.subgraphs.has(g), 'emptied parent must be dissolved');
  assert.deepEqual(ast.subgraphs.get(replacement)?.nodeIds, ['A', 'B']);

  const reparsed = parseMermaidFlowchart(serializeMermaidFlowchart(ast));
  assert.ok(!reparsed.subgraphs.has(g));
  assert.deepEqual(reparsed.subgraphs.get(replacement)?.nodeIds, ['A', 'B']);
});

test('Grouping: members from different parents yield a broader top-level group', () => {
  const ast = parseMermaidFlowchart(`flowchart LR
    A["A"] --> B["B"]
    B --> C["C"]
`);
  const g1 = createSubgraph(ast, 'G1', ['A', 'B']);
  const broad = createSubgraph(ast, 'Broad', ['A', 'C']);

  assert.deepEqual(ast.subgraphs.get(broad)?.nodeIds, ['A', 'C']);
  // Top-level: no group lists it as a child
  for (const sub of ast.subgraphs.values()) {
    assert.ok(!sub.subgraphIds.includes(broad));
  }
  // Partially drained source group survives with its remaining member
  assert.deepEqual(ast.subgraphs.get(g1)?.nodeIds, ['B']);

  const reparsed = parseMermaidFlowchart(serializeMermaidFlowchart(ast));
  assert.deepEqual(reparsed.subgraphs.get(broad)?.nodeIds, ['A', 'C']);
  assert.deepEqual(reparsed.subgraphs.get(g1)?.nodeIds, ['B']);
});

test('Grouping: node moves out of its (nested) group to top level', () => {
  const ast = parseMermaidFlowchart(`flowchart LR
    A["A"] --> B["B"]
`);
  const g = createSubgraph(ast, 'G', ['A', 'B']);
  const inner = createSubgraph(ast, 'Inner', ['A']);
  assert.ok(moveSubgraphToSubgraph(ast, inner, g));

  // "Get me out": node leaves its immediate group for the top level
  // (same call the node HUD remove-from-group button makes).
  // The drained inner group dissolves instead of lingering empty.
  moveNodeToSubgraph(ast, 'A', null);
  assert.strictEqual(ast.nodes.get('A')?.subgraphId, undefined);
  assert.ok(!ast.subgraphs.has(inner));
  assert.deepEqual(ast.subgraphs.get(g)?.nodeIds, ['B']);

  const reparsed = parseMermaidFlowchart(serializeMermaidFlowchart(ast));
  assert.strictEqual(reparsed.nodes.get('A')?.subgraphId, undefined);
  assert.ok(!reparsed.subgraphs.has(inner));
});

test('Grouping: remove-from-group steps out one level when nested', () => {
  const ast = parseMermaidFlowchart(`flowchart LR
    A["A"] --> B["B"]
`);
  const g = createSubgraph(ast, 'G', ['A']);
  const p = createSubgraph(ast, 'P', ['B']);
  assert.ok(moveSubgraphToSubgraph(ast, g, p));

  // Hook procedure for the HUD remove button: parent of A is G,
  // grandparent of G is P, so the node moves to P (not top level).
  const parent = ast.nodes.get('A')!.subgraphId;
  assert.strictEqual(parent, g);
  const grandparent = findParentSubgraphId(ast, parent!);
  assert.strictEqual(grandparent, p);
  assert.ok(moveNodeToSubgraph(ast, 'A', grandparent));

  assert.strictEqual(ast.nodes.get('A')?.subgraphId, p);
  assert.deepEqual(ast.subgraphs.get(p)?.nodeIds, ['B', 'A']);
  assert.ok(!ast.subgraphs.has(g), 'drained inner group dissolves');

  const reparsed = parseMermaidFlowchart(serializeMermaidFlowchart(ast));
  assert.strictEqual(reparsed.nodes.get('A')?.subgraphId, p);
  assert.deepEqual(reparsed.subgraphs.get(p)?.nodeIds, ['B', 'A']);
});

test('Grouping: moving the last node out dissolves the drained group', () => {
  const ast = parseMermaidFlowchart(`flowchart LR
    A["A"] --> B["B"]
`);
  const g1 = createSubgraph(ast, 'G1', ['A']);
  const g2 = createSubgraph(ast, 'G2', ['B']);

  // Reassign the sole member elsewhere: source dissolves (state parity)
  assert.ok(moveNodeToSubgraph(ast, 'A', g2));
  assert.ok(!ast.subgraphs.has(g1));
  assert.deepEqual(ast.subgraphs.get(g2)?.nodeIds, ['B', 'A']);

  // Partial drains survive
  assert.ok(moveNodeToSubgraph(ast, 'B', null));
  assert.deepEqual(ast.subgraphs.get(g2)?.nodeIds, ['A']);
});

test('Grouping: mixed members dissolve a fully drained group', () => {
  const ast = parseMermaidFlowchart(`flowchart LR
    A["A"] --> C["C"]
`);
  const g = createSubgraph(ast, 'G', ['A']);
  const broad = createSubgraph(ast, 'Broad', ['A', 'C']);

  assert.deepEqual(ast.subgraphs.get(broad)?.nodeIds, ['A', 'C']);
  assert.ok(!ast.subgraphs.has(g), 'drained group must dissolve');

  const reparsed = parseMermaidFlowchart(serializeMermaidFlowchart(ast));
  assert.ok(!reparsed.subgraphs.has(g));
  assert.deepEqual(reparsed.subgraphs.get(broad)?.nodeIds, ['A', 'C']);
});

test('Grouping: dissolving cascades to grandparents left empty', () => {
  const ast = parseMermaidFlowchart(`flowchart LR
    A["A"] --> C["C"]
`);
  const g = createSubgraph(ast, 'G', ['A']);
  const p = createSubgraph(ast, 'P', []);
  assert.ok(moveSubgraphToSubgraph(ast, g, p));
  createSubgraph(ast, 'Broad', ['A', 'C']);

  assert.ok(!ast.subgraphs.has(g));
  assert.ok(!ast.subgraphs.has(p), 'cascade must dissolve the emptied grandparent');

  const reparsed = parseMermaidFlowchart(serializeMermaidFlowchart(ast));
  assert.ok(!reparsed.subgraphs.has(g));
  assert.ok(!reparsed.subgraphs.has(p));
});

test('Grouping: wrapping a whole subgroup keeps the grandparent chain', () => {
  const ast = parseMermaidFlowchart(`flowchart LR
    A["A"] --> X["X"]
`);
  const g = createSubgraph(ast, 'G', ['A']);
  const p = createSubgraph(ast, 'P', ['X']);
  assert.ok(moveSubgraphToSubgraph(ast, g, p));

  const parent = createSubgraph(ast, 'Parent', [g]);

  // New parent nests at the same level (inside P), P itself is preserved
  assert.ok(ast.subgraphs.has(p));
  assert.deepEqual(ast.subgraphs.get(p)?.subgraphIds, [parent]);
  assert.deepEqual(ast.subgraphs.get(p)?.nodeIds, ['X']);
  assert.deepEqual(ast.subgraphs.get(parent)?.subgraphIds, [g]);

  const reparsed = parseMermaidFlowchart(serializeMermaidFlowchart(ast));
  assert.deepEqual(reparsed.subgraphs.get(p)?.subgraphIds, [parent]);
  assert.deepEqual(reparsed.subgraphs.get(parent)?.subgraphIds, [g]);
});

test('Nested Subgraphs: cyclic references cannot hang the serializer', () => {
  const ast = parseMermaidFlowchart(`flowchart LR
    A["A"]
`);
  const s1 = createSubgraph(ast, 'One', ['A']);
  const s2 = createSubgraph(ast, 'Two');
  // Force a corrupt cycle (mutations normally refuse this)
  ast.subgraphs.get(s1)!.subgraphIds.push(s2);
  ast.subgraphs.get(s2)!.subgraphIds.push(s1);

  const serialized = serializeMermaidFlowchart(ast);
  assert.ok(serialized.includes(`subgraph ${s1}`));
  assert.ok(serialized.includes(`subgraph ${s2}`));
  assert.ok(serialized.includes('A["A"]'));
});

test('Subgraph Style Mutations: solid border (stroke-dasharray none) round-trips', () => {
  const code = `flowchart TD
    subgraph sub_1 ["Group 1"]
        A["Node A"]
    end
`;
  const ast = parseMermaidFlowchart(code);

  // Solid writes explicit none so it overrides the dashed container default
  assert.ok(updateSubgraphStyle(ast, 'sub_1', { 'stroke-dasharray': 'none' }));
  assert.deepEqual(getSubgraphStyle(ast, 'sub_1'), { 'stroke-dasharray': 'none' });

  const serialized = serializeMermaidFlowchart(ast);
  assert.ok(serialized.includes('style sub_1 stroke-dasharray:none'));

  const reparsed = parseMermaidFlowchart(serialized);
  assert.deepEqual(getSubgraphStyle(reparsed, 'sub_1'), { 'stroke-dasharray': 'none' });
});

test('Nested Subgraphs: emitted nesting renders cleanly in Mermaid', async () => {
  const ast = parseMermaidFlowchart(`flowchart LR
    A["A"] --> B["B"]
    B --> C["C"]
`);
  const outer = createSubgraph(ast, 'Outer', ['A']);
  const inner = createSubgraph(ast, 'Inner', ['B', 'C']);
  assert.ok(moveSubgraphToSubgraph(ast, inner, outer));

  const serialized = serializeMermaidFlowchart(ast);
  const mermaid = (await import('mermaid')).default;
  mermaid.initialize({ startOnLoad: false });
  const { svg } = await mermaid.render('test_nested_subgraphs', serialized);
  assert.ok(svg.length > 0, 'SVG must render cleanly');
});
