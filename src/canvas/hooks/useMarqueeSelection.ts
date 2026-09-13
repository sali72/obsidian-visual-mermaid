import { useState, useRef, useCallback } from 'react';
import { Rect, SelectionBox } from '../types';
import { MermaidEdgeDef, MermaidNodeDef } from '../../diagrams/viewModel';

export interface UseMarqueeSelectionOptions {
  worldRef: React.RefObject<HTMLDivElement>;
  svgMountRef: React.RefObject<HTMLDivElement>;
  zoomRef: React.RefObject<number>;
  getLocalRect: (el: Element) => Rect | null;
  onSelectionChange: (nodes: Set<string>, edges: Set<string>) => void;
  selectedNodeIdsRef: React.RefObject<Set<string>>;
  selectedEdgeIdsRef: React.RefObject<Set<string>>;
}

function sameSets(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

export function useMarqueeSelection({
  worldRef,
  svgMountRef,
  zoomRef,
  getLocalRect,
  onSelectionChange,
  selectedNodeIdsRef,
  selectedEdgeIdsRef,
}: UseMarqueeSelectionOptions) {
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const dragBoxStartRef = useRef<{ x: number; y: number } | null>(null);
  const isMarqueeActiveRef = useRef<boolean>(false);
  const marqueeRafRef = useRef<number>(0);
  const pendingMarqueeRef = useRef<SelectionBox | null>(null);

  const startMarquee = useCallback(
    (clientX: number, clientY: number) => {
      if (!worldRef.current) return;
      const worldRect = worldRef.current.getBoundingClientRect();
      const z = zoomRef.current || 1;
      dragBoxStartRef.current = {
        x: (clientX - worldRect.left) / z,
        y: (clientY - worldRect.top) / z,
      };
      isMarqueeActiveRef.current = false;
    },
    [worldRef, zoomRef]
  );

  const updateMarquee = useCallback(
    (
      clientX: number,
      clientY: number,
      displayNodes: Map<string, MermaidNodeDef>,
      displayEdges: MermaidEdgeDef[]
    ) => {
      if (!dragBoxStartRef.current || !worldRef.current) return false;

      const worldRect = worldRef.current.getBoundingClientRect();
      const z = zoomRef.current || 1;
      const currentX = (clientX - worldRect.left) / z;
      const currentY = (clientY - worldRect.top) / z;
      const startX = dragBoxStartRef.current.x;
      const startY = dragBoxStartRef.current.y;

      const dist = Math.hypot(currentX - startX, currentY - startY);
      if (dist <= 3) return false;

      isMarqueeActiveRef.current = true;
      const box: SelectionBox = { startX, startY, currentX, currentY };
      setSelectionBox(box);
      pendingMarqueeRef.current = box;

      if (!marqueeRafRef.current) {
        marqueeRafRef.current = window.requestAnimationFrame(() => {
          marqueeRafRef.current = 0;
          const pending = pendingMarqueeRef.current;
          pendingMarqueeRef.current = null;
          const mount = svgMountRef.current;
          if (!pending || !mount) return;

          const minX = Math.min(pending.startX, pending.currentX);
          const maxX = Math.max(pending.startX, pending.currentX);
          const minY = Math.min(pending.startY, pending.currentY);
          const maxY = Math.max(pending.startY, pending.currentY);

          if (displayNodes.size === 0) {
            // View-Only mode: highlight arbitrary SVG elements intersecting with marquee box
            const elements = mount.querySelectorAll(
              ':is(.node, [class*="node"], .cluster, .actor, [class*="actor"], .task, [class*="task"], .commit, [class*="commit"], [class*="slice"], [class*="entity"], g[id]):not(.label):not(text)'
            );
            elements.forEach((el) => {
              const rect = getLocalRect(el);
              if (rect) {
                const intersects = !(
                  rect.x + rect.width < minX ||
                  rect.x > maxX ||
                  rect.y + rect.height < minY ||
                  rect.y > maxY
                );
                if (intersects) {
                  el.classList.add('mermaid-view-highlight');
                } else {
                  el.classList.remove('mermaid-view-highlight');
                }
              }
            });
            return;
          }

          const newSelectedNodes = new Set<string>();
          const newSelectedEdges = new Set<string>();

          // Check nodes (one id can match several elements, e.g. both [*] anchors)
          // Start/end anchors ([*]) are never part of a multi-select / composite group.
          for (const nodeId of displayNodes.keys()) {
            if (nodeId === '[*]' || nodeId.startsWith('[*]:')) continue;
            const nodeEls = mount.querySelectorAll(
              `[data-mermaid-node-id="${nodeId}"]`
            );
            for (const nodeEl of Array.from(nodeEls)) {
              const rect = getLocalRect(nodeEl);
              if (rect) {
                const intersects = !(
                  rect.x + rect.width < minX ||
                  rect.x > maxX ||
                  rect.y + rect.height < minY ||
                  rect.y > maxY
                );
                if (intersects) {
                  newSelectedNodes.add(nodeId);
                  break;
                }
              }
            }
          }

          // Check edges
          for (const edge of displayEdges) {
            const edgePathEl = mount.querySelector(
              `[data-mermaid-edge-id="${edge.id}"]:not(.mermaid-edge-hit-area)`
            );
            if (edgePathEl) {
              const rect = getLocalRect(edgePathEl);
              if (rect) {
                const intersects = !(
                  rect.x + rect.width < minX ||
                  rect.x > maxX ||
                  rect.y + rect.height < minY ||
                  rect.y > maxY
                );
                if (intersects) {
                  newSelectedEdges.add(edge.id);
                }
              }
            }
          }

          const currentNodes = selectedNodeIdsRef.current || new Set<string>();
          const currentEdges = selectedEdgeIdsRef.current || new Set<string>();
          if (
            !sameSets(newSelectedNodes, currentNodes) ||
            !sameSets(newSelectedEdges, currentEdges)
          ) {
            onSelectionChange(newSelectedNodes, newSelectedEdges);
          }
        });
      }

      return true;
    },
    [
      worldRef,
      svgMountRef,
      zoomRef,
      getLocalRect,
      onSelectionChange,
      selectedNodeIdsRef,
      selectedEdgeIdsRef,
    ]
  );

  const endMarquee = useCallback(
    (
      displayNodes: Map<string, MermaidNodeDef>,
      displayEdges: MermaidEdgeDef[]
    ) => {
      if (!dragBoxStartRef.current) return;

      dragBoxStartRef.current = null;
      setSelectionBox(null);
      if (marqueeRafRef.current) {
        window.cancelAnimationFrame(marqueeRafRef.current);
        marqueeRafRef.current = 0;
      }

      const pending = pendingMarqueeRef.current;
      pendingMarqueeRef.current = null;

      const mount = svgMountRef.current;
      if (pending && mount) {
        const minX = Math.min(pending.startX, pending.currentX);
        const maxX = Math.max(pending.startX, pending.currentX);
        const minY = Math.min(pending.startY, pending.currentY);
        const maxY = Math.max(pending.startY, pending.currentY);

        const newSelectedNodes = new Set<string>();
        const newSelectedEdges = new Set<string>();

        for (const nodeId of displayNodes.keys()) {
          if (nodeId === '[*]' || nodeId.startsWith('[*]:')) continue;
          const nodeEls = mount.querySelectorAll(
            `[data-mermaid-node-id="${nodeId}"]`
          );
          for (const nodeEl of Array.from(nodeEls)) {
            const rect = getLocalRect(nodeEl);
            if (
              rect &&
              !(
                rect.x + rect.width < minX ||
                rect.x > maxX ||
                rect.y + rect.height < minY ||
                rect.y > maxY
              )
            ) {
              newSelectedNodes.add(nodeId);
              break;
            }
          }
        }

        for (const edge of displayEdges) {
          const edgePathEl = mount.querySelector(
            `path[data-mermaid-edge-id="${edge.id}"]:not(.mermaid-edge-hit-area)`
          );
          if (edgePathEl) {
            const rect = getLocalRect(edgePathEl);
            if (
              rect &&
              !(
                rect.x + rect.width < minX ||
                rect.x > maxX ||
                rect.y + rect.height < minY ||
                rect.y > maxY
              )
            ) {
              newSelectedEdges.add(edge.id);
            }
          }
        }

        onSelectionChange(newSelectedNodes, newSelectedEdges);
      }

      window.setTimeout(() => {
        isMarqueeActiveRef.current = false;
      }, 50);
    },
    [svgMountRef, getLocalRect, onSelectionChange]
  );

  return {
    selectionBox,
    dragBoxStartRef,
    isMarqueeActiveRef,
    startMarquee,
    updateMarquee,
    endMarquee,
  };
}
