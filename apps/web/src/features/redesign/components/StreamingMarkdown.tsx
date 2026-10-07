/**
 * StreamingMarkdown — chat-grade markdown renderer with optional typewriter animation.
 *
 * Pattern borrowed from parity-studio (D:/VSCode Projects/parity-studio/src/components/canvas/ChatPanel.tsx:422-575).
 * Supports: paragraphs, h1/h2/h3, ul, ol, fenced code blocks, blockquotes,
 *   inline **bold**, *italic*, `code`, [link](href).
 *
 * When `streaming` is true, the visible text grows character-by-character at `cps` (chars-per-second).
 * Designed to be used by a chat turn that consumes a Convex action's streaming response or a
 * Vercel AI-SDK `useStream` hook in a future sprint.
 */

import { useEffect, useState, type ReactNode } from "react";

type Block =
  | { type: "p"; text: string }
  | { type: "h"; level: 1 | 2 | 3; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "code"; lang: string; text: string }
  | { type: "quote"; text: string };

interface StreamingMarkdownProps {
  text: string;
  /** When true, types out the text character-by-character. Caret blinks until done. */
  streaming?: boolean;
  /** Characters per second (default 220 — fast enough to read but visible). */
  cps?: number;
  className?: string;
}

export function StreamingMarkdown({ text, streaming = false, cps = 220, className }: StreamingMarkdownProps) {
  const [shown, setShown] = useState(streaming ? "" : text);
  const [done, setDone] = useState(!streaming);

  useEffect(() => {
    if (!streaming) {
      setShown(text);
      setDone(true);
      return;
    }
    let i = 0;
    setShown("");
    setDone(false);
    const intervalMs = Math.max(8, Math.round(1000 / cps));
    const id = window.setInterval(() => {
      i += Math.max(1, Math.round(cps / 60)); // grow several chars per tick to feel fluid
      if (i >= text.length) {
        setShown(text);
        setDone(true);
        window.clearInterval(id);
        return;
      }
      setShown(text.slice(0, i));
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [text, streaming, cps]);

  const blocks = parseBlocks(shown);
  return (
    <div className={`rd-md ${className ?? ""}`} aria-busy={!done} aria-live="polite">
      {blocks.map((b, i) => renderBlock(b, i))}
      {!done && <span className="rd-md__caret" aria-hidden="true">▍</span>}
    </div>
  );
}

function renderBlock(b: Block, idx: number): ReactNode {
  if (b.type === "h") {
    const Tag: keyof JSX.IntrinsicElements = b.level === 1 ? "h2" : b.level === 2 ? "h3" : "h4";
    return <Tag key={idx} className={`rd-md__h rd-md__h--${b.level}`}>{renderInline(b.text)}</Tag>;
  }
  if (b.type === "ul") {
    return (
      <ul key={idx} className="rd-md__ul">
        {b.items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}
      </ul>
    );
  }
  if (b.type === "ol") {
    return (
      <ol key={idx} className="rd-md__ol">
        {b.items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}
      </ol>
    );
  }
  if (b.type === "code") {
    if (b.lang === "mermaid") {
      return <MermaidBlock key={idx} source={b.text} />;
    }
    return (
      <pre key={idx} className="rd-md__code" data-lang={b.lang || undefined}>
        {b.lang && <span className="rd-md__code-lang">{b.lang}</span>}
        <code dangerouslySetInnerHTML={{ __html: highlightCode(b.text, b.lang) }} />
      </pre>
    );
  }
  if (b.type === "quote") {
    return <blockquote key={idx} className="rd-md__quote">{renderInline(b.text)}</blockquote>;
  }
  return <p key={idx} className="rd-md__p">{renderInline(b.text)}</p>;
}

/** Parse a markdown string into blocks. Streaming-friendly — handles partial input. */
function parseBlocks(text: string): Block[] {
  const out: Block[] = [];
  let para: string[] = [];
  let list: Extract<Block, { type: "ul" | "ol" }> | null = null;
  let code: { lang: string; lines: string[] } | null = null;
  let quote: string[] = [];

  const flushPara = () => {
    if (para.length === 0) return;
    out.push({ type: "p", text: para.join(" ") });
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    out.push(list);
    list = null;
  };
  const flushQuote = () => {
    if (quote.length === 0) return;
    out.push({ type: "quote", text: quote.join(" ") });
    quote = [];
  };

  const lines = text.split("\n");
  for (const raw of lines) {
    // Code fence
    const fence = raw.match(/^```(\w*)\s*$/);
    if (fence) {
      flushPara(); flushList(); flushQuote();
      if (code) {
        out.push({ type: "code", lang: code.lang, text: code.lines.join("\n") });
        code = null;
      } else {
        code = { lang: fence[1] || "", lines: [] };
      }
      continue;
    }
    if (code) {
      code.lines.push(raw);
      continue;
    }

    const line = raw.trim();
    if (line.length === 0) {
      flushPara(); flushList(); flushQuote();
      continue;
    }

    // Heading
    const h = line.match(/^(#{1,3})\s+(.+)$/);
    if (h) {
      flushPara(); flushList(); flushQuote();
      out.push({ type: "h", level: h[1].length as 1 | 2 | 3, text: h[2] });
      continue;
    }

    // Blockquote
    if (line.startsWith(">")) {
      flushPara(); flushList();
      quote.push(line.replace(/^>\s?/, ""));
      continue;
    }

    // Unordered list
    const ul = line.match(/^[-*]\s+(.+)$/);
    if (ul) {
      flushPara(); flushQuote();
      if (!list || list.type !== "ul") { flushList(); list = { type: "ul", items: [] }; }
      list.items.push(ul[1]);
      continue;
    }

    // Ordered list
    const ol = line.match(/^\d+[.)]\s+(.+)$/);
    if (ol) {
      flushPara(); flushQuote();
      if (!list || list.type !== "ol") { flushList(); list = { type: "ol", items: [] }; }
      list.items.push(ol[1]);
      continue;
    }

    flushList(); flushQuote();
    para.push(line);
  }

  if (code) out.push({ type: "code", lang: code.lang, text: code.lines.join("\n") });
  flushPara(); flushList(); flushQuote();
  return out;
}

/** Lightweight syntax highlighter — covers js/ts/py/sh/json/md.
 *  No external lib (Shiki is too heavy for this surface). Regex tokenizer with
 *  HTML-escape on the raw text first to keep DOM safe. */
function highlightCode(src: string, lang: string): string {
  const escaped = escapeHtml(src);
  const l = (lang || "").toLowerCase();
  const isJsLike = ["js", "ts", "jsx", "tsx", "javascript", "typescript"].includes(l);
  const isPy = l === "py" || l === "python";
  const isShell = l === "sh" || l === "bash" || l === "shell";
  const isJson = l === "json";

  if (isJsLike) {
    const kw = /\b(const|let|var|function|return|if|else|for|while|class|extends|import|export|from|as|async|await|new|of|in|true|false|null|undefined|this|typeof|throw|try|catch|finally|break|continue|case|default|switch)\b/g;
    return escaped
      .replace(/(\/\/[^\n]*)/g, '<span class="rd-tok-comment">$1</span>')
      .replace(/("[^"\n]*"|'[^'\n]*'|`[^`]*`)/g, '<span class="rd-tok-string">$1</span>')
      .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="rd-tok-num">$1</span>')
      .replace(kw, '<span class="rd-tok-kw">$1</span>');
  }
  if (isPy) {
    const kw = /\b(def|class|return|if|elif|else|for|while|import|from|as|in|not|and|or|True|False|None|self|lambda|yield|with|try|except|finally|raise|pass|break|continue|async|await)\b/g;
    return escaped
      .replace(/(#[^\n]*)/g, '<span class="rd-tok-comment">$1</span>')
      .replace(/("""[\s\S]*?"""|'''[\s\S]*?'''|"[^"\n]*"|'[^'\n]*')/g, '<span class="rd-tok-string">$1</span>')
      .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="rd-tok-num">$1</span>')
      .replace(kw, '<span class="rd-tok-kw">$1</span>');
  }
  if (isShell) {
    return escaped
      .replace(/(#[^\n]*)/g, '<span class="rd-tok-comment">$1</span>')
      .replace(/(^|\n)([a-z][\w-]*)/g, '$1<span class="rd-tok-kw">$2</span>')
      .replace(/(--?[a-zA-Z][\w-]*)/g, '<span class="rd-tok-flag">$1</span>')
      .replace(/("[^"\n]*"|'[^'\n]*')/g, '<span class="rd-tok-string">$1</span>');
  }
  if (isJson) {
    return escaped
      .replace(/("(?:\\.|[^"\\])*")(\s*:)/g, '<span class="rd-tok-key">$1</span>$2')
      .replace(/:\s*("(?:\\.|[^"\\])*")/g, ': <span class="rd-tok-string">$1</span>')
      .replace(/\b(true|false|null)\b/g, '<span class="rd-tok-kw">$1</span>')
      .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="rd-tok-num">$1</span>');
  }
  return escaped;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Mermaid block — renders source as a quiet pre + a "View diagram" CTA.
 *  Full Mermaid parsing is left to a follow-up sprint (lazy-load `mermaid` chunk on click). */
function MermaidBlock({ source }: { source: string }) {
  return (
    <div className="rd-md__mermaid">
      <div className="rd-md__mermaid-head">
        <span className="rd-md__mermaid-icon" aria-hidden="true">⊞</span>
        <span className="rd-md__mermaid-title">Mermaid diagram</span>
        <button type="button" className="rd-md__mermaid-cta">View →</button>
      </div>
      <pre className="rd-md__code" data-lang="mermaid">
        <span className="rd-md__code-lang">mermaid</span>
        <code>{source}</code>
      </pre>
    </div>
  );
}

/** Render inline markdown: **bold**, *italic*, `code`, [link](href), ![alt](src). */
function renderInline(text: string): ReactNode[] {
  // Tokenize while preserving order: image/bold/italic/code/link
  const tokenRe = /(!\[[^\]]*\]\([^)]+\)|\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  const parts = text.split(tokenRe).filter((p) => p !== undefined && p !== "");
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length >= 3) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={i} className="rd-md__inline-code">{part.slice(1, -1)}</code>;
    }
    const img = part.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (img) {
      return (
        <span key={i} className="rd-md__img-wrap">
          <img src={img[2]} alt={img[1] || ""} loading="lazy" className="rd-md__img" />
          {img[1] && <span className="rd-md__img-cap">{img[1]}</span>}
        </span>
      );
    }
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      return <a key={i} href={link[2]} target="_blank" rel="noopener noreferrer" className="rd-md__link">{link[1]}</a>;
    }
    return <span key={i}>{part}</span>;
  });
}
