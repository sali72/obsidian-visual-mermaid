/**
 * Unified Diagram Driver Types & Interfaces
 *
 * A DiagramDriver is the single contract every diagram type implements. The
 * canvas layer only talks to this interface — it never branches on diagram
 * type. Adding a new diagram means adding one package (parser, serializer,
 * mutations, view projection, DOM adapter) and registering its driver.
 */

import {
  FlowchartDirection,
  MermaidEdgeDef,
  MermaidNodeDef,
  MermaidSubgraphDef,
} from './viewModel';

export type SupportedDiagramType =
  | 'flowchart'
  | 'stateDiagram'
  | 'sequenceDiagram'
  | 'classDiagram'
  | 'erDiagram'
  | 'journey'
  | 'gantt'
  | 'pie'
  | 'quadrantChart'
  | 'requirementDiagram'
  | 'gitGraph'
  | 'c4'
  | 'mindmap'
  | 'timeline'
  | 'sankey'
  | 'xychart'
  | 'block'
  | 'packet'
  | 'kanban'
  | 'architecture'
  | 'zenuml'
  | 'useCaseDiagram'
  | 'agentflow'
  | 'unknown';

export interface DiagramTemplate {
  type: SupportedDiagramType;
  label: string;
  description: string;
  defaultCode: string;
}

/**
 * Diagram-agnostic view projection. The flowchart-shaped display types are
 * reused as the shared view-model for every diagram kind; drivers map their
 * native AST onto it (read-only — mutations go through DiagramMutations,
 * never by editing the projection).
 */
export interface ViewProjection {
  nodes: Map<string, MermaidNodeDef>;
  edges: MermaidEdgeDef[];
  subgraphs: Map<string, MermaidSubgraphDef>;
  direction: FlowchartDirection | undefined;
}

/** What the canvas UI offers for this diagram kind. */
export interface DiagramCapabilities {
  /** Whether this diagram type supports visual interactive editing. Defaults to true. */
  editable?: boolean;
  supportsDirection: boolean;
  /** Node "kind" picker (shapes for flowcharts, state types for state diagrams). */
  supportsNodeKinds: boolean;
  /** Arrow/connection type picker (--> -.- ==> etc.). */
  supportsEdgeTypes: boolean;
  /** Edge color/stroke styling. */
  supportsEdgeStyles: boolean;
  /** Subgraphs / composite containers. */
  supportsGroups: boolean;
  /** Pseudo-node start/end anchors (e.g. [*] in state diagrams). */
  hasAnchors: boolean;
}

/** UI vocabulary so components never hard-code diagram-specific nouns. */
export interface DiagramLabels {
  node: string; // "Step" | "State"
  nodes: string;
  edge: string; // "Connection" | "Transition"
  edges: string;
  group: string; // "Group" | "Composite State"
  addNode: string; // "Add Step" | "Add State"
  addGroup: string; // "Add Group" | "Add Composite"
  addChild: string; // "Next Step" | "Next State"
  insertNodeOnEdge: string; // "Insert Step" | "Insert State"
  edgeLabelPlaceholder: string;
}

/** One entry in the node-kind picker (shape or state type). */
export interface NodeKindOption {
  kind: string;
  label: string;
}

/**
 * Start/end anchor API. Anchors are pseudo-nodes ([*]) that exist as separate
 * visuals but share one id; the UI tracks which visual is selected via a
 * 'start' | 'end' kind obtained from the DOM adapter.
 */
export interface AnchorApi<TAst = unknown> {
  isAnchor(nodeId: string): boolean;
  has(ast: TAst, kind: 'start' | 'end', compositeId?: string): boolean;
  /** Create the anchor plus an initial node; returns the created node id. */
  add(ast: TAst, kind: 'start' | 'end', compositeId?: string): string | null;
  connectToEnd(ast: TAst, nodeId: string): void;
  /** Delete the anchor's transitions; kind null removes both directions. */
  delete(ast: TAst, kind: 'start' | 'end' | null, compositeId?: string): void;
}

export interface ConnectionContext {
  insertAfterEdgeId?: string;
  insertAtIndex?: number;
  y?: number;
}

/**
 * The full mutation surface the canvas needs. Core members are required;
 * optional members are gated by DiagramCapabilities.
 */
export interface DiagramMutations<TAst = unknown> {
  // Nodes
  addNode(ast: TAst, label: string): string;
  addChildNode(ast: TAst, parentId: string, label: string): string;
  deleteNode(ast: TAst, nodeId: string): void;
  deleteNodes(ast: TAst, nodeIds: Iterable<string>): void;
  updateNodeLabel(ast: TAst, nodeId: string, label: string): void;
  isNodeTextEditable(ast: TAst, nodeId: string): boolean;
  updateNodeKind(ast: TAst, nodeId: string, kind: string): void;
  updateNodesKind(ast: TAst, nodeIds: Iterable<string>, kind: string): void;

