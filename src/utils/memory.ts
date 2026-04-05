import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { z } from "zod";
import { log } from "./logger.js";

const MEMORY_FILE = ".patchpilots-memory.json";

const memoryFindingSchema = z.object({
  file: z.string(),
  title: z.string(),
  severity: z.string(),
  category: z.string(),
  status: z.enum(["open", "fixed"]),
  firstSeen: z.string(),
  lastSeen: z.string(),
  occurrences: z.number(),
});

const projectMemorySchema = z.object({
  projectPath: z.string(),
  lastRun: z.string(),
  totalRuns: z.number(),
  findings: z.array(memoryFindingSchema),
});

export interface MemoryFinding {
  file: string;
  title: string;
  severity: string;
  category: string;
  status: "open" | "fixed";
  firstSeen: string;
  lastSeen: string;
  occurrences: number;
}

export interface ProjectMemory {
  projectPath: string;
  lastRun: string;
  totalRuns: number;
  findings: MemoryFinding[];
}

function getMemoryPath(targetPath: string): string {
  const abs = resolve(targetPath);
  return resolve(statSync(abs).isFile() ? dirname(abs) : abs, MEMORY_FILE);
}

export function loadMemory(targetPath: string): ProjectMemory {
  const memPath = getMemoryPath(targetPath);
  if (!existsSync(memPath)) {
    return {
      projectPath: resolve(targetPath),
      lastRun: new Date().toISOString(),
      totalRuns: 0,
      findings: [],
    };
  }

  try {
    const raw = JSON.parse(readFileSync(memPath, "utf-8"));
    return projectMemorySchema.parse(raw);
  } catch {
    log.warn('Memory file is corrupt, starting fresh: ' + memPath);
    return {
      projectPath: resolve(targetPath),
      lastRun: new Date().toISOString(),
      totalRuns: 0,
      findings: [],
    };
  }
}

export function saveMemory(targetPath: string, memory: ProjectMemory): void {
  const memPath = getMemoryPath(targetPath);
  writeFileSync(memPath, JSON.stringify(memory, null, 2), "utf-8");
  log.verbose(`Memory saved to ${memPath}`);
}

export function updateMemory(
  memory: ProjectMemory,
  currentFindings: Array<{ file: string; title: string; severity: string; category?: string }>,
): ProjectMemory {
  const updated = structuredClone(memory);
  const now = new Date().toISOString();
  const currentKeys = new Set(currentFindings.map(f => `${f.file}::${f.title}`));

  // Update existing findings
  for (const existing of updated.findings) {
    const key = `${existing.file}::${existing.title}`;
    if (currentKeys.has(key)) {
      // Still present — bump occurrence
      existing.lastSeen = now;
      existing.occurrences++;
      existing.status = "open";
    } else if (existing.status === "open") {
      // Was open, no longer found — mark as fixed
      existing.status = "fixed";
    }
  }

  // Add new findings
  const existingKeys = new Set(updated.findings.map(f => `${f.file}::${f.title}`));
  for (const finding of currentFindings) {
    const key = `${finding.file}::${finding.title}`;
    if (!existingKeys.has(key)) {
      updated.findings.push({
        file: finding.file,
        title: finding.title,
        severity: finding.severity,
        category: finding.category ?? "unknown",
        status: "open",
        firstSeen: now,
        lastSeen: now,
        occurrences: 1,
      });
    }
  }

  updated.lastRun = now;
  updated.totalRuns++;

  return updated;
}

function sanitizeMemoryField(value: string): string {
  return value
    .replace(/[<>]/g, "")
    .replace(/[\x00-\x1f\x7f]/g, "") // control chars
    .replace(/[`*_~\[\]]/g, "")       // markdown-sensitive chars
    .slice(0, 200);
}

export function buildMemoryContext(memory: ProjectMemory): string {
  if (memory.totalRuns === 0 || memory.findings.length === 0) return "";

  const recurring = memory.findings.filter(f => f.occurrences > 1 && f.status === "open");
  const recentlyFixed = memory.findings.filter(f => f.status === "fixed").slice(-5);
  const openCount = memory.findings.filter(f => f.status === "open").length;

  const lines: string[] = [];
  lines.push(`\n<MEMORY_CONTEXT>`);
  lines.push(`## Project Memory (${memory.totalRuns} previous runs)\n`);

  if (recurring.length > 0) {
    lines.push("### Recurring issues (found multiple times — pay extra attention):");
    for (const f of recurring) {
      const title = sanitizeMemoryField(f.title);
      const file = sanitizeMemoryField(f.file);
      const severity = sanitizeMemoryField(f.severity);
      lines.push(`- **${title}** in \`${file}\` — found ${f.occurrences} times since ${f.firstSeen.split("T")[0]} [${severity}]`);
    }
    lines.push("");
  }

  if (recentlyFixed.length > 0) {
    lines.push("### Recently fixed (verify these stay fixed):");
    for (const f of recentlyFixed) {
      const title = sanitizeMemoryField(f.title);
      const file = sanitizeMemoryField(f.file);
      const severity = sanitizeMemoryField(f.severity);
      lines.push(`- ~~${title}~~ in \`${file}\` — was ${severity}, now fixed`);
    }
    lines.push("");
  }

  lines.push(`Open issues: ${openCount} | Total tracked: ${memory.findings.length}`);
  lines.push(`</MEMORY_CONTEXT>`);
  lines.push("");

  return lines.join("\n");
}

export function formatMemoryStatus(memory: ProjectMemory): string {
  const open = memory.findings.filter(f => f.status === "open");
  const fixed = memory.findings.filter(f => f.status === "fixed");
  const recurring = memory.findings.filter(f => f.occurrences > 1 && f.status === "open");

  const lines: string[] = [];
  lines.push("");
  lines.push(`Project memory: ${memory.totalRuns} runs | ${memory.findings.length} findings tracked`);
  lines.push(`  Open: ${open.length} | Fixed: ${fixed.length} | Recurring: ${recurring.length}`);

  if (recurring.length > 0) {
    lines.push("");
    lines.push("  Recurring issues:");
    for (const f of recurring) {
      lines.push(`    ⚠ ${f.title} (${f.file}) — ${f.occurrences}x since ${f.firstSeen.split("T")[0]}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}
