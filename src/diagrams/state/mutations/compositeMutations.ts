/**
 * Composite State mutations for Mermaid State Diagrams
 */

import {
  MermaidCompositeStateDef,
  MermaidStateAST,
  StateDirection,
} from '../types';
import {
  deleteState,
  removeComposite,
  pruneEmptyComposites,
  pruneOrphanStartEnd,
} from './stateMutations';
import { isNodeInsideComposite } from './transitionMutations';

export function setStateDiagramDirection(
  ast: MermaidStateAST,
  direction: StateDirection
): void {
  ast.direction = direction;
}

export function createCompositeState(
  ast: MermaidStateAST,
  label = 'Composite State'
): string {
  let n = ast.compositeStates.size + 1;
  while (ast.compositeStates.has(`comp_${n}`)) n++;
  const compId = `comp_${n}`;
  const newComp: MermaidCompositeStateDef = {
    type: 'composite',
    id: compId,
    label: label || compId,
    stateIds: [],
    compositeIds: [],
  };

  ast.compositeStates.set(compId, newComp);
  return compId;
}

export function renameCompositeState(
  ast: MermaidStateAST,
  compId: string,
  newLabel: string
): void {
  const comp = ast.compositeStates.get(compId);
  if (comp) {
    comp.label = newLabel;
  }
}

export function deleteCompositeState(
  ast: MermaidStateAST,
  compId: string,
  deleteInnerStates = false
): void {
  const comp = ast.compositeStates.get(compId);
  if (!comp) return;

  // Find parent composite if nested
  let parentComp: MermaidCompositeStateDef | undefined;
  for (const parent of ast.compositeStates.values()) {
    if (parent.compositeIds?.includes(compId)) {
      parentComp = parent;
      break;
    }
  }

  if (deleteInnerStates) {
    // Recursively delete all nested child composites
    const childComps = [...(comp.compositeIds || [])];
    for (const childId of childComps) {
      deleteCompositeState(ast, childId, true);
    }
    // Delete inner states (deleteState guards against deleting [*])
    for (const sid of [...comp.stateIds]) {
      if (sid !== '[*]') {
        deleteState(ast, sid);
      }
    }
  } else {
    // Dissolve: reparent inner states to parent composite or to root
    for (const sid of comp.stateIds) {
      if (sid === '[*]') continue;
      const st = ast.states.get(sid);
      if (st && st.compositeId === compId) {
        if (parentComp) {
          st.compositeId = parentComp.id;
          if (!parentComp.stateIds.includes(sid)) {
            parentComp.stateIds.push(sid);
          }
        } else {
          delete st.compositeId;
        }
      }
    }
    // Reparent nested child composites to parent composite if nested
    if (comp.compositeIds) {
      for (const childId of comp.compositeIds) {
        if (parentComp && !parentComp.compositeIds.includes(childId)) {
          parentComp.compositeIds.push(childId);
        }
      }
    }
  }

  // Remove from parent composite's compositeIds
  if (parentComp) {
    parentComp.compositeIds = parentComp.compositeIds.filter((id) => id !== compId);
  }

  // Removes definition, its styles, transitions, and cleans up references
  removeComposite(ast, compId);

  // If the parent (or ancestor) composite became empty after child deletion, prune it
  pruneEmptyComposites(ast);
  pruneOrphanStartEnd(ast);
}

export function moveCompositeToComposite(
  ast: MermaidStateAST,
  childCompId: string,
  targetParentId?: string
): void {
  if (childCompId === targetParentId) return;
  if (!ast.compositeStates.has(childCompId)) return;

  // Prevent cycles: cannot move an ancestor into its own descendant
  if (targetParentId && isCompositeDescendant(ast, childCompId, targetParentId)) {
    return;
  }

  // Remove from old parent composite
  for (const parent of ast.compositeStates.values()) {
    if (parent.compositeIds?.includes(childCompId)) {
      parent.compositeIds = parent.compositeIds.filter((id) => id !== childCompId);
    }
  }

  // Add to target parent composite
  if (targetParentId && ast.compositeStates.has(targetParentId)) {
    const targetComp = ast.compositeStates.get(targetParentId)!;
    if (!targetComp.compositeIds) targetComp.compositeIds = [];
    if (!targetComp.compositeIds.includes(childCompId)) {
      targetComp.compositeIds.push(childCompId);
    }

    // Only outer nodes can point to composites; inner nodes cannot point to the outer composite.
    // Purge any transitions from childCompId (or its members) pointing to targetParentId or its ancestors.
    ast.transitions = ast.transitions.filter(
      (t) => !(isNodeInsideComposite(ast, t.from, childCompId) && isNodeInsideComposite(ast, childCompId, t.to))
    );
  }
}

function isCompositeDescendant(
  ast: MermaidStateAST,
  ancestorId: string,
  descendantCandidateId: string
): boolean {
  const ancestor = ast.compositeStates.get(ancestorId);
  if (!ancestor || !ancestor.compositeIds) return false;
  if (ancestor.compositeIds.includes(descendantCandidateId)) return true;
  return ancestor.compositeIds.some((cid) => isCompositeDescendant(ast, cid, descendantCandidateId));
}

export function moveStateToComposite(
  ast: MermaidStateAST,
  stateId: string,
  targetCompId?: string
): void {
  // Anchor points are managed directly via start/end mutations, not moved.
  if (stateId === '[*]' || stateId.startsWith('[*]:')) return;

  // If stateId is actually a composite state ID, delegate to moveCompositeToComposite
  if (ast.compositeStates.has(stateId)) {
    moveCompositeToComposite(ast, stateId, targetCompId);
    return;
  }

  const state = ast.states.get(stateId);
  if (!state) return;

  // Remove from old composite
  if (state.compositeId && ast.compositeStates.has(state.compositeId)) {
    const oldCompId = state.compositeId;
    const oldComp = ast.compositeStates.get(oldCompId)!;
    oldComp.stateIds = oldComp.stateIds.filter((id) => id !== stateId);
    if (oldComp.stateIds.length === 0 && (!oldComp.compositeIds || oldComp.compositeIds.length === 0)) {
      removeComposite(ast, oldCompId);
    }
  }

  // Assign to new composite
  if (targetCompId && ast.compositeStates.has(targetCompId)) {
    state.compositeId = targetCompId;
    const targetComp = ast.compositeStates.get(targetCompId)!;
    if (!targetComp.stateIds.includes(stateId)) {
      targetComp.stateIds.push(stateId);
    }

    // Only outer nodes can point to composites; inner nodes cannot point to the outer composite.
    // Purge any transitions from this newly-nested state pointing to targetCompId or its ancestors.
    ast.transitions = ast.transitions.filter(
      (t) => !(t.from === stateId && isNodeInsideComposite(ast, stateId, t.to))
    );
  } else {
    delete state.compositeId;
  }
}
