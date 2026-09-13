/**
 * Node Interactivity Setup for Native Mermaid SVG.
 * Handles hit-testing, clicking, double-clicking, and hover proximity detection
 * for nodes and start/end anchors, using the driver's SVG DOM adapter.
 */

import { MermaidNodeDef, MermaidSubgraphDef } from '../../diagrams/viewModel';
import { SvgDomAdapter } from '../../diagrams/types';
import { Rect } from '../types';

export type StartEndKind = 'start' | 'end' | null;

export interface SetupNodeInteractivityOptions {
  mountEl: HTMLElement;
  dom: SvgDomAdapter;
  displayNodes: Map<string, MermaidNodeDef>;
  displaySubgraphs: Map<string, MermaidSubgraphDef>;
  getLocalRect: (el: Element) => Rect | null;
  getLocalPoint?: (clientX: number, clientY: number) => { x: number; y: number } | null;
  onSelectNode: (targetNodeId: string, isMulti: boolean, htmlEl: Element) => void;
  onSelectSubgraph: (targetSubId: string, htmlEl: Element) => void;
  onStartEditingNode: (nodeId: string, nodeEl: Element) => void;
  onStartEditingSubgraph: (subId: string, subEl: Element) => void;
  onHoverNode: (nodeId: string, rect: Rect | null, startEndKind?: StartEndKind) => void;
}

