/**
 * State diagram driver: wires the state parser/serializer and mutations into
 * the unified DiagramDriver contract.
 */

import { DiagramDriver } from '../types';
import {
  MermaidEdgeDef,
  MermaidNodeDef,
  MermaidShapeType,
  MermaidSubgraphDef,
} from '../viewModel';
import { MermaidStateAST, MermaidStateType, StateDirection } from './types';
import { parseMermaidStateDiagram } from './parser';
import { serializeMermaidStateDiagram } from './serializer';
import * as st from './mutations';

const STATE_KIND_OPTIONS = [
  { kind: 'normal', label: 'Normal State' },
  { kind: 'choice', label: 'Choice <<choice>>' },
  { kind: 'fork', label: 'Fork <<fork>>' },
  { kind: 'join', label: 'Join <<join>>' },
];

/** Map a state type onto the shared flowchart-shaped view model. */
function stateTypeToShape(stateType: MermaidStateType): MermaidShapeType {
  if (stateType === 'start' || stateType === 'end') return 'circle';
  if (stateType === 'choice') return 'diamond';
  return 'rectangle'; // normal, fork, join
}

function cloneStateAst(ast: MermaidStateAST): MermaidStateAST {
  return {
    ...ast,
    frontmatter: ast.frontmatter,
    states: new Map(Array.from(ast.states, ([id, s]) => [id, { ...s }])),
    transitions: ast.transitions.map((t) => ({ ...t })),
    compositeStates: new Map(
      Array.from(ast.compositeStates, ([id, c]) => [
        id,
        {
          ...c,
          stateIds: [...c.stateIds],
          compositeIds: [...c.compositeIds],
        },
      ])
    ),
    styles: ast.styles.map((s) => ({ ...s })),
    rawLines: ast.rawLines.map((r) => ({ ...r })),
  };
}

function createEmptyStateAst(): MermaidStateAST {
  return {
    diagramType: 'stateDiagram-v2',
    frontmatter: undefined,
    states: new Map(),
    transitions: [],
    compositeStates: new Map(),
    styles: [],
    rawLines: [],
  };
}

