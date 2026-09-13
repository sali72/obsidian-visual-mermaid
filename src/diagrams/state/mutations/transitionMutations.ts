/**
 * Transition mutations for Mermaid State Diagrams
 */

import { MermaidStateAST, MermaidTransitionDef } from '../types';
import { addState } from './stateMutations';

export function ensureStartEndEntry(ast: MermaidStateAST): void {
  if (!ast.states.has('[*]')) {
    ast.states.set('[*]', {
      type: 'state',
      id: '[*]',
      label: '[*]',
      stateType: 'start',
    });
  }
}

/**
 * Checks if candidateNodeId is inside compositeId (directly or through nested composites).
 * Also returns true if candidateNodeId === compositeId.
 */
export function isNodeInsideComposite(
  ast: MermaidStateAST,
  candidateNodeId: string,
  compositeId: string
): boolean {
  if (candidateNodeId === compositeId) return true;

  // 1. If candidate is a normal/pseudo state:
  const state = ast.states.get(candidateNodeId);
  if (state?.compositeId) {
    if (state.compositeId === compositeId) return true;
    return isNodeInsideComposite(ast, state.compositeId, compositeId);
  }

  // 2. If candidate is a composite state:
  if (ast.compositeStates.has(candidateNodeId)) {
    for (const [pId, parent] of ast.compositeStates.entries()) {
      if (parent.compositeIds?.includes(candidateNodeId)) {
        if (pId === compositeId) return true;
        if (isNodeInsideComposite(ast, pId, compositeId)) return true;
      }
    }
  }

  return false;
}

/**
 * Checks if two states are internal states belonging to different composite states.
 * Official Mermaid rule: "You cannot define transitions between internal states belonging to different composite states".
 */
export function areInDifferentComposites(
  ast: MermaidStateAST,
  fromId: string,
  toId: string
): boolean {
  if (fromId === '[*]' || toId === '[*]') return false;
  const fromState = ast.states.get(fromId);
  const toState = ast.states.get(toId);

  // Both are internal states with a compositeId, and their immediate composites differ
  if (fromState?.compositeId && toState?.compositeId && fromState.compositeId !== toState.compositeId) {
    return true;
  }

  return false;
}

export function connectStates(
  ast: MermaidStateAST,
  fromId: string,
  toId: string,
  label?: string
): MermaidTransitionDef | null {
  const actualFrom = fromId.startsWith('[*]') ? '[*]' : fromId;
  const actualTo = toId.startsWith('[*]') ? '[*]' : toId;

  if (actualFrom === '[*]' && actualTo === '[*]') return null;

  // If from is a scoped anchor e.g. '[*]:Active', verify target is within 'Active'
  if (fromId.startsWith('[*]:')) {
    const compId = fromId.slice(4);
    if (!isNodeInsideComposite(ast, actualTo, compId)) {
      return null;
    }
  }

  // If to is a scoped anchor e.g. '[*]:Active', verify source is within 'Active'
  if (toId.startsWith('[*]:')) {
    const compId = toId.slice(4);
    if (!isNodeInsideComposite(ast, actualFrom, compId)) {
      return null;
    }
  }

  // Only outer nodes can point to composites; inner nodes cannot point to the outer composite.
  if (ast.compositeStates.has(actualTo) && isNodeInsideComposite(ast, actualFrom, actualTo)) {
    return null;
  }

  // Official Mermaid rule: cannot define transitions between internal states of different composite states
  if (areInDifferentComposites(ast, actualFrom, actualTo)) {
    return null;
  }

  // Same endpoints with the same label are duplicates; same endpoints with a
  // different label are distinct transitions (different events/conditions).
  const normalizedLabel = label?.trim() || undefined;
  const existing = ast.transitions.find(
    (t) => t.from === actualFrom && t.to === actualTo && (t.label || undefined) === normalizedLabel
  );
  if (existing) {
    return existing;
  }

  if (actualFrom === '[*]' || actualTo === '[*]') {
    ensureStartEndEntry(ast);
  }

  const transitionId = `t_${actualFrom}_${actualTo}_${ast.transitions.length + 1}`;
  const newTransition: MermaidTransitionDef = {
    type: 'transition',
    id: transitionId,
    from: actualFrom,
    to: actualTo,
    label,
  };

  ast.transitions.push(newTransition);
  return newTransition;
}

export function deleteTransition(ast: MermaidStateAST, transitionId: string): void {
  ast.transitions = ast.transitions.filter((t) => t.id !== transitionId);
}

export function deleteTransitions(
  ast: MermaidStateAST,
  transitionIds: Iterable<string>
): void {
  const idSet = new Set(transitionIds);
  ast.transitions = ast.transitions.filter((t) => !idSet.has(t.id));
}

export function connectToEndState(
  ast: MermaidStateAST,
  fromId: string,
  label?: string
): MermaidTransitionDef | null {
  return connectStates(ast, fromId, '[*]', label);
}

export function connectFromStartState(
  ast: MermaidStateAST,
  toId: string,
  label?: string
): MermaidTransitionDef | null {
  return connectStates(ast, '[*]', toId, label);
}

export function updateTransitionLabel(
  ast: MermaidStateAST,
  transitionId: string,
  newLabel: string
): void {
  const tr = ast.transitions.find((t) => t.id === transitionId);
  if (tr) {
    tr.label = newLabel.trim() || undefined;
  }
}

/**
 * Split a transition with a new state: from -> to becomes from -> new -> to,
 * with the original label moved to the second leg. Returns the new state id.
 */
export function insertStateOnTransition(
  ast: MermaidStateAST,
  transitionId: string,
  label = 'New State'
): string | null {
  const tr = ast.transitions.find((t) => t.id === transitionId);
  if (!tr) return null;

  // Determine composite scope for the new state:
  // If both endpoints are inside the same composite, or one endpoint is inside a composite
  // and the other is an anchor [*] or the composite itself, place the state inside that composite.
  const fromState = ast.states.get(tr.from);
  const toState = ast.states.get(tr.to);
  let targetCompositeId: string | undefined;

  if (fromState?.compositeId && toState?.compositeId) {
    if (fromState.compositeId === toState.compositeId) {
      targetCompositeId = fromState.compositeId;
    }
  } else if (fromState?.compositeId && tr.to === '[*]') {
    targetCompositeId = fromState.compositeId;
  } else if (toState?.compositeId && tr.from === '[*]') {
    targetCompositeId = toState.compositeId;
  } else if (ast.compositeStates.has(tr.from) && toState?.compositeId) {
    targetCompositeId = toState.compositeId;
  } else if (ast.compositeStates.has(tr.to) && fromState?.compositeId) {
    targetCompositeId = fromState.compositeId;
  }

  const newStateId = addState(ast, label, 'normal', targetCompositeId);
  const oldTo = tr.to;
  const oldLabel = tr.label;
  tr.to = newStateId;
  delete tr.label;
  connectStates(ast, newStateId, oldTo, oldLabel);
  return newStateId;
}
