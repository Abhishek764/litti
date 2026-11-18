/**
 * Small Markdown → HTML renderer for the docs site. Covers what docs/guide uses:
 * headings, paragraphs, bold/italic, inline code, links, fenced code, tables,
 * ordered/unordered lists, blockquotes. All text is HTML-escaped first; links
 * are limited to http(s), in-page anchors and other docs pages.
 */

export interface Heading { level: number; text: string; id: string }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const slugify = (s: string) => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '').replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 80) || 'section';

function href(raw: string): string | null {
  const u = raw.trim();
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('#')) return u;
  if (/^[a-z0-9-]+(#[a-z0-9-]+)?$/i.test(u)) return `/docs/${u}`;
  if (u.startsWith('/')) return u;
  return null;
}

/** Inline formatting on already-escaped text. Code spans are protected from other rules. */
export function inline(text: string): string {
  const codes: string[] = [];
  let s = esc(text).replace(/`([^`]+)`/g, (_, c) => { codes.push(`<code>${c}</code>`); return `\u0000${codes.length - 1}\u0000`; });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
    const h = href(url.replace(/&amp;/g, '&'));
    if (!h) return label;
    const ext = /^https?:/i.test(h);
    return `<a href="${esc(h)}"${ext ? ' target="_blank" rel="noopener"' : ''}>${label}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
}

const isTableSep = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const cells = (l: string) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'));

export function render(md: string): { html: string; title: string; headings: Heading[] } {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  const headings: Heading[] = [];
  const used = new Set<string>();
  let title = '';
  let i = 0;

  const para: string[] = [];
  const flush = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para.length = 0; } };

  while (i < lines.length) {
    const line = lines[i];

    const fence = line.match(/^```\s*([\w-]*)\s*$/);
    if (fence) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]);
      i++;
      out.push(`<div class="code"><button class="copy" type="button">Copy</button><pre><code${fence[1] ? ` class="lang-${esc(fence[1])}"` : ''}>${esc(body.join('\n'))}</code></pre></div>`);
      continue;
    }

    const h = line.match(/^(#{1,4})\s+(.+?)\s*#*\s*$/);
    if (h) {
      flush();
      const level = h[1].length;
      if (level === 1 && !title) { title = h[2]; i++; continue; }
      let id = slugify(h[2]);
      while (used.has(id)) id += '-x';
      used.add(id);
      headings.push({ level, text: h[2], id });
      out.push(`<h${level} id="${id}"><a class="anchor" href="#${id}">#</a>${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      flush();
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
      out.push(`<div class="table"><table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }

    if (/^>\s?/.test(line)) {
      flush();
      const q: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${inline(q.join(' '))}</blockquote>`);
      continue;
    }

    const li = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
    if (li) {
      flush();
      const ordered = /\d/.test(li[2]);
      const items: string[] = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
        if (m && /\d/.test(m[2]) === ordered && m[1].length < 2) { items.push(m[3]); i++; continue; }
        // Continuation lines (indented) belong to the previous item.
        if (items.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*```/.test(lines[i])) { items[items.length - 1] += ' ' + lines[i].trim(); i++; continue; }
        break;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map(t => `<li>${inline(t)}</li>`).join('')}</${tag}>`);
      continue;
    }

    if (!line.trim()) { flush(); i++; continue; }
    para.push(line.trim());
    i++;
  }
  flush();
  return { html: out.join('\n'), title, headings };
}
