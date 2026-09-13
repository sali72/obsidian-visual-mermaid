import { useRef, useCallback, useMemo } from 'react';
import { useCanvasStore } from '../store/canvasStore';
import {
  ActiveEdgePopover,
  ActiveMultiPopover,
  ActiveNodePopover,
  PopoverPos,
  Rect,
  SelectedEdgePos,
} from '../types';
import {
  applySelectedEdgeHalos,
  applySelectedNodeHalos,
} from '../renderer/selectionHalo';

export interface UseCanvasSelectionOptions {
  svgMountRef: React.RefObject<HTMLDivElement>;
  getLocalRect: (el: Element) => Rect | null;
  displayDirection: string;
}

export function useCanvasSelection({
  svgMountRef,
  getLocalRect,
  displayDirection,
}: UseCanvasSelectionOptions) {
  const selectedNodeIds = useCanvasStore((s) => s.selectedNodeIds);
  const selectedEdgeIds = useCanvasStore((s) => s.selectedEdgeIds);
  const selectedSubgraphId = useCanvasStore((s) => s.selectedSubgraphId);
  const selectedStarKind = useCanvasStore((s) => s.selectedStarKind);

  const selectedNodeRect = useCanvasStore((s) => s.selectedNodeRect);
  const selectedEdgePos = useCanvasStore((s) => s.selectedEdgePos);
  const selectedSubgraphRect = useCanvasStore((s) => s.selectedSubgraphRect);

  const activeNodePopover = useCanvasStore((s) => s.activeNodePopover);
  const activeEdgePopover = useCanvasStore((s) => s.activeEdgePopover);
  const activeMultiPopover = useCanvasStore((s) => s.activeMultiPopover);
  const activeSubgraphPopover = useCanvasStore((s) => s.activeSubgraphPopover);

  const unmatchedSubgraphIds = useCanvasStore((s) => s.unmatchedSubgraphIds);

  const setSelectedNodeIds = useCallback((ids: Set<string>) => {
    useCanvasStore.getState().setSelectedNodeIds(ids);
  }, []);
  const setSelectedEdgeIds = useCallback((ids: Set<string>) => {
    useCanvasStore.getState().setSelectedEdgeIds(ids);
  }, []);
  const setSelectedSubgraphId = useCallback((id: string | null) => {
    useCanvasStore.getState().setSelectedSubgraphId(id);
  }, []);
  const setSelectedNodeRect = useCallback((rect: Rect | null) => {
    useCanvasStore.getState().setSelectedNodeRect(rect);
  }, []);
  const setSelectedEdgePos = useCallback((pos: SelectedEdgePos | null) => {
    useCanvasStore.getState().setSelectedEdgePos(pos);
  }, []);
  const setSelectedSubgraphRect = useCallback((rect: Rect | null) => {
    useCanvasStore.getState().setSelectedSubgraphRect(rect);
  }, []);

  const setActiveNodePopover = useCallback(
    (popover: ActiveNodePopover | ((prev: ActiveNodePopover) => ActiveNodePopover)) => {
      useCanvasStore.getState().setActiveNodePopover(popover);
    },
    []
  );
  const setActiveEdgePopover = useCallback(
    (popover: ActiveEdgePopover | ((prev: ActiveEdgePopover) => ActiveEdgePopover)) => {
      useCanvasStore.getState().setActiveEdgePopover(popover);
    },
    []
  );
  const setActiveMultiPopover = useCallback(
    (popover: ActiveMultiPopover | ((prev: ActiveMultiPopover) => ActiveMultiPopover)) => {
      useCanvasStore.getState().setActiveMultiPopover(popover);
    },
    []
  );
  const setActiveSubgraphPopover = useCallback(
    (
      popover:
        | 'style'
        | 'group'
        | null
        | ((prev: 'style' | 'group' | null) => 'style' | 'group' | null)
    ) => {
      useCanvasStore.getState().setActiveSubgraphPopover(popover);
    },
    []
  );
  const setUnmatchedSubgraphIds = useCallback((ids: string[] | ((prev: string[]) => string[])) => {
    useCanvasStore.getState().setUnmatchedSubgraphIds(ids);
  }, []);

  const selectedNodeIdsRef = useRef<Set<string>>(selectedNodeIds);
  selectedNodeIdsRef.current = selectedNodeIds;
  const selectedEdgeIdsRef = useRef<Set<string>>(selectedEdgeIds);
  selectedEdgeIdsRef.current = selectedEdgeIds;

  const isMultiSelect = selectedNodeIds.size + selectedEdgeIds.size > 1;

  const selectedNodeId =
    selectedNodeIds.size === 1
      ? Array.from(selectedNodeIds)[0]
      : null;

  const selectedEdgeId =
    selectedEdgeIds.size === 1
      ? Array.from(selectedEdgeIds)[0]
      : null;

  const updateSelectedNodeHalo = useCallback(
    (targets?: string | null | Set<string> | string[]) => {
      applySelectedNodeHalos(
        svgMountRef.current,
        selectedNodeIdsRef.current,
        targets,
        selectedStarKind ?? null
      );
    },
    [svgMountRef, selectedStarKind]
  );

  const updateSelectedEdgeHalo = useCallback(
    (targets?: string | null | Set<string> | string[]) => {
      applySelectedEdgeHalos(
        svgMountRef.current,
        selectedEdgeIdsRef.current,
        targets
      );
    },
    [svgMountRef]
  );

  const updateSelectedNodeRect = useCallback(() => {
    const currentId =
      selectedNodeIdsRef.current.size === 1
        ? Array.from(selectedNodeIdsRef.current)[0]
        : null;
    if (!currentId || !svgMountRef.current) {
      setSelectedNodeRect(null);
      return;
    }
    // For [*] we keep anchors distinct — HUD should anchor to the selected
    // start or end circle, not the union of both.
    const isAnchor = currentId === '[*]' || currentId.startsWith('[*]:');
    const selector =
      isAnchor && selectedStarKind
        ? `[data-mermaid-node-id="${currentId}"][data-mermaid-start-end="${selectedStarKind}"]`
        : `[data-mermaid-node-id="${currentId}"]`;
    const nodeEls = Array.from(svgMountRef.current.querySelectorAll(selector));
    // Fallback to any element with this id if kind-filtered query found nothing (e.g. during re-render)
    const elsToUse =
      nodeEls.length > 0
        ? nodeEls
        : Array.from(svgMountRef.current.querySelectorAll(`[data-mermaid-node-id="${currentId}"]`));
    if (elsToUse.length === 0) {
      setSelectedNodeRect(null);
      return;
    }
    if (elsToUse.length === 1) {
      const rect = getLocalRect(elsToUse[0]);
      if (rect) setSelectedNodeRect(rect);
      return;
    }
    if (!isAnchor) {
      let topEl = elsToUse[0];
      let topY = Infinity;
      for (const el of elsToUse) {
        if (
          el.classList.contains('actor-line') ||
          el.classList.contains('mermaid-lifeline-hit-area') ||
          el.tagName.toLowerCase() === 'line'
        ) {
          continue;
        }
        const r = getLocalRect(el);
        if (r && r.y < topY) {
          topY = r.y;
          topEl = el;
        }
      }
      const rect = getLocalRect(topEl);
      if (rect) setSelectedNodeRect(rect);
      return;
    }
    // Union of all matching rects (covers both start & end anchors when no kind).
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let found = false;
    for (const el of elsToUse) {
      const r = getLocalRect(el);
      if (!r) continue;
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.width);
      maxY = Math.max(maxY, r.y + r.height);
      found = true;
    }
    if (found) {
      setSelectedNodeRect({ x: minX, y: minY, width: maxX - minX, height: maxY - minY });
    }
  }, [getLocalRect, svgMountRef, selectedStarKind]);

  const setSelectedNodeId = useCallback(
    (id: string | null) => {
      const newSet = id ? new Set([id]) : new Set<string>();
      selectedNodeIdsRef.current = newSet;
      setSelectedNodeIds(newSet);
      updateSelectedNodeHalo(newSet);
      if (id && svgMountRef.current) {
        const selector =
          id === '[*]' && selectedStarKind
            ? `[data-mermaid-node-id="${id}"][data-mermaid-start-end="${selectedStarKind}"]`
            : `[data-mermaid-node-id="${id}"]`;
        let nodeEls = Array.from(svgMountRef.current.querySelectorAll(selector));
        if (nodeEls.length === 0) {
          nodeEls = Array.from(svgMountRef.current.querySelectorAll(`[data-mermaid-node-id="${id}"]`));
        }
        if (nodeEls.length > 0) {
          if (id !== '[*]') {
            let topEl = nodeEls[0];
            let topY = Infinity;
            for (const el of nodeEls) {
              if (
                el.classList.contains('actor-line') ||
                el.classList.contains('mermaid-lifeline-hit-area') ||
                el.tagName.toLowerCase() === 'line'
              ) {
                continue;
              }
              const r = getLocalRect(el);
              if (r && r.y < topY) {
                topY = r.y;
                topEl = el;
              }
            }
            const rect = getLocalRect(topEl);
            if (rect) setSelectedNodeRect(rect);
          } else if (nodeEls.length === 1) {
            const rect = getLocalRect(nodeEls[0]);
            if (rect) setSelectedNodeRect(rect);
          } else {
            let minX = Infinity;
            let minY = Infinity;
            let maxX = -Infinity;
            let maxY = -Infinity;
            let found = false;
            for (const el of nodeEls) {
              const r = getLocalRect(el);
              if (!r) continue;
              minX = Math.min(minX, r.x);
              minY = Math.min(minY, r.y);
              maxX = Math.max(maxX, r.x + r.width);
              maxY = Math.max(maxY, r.y + r.height);
              found = true;
            }
            if (found) setSelectedNodeRect({ x: minX, y: minY, width: maxX - minX, height: maxY - minY });
          }
        }
      } else {
        setSelectedNodeRect(null);
      }
    },
    [getLocalRect, updateSelectedNodeHalo, svgMountRef, selectedStarKind]
  );

  const setSelectedEdgeId = useCallback(
    (id: string | null) => {
      const newSet = id ? new Set([id]) : new Set<string>();
      selectedEdgeIdsRef.current = newSet;
      setSelectedEdgeIds(newSet);
      updateSelectedEdgeHalo(newSet);
      if (!id) setSelectedEdgePos(null);
    },
    [updateSelectedEdgeHalo]
  );

  const clearSelection = useCallback(() => {
    useCanvasStore.getState().clearSelection();
    updateSelectedNodeHalo(new Set());
    updateSelectedEdgeHalo(new Set());
    if (svgMountRef.current) {
      svgMountRef.current
        .querySelectorAll('.mermaid-cluster-selected')
        .forEach((c) => c.classList.remove('mermaid-cluster-selected'));
    }
  }, [svgMountRef, updateSelectedNodeHalo, updateSelectedEdgeHalo]);

  // Downstream Sprout Button Position based on diagram direction
  const isLR = displayDirection === 'LR' || displayDirection === 'RL';
  const sproutX = selectedNodeRect
    ? isLR
      ? selectedNodeRect.x + selectedNodeRect.width + 12
      : selectedNodeRect.x + selectedNodeRect.width / 2
    : 0;
  const sproutY = selectedNodeRect
    ? isLR
      ? selectedNodeRect.y + selectedNodeRect.height / 2
      : selectedNodeRect.y + selectedNodeRect.height + 12
    : 0;

  // Bounding box enclosing all selected nodes & edges in world coordinates (for Multi-Select)
  const multiSelectBounds = useMemo(() => {
    const totalCount = selectedNodeIds.size + selectedEdgeIds.size;
    if (totalCount <= 1 || !svgMountRef.current) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let found = 0;

    for (const id of selectedNodeIds) {
      const els = Array.from(
        svgMountRef.current.querySelectorAll(`[data-mermaid-node-id="${id}"]`)
      );
      for (const el of els) {
        const rect = getLocalRect(el);
        if (rect) {
          minX = Math.min(minX, rect.x);
          minY = Math.min(minY, rect.y);
          maxX = Math.max(maxX, rect.x + rect.width);
          maxY = Math.max(maxY, rect.y + rect.height);
          found++;
        }
      }
    }

    for (const edgeId of selectedEdgeIds) {
      const el = svgMountRef.current.querySelector(
        `path[data-mermaid-edge-id="${edgeId}"]:not(.mermaid-edge-hit-area)`
      );
      if (el) {
        const rect = getLocalRect(el);
        if (rect) {
          minX = Math.min(minX, rect.x);
          minY = Math.min(minY, rect.y);
          maxX = Math.max(maxX, rect.x + rect.width);
          maxY = Math.max(maxY, rect.y + rect.height);
          found++;
        }
      }
    }

    if (found === 0) return null;
    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
      centerX: minX + (maxX - minX) / 2,
      topY: minY,
    };
  }, [selectedNodeIds, selectedEdgeIds, getLocalRect, svgMountRef]);

  // Position for Shape, Arrow Type & Style popovers (anchored to single sprout or multi-select cluster)
  const popoverPos: PopoverPos | null = useMemo(() => {
    if (isMultiSelect && multiSelectBounds) {
      return {
        left: multiSelectBounds.centerX,
        top: multiSelectBounds.topY - 8,
        transform: 'translate(-50%, 0)',
      };
    }
    if (selectedNodeRect) {
      return {
        left: sproutX,
        top: isLR ? sproutY + 28 : sproutY + 36,
        transform: isLR ? 'translate(0, 0)' : 'translate(-50%, 0)',
      };
    }
    if (selectedEdgePos) {
      return {
        left: selectedEdgePos.x,
        top: selectedEdgePos.y + 14,
        transform: 'translate(-50%, 0)',
      };
    }
    return null;
  }, [
    isMultiSelect,
    multiSelectBounds,
    selectedNodeRect,
    selectedEdgePos,
    sproutX,
    sproutY,
    isLR,
  ]);

  // Position for the subgraph style popover (anchored above the group HUD)
  const subgraphPopoverPos: PopoverPos | null = useMemo(() => {
    if (!selectedSubgraphRect || !selectedSubgraphId) return null;
    return {
      left: selectedSubgraphRect.x + selectedSubgraphRect.width / 2,
      top: selectedSubgraphRect.y - 20,
      transform: 'translate(-50%, -100%)',
    };
  }, [selectedSubgraphRect, selectedSubgraphId]);

  const isolateSelection = useCallback(
    (keepType: 'node' | 'edge' | 'subgraph', id: string) => {
      const empty = new Set<string>();
      if (keepType === 'node') {
        useCanvasStore.getState().setSelectedEdgeIds(empty);
        useCanvasStore.getState().setSelectedEdgePos(null);
        updateSelectedEdgeHalo(empty);
      } else if (keepType === 'edge') {
        useCanvasStore.getState().setSelectedNodeIds(empty);
        useCanvasStore.getState().setSelectedNodeRect(null);
        updateSelectedNodeHalo(empty);
        setSelectedEdgeId(id);
        updateSelectedEdgeHalo(new Set([id]));
      } else if (keepType === 'subgraph') {
        useCanvasStore.getState().setSelectedNodeIds(empty);
        useCanvasStore.getState().setSelectedEdgeIds(empty);
        useCanvasStore.getState().setSelectedNodeRect(null);
        useCanvasStore.getState().setSelectedEdgePos(null);
        useCanvasStore.getState().clearPopovers();
        updateSelectedNodeHalo(empty);
        updateSelectedEdgeHalo(empty);
        useCanvasStore.getState().setSelectedSubgraphId(id);
      }
    },
    [updateSelectedNodeHalo, updateSelectedEdgeHalo, setSelectedEdgeId]
  );

  return {
    selectedNodeIds,
    setSelectedNodeIds,
    selectedEdgeIds,
    setSelectedEdgeIds,
    selectedSubgraphId,
    setSelectedSubgraphId,
    selectedNodeRect,
    setSelectedNodeRect,
    selectedEdgePos,
    setSelectedEdgePos,
    selectedSubgraphRect,
    setSelectedSubgraphRect,
    selectedNodeIdsRef,
    selectedEdgeIdsRef,
    activeNodePopover,
    setActiveNodePopover,
    activeEdgePopover,
    setActiveEdgePopover,
    activeMultiPopover,
    setActiveMultiPopover,
    activeSubgraphPopover,
    setActiveSubgraphPopover,
    unmatchedSubgraphIds,
    setUnmatchedSubgraphIds,
    isMultiSelect,
    selectedNodeId,
    selectedEdgeId,
    setSelectedNodeId,
    setSelectedEdgeId,
    clearSelection,
    isolateSelection,
    updateSelectedNodeHalo,
    updateSelectedEdgeHalo,
    updateSelectedNodeRect,
    isLR,
    sproutX,
    sproutY,
    multiSelectBounds,
    popoverPos,
    subgraphPopoverPos,
  };
}
