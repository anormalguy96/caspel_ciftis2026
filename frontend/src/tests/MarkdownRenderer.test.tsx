import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MarkdownRenderer } from '../components/MarkdownRenderer';
import { CaspelAIModal } from '../components/CaspelAIModal';
import rendererSource from '../components/MarkdownRenderer.tsx?raw';
import modalSource from '../components/CaspelAIModal.tsx?raw';

/**
 * Everything this component renders came from a language model or from text
 * retrieved out of the corpus. Neither is trusted input. A visitor at a public
 * exhibition scans a QR code and reads whatever appears; if a crafted answer
 * could run script in that page, the booth would be handing out an XSS to
 * every phone that scans it.
 */

vi.mock('../services/analytics', () => ({
  trackAnalyticsEvent: vi.fn(),
  getSessionId: () => 'test-session',
}));

const sendChatMessage = vi.fn();
vi.mock('../services/api', async () => {
  const actual = await vi.importActual<typeof import('../services/api')>('../services/api');
  return { ...actual, sendChatMessage: (...args: unknown[]) => sendChatMessage(...args) };
});

beforeEach(() => {
  sendChatMessage.mockReset();
});

// ==========================================================================
// 1-4. Hostile content cannot execute
// ==========================================================================

describe('assistant content cannot execute', () => {
  it('escapes a script tag instead of running it', () => {
    const { container } = render(<MarkdownRenderer content={'<script>window.__pwned = 1</script>'} />);

    expect(container.querySelectorAll('script')).toHaveLength(0);
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    // Escaped, so the angle brackets are text and the browser never parses them.
    expect(container.innerHTML).toContain('&lt;script&gt;');
  });

  it('creates no element and no live handler from raw HTML', () => {
    const { container } = render(<MarkdownRenderer content={'<img src=x onerror=alert(1)>'} />);

    expect(container.querySelectorAll('img')).toHaveLength(0);
    expect(container.querySelector('[onerror]')).toBeNull();
    expect(container.innerHTML).toContain('&lt;img');
    // The literal word survives as text; that is the escape working, not a leak.
    expect(container.textContent).toContain('onerror');
  });

  it('creates no iframe, object or embed', () => {
    const { container } = render(
      <MarkdownRenderer content={'<iframe src="https://evil.test"></iframe><object data=x></object><embed src=x>'} />
    );

    expect(container.querySelectorAll('iframe, object, embed')).toHaveLength(0);
  });

  it('builds no anchor, so javascript:, data: and file: have nothing to attach to', () => {
    const hostile = [
      '[a](javascript:alert(1))',
      '[b](data:text/html,<script>alert(1)</script>)',
      '[c](file:///etc/passwd)',
      '[d](https://evil.test)',
      '<a href="javascript:alert(1)">e</a>',
    ].join(' ');
    const { container } = render(<MarkdownRenderer content={hostile} />);

    // Assert on the DOM, not the serialised string: a literal "href=" does
    // appear in the output, escaped, as part of the text the model sent. That
    // is the escape working. What must not exist is an element carrying it.
    expect(container.querySelectorAll('a')).toHaveLength(0);
    expect(container.querySelector('[href]')).toBeNull();
    expect(container.innerHTML).toContain('&lt;a href=');
  });
});

// ==========================================================================
// 5-6, 13. Structural guarantees
// ==========================================================================

