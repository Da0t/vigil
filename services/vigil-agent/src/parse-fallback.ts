import { VLOG_LINE, type ParsedLogs } from "../../../src/lib/contract";

export function parseLogsFallback(raw: string): ParsedLogs {
  const errorLines: { line: string; component: string; code: string; rest: string }[] = [];
  for (const line of raw.split("\n")) {
    const m = VLOG_LINE.exec(line.trim());
    if (m?.groups && m.groups.lvl === "E") {
      errorLines.push({ line: line.trim(), component: m.groups.component, code: m.groups.code, rest: m.groups.rest });
    }
  }
  const count = (key: (e: (typeof errorLines)[number]) => string) => {
    const map = new Map<string, number>();
    for (const e of errorLines) map.set(key(e), (map.get(key(e)) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  };
  const deploy = errorLines.map((e) => /deploy=(#\d+)/.exec(e.rest)?.[1]).find(Boolean);
  return {
    errorSignature: count((e) => e.code) ?? "UNKNOWN",
    suspectComponent: count((e) => e.component) ?? "unknown",
    suspectDeploy: deploy,
    sampleLines: errorLines.slice(0, 3).map((e) => e.line),
    parserSource: "fallback",
  };
}
