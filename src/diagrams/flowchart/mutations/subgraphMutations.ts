/**
 * Subgraph (Group) mutations for Flowchart diagrams
 */

import { MermaidFlowchartAST, MermaidSubgraphDef } from '../types';
import { deleteNodes } from './nodeMutations';

/**
 * Generate a unique subgraph ID that doesn't collide with existing subgraphs.
 */
export function generateUniqueSubgraphId(
  ast: MermaidFlowchartAST,
  base = 'sub'
): string {
  let counter = ast.subgraphs.size + 1;
  let candidate = `${base}_${counter}`;
  while (ast.subgraphs.has(candidate)) {
    counter++;
    candidate = `${base}_${counter}`;
  }
  return candidate;
}

/**
 * Find the parent group of a node or subgroup, if any.
 */
export function findParentSubgraphId(
  ast: MermaidFlowchartAST,
  childId: string
): string | null {
  for (const [id, sub] of ast.subgraphs.entries()) {
    if (sub.subgraphIds?.includes(childId)) return id;
  }
  return null;
}

/**
 * Create a new subgraph in the AST, optionally grouping initial node IDs.
 *
 * Placement follows the members: when every member shares one parent group
 * the new group nests inside it (grouping a node of G creates a nested
 * group in G); mixed or ungrouped members yield a top-level (broader)
 * group. Source groups drained entirely by the operation are dissolved
 * (cascading to grandparents) so no hollow group is left behind —
 * pre-existing empty groups the operation did not touch are preserved.
 */