describe('the renderer has no unsafe machinery', () => {
  it('uses no dangerouslySetInnerHTML path', () => {
    expect(rendererSource).not.toMatch(/dangerouslySetInnerHTML/);
    expect(rendererSource).not.toMatch(/\binnerHTML\b/);
    expect(modalSource).not.toMatch(/dangerouslySetInnerHTML/);
  });

  it('calls no external rendering service', async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(new Response('')));
    vi.stubGlobal('fetch', fetchSpy);

    const { container } = render(<MarkdownRenderer content={'**Caspel ERP** overview\n\n- one\n- two'} />);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(container.querySelectorAll('img, script, link')).toHaveLength(0);
    // Zero-dependency by construction: React is the only import.
    expect(rendererSource).not.toMatch(/\bfetch\(|XMLHttpRequest|https?:\/\//);
    vi.unstubAllGlobals();
  });

  it('cannot introduce tabnabbing: any future anchor must be safe', () => {
    const { container } = render(
      <MarkdownRenderer content={'[CASPEL](https://caspel.com) and [ERP](https://caspel.com/erp)'} />
    );

    // Today there are none. If link support is ever added, this fails unless
    // every anchor carries noopener/noreferrer and a safe protocol.
    for (const anchor of Array.from(container.querySelectorAll('a'))) {
      const rel = anchor.getAttribute('rel') ?? '';
      expect(rel).toContain('noopener');
      expect(rel).toContain('noreferrer');
      expect(anchor.getAttribute('href') ?? '').toMatch(/^https?:\/\//);
    }
  });

  it('writes no visitor prompt, context or provider output to the console', () => {
    expect(modalSource).not.toMatch(/console\.(log|debug|info|warn|error|trace|dir)/);
    expect(rendererSource).not.toMatch(/console\./);
  });
});

// ==========================================================================
// 7-11. The formatting the system prompt actually asks for
// ==========================================================================

describe('supported formatting renders correctly', () => {
  it('renders bold', () => {
    render(<MarkdownRenderer content={'**Caspel ERP** is modular.'} />);
    expect(screen.getByText('Caspel ERP').tagName).toBe('STRONG');
  });

  it('renders inline code', () => {
    render(<MarkdownRenderer content={'Call `GET /api/health` to check.'} />);
    expect(screen.getByText('GET /api/health').tagName).toBe('CODE');
  });

  it('renders ordered lists', () => {
    const { container } = render(<MarkdownRenderer content={'1. Procurement\n2. Finance\n3. HR'} />);
    expect(container.querySelectorAll('ol > li')).toHaveLength(3);
    expect(container.querySelector('ol > li')?.textContent).toBe('Procurement');
  });

  it('renders unordered lists', () => {
    const { container } = render(<MarkdownRenderer content={'- Procurement\n- Finance'} />);
    expect(container.querySelectorAll('ul > li')).toHaveLength(2);
  });

  it('renders a document/page citation as readable text', () => {
    render(<MarkdownRenderer content={'Modules are listed in [CASPEL ERP Presentation, Page 4].'} />);
    expect(screen.getByText(/\[CASPEL ERP Presentation, Page 4\]/)).toBeInTheDocument();
  });

  it('leaves unsupported syntax as literal text rather than half-parsing it', () => {
    // Documented gaps. Asserted so the comment cannot drift from the parser.
    const { container } = render(<MarkdownRenderer content={'| A | B |\n| - | - |\n\n*italic* __alsobold__'} />);
    expect(container.querySelectorAll('table, em')).toHaveLength(0);
    expect(container.textContent).toContain('| A | B |');
    expect(container.textContent).toContain('*italic*');
    expect(container.textContent).toContain('__alsobold__');
  });
});

// ==========================================================================
// 12. Visitor input is never treated as markup
// ==========================================================================

describe('visitor messages stay plain text', () => {
  it('renders what the visitor typed without parsing it as markdown or HTML', async () => {
    const user = userEvent.setup();
    // No assistant reply: the failure keeps the assertion focused on the
    // visitor's own message, and calls no provider.
    sendChatMessage.mockRejectedValue(new Error('unavailable'));

    render(<CaspelAIModal isOpen onClose={() => {}} />);

    const hostile = '<script>alert(1)</script> **not bold**';
    const input = screen.getByRole('textbox');
    await user.type(input, hostile);
    await user.keyboard('{Enter}');

    const bubble = await screen.findByText(/not bold/);
    expect(bubble.tagName).toBe('P');
    expect(bubble.className).toContain('chat__text');
    expect(bubble.querySelectorAll('strong, script')).toHaveLength(0);
    expect(bubble.textContent).toContain('<script>');

    await waitFor(() => expect(sendChatMessage).toHaveBeenCalled());
  });
});
