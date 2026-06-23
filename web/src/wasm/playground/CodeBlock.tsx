// A small Python tokenizer for the playground snippets: comments, strings,
// numbers, keywords, function calls (an identifier immediately before "("), and
// punctuation each get their own class; everything else is plain text. Enough to
// read like a real editor without pulling in a syntax-highlighter dependency.
import type { ReactNode } from "react";

const KEYWORDS = new Set([
  "import", "from", "as", "with", "for", "in", "def", "return", "if", "else", "elif",
  "True", "False", "None", "and", "or", "not", "class", "lambda", "while", "try",
  "except", "finally", "raise", "yield", "pass", "break", "continue", "is", "await",
  "async", "global", "nonlocal", "del", "assert",
]);

interface Tok {
  text: string;
  cls: string;
}

// One token per match: comment | triple/single/double string | number | identifier
// | whitespace | a single punctuation char.
const RE =
  /(#[^\n]*)|("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\d[\d_]*\.?\d*)|([A-Za-z_]\w*)|(\s+)|([^\s\w])/g;

function tokenize(code: string): Tok[] {
  const toks: Tok[] = [];
  let m: RegExpExecArray | null;
  RE.lastIndex = 0;
  while ((m = RE.exec(code)) !== null) {
    if (m[1] != null) toks.push({ text: m[1], cls: "tok-com" });
    else if (m[2] != null) toks.push({ text: m[2], cls: "tok-str" });
    else if (m[3] != null) toks.push({ text: m[3], cls: "tok-num" });
    else if (m[4] != null) toks.push({ text: m[4], cls: KEYWORDS.has(m[4]) ? "tok-kw" : "ident" });
    else if (m[5] != null) toks.push({ text: m[5], cls: "ws" });
    else toks.push({ text: m[0], cls: "tok-punc" });
  }
  // An identifier directly before "(" is a function/method call.
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].cls !== "ident") continue;
    let j = i + 1;
    while (j < toks.length && toks[j].cls === "ws") j++;
    if (j < toks.length && toks[j].cls === "tok-punc" && toks[j].text === "(") toks[i].cls = "tok-fn";
  }
  return toks;
}

export function CodeBlock({ code }: { code: string }) {
  const toks = tokenize(code);
  return (
    <pre className="pg-code">
      <code>
        {toks.map((tk, i): ReactNode =>
          tk.cls === "ws" || tk.cls === "ident" ? (
            tk.text
          ) : (
            <span key={i} className={tk.cls}>
              {tk.text}
            </span>
          ),
        )}
      </code>
    </pre>
  );
}