  // Connections
  connect(ast: TAst, fromId: string, toId: string, context?: ConnectionContext): void;
  deleteEdge(ast: TAst, edgeId: string): void;
  deleteEdges(ast: TAst, edgeIds: Iterable<string>): void;
  updateEdgeLabel(ast: TAst, edgeId: string, label: string): void;
  /** Reverse an edge; returns the (possibly new) edge id. */
  reverseEdge(ast: TAst, edgeId: string): string | null;
  /** Split an edge with a new node; returns the created node id. */
  insertNodeOnEdge(ast: TAst, edgeId: string, label: string): string | null;
  updateEdgeType?(ast: TAst, edgeId: string, type: string): void;
  updateEdgesType?(ast: TAst, edgeIds: Iterable<string>, type: string): void;

  // Node styles
  getNodeStyle(ast: TAst, nodeId: string): Record<string, string> | undefined;
  updateNodeStyle(ast: TAst, nodeId: string, styles: Record<string, string> | null): void;
  updateNodesStyle(ast: TAst, nodeIds: Iterable<string>, styles: Record<string, string> | null): void;
  clearNodeStyle(ast: TAst, nodeId: string): void;
  clearNodesStyle(ast: TAst, nodeIds: Iterable<string>): void;

  // Edge styles (optional — supportsEdgeStyles)
  getEdgeStyle?(ast: TAst, edgeId: string): Record<string, string> | undefined;
  updateEdgeStyle?(ast: TAst, edgeId: string, styles: Record<string, string> | null): void;
  updateEdgesStyle?(ast: TAst, edgeIds: Iterable<string>, styles: Record<string, string> | null): void;
  clearEdgeStyle?(ast: TAst, edgeId: string): void;
  clearEdgesStyle?(ast: TAst, edgeIds: Iterable<string>): void;

  // Groups (subgraphs / composite states)
  getGroupStyle(ast: TAst, groupId: string): Record<string, string> | undefined;
  updateGroupStyle(ast: TAst, groupId: string, styles: Record<string, string> | null): void;
  clearGroupStyle(ast: TAst, groupId: string): void;
  /** Create an empty group; returns the group id. */
  createGroup(ast: TAst, label: string): string;
  /** Create a group containing the given nodes; returns the group id. */
  createGroupWithMembers(ast: TAst, label: string, nodeIds: Iterable<string>): string;
  deleteGroup(ast: TAst, groupId: string, deleteMembers: boolean): void;
  renameGroup(ast: TAst, groupId: string, label: string): void;
  moveNodeToGroup(ast: TAst, nodeId: string, groupId: string | null): void;
  moveNodesToGroup(ast: TAst, nodeIds: Iterable<string>, groupId: string | null): void;

  // Clipboard
  duplicateNodes(ast: TAst, nodeIds: Iterable<string>): { nodeIds: string[]; edgeIds: string[] };

  // Diagram-level
  getDirection(ast: TAst): string | undefined;
  setDirection(ast: TAst, direction: string): void;

  // Start/end anchors (optional — hasAnchors)
  anchors?: AnchorApi<TAst>;
}

/**
 * Maps native mermaid SVG DOM onto view-model ids. Each diagram kind renders
 * different DOM structure (id prefixes, anchor shapes), so matching is a
 * driver concern.
 */
export interface SvgDomAdapter {
  /** Prefixes mermaid uses for node element ids, e.g. 'flowchart-'. */
  nodeIdPrefixes: string[];
  /** Optional custom CSS selector for locating node elements. */
  nodeSelector?: string;
  /** Optional custom CSS selector for locating edge line/path elements. */
  edgeSelector?: string;
  /** Selectors that locate anchor elements ([*]), if this diagram has them. */
  anchorSelectors?: string;
  /** View-model node id of the anchor pseudo-node ('[*]'), if this diagram has them. */
  anchorNodeId?: string;
  /** True if this element renders a start/end anchor. */
  isAnchorElement?: (el: Element) => boolean;
  /** Derive 'start' | 'end' from an anchor element. */
  getAnchorKind?(el: Element): 'start' | 'end' | null;
  /** Derive the composite/subgraph id from an anchor element if inside a composite, or null/undefined if root */
  getAnchorCompositeId?(el: Element): string | null;
}

export interface DiagramDriver<TAst = unknown> {
  type: SupportedDiagramType;
  displayName: string;
  supportsDirection: boolean;
  canHandle(code: string): boolean;
  parse(code: string): TAst;
  serialize(ast: TAst): string;
  createDefault(direction?: string): string;

  /** Structural copy so mutations never touch the committed AST in place. */
  clone(ast: TAst): TAst;
  /** Empty AST used as fallback when parsing fails. */
  createEmpty(): TAst;

  /** Read-only projection to the shared canvas view-model. */
  project(ast: TAst): ViewProjection;

  capabilities: DiagramCapabilities;
  labels: DiagramLabels;
  /** Options for the node-kind picker (empty when !supportsNodeKinds). */
  nodeKindOptions: NodeKindOption[];

  mutations: DiagramMutations<TAst>;
  dom: SvgDomAdapter;
}
