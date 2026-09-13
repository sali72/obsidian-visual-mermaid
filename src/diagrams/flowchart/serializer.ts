/**
 * Serializer: Converts MermaidFlowchartAST to clean, normalized Mermaid text
 */

import {
  ArrowType,
  MermaidFlowchartAST,
  MermaidShapeType,
} from './types';

export function serializeMermaidFlowchart(ast: MermaidFlowchartAST): string {
  const lines: string[] = [];

  // 1. Header
  lines.push(`${ast.diagramType || 'flowchart'} ${ast.direction || 'TD'}`);

  const emittedNodeIds = new Set<string>();

  // 2. Subgraphs. Only top-level groups are emitted here; nested groups
  // recurse through subgraphIds so the hierarchy survives the round-trip.
  const childSubIds = new Set<string>();
  for (const subDef of ast.subgraphs.values()) {
    for (const childId of subDef.subgraphIds ?? []) childSubIds.add(childId);
  }

  const emittedSubIds = new Set<string>();
  const emitSubgraph = (subId: string, indent: string): void => {
    const subDef = ast.subgraphs.get(subId);
    // emittedSubIds doubles as a cycle guard: a corrupt AST must never
    // hang the serializer in infinite recursion.
    if (!subDef || emittedSubIds.has(subId)) return;
    emittedSubIds.add(subId);

    const labelPart = subDef.label ? ` ["${escapeLabel(subDef.label)}"]` : '';
    lines.push(`${indent}subgraph ${subId}${labelPart}`);

    const inner = indent + '    ';
    if (subDef.direction) {
      lines.push(`${inner}direction ${subDef.direction}`);
    }

    for (const nodeId of subDef.nodeIds) {
      const node = ast.nodes.get(nodeId);
      if (node) {
        lines.push(`${inner}${node.id}${formatShape(node.shape, node.label)}`);
        emittedNodeIds.add(node.id);
      }
    }

    for (const childId of subDef.subgraphIds ?? []) {
      emitSubgraph(childId, inner);
    }

    lines.push(`${indent}end\n`);
  };

  for (const [subId] of ast.subgraphs.entries()) {
    if (!childSubIds.has(subId)) emitSubgraph(subId, '    ');
  }
  // Orphaned references and defensive leftovers emit flat so no group
  // silently vanishes from the output.
  for (const [subId] of ast.subgraphs.entries()) {
    if (!emittedSubIds.has(subId)) emitSubgraph(subId, '    ');
  }

  // 3. Standalone nodes (not part of any subgraph, or not yet defined with custom label)
  for (const [nodeId, node] of ast.nodes.entries()) {
    if (!node.subgraphId && !emittedNodeIds.has(nodeId)) {
      lines.push(`    ${node.id}${formatShape(node.shape, node.label)}`);
      emittedNodeIds.add(nodeId);
    }
  }

  if (lines.length > 1 && ast.edges.length > 0) {
    lines.push('');
  }

  // 4. Edges
  for (const edge of ast.edges) {
    const arrowStr = formatArrow(edge.arrowType, edge.label);
    lines.push(`    ${edge.from} ${arrowStr} ${edge.to}`);
  }

  // 5. ClassDefs
  if (ast.classDefs.size > 0) {
    lines.push('');
    for (const [name, def] of ast.classDefs.entries()) {
      const stylePairs = Object.entries(def.styles)
        .map(([k, v]) => `${k}:${v}`)
        .join(',');
      lines.push(`    classDef ${name} ${stylePairs}`);
    }
  }

  // 5b. Class assignments
  const classToNodes = new Map<string, string[]>();
  for (const node of ast.nodes.values()) {
    if (node.classes && node.classes.length > 0) {
      for (const cls of node.classes) {
        if (!classToNodes.has(cls)) {
          classToNodes.set(cls, []);
        }
        classToNodes.get(cls)!.push(node.id);
      }
    }
  }

  if (classToNodes.size > 0) {
    lines.push('');
    for (const [cls, nodeIds] of classToNodes.entries()) {
      lines.push(`    class ${nodeIds.join(',')} ${cls}`);
    }
  }

  // 6. Style statements
  if (ast.styles.length > 0) {
    const mergedStyles = new Map<string, Record<string, string>>();
    for (const style of ast.styles) {
      const current = mergedStyles.get(style.targetId) || {};
      mergedStyles.set(style.targetId, { ...current, ...style.styles });
    }

    lines.push('');
    for (const [targetId, styles] of mergedStyles.entries()) {
      const stylePairs = Object.entries(styles)
        .map(([k, v]) => `${k}:${v}`)
        .join(',');
      lines.push(`    style ${targetId} ${stylePairs}`);
    }
  }

  // 7. LinkStyle statements
  let hasLinkStyles = false;
  for (let i = 0; i < ast.edges.length; i++) {
    const edge = ast.edges[i];
    if (edge.style && Object.keys(edge.style).length > 0) {
      if (!hasLinkStyles) {
        lines.push('');
        hasLinkStyles = true;
      }
      const stylePairs = Object.entries(edge.style)
        .map(([k, v]) => `${k}:${v}`)
        .join(',');
      lines.push(`    linkStyle ${i} ${stylePairs}`);
    }
  }

  return lines.join('\n').trim() + '\n';
}

function formatShape(shape: MermaidShapeType, label: string): string {
  const safe = `"${escapeLabel(label)}"`;
  switch (shape) {
    case 'rounded':
      return `(${safe})`;
    case 'stadium':
      return `([${safe}])`;
    case 'subroutine':
      return `[[${safe}]]`;
    case 'cylinder':
      return `[(${safe})]`;
    case 'circle':
      return `((${safe}))`;
    case 'double_circle':
      return `(((${safe})))`;
    case 'diamond':
      return `{${safe}}`;
    case 'hexagon':
      return `{{${safe}}}`;
    case 'parallelogram':
      return `[/${safe}/]`;
    case 'parallelogram_alt':
      return `[\\${safe}\\]`;
    case 'trapezoid':
      return `[/${safe}\\]`;
    case 'trapezoid_alt':
      return `[\\${safe}/]`;
    case 'asymmetric':
      return `>${safe}]`;
    case 'rectangle':
    default:
      return `[${safe}]`;
  }
}

function formatArrow(type: ArrowType, label?: string): string {
  const labelPart = label ? `|${escapeLabel(label)}|` : '';
  switch (type) {
    case 'dotted':
      return label ? `-.->${labelPart}` : '-.->';
    case 'thick':
      return label ? `==>${labelPart}` : '==>';
    case 'bidirectional':
      return label ? `<-->${labelPart}` : '<-->';
    case 'cross':
      return label ? `--x${labelPart}` : '--x';
    case 'circle':
      return label ? `--o${labelPart}` : '--o';
    case 'open':
      return label ? `---${labelPart}` : '---';
    case 'dotted_open':
      return label ? `-.-${labelPart}` : '-.-';
    case 'thick_open':
      return label ? `===${labelPart}` : '===';
    case 'arrow':
    default:
      return label ? `-->${labelPart}` : '-->';
  }
}

function escapeLabel(label: string): string {
  return label.replace(/"/g, '#quot;');
}
