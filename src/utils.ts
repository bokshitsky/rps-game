export function wrapLines(text: string, maxChars: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}

export function mixColor(base: number, target: number, amount: number): string {
  const r = (base >> 16) & 0xff;
  const g = (base >> 8) & 0xff;
  const b = base & 0xff;
  const tr = (target >> 16) & 0xff;
  const tg = (target >> 8) & 0xff;
  const tb = target & 0xff;
  const nextR = Math.round(r + (tr - r) * amount);
  const nextG = Math.round(g + (tg - g) * amount);
  const nextB = Math.round(b + (tb - b) * amount);
  return `rgb(${nextR}, ${nextG}, ${nextB})`;
}
