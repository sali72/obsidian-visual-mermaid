/**
 * Hook to manage Mermaid SVG rendering, camera stabilization, unmatched subgraph discovery,
 * and binding SVG DOM interactivity via the centralized Zustand store.
 */

import React, { useEffect, useRef, useCallback } from 'react';
import { App } from 'obsidian';
import { Rect } from '../types';
import { MermaidNodeDef, MermaidEdgeDef, MermaidSubgraphDef } from '../../diagrams/viewModel';
import { DiagramDriver } from '../../diagrams/types';
import { renderMermaidSvg, mountMermaidSvg } from '../renderer/mermaidRenderer';
import { applySelectedNodeHalos } from '../renderer/selectionHalo';
import { setupSvgInteractivity } from '../interaction/setupSvgInteractivity';
import { setupViewOnlyInteractivity } from '../interaction/setupViewOnlyInteractivity';
import { useCanvasStore } from '../store/canvasStore';

export interface UseCanvasRendererOptions {
  app: App;
  code: string;
  driver: DiagramDriver;
  svgMountRef: React.RefObject<HTMLDivElement>;
  displayNodes: Map<string, MermaidNodeDef>;
  displayEdges: MermaidEdgeDef[];
  displaySubgraphs: Map<string, MermaidSubgraphDef>;
  getLocalRect: (el: Element) => Rect | null;
  getLocalPoint?: (clientX: number, clientY: number) => { x: number; y: number } | null;
  updateSelectedNodeHalo: (nodes?: Set<string>) => void;
  updateSelectedEdgeHalo: (edges?: Set<string>) => void;
  updateSelectedNodeRect: () => void;
  inlineEditing: {
    startEditingEdge: (edgeId: string, edgeEl: Element) => void;
    startEditingSubgraph: (subId: string, subEl: Element) => void;
    setEditingNodeId: (id: string | null) => void;
  };
  handleStartEditingNode: (nodeId: string, el: Element) => void;
  stabilizeCamera: () => void;
  setSyntaxError: (err: string | null) => void;
}

