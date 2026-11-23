// Tiny, safe Markdown subset renderer. Everything is HTML-escaped first, so
// agent output can never inject markup (important: the webview can call IPC).

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inline(s: string): string {
  let out = esc(s);
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  // Links are shown as text + URL; clicking is disabled on purpose.
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1 <span class="url">($2)</span>');
  return out;
}

export function renderMarkdown(src: string): string {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let i = 0;
  let list: "ul" | "ol" | null = null;
  const closeList = () => {
    if (list) html.push(`</${list}>`);
    list = null;
  };

  while (i < lines.length) {
    const line = lines[i];

    const fence = line.match(/^\s*```/);
    if (fence) {
      closeList();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i++;
      html.push(`<pre><code>${esc(body.join("\n"))}</code></pre>`);
      continue;
    }

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      closeList();
      html.push(`<p class="h">${inline(h[2])}</p>`);
      i++;
      continue;
    }

    const ul = line.match(/^\s*[-*•]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      const kind = ul ? "ul" : "ol";
      if (list !== kind) {
        closeList();
        html.push(`<${kind}>`);
        list = kind;
      }
      html.push(`<li>${inline((ul ?? ol)![1])}</li>`);
      i++;
      continue;
    }

    if (line.trim() === "") {
      closeList();
      i++;
      continue;
    }

    closeList();
    const para: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^\s*(```|#{1,4}\s|[-*•]\s|\d+[.)]\s)/.test(lines[i])
    ) {
      para.push(lines[i++]);
    }
    html.push(`<p>${para.map(inline).join("<br>")}</p>`);
  }
  closeList();
  return html.join("");
}
