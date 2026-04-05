import { readFileSync, statSync } from "node:fs";
import { resolve, extname, relative } from "node:path";
import { glob } from "glob";
import type { FileContent, PatchPilotsConfig } from "../types/index.js";

const LANGUAGE_MAP: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".rb": "ruby",
  ".php": "php",
  ".c": "c",
  ".cpp": "cpp",
  ".h": "c",
  ".hpp": "cpp",
  ".cs": "csharp",
  ".swift": "swift",
  ".kt": "kotlin",
  ".html": "html",
  ".css": "css",
  ".scss": "scss",
  ".vue": "vue",
  ".svelte": "svelte",
};

function inferLanguage(filePath: string): string {
  return LANGUAGE_MAP[extname(filePath)] ?? "plaintext";
}

function validateGlobPatterns(patterns: string[]): void {
  for (const pattern of patterns) {
    if (pattern.includes("..") || resolve(pattern) === pattern) {
      throw new Error(`Unsafe glob pattern rejected: ${pattern}`);
    }
  }
}

export async function collectFiles(
  targetPath: string,
  config: PatchPilotsConfig
): Promise<FileContent[]> {
  const absPath = resolve(targetPath);
  const stat = statSync(absPath);

  if (stat.isFile()) {
    const content = readFileSync(absPath, "utf-8");
    return [{ path: relative(process.cwd(), absPath), content, language: inferLanguage(absPath) }];
  }

  validateGlobPatterns(config.include);
  validateGlobPatterns(config.exclude);

  const matches = await glob(config.include, {
    cwd: absPath,
    ignore: config.exclude,
    nodir: true,
    absolute: true,
  });

  const files: FileContent[] = [];

  for (const match of matches) {
    if (files.length >= config.maxFiles) break;

    // Ensure resolved path stays within the target directory
    const rel = relative(absPath, match);
    if (rel.startsWith("..") || resolve(rel) === rel) continue;

    try {
      const fileStat = statSync(match);
      if (fileStat.size > config.maxFileSize) continue;

      const content = readFileSync(match, "utf-8");
      files.push({
        path: relative(process.cwd(), match),
        content,
        language: inferLanguage(match),
      });
    } catch {
      // Skip unreadable files
    }
  }

  return files;
}
