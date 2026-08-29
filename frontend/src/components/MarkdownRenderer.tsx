import React from 'react';

interface MarkdownRendererProps {
  content: string;
}

/**
 * Zero-dependency Markdown renderer for assistant answers.
 *
 * Supported, and nothing else: headings, **bold**, `inline code`, ordered and
 * unordered lists, and paragraphs. Tables, italics, __bold__ and fenced code
 * blocks are NOT parsed and fall through as literal text -- the system prompt
 * asks for bold and lists only, so the parser stays small on purpose.
 *
 * The security property is structural rather than a filter to be kept up to
 * date: every fragment is handed to React as a child, so it is escaped, and no
 * attribute is ever built from content. There is no anchor support at all,
 * which is why javascript:, data: and file: URLs have nothing to attach to and
 * why tabnabbing has no surface here. Content reaching this component is model
 * output and retrieved corpus text, so it is treated as untrusted throughout.
 */
export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  if (!content) return null;

  // Helper to parse inline bold (**text**) and inline code (`code`)
  const renderInline = (text: string): React.ReactNode[] => {
    // Match **bold** or `code`
    const parts = text.split(/(\*\*.*?\*\*|`.*?`)/g);
    return parts.map((part, index) => {
      if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
        return <strong key={index}>{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
        return <code key={index} className="chat__code">{part.slice(1, -1)}</code>;
      }
      return part;
    });
  };

  // Split into block elements by double newline or blank lines
  const blocks = content.trim().split(/\n\s*\n/);

  return (
    <div className="markdown-body">
      {blocks.map((block, blockIdx) => {
        const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
        if (lines.length === 0) return null;

        const firstLine = lines[0];

        // Headings (# Heading, ## Heading, ### Heading)
        if (/^#{1,3}\s+/.test(firstLine)) {
          const level = firstLine.match(/^(#{1,3})/)?.[0].length || 3;
          const headingText = firstLine.replace(/^#{1,3}\s+/, '');
          const Tag = level === 1 ? 'h3' : level === 2 ? 'h4' : 'h5';
          return (
            <Tag key={blockIdx} className="markdown-heading">
              {renderInline(headingText)}
            </Tag>
          );
        }

        // Ordered list block (every line starts with 1. 2. 3.)
        const isOrderedList = lines.length > 1 && lines.every((line) => /^\d+[\.\)]\s+/.test(line));
        if (isOrderedList) {
          return (
            <ol key={blockIdx} className="markdown-list markdown-list--ordered">
              {lines.map((line, lineIdx) => {
                const itemText = line.replace(/^\d+[\.\)]\s+/, '');
                return <li key={lineIdx}>{renderInline(itemText)}</li>;
              })}
            </ol>
          );
        }

        // Unordered list block (every line starts with - or * or •)
        const isUnorderedList = lines.length > 1 && lines.every((line) => /^[-*•]\s+/.test(line));
        if (isUnorderedList) {
          return (
            <ul key={blockIdx} className="markdown-list markdown-list--unordered">
              {lines.map((line, lineIdx) => {
                const itemText = line.replace(/^[-*•]\s+/, '');
                return <li key={lineIdx}>{renderInline(itemText)}</li>;
              })}
            </ul>
          );
        }

        // Mixed content (lines contain list markers interspersed with prose)
        const hasListMarkers = lines.some((line) => /^(?:\d+[\.\)]|[-*•])\s+/.test(line));
        if (hasListMarkers) {
          return (
            <div key={blockIdx} className="markdown-block">
              {lines.map((line, lineIdx) => {
                if (/^\d+[\.\)]\s+/.test(line)) {
                  const num = line.match(/^\d+[\.\)]/)?.[0];
                  const itemText = line.replace(/^\d+[\.\)]\s+/, '');
                  return (
                    <div key={lineIdx} className="markdown-list-item">
                      <span className="markdown-list-num">{num}</span>
                      <span>{renderInline(itemText)}</span>
                    </div>
                  );
                }
                if (/^[-*•]\s+/.test(line)) {
                  const itemText = line.replace(/^[-*•]\s+/, '');
                  return (
                    <div key={lineIdx} className="markdown-list-item">
                      <span className="markdown-list-bullet">•</span>
                      <span>{renderInline(itemText)}</span>
                    </div>
                  );
                }
                return (
                  <p key={lineIdx} className="markdown-para">
                    {renderInline(line)}
                  </p>
                );
              })}
            </div>
          );
        }

        // Standard paragraph
        return (
          <p key={blockIdx} className="markdown-para">
            {lines.map((line, lineIdx) => (
              <React.Fragment key={lineIdx}>
                {lineIdx > 0 && <br />}
                {renderInline(line)}
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
};