export function setupNodeInteractivity({
  mountEl,
  dom,
  displayNodes,
  displaySubgraphs,
  getLocalRect,
  getLocalPoint,
  onSelectNode,
  onSelectSubgraph,
  onStartEditingNode,
  onStartEditingSubgraph,
  onHoverNode,
}: SetupNodeInteractivityOptions): void {
  const prefixes = dom.nodeIdPrefixes || ['node-', 'flowchart-'];
  const anchorNodeId = dom.anchorNodeId;
  const isAnchorEl = dom.isAnchorElement;

  // Remove stale lifeline hit areas from previous render
  mountEl.querySelectorAll('.mermaid-lifeline-hit-area').forEach((el) => el.remove());

  const nodeSelector = dom.nodeSelector || '.node, [class*="node "]';
  const nodeElements = mountEl.querySelectorAll(nodeSelector);
  nodeElements.forEach((el) => {
    const htmlEl = el as SVGGraphicsElement;
    htmlEl.setCssStyles({ cursor: 'pointer' });

    const idAttr = htmlEl.getAttribute('id') || '';
    let matchedNodeId: string | null = null;

    // 1. Direct name or data-id attribute (standard in Mermaid sequence participants, actors, lifelines)
    const directName =
      htmlEl.getAttribute('name') ||
      htmlEl.getAttribute('data-id') ||
      htmlEl.getAttribute('data-actor-id');
    if (directName && displayNodes.has(directName)) {
      matchedNodeId = directName;
    }

    // 2. Closest ancestor with name or data-id (e.g. inner rect/text inside actor-man figure or top container)
    if (!matchedNodeId) {
      const containerName =
        htmlEl.closest?.('[name]')?.getAttribute('name') ||
        htmlEl.closest?.('[data-id]')?.getAttribute('data-id');
      if (containerName && displayNodes.has(containerName)) {
        matchedNodeId = containerName;
      }
    }

    // 3. Anchor state [*] element
    if (!matchedNodeId) {
      if (isAnchorEl && isAnchorEl(htmlEl)) {
        const compId = dom.getAnchorCompositeId?.(htmlEl) ?? null;
        matchedNodeId = compId ? `${anchorNodeId || '[*]'}:${compId}` : (anchorNodeId || '[*]');
      }
    }

    // 4. Prefix or exact ID matching (flowchart/state nodes)
    if (!matchedNodeId) {
      for (const nid of displayNodes.keys()) {
        if (nid === anchorNodeId) continue;
        if (
          prefixes.some(
            (p) => idAttr.includes(`${p}${nid}-`) || idAttr === `${p}${nid}`
          ) ||
          idAttr.endsWith(`-${nid}`) ||
          idAttr === nid
        ) {
          matchedNodeId = nid;
          break;
        }
      }
    }

    // 5. Indexed actor fallback (actor0, actor1)
    if (!matchedNodeId && /^actor(\d+)$/.test(idAttr)) {
      const idx = parseInt(idAttr.replace('actor', ''), 10);
      const keys = Array.from(displayNodes.keys());
      if (idx >= 0 && idx < keys.length) {
        matchedNodeId = keys[idx];
      }
    }

    // 6. Empty subgraphs degrade to plain `.node` elements with id `{diagramId}-{subId}`
    if (!matchedNodeId && idAttr && !prefixes.some((p) => idAttr.includes(p))) {
      for (const subId of displaySubgraphs.keys()) {
        if (idAttr === subId || idAttr.endsWith(`-${subId}`) || prefixes.some((p) => idAttr.includes(`${p}${subId}-`))) {
          htmlEl.setAttribute('data-mermaid-subgraph-id', subId);
          const targetSubId = subId;
          htmlEl.onclick = (e) => {
            e.stopPropagation();
            onSelectSubgraph(targetSubId, htmlEl);
          };
          htmlEl.ondblclick = (e) => {
            e.stopPropagation();
            onStartEditingSubgraph(targetSubId, htmlEl);
          };
          return;
        }
      }
    }

    // 7. Text label content matching
    if (!matchedNodeId) {
      const labelText = htmlEl.querySelector('.label, text')?.textContent?.trim() || htmlEl.textContent?.trim();
      for (const [nid, ndef] of displayNodes.entries()) {
        if (ndef.label === labelText || nid === labelText) {
          matchedNodeId = nid;
          break;
        }
      }
    }

    if (!matchedNodeId) return;
    const targetNodeId = matchedNodeId;
    htmlEl.setAttribute('data-mermaid-node-id', targetNodeId);
    if (anchorNodeId && targetNodeId === anchorNodeId) {
      const k = dom.getAnchorKind?.(htmlEl) ?? null;
      if (k) htmlEl.setAttribute('data-mermaid-start-end', k);
    }

    // Bottom mirrored actors in sequence diagrams should only allow click selection, no hover handles
    if (htmlEl.classList.contains('actor-bottom') || htmlEl.closest('.actor-bottom')) {
      htmlEl.onclick = (e) => {
        e.stopPropagation();
        const isMulti = e.shiftKey || e.metaKey || e.ctrlKey;
        onSelectNode(targetNodeId, isMulti, htmlEl);
      };
      return;
    }

    const isLifeline =
      (htmlEl.classList.contains('actor-line') || htmlEl.getAttribute('id')?.startsWith('actor')) &&
      htmlEl.tagName.toLowerCase() === 'line';

    const isText = htmlEl.tagName.toLowerCase() === 'text' || !!htmlEl.closest('text');
    const isActor = htmlEl.classList.contains('actor') || htmlEl.classList.contains('actor-top');

    const getPrimaryHeaderEl = (): Element | null => {
      return (
        mountEl.querySelector(
          `rect.actor-top[name="${targetNodeId}"], g.actor-top[name="${targetNodeId}"], rect.actor[name="${targetNodeId}"], [data-mermaid-node-id="${targetNodeId}"]:not(.actor-line):not(.mermaid-lifeline-hit-area):not(text):not(line)`
        ) || null
      );
    };

    htmlEl.onclick = (e) => {
      e.stopPropagation();
      const isMulti = e.shiftKey || e.metaKey || e.ctrlKey;
      onSelectNode(targetNodeId, isMulti, htmlEl);
    };

    htmlEl.ondblclick = (e) => {
      e.stopPropagation();
      onStartEditingNode(targetNodeId, htmlEl);
    };

    if (!isLifeline) {
      const handleHeaderHover = () => {
        let targetEl: Element = htmlEl;
        if (isText || isActor) {
          const topHeader = getPrimaryHeaderEl();
          if (topHeader) targetEl = topHeader;
        }
        const rect = getLocalRect(targetEl);
        const anchorKind =
          anchorNodeId && targetNodeId === anchorNodeId
            ? dom.getAnchorKind?.(htmlEl) ?? null
            : null;
        onHoverNode(targetNodeId, rect, anchorKind);
      };

      htmlEl.onmouseenter = handleHeaderHover;
      if (isText) {
        htmlEl.onmousemove = handleHeaderHover;
      }
    }

    // For vertical lifelines, attach an invisible 28px hit area overlay to make selection
    // and drag-to-connect dropping completely effortless anywhere along the column timeline.
    if (isLifeline) {
      const lineEl = htmlEl as unknown as SVGLineElement;
      const hitArea = createSvg('line');
      hitArea.setAttribute('x1', lineEl.getAttribute('x1') || '0');
      hitArea.setAttribute('y1', lineEl.getAttribute('y1') || '0');
      hitArea.setAttribute('x2', lineEl.getAttribute('x2') || '0');
      hitArea.setAttribute('y2', lineEl.getAttribute('y2') || '0');
      hitArea.setAttribute('class', 'mermaid-lifeline-hit-area');
      hitArea.setAttribute('data-mermaid-node-id', targetNodeId);
      hitArea.setAttribute('fill', 'none');
      hitArea.setAttribute('stroke', 'transparent');
      hitArea.setAttribute('stroke-width', '28');
      hitArea.setCssStyles({ cursor: 'pointer', pointerEvents: 'stroke' });

      const updateLifelineHover = (e: MouseEvent) => {
        const lineRect = getLocalRect(lineEl);
        if (!lineRect) return;
        const pt = getLocalPoint ? getLocalPoint(e.clientX, e.clientY) : null;
        const lineCenterX = lineRect.x + lineRect.width / 2;
        const targetY = pt ? pt.y : lineRect.y + lineRect.height / 2;

        // Clamp to lifeline span with 12px margin
        const clampedY = Math.max(
          lineRect.y + 12,
          Math.min(lineRect.y + lineRect.height - 12, targetY)
        );

        // When isLR is false, ConnectionHandle places handle at:
        // posX = rect.x + rect.width / 2
        // posY = rect.y + rect.height
        // Setting width = 20, height = 10 puts the handle dot precisely at (lineCenterX, clampedY).
        const handleRect: Rect = {
          x: lineCenterX - 10,
          y: clampedY - 10,
          width: 20,
          height: 10,
        };
        onHoverNode(targetNodeId, handleRect, null);
      };

      hitArea.onclick = (e) => {
        e.stopPropagation();
        const isMulti = e.shiftKey || e.metaKey || e.ctrlKey;
        onSelectNode(targetNodeId, isMulti, htmlEl);
      };
      hitArea.ondblclick = (e) => {
        e.stopPropagation();
        onStartEditingNode(targetNodeId, htmlEl);
      };

      hitArea.onmouseenter = updateLifelineHover;
      hitArea.onmousemove = updateLifelineHover;
      lineEl.onmouseenter = updateLifelineHover;
      lineEl.onmousemove = updateLifelineHover;

      htmlEl.parentNode?.insertBefore(hitArea, htmlEl.nextSibling);
    }
  });

  // Anchor shapes (e.g. mermaid renders [*] as <g class="node default"
  // id="...-root_start-…"> / outer-path end markers) are tagged separately for
  // selection and drag-to-connect.
  if (dom.anchorSelectors && anchorNodeId) {
    mountEl.querySelectorAll(dom.anchorSelectors).forEach((shapeEl) => {
      const el = shapeEl;
      const kind = dom.getAnchorKind?.(el) ?? null;
      if (!kind) return;
      const compId = dom.getAnchorCompositeId?.(el) ?? null;
      const targetAnchorId = compId ? `${anchorNodeId}:${compId}` : anchorNodeId;
      const rawContainer = el.closest('g.node, g');
      const container =
        (rawContainer as SVGGraphicsElement | null) ||
        (el as SVGGraphicsElement);
      container.setAttribute('data-mermaid-node-id', targetAnchorId);
      container.setAttribute('data-mermaid-start-end', kind);
      if (compId) {
        container.setAttribute('data-mermaid-subgraph-id', compId);
      }
      container.setCssStyles({ cursor: 'pointer' });

      container.onclick = (e) => {
        e.stopPropagation();
        const isMulti =
          (e as MouseEvent).shiftKey || (e as MouseEvent).metaKey || (e as MouseEvent).ctrlKey;
        onSelectNode(targetAnchorId, isMulti, container);
      };

      container.ondblclick = (e) => {
        e.stopPropagation();
        onStartEditingNode(targetAnchorId, container);
      };

      container.onmouseenter = () => {
        const rect = getLocalRect(container);
        onHoverNode(targetAnchorId, rect, kind);
      };
    });
  }
}
