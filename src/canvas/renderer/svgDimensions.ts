/**
 * Normalizes SVG dimensions so diagrams render at their true 1:1 natural scale
 * rather than being shrunk or constrained by container width, viewport width, or
 * Obsidian's responsive `max-width: 100%` stylesheet rules.
 */
export function normalizeSvgDimensions(svg: SVGSVGElement): void {
  let naturalWidth: number | null = null;
  let naturalHeight: number | null = null;

  const viewBox = svg.getAttribute('viewBox');
  if (viewBox) {
    const parts = viewBox.trim().split(/[\s,]+/);
    if (parts.length === 4) {
      const w = parseFloat(parts[2]);
      const h = parseFloat(parts[3]);
      if (!isNaN(w) && w > 0 && !isNaN(h) && h > 0) {
        naturalWidth = w;
        naturalHeight = h;
      }
    }
  }

  if (naturalWidth === null && svg.style.maxWidth) {
    const parsed = parseFloat(svg.style.maxWidth);
    if (!isNaN(parsed) && parsed > 0) {
      naturalWidth = parsed;
    }
  }

  if (naturalHeight === null) {
    if (svg.style.maxHeight) {
      const parsedH = parseFloat(svg.style.maxHeight);
      if (!isNaN(parsedH) && parsedH > 0) naturalHeight = parsedH;
    } else if (svg.hasAttribute('height') && !svg.getAttribute('height')?.includes('%')) {
      const parsedH = parseFloat(svg.getAttribute('height') || '');
      if (!isNaN(parsedH) && parsedH > 0) naturalHeight = parsedH;
    }
  }

  if (naturalWidth !== null) {
    svg.setAttribute('width', `${naturalWidth}`);
    svg.style.setProperty('width', `${naturalWidth}px`, 'important');
    svg.style.setProperty('min-width', `${naturalWidth}px`, 'important');
  }
  if (naturalHeight !== null) {
    svg.setAttribute('height', `${naturalHeight}`);
    svg.style.setProperty('height', `${naturalHeight}px`, 'important');
    svg.style.setProperty('min-height', `${naturalHeight}px`, 'important');
  }
  svg.style.setProperty('max-width', 'none', 'important');
}