export const StateDiagramDriver: DiagramDriver<MermaidStateAST> = {
  type: 'stateDiagram',
  displayName: 'State Diagram',
  supportsDirection: true,
  canHandle(code: string): boolean {
    const lines = code.split('\n');
    let inFrontmatter = false;
    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (!trimmed || trimmed.startsWith('%%')) continue;
      if (!inFrontmatter && trimmed === '---') {
        inFrontmatter = true;
        continue;
      }
      if (inFrontmatter) {
        if (trimmed === '---') inFrontmatter = false;
        continue;
      }
      return /^stateDiagram(-v2)?\b/i.test(trimmed);
    }
    return false;
  },
  parse(code: string): MermaidStateAST {
    return parseMermaidStateDiagram(code);
  },
  serialize(ast: MermaidStateAST): string {
    return serializeMermaidStateDiagram(ast);
  },
  createDefault(direction = 'LR'): string {
    const dirLine = direction ? `    direction ${direction}\n` : '';
    return `stateDiagram-v2\n${dirLine}    [*] --> Idle\n    Idle --> Processing : Submit\n    Processing --> Success : Approve\n    Processing --> Failed : Reject\n    Success --> [*]\n    Failed --> Idle : Retry\n`;
  },
  clone: cloneStateAst,
  createEmpty: createEmptyStateAst,
  project(ast: MermaidStateAST) {
    const nodes = new Map<string, MermaidNodeDef>();
    for (const [id, state] of ast.states.entries()) {
      if (id === '[*]') continue;
      nodes.set(id, {
        type: 'node',
        id,
        label: state.label || id,
        shape: stateTypeToShape(state.stateType),
        kind: state.stateType,
        subgraphId: state.compositeId,
        style: state.style,
      });
    }

    // Root start/end anchors
    if (st.hasStartState(ast) || st.hasEndState(ast)) {
      nodes.set('[*]', {
        type: 'node',
        id: '[*]',
        label: '[*]',
        shape: 'circle',
        kind: undefined,
        subgraphId: undefined,
      });
    }

    // Composite-scoped start/end anchors
    for (const compId of ast.compositeStates.keys()) {
      if (st.hasStartState(ast, compId) || st.hasEndState(ast, compId)) {
        nodes.set(`[*]:${compId}`, {
          type: 'node',
          id: `[*]:${compId}`,
          label: '[*]',
          shape: 'circle',
          kind: undefined,
          subgraphId: compId,
        });
      }
    }

    const edges: MermaidEdgeDef[] = ast.transitions.map((tr) => ({
      type: 'edge' as const,
      id: tr.id,
      from: tr.from,
      to: tr.to,
      arrowType: 'arrow' as const,
      label: tr.label,
      style: tr.style,
    }));

    const subgraphs = new Map<string, MermaidSubgraphDef>();
    for (const [id, comp] of ast.compositeStates.entries()) {
      const stateIds = [...comp.stateIds];
      if (st.hasStartState(ast, id) || st.hasEndState(ast, id)) {
        if (!stateIds.includes(`[*]:${id}`)) {
          stateIds.push(`[*]:${id}`);
        }
      }
      subgraphs.set(id, {
        type: 'subgraph',
        id,
        label: comp.label,
        direction: comp.direction || ast.direction || 'TD',
        nodeIds: stateIds,
        subgraphIds: comp.compositeIds,
        style: comp.style,
      });
    }
    return {
      nodes,
      edges,
      subgraphs,
      direction: ast.direction,
    };
  },

  capabilities: {
    supportsDirection: true,
    supportsNodeKinds: true,
    supportsEdgeTypes: false,
    supportsEdgeStyles: false,
    supportsGroups: true,
    hasAnchors: true,
  },

  labels: {
    node: 'State',
    nodes: 'States',
    edge: 'Transition',
    edges: 'Transitions',
    group: 'Composite',
    addNode: 'Add State',
    addGroup: 'Add Composite',
    addChild: 'Next State',
    insertNodeOnEdge: 'Insert State',
    edgeLabelPlaceholder: 'Event / Condition (e.g. onClick)...',
  },

  nodeKindOptions: STATE_KIND_OPTIONS,

  mutations: {
    addNode: (ast, label) => st.addState(ast, label),
    addChildNode: (ast, parentId, label) => st.addChildState(ast, parentId, label),
    deleteNode: (ast, nodeId) => {
      if (nodeId === '[*]') return;
      st.deleteState(ast, nodeId);
    },
    deleteNodes: (ast, nodeIds) => {
      st.deleteStates(ast, Array.from(nodeIds).filter((id) => id !== '[*]'));
    },
    updateNodeLabel: (ast, nodeId, label) => {
      st.updateStateLabel(ast, nodeId, label);
    },
    isNodeTextEditable: (ast, nodeId) =>
      st.isStateTextEditable(ast.states.get(nodeId)),
    updateNodeKind: (ast, nodeId, kind) => {
      st.updateStateType(ast, nodeId, kind as MermaidStateType);
    },
    updateNodesKind: (ast, nodeIds, kind) => {
      for (const id of nodeIds) {
        st.updateStateType(ast, id, kind as MermaidStateType);
      }
    },

    connect: (ast, fromId, toId) => {
      st.connectStates(ast, fromId, toId);
    },
    deleteEdge: (ast, edgeId) => {
      st.deleteTransition(ast, edgeId);
    },
    deleteEdges: (ast, edgeIds) => {
      st.deleteTransitions(ast, edgeIds);
    },
    updateEdgeLabel: (ast, edgeId, label) => {
      st.updateTransitionLabel(ast, edgeId, label);
    },
    reverseEdge: (ast, edgeId) => {
      const tr = ast.transitions.find((t) => t.id === edgeId);
      if (!tr) return null;
      // Only outer nodes can point to composites; inner nodes cannot point to outer composite.
      if (ast.compositeStates.has(tr.from) && st.isNodeInsideComposite(ast, tr.to, tr.from)) {
        return null;
      }
      if (st.areInDifferentComposites(ast, tr.to, tr.from)) {
        return null;
      }
      const oldFrom = tr.from;
      tr.from = tr.to;
      tr.to = oldFrom;
      return tr.id;
    },
    insertNodeOnEdge: (ast, edgeId, label) =>
      st.insertStateOnTransition(ast, edgeId, label),

    getNodeStyle: (ast, nodeId) => st.getStateStyle(ast, nodeId),
    updateNodeStyle: (ast, nodeId, styles) => {
      if (styles && Object.keys(styles).length > 0) {
        st.updateStateStyle(ast, nodeId, styles);
      } else {
        st.clearStateStyle(ast, nodeId);
      }
    },
    updateNodesStyle: (ast, nodeIds, styles) => {
      const ids = Array.from(nodeIds).filter((id) => id !== '[*]');
      if (styles && Object.keys(styles).length > 0) {
        st.updateStatesStyle(ast, ids, styles);
      } else {
        st.clearStatesStyle(ast, ids);
      }
    },
    clearNodeStyle: (ast, nodeId) => {
      st.clearStateStyle(ast, nodeId);
    },
    clearNodesStyle: (ast, nodeIds) => {
      st.clearStatesStyle(ast, nodeIds);
    },

    getGroupStyle: (ast, groupId) => st.getCompositeStateStyle(ast, groupId),
    updateGroupStyle: (ast, groupId, styles) => {
      if (styles && Object.keys(styles).length > 0) {
        st.updateCompositeStateStyle(ast, groupId, styles);
      } else {
        st.clearCompositeStateStyle(ast, groupId);
      }
    },
    clearGroupStyle: (ast, groupId) => {
      st.clearCompositeStateStyle(ast, groupId);
    },
    createGroup: (ast, label) => {
      const compId = st.createCompositeState(ast, label);
      st.addState(ast, 'State 1', 'normal', compId);
      return compId;
    },
    createGroupWithMembers: (ast, label, nodeIds) => {
      const memberIds = Array.from(nodeIds);

      // Shared parent is computed BEFORE moving (moves rewrite membership).
      // States of one composite yield a nested composite; mixed or
      // top-level members yield a top-level (broader) composite. Anchors
      // ([*]) are never groupable and ignored for the placement decision.
      // Pre-move parents are also collected so composites drained by the
      // moves can be dissolved afterwards.
      let sharedParent: string | null = null;
      let hasMembers = false;
      let mixedParents = false;
      const drainedParents = new Set<string>();
      for (const nid of memberIds) {
        let parent: string | null;
        if (ast.compositeStates.has(nid)) {
          parent = st.findParentComposite(ast, nid);
        } else if (ast.states.has(nid)) {
          if (nid === '[*]' || nid.startsWith('[*]:')) continue;
          parent = ast.states.get(nid)!.compositeId ?? null;
        } else {
          continue;
        }
        if (parent) drainedParents.add(parent);
        if (mixedParents) continue;
        if (!hasMembers) {
          sharedParent = parent;
          hasMembers = true;
        } else if (sharedParent !== parent) {
          mixedParents = true;
        }
      }
      const nestParent = !mixedParents && hasMembers ? sharedParent : null;

      const compId = st.createCompositeState(ast, label);
      // Retarget upfront the transitions of parents this operation will
      // fully consume, so they survive onto the new composite instead of
      // dropping when the shell dissolves mid-move.
      {
        const memberSet = new Set(memberIds);
        const consumed: string[] = [];
        for (const pid of drainedParents) {
          const pdef = ast.compositeStates.get(pid);
          if (!pdef) continue;
          const content = [...pdef.stateIds, ...(pdef.compositeIds ?? [])];
          if (content.length > 0 && content.every((id) => memberSet.has(id))) {
            consumed.push(pid);
          }
        }
        if (consumed.length > 0) {
          const consumedSet = new Set(consumed);
          for (const tr of ast.transitions) {
            if (consumedSet.has(tr.from)) tr.from = compId;
            if (consumedSet.has(tr.to)) tr.to = compId;
          }
        }
      }
      for (const nid of memberIds) {
        st.moveStateToComposite(ast, nid, compId);
      }
      const comp = ast.compositeStates.get(compId);
      if (comp && comp.stateIds.length === 0 && (!comp.compositeIds || comp.compositeIds.length === 0)) {
        st.addState(ast, 'State 1', 'normal', compId);
      }

      if (nestParent) {
        st.moveStateToComposite(ast, compId, nestParent);
        const parentDef = ast.compositeStates.get(nestParent);
        const nestedOk = parentDef?.compositeIds?.includes(compId) ?? false;
        const parentEmptied =
          nestedOk &&
          (parentDef!.stateIds.length === 0) &&
          (parentDef!.compositeIds ?? []).filter((id) => id !== compId).length === 0 &&
          !memberIds.some((id) => ast.compositeStates.has(id));
        if (parentEmptied) {
          // Grouping plain states consumed the parent entirely: retarget its
          // transitions onto the new composite, dissolve the hollow shell,
          // and let the new composite take its place at the grandparent level.
          for (const tr of ast.transitions) {
            if (tr.from === nestParent) tr.from = compId;
            if (tr.to === nestParent) tr.to = compId;
          }
          const grandparent = st.findParentComposite(ast, nestParent);
          st.moveStateToComposite(ast, compId, grandparent ?? undefined);
          st.deleteCompositeState(ast, nestParent, false);
        }
      }

      // Dissolve any other source composite this operation drained entirely
      // (cascading to grandparents) so no hollow composite is left behind.
      // Plain-state sources usually self-prune inside moveStateToComposite;
      // anything still containing members — including the new composite —
      // is preserved. Transitions of a dissolved shell retarget onto the
      // new composite taking over its members.
      const drainQueue = [...drainedParents];
      while (drainQueue.length > 0) {
        const drainedId = drainQueue.pop()!;
        if (drainedId === nestParent) continue;
        const drainedDef = ast.compositeStates.get(drainedId);
        if (
          !drainedDef ||
          drainedDef.stateIds.length > 0 ||
          (drainedDef.compositeIds ?? []).length > 0
        ) {
          continue;
        }
        for (const tr of ast.transitions) {
          if (tr.from === drainedId) tr.from = compId;
          if (tr.to === drainedId) tr.to = compId;
        }
        const grandparent = st.findParentComposite(ast, drainedId);
        st.deleteCompositeState(ast, drainedId, false);
        if (grandparent && grandparent !== drainedId) drainQueue.push(grandparent);
      }
      return compId;
    },
    deleteGroup: (ast, groupId, deleteMembers) => {
      st.deleteCompositeState(ast, groupId, deleteMembers);
    },
    renameGroup: (ast, groupId, label) => {
      st.renameCompositeState(ast, groupId, label);
    },
    moveNodeToGroup: (ast, nodeId, groupId) => {
      st.moveStateToComposite(ast, nodeId, groupId || undefined);
    },
    moveNodesToGroup: (ast, nodeIds, groupId) => {
      for (const nid of nodeIds) {
        st.moveStateToComposite(ast, nid, groupId || undefined);
      }
    },

    duplicateNodes: (ast, nodeIds) => {
      const res = st.duplicateStates(ast, nodeIds);
      return { nodeIds: res.stateIds, edgeIds: res.transitionIds };
    },

    getDirection: (ast) => ast.direction,
    setDirection: (ast, direction) => {
      st.setStateDiagramDirection(ast, direction as StateDirection);
    },

    anchors: {
      isAnchor: (nodeId) => nodeId === '[*]' || nodeId.startsWith('[*]:'),
      has: (ast, kind, compositeId) =>
        kind === 'start'
          ? st.hasStartState(ast, compositeId)
          : st.hasEndState(ast, compositeId),
      add: (ast, kind, compositeId) =>
        kind === 'start'
          ? st.addStartState(ast, 'New State', compositeId)
          : st.addEndState(ast, 'New State', compositeId),
      connectToEnd: (ast, nodeId) => {
        st.connectToEndState(ast, nodeId);
      },
      delete: (ast, kind, compositeId) => {
        if (kind === 'start') st.deleteStartAnchor(ast, compositeId);
        else if (kind === 'end') st.deleteEndAnchor(ast, compositeId);
        else {
          st.deleteStartAnchor(ast, compositeId);
          st.deleteEndAnchor(ast, compositeId);
        }
      },
    },
  },

  dom: {
    nodeIdPrefixes: ['state-'],
    anchorSelectors:
      '.state-start, .state-end, [id*="root_start"], [id*="root_end"], [id*="_start"], [id*="_end"]',
    anchorNodeId: '[*]',
    isAnchorElement(el) {
      const idAttr = el.getAttribute('id') || '';
      return (
        el.classList.contains('state-start') ||
        el.classList.contains('state-end') ||
        idAttr.includes('root_start') ||
        idAttr.includes('root_end') ||
        idAttr.includes('_start') ||
        idAttr.includes('_end') ||
        el.classList.contains('outer-path') ||
        !!el.querySelector?.('.outer-path')
      );
    },
    getAnchorKind(el) {
      const attr = el.getAttribute('data-mermaid-start-end');
      if (attr === 'start' || attr === 'end') return attr;
      const container = el.closest('g.node, g') || el;
      const idAttr = container.getAttribute('id') || el.getAttribute('id') || '';
      const match = idAttr.match(/^(?:state-)?(.+)_(start|end)(?:-\d+)?$/);
      if (match) {
        return match[2] as 'start' | 'end';
      }
      if (idAttr.includes('root_start') || idAttr.includes('_start-') || idAttr.endsWith('_start')) return 'start';
      if (idAttr.includes('root_end') || idAttr.includes('_end-') || idAttr.endsWith('_end')) return 'end';
      if (el.classList.contains('state-start')) return 'start';
      if (el.classList.contains('state-end')) return 'end';
      try {
        if (el.querySelector('.state-start')) return 'start';
        if (el.querySelector('.state-end')) return 'end';
        if (el.querySelector('.outer-path')) return 'end';
      } catch {
        /* ignore */
      }
      return null;
    },
    getAnchorCompositeId(el) {
      const container = el.closest('g.node, g') || el;
      const idAttr = container.getAttribute('id') || el.getAttribute('id') || '';
      const match =
        idAttr.match(/(?:^|-)state-(.+?)_(?:start|end)(?:-\d+)?$/) ||
        idAttr.match(/^(.+?)_(?:start|end)(?:-\d+)?$/);
      if (match && match[1] !== 'root') {
        return match[1];
      }
      const clusterEl = el.closest('[data-mermaid-subgraph-id]');
      if (clusterEl) {
        const subId = clusterEl.getAttribute('data-mermaid-subgraph-id');
        if (subId) return subId;
      }
      return null;
    },
  },
};