export function createSubgraph(
  ast: MermaidFlowchartAST,
  label = 'New Group',
  nodeIds?: Iterable<string>
): string {
  const subId = generateUniqueSubgraphId(ast, 'sub');

  const memberIds = nodeIds ? Array.from(nodeIds) : [];

  // Shared parent is computed BEFORE attaching (attaching rewrites
  // membership). Unknown ids are ignored for the placement decision.
  // Pre-move parents are also collected so groups drained by the move can
  // be dissolved afterwards.
  let sharedParent: string | null = null;
  let hasMembers = false;
  let mixedParents = false;
  const drainedParents = new Set<string>();
  for (const nid of memberIds) {
    let parent: string | null;
    if (ast.subgraphs.has(nid)) {
      parent = findParentSubgraphId(ast, nid);
    } else if (ast.nodes.has(nid)) {
      parent = ast.nodes.get(nid)!.subgraphId ?? null;
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

  const subDef: MermaidSubgraphDef = {
    type: 'subgraph',
    id: subId,
    label: label.trim() || subId,
    nodeIds: [],
    subgraphIds: [],
  };
  // Register before attaching members: group-into-group moves
  // (moveSubgraphToSubgraph) require the target to exist, otherwise a
  // "create parent group" call silently yields an empty group.
  ast.subgraphs.set(subId, subDef);

  let hadGroupMember = false;
  for (const nid of memberIds) {
    if (ast.subgraphs.has(nid)) {
      hadGroupMember = true;
      moveSubgraphToSubgraph(ast, nid, subId);
    } else if (ast.nodes.has(nid)) {
      // Remove from any prior subgraph
      const node = ast.nodes.get(nid)!;
      if (node.subgraphId && ast.subgraphs.has(node.subgraphId)) {
        const oldSub = ast.subgraphs.get(node.subgraphId)!;
        oldSub.nodeIds = oldSub.nodeIds.filter((id) => id !== nid);
      }
      node.subgraphId = subId;
      if (!subDef.nodeIds.includes(nid)) subDef.nodeIds.push(nid);
    }
  }

  if (nestParent) {
    moveSubgraphToSubgraph(ast, subId, nestParent);
    const parentDef = ast.subgraphs.get(nestParent);
    const nestedOk = parentDef?.subgraphIds?.includes(subId) ?? false;
    const parentEmptied =
      nestedOk &&
      !hadGroupMember &&
      (parentDef!.nodeIds.length === 0) &&
      (parentDef!.subgraphIds ?? []).filter((id) => id !== subId).length === 0;
    if (parentEmptied) {
      // The operation consumed the parent entirely: dissolve the hollow
      // shell and let the new group take its place at the grandparent level.
      const grandparent = findParentSubgraphId(ast, nestParent);
      moveSubgraphToSubgraph(ast, subId, grandparent);
      deleteSubgraph(ast, nestParent, false);
    }
  }

  // Dissolve any other source group this operation drained entirely
  // (cascading to grandparents) so no hollow group is left behind. The
  // nest parent above is handled separately; anything still containing
  // members — including the new group — is preserved.
  const drainQueue = [...drainedParents];
  while (drainQueue.length > 0) {
    const drainedId = drainQueue.pop()!;
    if (drainedId === nestParent) continue;
    const drainedDef = ast.subgraphs.get(drainedId);
    if (
      !drainedDef ||
      drainedDef.nodeIds.length > 0 ||
      (drainedDef.subgraphIds ?? []).length > 0
    ) {
      continue;
    }
    const grandparent = findParentSubgraphId(ast, drainedId);
    deleteSubgraph(ast, drainedId, false);
    if (grandparent && grandparent !== drainedId) drainQueue.push(grandparent);
  }

  return subId;
}

/**
 * Delete a subgraph.
 * If deleteInnerNodes is false (default), the subgraph is dissolved (nodes become ungrouped).
 * If deleteInnerNodes is true, all inner nodes and their edges are deleted.
 */
export function deleteSubgraph(
  ast: MermaidFlowchartAST,
  subgraphId: string,
  deleteInnerNodes: boolean = false
): boolean {
  if (!ast.subgraphs.has(subgraphId)) return false;

  const sub = ast.subgraphs.get(subgraphId)!;
  const innerNodeIds = [...sub.nodeIds];

  if (deleteInnerNodes) {
    deleteNodes(ast, innerNodeIds);
  } else {
    for (const nid of innerNodeIds) {
      const node = ast.nodes.get(nid);
      if (node && node.subgraphId === subgraphId) {
        delete node.subgraphId;
      }
    }
  }

  // Remove from parent subgraphs if nested
  for (const parentSub of ast.subgraphs.values()) {
    parentSub.subgraphIds = parentSub.subgraphIds.filter((id) => id !== subgraphId);
  }

  // Remove style if any
  ast.styles = ast.styles.filter((s) => s.targetId !== subgraphId);

  // Remove subgraph definition
  ast.subgraphs.delete(subgraphId);
  return true;
}

/**
 * Rename a subgraph label.
 */
export function renameSubgraph(
  ast: MermaidFlowchartAST,
  subgraphId: string,
  newLabel: string
): boolean {
  const sub = ast.subgraphs.get(subgraphId);
  if (!sub) return false;
  sub.label = newLabel.trim() || subgraphId;
  return true;
}

function isSubgraphDescendant(
  ast: MermaidFlowchartAST,
  ancestorId: string,
  candidateId: string
): boolean {
  const ancestor = ast.subgraphs.get(ancestorId);
  if (!ancestor || !ancestor.subgraphIds) return false;
  if (ancestor.subgraphIds.includes(candidateId)) return true;
  return ancestor.subgraphIds.some((cid) => isSubgraphDescendant(ast, cid, candidateId));
}

export function moveSubgraphToSubgraph(
  ast: MermaidFlowchartAST,
  childSubId: string,
  targetParentId: string | null
): boolean {
  if (!ast.subgraphs.has(childSubId)) return false;
  if (childSubId === targetParentId) return false;
  if (targetParentId && isSubgraphDescendant(ast, childSubId, targetParentId)) return false;

  // Remove from old parent subgraph
  for (const parent of ast.subgraphs.values()) {
    if (parent.subgraphIds?.includes(childSubId)) {
      parent.subgraphIds = parent.subgraphIds.filter((id) => id !== childSubId);
    }
  }

  // Add to target parent
  if (targetParentId && ast.subgraphs.has(targetParentId)) {
    const target = ast.subgraphs.get(targetParentId)!;
    if (!target.subgraphIds) target.subgraphIds = [];
    if (!target.subgraphIds.includes(childSubId)) {
      target.subgraphIds.push(childSubId);
    }
  }
  return true;
}

/**
 * Dissolve a group left completely empty (no nodes, no subgroups).
 * Used after member moves so "get me out" style actions never leave
 * hollow shells behind. Pre-existing empty groups are never passed here,
 * only groups that just lost a member. Returns true when dissolved.
 */
export function pruneEmptySubgraph(
  ast: MermaidFlowchartAST,
  subId: string | null | undefined
): boolean {
  if (!subId) return false;
  const sub = ast.subgraphs.get(subId);
  if (!sub) return false;
  if (sub.nodeIds.length > 0 || (sub.subgraphIds ?? []).length > 0) return false;
  return deleteSubgraph(ast, subId, false);
}

/**
 * Move a single node to another subgraph, or unparent it if targetSubgraphId is null.
 * A source group drained entirely by the move dissolves (state-diagram parity).
 */
export function moveNodeToSubgraph(
  ast: MermaidFlowchartAST,
  nodeId: string,
  targetSubgraphId: string | null
): boolean {
  if (ast.subgraphs.has(nodeId)) {
    return moveSubgraphToSubgraph(ast, nodeId, targetSubgraphId);
  }

  const node = ast.nodes.get(nodeId);
  if (!node) return false;

  if ((node.subgraphId || null) === (targetSubgraphId || null)) return true;

  // Remove from old subgraph
  const oldSubgraphId = node.subgraphId;
  if (oldSubgraphId && ast.subgraphs.has(oldSubgraphId)) {
    const oldSub = ast.subgraphs.get(oldSubgraphId)!;
    oldSub.nodeIds = oldSub.nodeIds.filter((id) => id !== nodeId);
  }

  if (targetSubgraphId) {
    if (!ast.subgraphs.has(targetSubgraphId)) return false;
    const targetSub = ast.subgraphs.get(targetSubgraphId)!;
    if (!targetSub.nodeIds.includes(nodeId)) {
      targetSub.nodeIds.push(nodeId);
    }
    node.subgraphId = targetSubgraphId;
  } else {
    delete node.subgraphId;
  }

  pruneEmptySubgraph(ast, oldSubgraphId);

  return true;
}

/**
 * Batch move multiple nodes to a subgraph or unparent them.
 */
export function moveNodesToSubgraph(
  ast: MermaidFlowchartAST,
  nodeIds: Iterable<string>,
  targetSubgraphId: string | null
): number {
  let count = 0;
  for (const nid of nodeIds) {
    if (moveNodeToSubgraph(ast, nid, targetSubgraphId)) {
      count++;
    }
  }
  return count;
}
