/**
 * The explorer's stylesheet: colour tokens on `:root`, redefined for dark mode (by preference unless
 * a `data-theme` stamp says otherwise, and by the stamp), a missing value styled apart from a
 * measured one, and tables that scroll inside their own box instead of widening the page.
 */
export const EXPLORER_CSS = `
:root {
  --bg: #fbfbfa; --surface: #ffffff; --text: #1d1d1f; --muted: #6b6b70; --line: #e3e3e6;
  --accent: #2b59c3; --missing: #9a6a00; --fail: #b3261e; --pass: #1e7a3c;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #151517; --surface: #1d1d20; --text: #ececf0; --muted: #a0a0a8; --line: #33333a;
    --accent: #8fb0ff; --missing: #e0b44a; --fail: #ff8a80; --pass: #7fd69a;
    color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --bg: #151517; --surface: #1d1d20; --text: #ececf0; --muted: #a0a0a8; --line: #33333a;
  --accent: #8fb0ff; --missing: #e0b44a; --fail: #ff8a80; --pass: #7fd69a;
  color-scheme: dark;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.45 system-ui, -apple-system, sans-serif; }
main { max-width: 1400px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 22px; margin: 0 0 4px; }
h2 { font-size: 17px; margin: 32px 0 8px; }
h3 { font-size: 14px; margin: 20px 0 6px; }
p.note, .muted { color: var(--muted); }
.filters { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; margin: 16px 0; }
.filters label { display: grid; gap: 4px; font-size: 12px; color: var(--muted); }
.filters select { font: inherit; padding: 4px 6px; background: var(--surface); color: var(--text); border: 1px solid var(--line); border-radius: 6px; }
.table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--line); vertical-align: top; white-space: nowrap; }
th { font-size: 12px; color: var(--muted); font-weight: 600; }
tr:last-child td { border-bottom: 0; }
.missing { color: var(--missing); font-style: italic; }
.fail { color: var(--fail); }
.pass { color: var(--pass); }
.trend { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); }
.trend figure { margin: 0; padding: 12px; background: var(--surface); border: 1px solid var(--line); border-radius: 8px; }
.trend figcaption { font-size: 12px; color: var(--muted); margin-bottom: 6px; }
.trend svg { width: 100%; height: 120px; display: block; }
.trend svg .axis { stroke: var(--line); }
.trend svg .dot { fill: var(--accent); }
.trend svg .path { stroke: var(--accent); fill: none; stroke-width: 1.5; }
.trend ul { margin: 6px 0 0; padding-left: 18px; font-size: 12px; }
`;
