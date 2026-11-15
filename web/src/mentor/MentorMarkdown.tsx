import type { ReactNode } from 'react';

// Renders the subset of Markdown that DeepSeek produces in short chat answers:
// paragraphs, bullet/numbered lists, **bold**, *italic*, `code`.
// Operates on plain strings — no dangerouslySetInnerHTML.

type Block =
  { kind: 'para'; lines: string[] } | { kind: 'bullet'; items: string[] } | { kind: 'ordered'; items: string[] };

const INLINE_RE = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;

function renderInline(text: string): ReactNode[] {
  return text.split(INLINE_RE).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('*') && part.endsWith('*')) return <em key={i}>{part.slice(1, -1)}</em>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>;
    return part;
  });
}

function parseBlocks(text: string): Block[] {
  const lines = text.split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i++;
      continue;
    }

    if (/^[-*] /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*] /.test(lines[i])) {
        items.push(lines[i].replace(/^[-*] /, ''));
        i++;
      }
      blocks.push({ kind: 'bullet', items });
      continue;
    }

    if (/^\d+\. /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\. /, ''));
        i++;
      }
      blocks.push({ kind: 'ordered', items });
      continue;
    }

    const paraLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !/^[-*] /.test(lines[i]) && !/^\d+\. /.test(lines[i])) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push({ kind: 'para', lines: paraLines });
  }

  return blocks;
}

export function MentorMarkdown({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  return (
    <>
      {blocks.map((block, bi) => {
        if (block.kind === 'bullet') {
          return (
            <ul key={bi}>
              {block.items.map((item, ii) => (
                <li key={ii}>{renderInline(item)}</li>
              ))}
            </ul>
          );
        }
        if (block.kind === 'ordered') {
          return (
            <ol key={bi}>
              {block.items.map((item, ii) => (
                <li key={ii}>{renderInline(item)}</li>
              ))}
            </ol>
          );
        }
        return (
          <p key={bi}>
            {block.lines.flatMap((line, li) => [...(li > 0 ? [<br key={`br-${li}`} />] : []), ...renderInline(line)])}
          </p>
        );
      })}
    </>
  );
}
