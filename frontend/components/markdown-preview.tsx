'use client';
import { ReactNode } from 'react';

// Renderizador de Markdown MUY simple y SEGURO: convierte patrones bÃ¡sicos de
// Markdown a elementos React nativos. No usa dangerouslySetInnerHTML ni
// innerHTML (evita XSS por contenido), y tampoco depende de una librerÃ­a externa
// (npm no es fiable en este entorno). Soporta: encabezados, negrita, cursiva,
// cÃ³digo inline, bloques de cÃ³digo, listas (con viÃ±etas), enlaces y saltos de
// lÃ­nea. Suficiente para notas tÃ©cnicas de los tÃ©cnicos.
export function MarkdownPreview({ text }: { text: string }) {
  if (!text) return <p className="muted">(sin contenido)</p>;
  const lines = text.split('\n');
  const nodes: ReactNode[] = [];
  let inCode = false;
  let codeLines: string[] = [];
  let list: string[] = [];
  let key = 0;

  const flushList = () => {
    if (list.length) {
      nodes.push(
        <ul key={key++} style={{ margin: '4px 0', paddingLeft: 20 }}>
          {list.map((it, i) => (
            <li key={i}>{renderInline(it)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
  };

  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    // Bloque de cÃ³digo ```
    if (line.trim().startsWith('```')) {
      if (!inCode) {
        flushList();
        inCode = true;
        codeLines = [];
      } else {
        nodes.push(
          <pre key={key++} style={{ background: 'var(--code-bg)', padding: 10, borderRadius: 6, overflowX: 'auto', fontSize: 13 }}>
            <code>{codeLines.join('\n')}</code>
          </pre>,
        );
        inCode = false;
      }
      continue;
    }
    if (inCode) { codeLines.push(line); continue; }
    // DemÃ¡s encabezados
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushList();
      const tag = h[1].length as 1 | 2 | 3 | 4;
      const style = { margin: '10px 0 4px', fontWeight: tag <= 2 ? 700 : 600, fontSize: tag === 1 ? 20 : tag === 2 ? 17 : tag === 3 ? 15 : 14 };
      nodes.push(<div key={key++} style={style}>{renderInline(h[2])}</div>);
      continue;
    }
    // Lista (viÃ±eta)
    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (li) { list.push(li[1]); continue; }
    // Enlace [texto](url) o URL a secas
    flushList();
    if (line.trim()) nodes.push(<p key={key++} style={{ margin: '4px 0' }}>{renderInline(line)}</p>);
  }
  flushList();
  return <div>{nodes}</div>;
}

function renderInline(text: string): ReactNode {
  // Procesa: cÃ³digo `x`, negrita **x**, cursiva *x*, enlace [t](u)
  const parts: ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|(?<!\*)\*[^*]+\*(?!\*)|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('`')) {
      parts.push(<code key={k++} style={{ background: 'var(--code-bg)', padding: '1px 4px', borderRadius: 4, fontSize: 13 }}>{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith('**')) {
      parts.push(<strong key={k++}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith('*')) {
      parts.push(<em key={k++}>{tok.slice(1, -1)}</em>);
    } else {
      const link = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (link) {
        parts.push(<a key={k++} href={link[2]} target="_blank" rel="noreferrer" style={{ color: 'var(--blue)' }}>{link[1]}</a>);
      } else parts.push(tok);
    }
    last = re.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