export function useCanvasRenderer({
  app,
  code,
  driver,
  svgMountRef,
  displayNodes,
  displayEdges,
  displaySubgraphs,
  getLocalRect,
  getLocalPoint,
  updateSelectedNodeHalo,
  updateSelectedEdgeHalo,
  updateSelectedNodeRect,
  inlineEditing,
  handleStartEditingNode,
  stabilizeCamera,
  setSyntaxError,
}: UseCanvasRendererOptions) {
  const renderTicketRef = useRef<number>(0);
  const anchors = driver.mutations.anchors;
  const isAnchorId = (id: string | null | undefined): id is string =>
    !!anchors && !!id && anchors.isAnchor(id);

  const isEditable = driver.capabilities.editable !== false;

  const setupSvg = useCallback(() => {
    const mountEl = svgMountRef.current;
    if (!mountEl) return;

    if (!isEditable) {
      setupViewOnlyInteractivity({ mountEl });
      return;
    }

    setupSvgInteractivity({
      mountEl,
      dom: driver.dom,
      displayNodes,
      displayEdges,
      displaySubgraphs,
      getLocalRect,
      getLocalPoint,
      onSelectNode: (targetNodeId, isMulti, htmlEl) => {
        useCanvasStore.getState().setSelectedSubgraphId(null);
        useCanvasStore.getState().setSelectedSubgraphRect(null);
        useCanvasStore.getState().setActiveSubgraphPopover(null);
        mountEl.querySelectorAll('.mermaid-cluster-selected').forEach((c) =>
          c.classList.remove('mermaid-cluster-selected')
        );

        // Track which anchor (start vs end) was clicked — they share one node
        // id but have distinct visuals.
        const starKindForTarget = isAnchorId(targetNodeId)
          ? driver.dom.getAnchorKind?.(htmlEl) ?? null
          : null;

        if (isAnchorId(targetNodeId) && starKindForTarget) {
          useCanvasStore.getState().setSelectedStarKind(starKindForTarget);
        } else if (!isAnchorId(targetNodeId)) {
          useCanvasStore.getState().setSelectedStarKind(null);
        }

        if (isMulti) {
          // Anchors are single-select only — never part of a multi-select group.
          if (isAnchorId(targetNodeId)) {
            const nextNodes = new Set([targetNodeId]);
            useCanvasStore.getState().setSelectedNodeIds(nextNodes);
            useCanvasStore.getState().setSelectedEdgeIds(new Set());
            useCanvasStore.getState().setSelectedEdgePos(null);
            updateSelectedEdgeHalo(new Set());
            const rect = getLocalRect(htmlEl);
            if (rect) useCanvasStore.getState().setSelectedNodeRect(rect);
            // Kind-filtered halo — only highlight the clicked anchor, not both
            applySelectedNodeHalos(mountEl, nextNodes, undefined, starKindForTarget);
            return;
          }
          const prev = useCanvasStore.getState().selectedNodeIds;
          // Drop any existing anchor from the multi-set before toggling.
          const next = new Set(
            Array.from(prev).filter((id) => !isAnchorId(id))
          );
          if (next.has(targetNodeId)) next.delete(targetNodeId);
          else next.add(targetNodeId);
          useCanvasStore.getState().setSelectedNodeIds(next);
          updateSelectedNodeHalo(next);
        } else {
          const nextNodes = new Set([targetNodeId]);
          const emptyEdges = new Set<string>();
          useCanvasStore.getState().setSelectedNodeIds(nextNodes);
          useCanvasStore.getState().setSelectedEdgeIds(emptyEdges);
          useCanvasStore.getState().setSelectedEdgePos(null);
          updateSelectedEdgeHalo(emptyEdges);
          const rect = getLocalRect(htmlEl);
          if (rect) useCanvasStore.getState().setSelectedNodeRect(rect);
          if (isAnchorId(targetNodeId) && starKindForTarget) {
            applySelectedNodeHalos(mountEl, nextNodes, undefined, starKindForTarget);
          } else {
            updateSelectedNodeHalo(nextNodes);
          }
        }
      },
      onSelectEdge: (targetEdge, resolvedPath, isMulti) => {
        useCanvasStore.getState().setSelectedStarKind(null);
        useCanvasStore.getState().setSelectedSubgraphId(null);
        useCanvasStore.getState().setSelectedSubgraphRect(null);
        useCanvasStore.getState().setActiveSubgraphPopover(null);
        mountEl.querySelectorAll('.mermaid-cluster-selected').forEach((c) =>
          c.classList.remove('mermaid-cluster-selected')
        );

        const edgeId = targetEdge.id;
        if (isMulti) {
          const prev = useCanvasStore.getState().selectedEdgeIds;
          const next = new Set(prev);
          if (next.has(edgeId)) next.delete(edgeId);
          else next.add(edgeId);
          useCanvasStore.getState().setSelectedEdgeIds(next);
          updateSelectedEdgeHalo(next);
        } else {
          const nextEdges = new Set([edgeId]);
          const emptyNodes = new Set<string>();
          useCanvasStore.getState().setSelectedEdgeIds(nextEdges);
          useCanvasStore.getState().setSelectedNodeIds(emptyNodes);
          useCanvasStore.getState().setSelectedNodeRect(null);
          inlineEditing.setEditingNodeId(null);
          updateSelectedNodeHalo(emptyNodes);
          updateSelectedEdgeHalo(nextEdges);

          const rect = getLocalRect(resolvedPath);
          if (rect) {
            useCanvasStore.getState().setSelectedEdgePos({
              x: rect.x + rect.width / 2,
              y: rect.y + rect.height / 2,
              label: targetEdge.label,
              from: targetEdge.from,
              to: targetEdge.to,
              arrowType: targetEdge.arrowType,
            });
          }
        }
      },
      onSelectSubgraph: (targetSubId, htmlEl) => {
        useCanvasStore.getState().setSelectedStarKind(null);
        useCanvasStore.getState().clearSelection();
        useCanvasStore.getState().setSelectedSubgraphId(targetSubId);
        updateSelectedNodeHalo(new Set());
        updateSelectedEdgeHalo(new Set());

        mountEl.querySelectorAll('.mermaid-cluster-selected').forEach((c) =>
          c.classList.remove('mermaid-cluster-selected')
        );
        htmlEl.classList.add('mermaid-cluster-selected');

        const rect = getLocalRect(htmlEl);
        if (rect) useCanvasStore.getState().setSelectedSubgraphRect(rect);
      },
      onStartEditingNode: handleStartEditingNode,
      onStartEditingEdge: inlineEditing.startEditingEdge,
      onStartEditingSubgraph: inlineEditing.startEditingSubgraph,
      onHoverNode: (nodeId, rect, kind) => {
        useCanvasStore.getState().setHoveredNode(nodeId, rect, kind ?? null);
      },
    });
  }, [
    svgMountRef,
    driver,
    displayNodes,
    displayEdges,
    displaySubgraphs,
    getLocalRect,
    updateSelectedNodeHalo,
    updateSelectedEdgeHalo,
    inlineEditing,
    handleStartEditingNode,
  ]);

  // Stable refs for renderer effect
  const setupRef = useRef(setupSvg);
  setupRef.current = setupSvg;
  const stabilizeRef = useRef(stabilizeCamera);
  stabilizeRef.current = stabilizeCamera;
  const rectRef = useRef(updateSelectedNodeRect);
  rectRef.current = updateSelectedNodeRect;
  const haloNodeRef = useRef(updateSelectedNodeHalo);
  haloNodeRef.current = updateSelectedNodeHalo;
  const haloEdgeRef = useRef(updateSelectedEdgeHalo);
  haloEdgeRef.current = updateSelectedEdgeHalo;
  const subgraphsRef = useRef(displaySubgraphs);
  subgraphsRef.current = displaySubgraphs;

  // Render effect
  // NOTE: displayNodes/displayEdges/displaySubgraphs are intentionally part
  // of the deps. Undo/redo applies code first (re-render with stale AST) and
  // only then re-parses into a fresh AST. Without these deps the SVG would
  // keep interactivity bound to the stale AST, leaving the redone edge/group
  // without hit areas (unselectable). Including them forces a second pass
  // with the fresh projection once the AST catches up.
  useEffect(() => {
    const mountEl = svgMountRef.current;
    if (!mountEl) return;

    const ticket = ++renderTicketRef.current;

    renderMermaidSvg(app, code)
      .then((svgHtml) => {
        if (ticket !== renderTicketRef.current) return;
        // Parsed as XML and adopted into the DOM (no innerHTML), preserving
        // Mermaid's embedded theme <style> that Obsidian's HTML sanitizer
        // would strip.
        mountMermaidSvg(mountEl, svgHtml);
        setSyntaxError(null);

        setupRef.current();
        stabilizeRef.current();
        rectRef.current();
        haloNodeRef.current();
        haloEdgeRef.current();

        try {
          const rendered = new Set<string>();
          mountEl.querySelectorAll('[data-mermaid-subgraph-id]').forEach((el) => {
            const id = el.getAttribute('data-mermaid-subgraph-id');
            if (id) rendered.add(id);
          });
          const missing: string[] = [];
          for (const subId of subgraphsRef.current.keys()) {
            if (!rendered.has(subId)) missing.push(subId);
          }
          useCanvasStore.getState().setUnmatchedSubgraphIds((prev) => {
            if (prev.length === missing.length && prev.every((id) => missing.includes(id))) {
              return prev;
            }
            return missing;
          });
        } catch {
          /* ignore */
        }
      })
      .catch((err: unknown) => {
        if (ticket !== renderTicketRef.current) return;
        console.error('Mermaid render error:', err);
        setSyntaxError(err instanceof Error ? err.message : 'Diagram syntax error');
      });
  }, [code, app, setSyntaxError, svgMountRef, displayNodes, displayEdges, displaySubgraphs]);
}
