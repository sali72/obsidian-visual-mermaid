/**
 * Update shape-matched SVG selection halo for all currently selected nodes.
 * Clones the exact geometric SVG elements (circle, rect, polygon, path, ellipse)
 * and injects soft pulsing and crisp accent halos into the rendered SVG DOM.
 */
export function applySelectedNodeHalos(
  mountEl: HTMLElement | null,
  selectedNodeIds: Iterable<string>,
  targets?: string | null | Set<string> | string[],
  starKind?: 'start' | 'end' | null
): void {
  if (!mountEl) return;

  // 1. Clean up any existing selection halos & selected classes
  mountEl
    .querySelectorAll('.mermaid-node-selection-halo')
    .forEach((el) => el.remove());
  mountEl.querySelectorAll('.mermaid-node-selected').forEach((el) => {
    el.classList.remove('mermaid-node-selected');
  });

  let activeIds: string[] = [];
  if (targets !== undefined) {
    if (!targets) {
      activeIds = [];
    } else if (typeof targets === 'string') {
      activeIds = [targets];
    } else {
      activeIds = Array.from(targets);
    }
  } else {
    activeIds = Array.from(selectedNodeIds);
  }

  if (activeIds.length === 0) return;

  for (const activeId of activeIds) {
    // For [*] we keep start/end distinct via data-mermaid-start-end
    let selector = `[data-mermaid-node-id="${activeId}"]`;
    if ((activeId === '[*]' || activeId.startsWith('[*]:')) && starKind) {
      selector = `[data-mermaid-node-id="${activeId}"][data-mermaid-start-end="${starKind}"]`;
    }
    const nodeEls = Array.from(mountEl.querySelectorAll(selector));
    // Fallback to any [*] element if kind-filtered query found nothing (e.g. re-render race)
    const elsToUse =
      nodeEls.length > 0
        ? nodeEls
        : Array.from(mountEl.querySelectorAll(`[data-mermaid-node-id="${activeId}"]`));
    if (elsToUse.length === 0) continue;

    for (const nodeEl of elsToUse) {
      nodeEl.classList.add('mermaid-node-selected');

      // Skip lifelines, lifeline hit areas, and mirrored bottom actor boxes when cloning halo shapes
      if (
        nodeEl.classList.contains('actor-line') ||
        nodeEl.classList.contains('mermaid-lifeline-hit-area') ||
        nodeEl.classList.contains('actor-bottom') ||
        nodeEl.closest('.actor-bottom') ||
        nodeEl.tagName.toLowerCase() === 'line'
      ) {
        continue;
      }

      // 2. Identify shape elements representing the node's geometry
      let shapeElements = Array.from(
        nodeEl.querySelectorAll('rect, circle, polygon, path, ellipse, line')
      ).filter((el) => {
        if (
          el.closest('.label') ||
          el.closest('text') ||
          el.closest('foreignObject')
        ) {
          return false;
        }
        if (
          el.classList.contains('mermaid-node-selection-halo') ||
          el.classList.contains('actor-line') ||
          el.classList.contains('mermaid-lifeline-hit-area')
        ) {
          return false;
        }
        return true;
      });

      // Prefer primary label-container shape(s) if present (except for stick figures where all limbs should glow)
      if (!nodeEl.classList.contains('actor-man') && !nodeEl.querySelector('.actor-man')) {
        const primaryShapes = shapeElements.filter(
          (el) =>
            el.classList.contains('label-container') ||
            el.classList.contains('outer') ||
            el.classList.contains('basic') ||
            el.classList.contains('actor-top')
        );
        if (primaryShapes.length > 0) {
          shapeElements = primaryShapes;
        }
      }

      // If nodeEl itself is a geometric SVG shape (e.g. <rect class="actor actor-top">)
      if (
        shapeElements.length === 0 &&
        ['rect', 'circle', 'polygon', 'path', 'ellipse', 'line'].includes(
          nodeEl.tagName.toLowerCase()
        )
      ) {
        shapeElements = [nodeEl];
      }

      if (shapeElements.length === 0) continue;

    // 3. For each shape element, inject an outer soft pulsing glow and an inner crisp accent contour
    shapeElements.forEach((shapeEl) => {
      const parent = shapeEl.parentNode;
      if (!parent) return;

      // Outer soft pulsing halo
      const outerHalo = shapeEl.cloneNode(false) as SVGElement;
      outerHalo.removeAttribute('id');
      outerHalo.removeAttribute('style');
      outerHalo.removeAttribute('fill');
      outerHalo.removeAttribute('stroke');
      outerHalo.setAttribute('fill', 'none');
      outerHalo.setAttribute(
        'class',
        'mermaid-node-selection-halo mermaid-node-selection-halo-glow'
      );
      outerHalo.setAttribute('pointer-events', 'none');

      // Inner crisp accent contour
      const innerHalo = shapeEl.cloneNode(false) as SVGElement;
      innerHalo.removeAttribute('id');
      innerHalo.removeAttribute('style');
      innerHalo.removeAttribute('fill');
      innerHalo.removeAttribute('stroke');
      innerHalo.setAttribute('fill', 'none');
      innerHalo.setAttribute(
        'class',
        'mermaid-node-selection-halo mermaid-node-selection-halo-accent'
      );
      innerHalo.setAttribute('pointer-events', 'none');

      parent.insertBefore(outerHalo, shapeEl.nextSibling);
      parent.insertBefore(innerHalo, outerHalo.nextSibling);
      });
    }
  }
}

/**
 * Update selection styling for all currently selected edges.
 * Applies .mermaid-edge-selected to matching SVG paths and edge labels.
 */
export function applySelectedEdgeHalos(
  mountEl: HTMLElement | null,
  selectedEdgeIds: Iterable<string>,
  targets?: string | null | Set<string> | string[]
): void {
  if (!mountEl) return;

  mountEl.querySelectorAll('.mermaid-edge-selected').forEach((el) => {
    el.classList.remove('mermaid-edge-selected');
  });

  let activeIds: string[] = [];
  if (targets !== undefined) {
    if (!targets) {
      activeIds = [];
    } else if (typeof targets === 'string') {
      activeIds = [targets];
    } else {
      activeIds = Array.from(targets);
    }
  } else {
    activeIds = Array.from(selectedEdgeIds);
  }

  if (activeIds.length === 0) return;

  for (const activeId of activeIds) {
    const els = mountEl.querySelectorAll(`[data-mermaid-edge-id="${activeId}"]`);
    els.forEach((el) => {
      if (!el.classList.contains('mermaid-edge-hit-area')) {
        el.classList.add('mermaid-edge-selected');
      }
    });
  }
}
