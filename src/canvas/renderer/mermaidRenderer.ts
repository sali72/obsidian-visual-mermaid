import { App, MarkdownRenderer, Component, loadMermaid, sanitizeHTMLToDom } from 'obsidian';
import { normalizeSvgDimensions } from './svgDimensions';

export { normalizeSvgDimensions };

let cachedMermaidApi: MermaidApi | null = null;
export interface MermaidRenderResult {
  svg: string;
}

export interface MermaidApi {
  render(id: string, text: string, container?: HTMLElement): Promise<MermaidRenderResult | string>;
}

export async function getMermaidApi(): Promise<MermaidApi | null> {
  if (cachedMermaidApi) return cachedMermaidApi;
  if (typeof window !== 'undefined' && (window as unknown as { mermaid?: MermaidApi }).mermaid) {
    cachedMermaidApi = (window as unknown as { mermaid?: MermaidApi }).mermaid ?? null;
    return cachedMermaidApi;
  }
  try {
    const loaded: unknown = await loadMermaid();
    cachedMermaidApi = (loaded as MermaidApi).render ? (loaded as MermaidApi) : null;
    return cachedMermaidApi;
  } catch (err) {
    console.warn(
      'Merlay: Direct loadMermaid not available, fallback to MarkdownRenderer',
      err
    );
    return null;
  }
}

let renderSeq = 0;


/**
 * Insert Mermaid-produced SVG into the canvas mount without using innerHTML.
 *
 * Obsidian's HTML sanitizer strips the <style> block Mermaid embeds for
 * diagram theming, so instead the SVG string is parsed into inert nodes and
 * adopted into the live DOM with full fidelity. Script elements and inline
 * event-handler attributes are removed before insertion (Mermaid itself also
 * runs with its default strict security level, which strips scripts from
 * diagram source).
 *
 * The markup is parsed as HTML (not XML) because Mermaid serializes the SVG
 * the same way innerHTML does — e.g. unclosed <br> inside foreignObject
 * labels — which would fail XML parsing whenever a label wraps.
 */
export function mountMermaidSvg(mountEl: HTMLElement, svgHtml: string): void {
  mountEl.empty();

  let svg: SVGSVGElement | null = null;
  try {
    const doc = new DOMParser().parseFromString(svgHtml, 'text/html');
    svg = doc.querySelector<SVGSVGElement>('svg');
  } catch {
    svg = null;
  }

  if (!svg) {
    // Last-resort fallback: sanitized insertion (may lose diagram theming).
    const fragment = sanitizeHTMLToDom(svgHtml);
    const fallbackSvg = fragment.querySelector<SVGSVGElement>('svg');
    if (fallbackSvg) {
      normalizeSvgDimensions(fallbackSvg);
    }
    mountEl.append(fragment);
    return;
  }

  const scrubHandlers = (el: Element): void => {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.toLowerCase().startsWith('on')) {
        el.removeAttribute(attr.name);
      }
    }
  };
  scrubHandlers(svg);
  svg.querySelectorAll('script').forEach((s) => s.remove());
  svg.querySelectorAll('*').forEach(scrubHandlers);

  normalizeSvgDimensions(svg);

  mountEl.append(document.importNode(svg, true));
}

export async function renderMermaidSvg(app: App, code: string): Promise<string> {
  const mermaidApi = await getMermaidApi();
  if (mermaidApi && typeof mermaidApi.render === 'function') {
    const id = `vmm_${Date.now()}_${++renderSeq}`;
    const scratch = document.body.createDiv('mermaid');
    scratch.setCssStyles({
      position: 'absolute',
      visibility: 'hidden',
      top: '-9999px',
      left: '-9999px',
      width: 'auto',
      maxWidth: 'none',
      overflow: 'visible',
    });

    try {
      const res: MermaidRenderResult | string = await mermaidApi.render(id, code, scratch);
      scratch.remove();
      return typeof res === 'string' ? res : res.svg;
    } catch (err) {
      scratch.remove();
      throw err;
    }
  }

  // Fallback to MarkdownRenderer if direct API is unavailable
  const tempContainer = createDiv();
  const comp = new Component();
  comp.load();
  await MarkdownRenderer.render(
    app,
    `\`\`\`mermaid\n${code}\n\`\`\``,
    tempContainer,
    '',
    comp
  );
  comp.unload();
  return tempContainer.innerHTML;
}
