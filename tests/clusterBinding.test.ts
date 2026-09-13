import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { FlowchartDriver } from '../src/diagrams/flowchart/flowchartDriver';
import { StateDiagramDriver } from '../src/diagrams/state/stateDriver';
import { setupNodeInteractivity } from '../src/canvas/interaction/nodeInteractivity';
import { setupClusterInteractivity } from '../src/canvas/interaction/clusterInteractivity';

// DOM harness for mermaid.render (mirrors stateCompositeSyntaxError.test.ts)
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="c"></div></body></html>');
(global as any).window = dom.window;
(global as any).document = dom.window.document;
(global as any).SVGElement = dom.window.SVGElement;
(global as any).Element = dom.window.Element;
dom.window.SVGElement.prototype.getBBox = () => ({ x: 0, y: 0, width: 10, height: 10 });
(global as any).CSSStyleSheet = class CSSStyleSheet {
  cssRules = [];
  replaceSync() {}
  insertRule() {}
};
// Obsidian DOM extension used by the interactivity setup
(dom.window.Element.prototype as any).setCssStyles = function (styles: Record<string, string>) {
  for (const k of Object.keys(styles || {})) {
    try {
      (this as any).style[k] = (styles as any)[k];
    } catch {
      /* ignore */
    }
  }
};

const nullRect = () => null;

async function renderInto(code: string, renderId: string): Promise<HTMLElement> {
  const mermaid = (await import('mermaid')).default;
  mermaid.initialize({ startOnLoad: false });
  const { svg } = await mermaid.render(renderId, code);
  const mountEl = dom.window.document.createElement('div');
  mountEl.innerHTML = svg;
  return mountEl as unknown as HTMLElement;
}

test('Cluster Binding: two groups bind to their own cluster, wrappers stay unbound', async () => {
  const ast = FlowchartDriver.parse('flowchart LR\n    A["Start"] --> B["Process"]\n');
  // Mirror the "Add Group" UI action twice (both groups share the default label)
  FlowchartDriver.mutations.createGroup!(ast, 'New Group');
  FlowchartDriver.mutations.createGroup!(ast, 'New Group');
  const code = FlowchartDriver.serialize(ast);
  const proj = FlowchartDriver.project(FlowchartDriver.parse(code));
  assert.strictEqual(proj.subgraphs.size, 2);

  const mountEl = await renderInto(code, 'test_cluster_two_groups');

  setupNodeInteractivity({
    mountEl: mountEl as any,
    dom: FlowchartDriver.dom as any,
    displayNodes: proj.nodes as any,
    displaySubgraphs: proj.subgraphs as any,
    getLocalRect: nullRect as any,
    onSelectNode: () => {},
    onSelectSubgraph: () => {},
    onStartEditingNode: () => {},
    onStartEditingSubgraph: () => {},
    onHoverNode: () => {},
  });
  const selections: Array<{ id: string; el: Element }> = [];
  setupClusterInteractivity({
    mountEl: mountEl as any,
    displaySubgraphs: proj.subgraphs as any,
    getLocalRect: nullRect as any,
    onSelectSubgraph: (id: string, el: Element) => {
      selections.push({ id, el });
    },
    onStartEditingSubgraph: () => {},
  });

  const bound = Array.from(mountEl.querySelectorAll('[data-mermaid-subgraph-id]'));
  // Exactly the two real clusters — no g.clusters wrapper, no cluster-label
  assert.strictEqual(bound.length, 2);
  for (const el of bound) {
    assert.ok(el.classList.contains('cluster'), `expected .cluster, got "${el.getAttribute('class')}"`);
    assert.notStrictEqual(el.getAttribute('class'), 'clusters');
  }
  const bySub = new Map(
    bound.map((el) => [el.getAttribute('data-mermaid-subgraph-id'), el])
  );
  assert.ok(bySub.has('sub_1'));
  assert.ok(bySub.has('sub_2'));
  assert.ok((bySub.get('sub_1')!.getAttribute('id') || '').endsWith('-sub_1'));
  assert.ok((bySub.get('sub_2')!.getAttribute('id') || '').endsWith('-sub_2'));

  // Clicking the first group's rect selects sub_1 scoped to its own cluster —
  // the highlight must not cover the second group.
  const rect1 = bySub.get('sub_1')!.querySelector('rect');
  assert.ok(rect1);
  (rect1 as any).onclick({ stopPropagation: () => {} });
  assert.strictEqual(selections.length, 1);
  assert.strictEqual(selections[0].id, 'sub_1');
  assert.strictEqual(selections[0].el, bySub.get('sub_1'));
  assert.ok(!(selections[0].el as Element).contains(bySub.get('sub_2')));
});

test('Cluster Binding: two state composites bind to their own cluster element', async () => {
  const ast = StateDiagramDriver.parse('stateDiagram-v2\n    [*] --> Idle\n    Idle --> Processing : Submit\n');
  StateDiagramDriver.mutations.createGroupWithMembers!(ast, 'Comp A', ['Idle']);
  StateDiagramDriver.mutations.createGroupWithMembers!(ast, 'Comp B', ['Processing']);
  const code = StateDiagramDriver.serialize(ast);
  const proj = StateDiagramDriver.project(StateDiagramDriver.parse(code));
  assert.strictEqual(proj.subgraphs.size, 2);

  const mountEl = await renderInto(code, 'test_cluster_two_composites');

  setupNodeInteractivity({
    mountEl: mountEl as any,
    dom: StateDiagramDriver.dom as any,
    displayNodes: proj.nodes as any,
    displaySubgraphs: proj.subgraphs as any,
    getLocalRect: nullRect as any,
    onSelectNode: () => {},
    onSelectSubgraph: () => {},
    onStartEditingNode: () => {},
    onStartEditingSubgraph: () => {},
    onHoverNode: () => {},
  });
  setupClusterInteractivity({
    mountEl: mountEl as any,
    displaySubgraphs: proj.subgraphs as any,
    getLocalRect: nullRect as any,
    onSelectSubgraph: () => {},
    onStartEditingSubgraph: () => {},
  });

  const bound = Array.from(mountEl.querySelectorAll('[data-mermaid-subgraph-id]'));
  // Neither binding may be the shared g.clusters wrapper (anchor elements
  // carry a composite id too — only cluster containers are asserted here).
  for (const el of bound) {
    assert.notStrictEqual(el.getAttribute('class'), 'clusters');
  }
  const clusterBound = bound.filter((el) => {
    const cls = el.getAttribute('class') || '';
    return cls.includes('cluster') && !cls.includes('label');
  });
  assert.strictEqual(clusterBound.length, 2);
  const bySub = new Map(
    clusterBound.map((el) => [el.getAttribute('data-mermaid-subgraph-id'), el])
  );
  assert.ok(bySub.has('comp_1'));
  assert.ok(bySub.has('comp_2'));
});
