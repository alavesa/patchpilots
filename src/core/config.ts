import { readFileSync, existsSync, statSync, chmodSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import { DEFAULT_CONFIG, type PatchPilotsConfig } from "../types/index.js";
import { log } from "../utils/logger.js";

const customAgentSchema = z.object({
  name: z.string(),
  description: z.string(),
  prompt: z.string(),
});

const modelRoutingSchema = z.object({
  enabled: z.boolean().optional(),
  fast: z.string().optional(),
  standard: z.string().optional(),
  deep: z.string().optional(),
  fastMaxLines: z.number().positive().optional(),
  deepMinLines: z.number().positive().optional(),
  fastPatterns: z.array(z.string()).optional(),
  deepPatterns: z.array(z.string()).optional(),
}).optional();

const configSchema = z.object({
  apiKey: z.string().optional(),
  model: z.string().optional(),
  maxTokens: z.number().positive().optional(),
  temperature: z.number().min(0).max(1).optional(),
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
  maxFileSize: z.number().positive().optional(),
  maxFiles: z.number().positive().optional(),
  batchSize: z.number().positive().optional(),
  customAgents: z.array(customAgentSchema).optional(),
  modelRouting: modelRoutingSchema,
});

function findConfigFile(startDir: string): string | null {
  let dir = resolve(startDir);
  while (true) {
    const configPath = resolve(dir, ".patchpilots.json");
    if (existsSync(configPath)) return configPath;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function loadGlobalConfig(): Partial<PatchPilotsConfig> {
  const globalPath = resolve(homedir(), ".patchpilots.json");
  if (!existsSync(globalPath)) return {};
  try {
    return configSchema.parse(JSON.parse(readFileSync(globalPath, "utf-8")));
  } catch {
    return {};
  }
}

function loadFileConfig(startDir: string): Partial<PatchPilotsConfig> {
  const configPath = findConfigFile(startDir);
  if (!configPath) return {};

  try {
    const raw = JSON.parse(readFileSync(configPath, "utf-8"));
    return configSchema.parse(raw);
  } catch {
    return {};
  }
}

export interface CLIOptions {
  model?: string;
  config?: string;
  routing?: boolean;
}

export function loadConfig(targetPath: string, cliOptions: CLIOptions = {}): PatchPilotsConfig {
  const globalConfig = loadGlobalConfig();
  const fileConfig = cliOptions.config
    ? configSchema.parse(JSON.parse(readFileSync(resolve(cliOptions.config), "utf-8")))
    : loadFileConfig(targetPath);

  // Prefer env var (safer) over config files (plaintext on disk)
  let apiKey = process.env.ANTHROPIC_API_KEY ?? "";
  let keySource: "env" | "file" | "global" = "env";

  if (!apiKey && fileConfig.apiKey) {
    apiKey = fileConfig.apiKey;
    keySource = "file";
  }
  if (!apiKey && globalConfig.apiKey) {
    apiKey = globalConfig.apiKey;
    keySource = "global";
  }

  if (!apiKey) {
    throw new Error(
      "Missing API key. Set ANTHROPIC_API_KEY environment variable or add apiKey to .patchpilots.json"
    );
  }

  if (keySource !== "env") {
    const configPath = keySource === "global"
      ? resolve(homedir(), ".patchpilots.json")
      : findConfigFile(targetPath);
    log.warn("API key loaded from config file. For better security, use ANTHROPIC_API_KEY environment variable instead.");
    // Ensure config file has restrictive permissions (owner-only read/write)
    if (configPath) {
      try {
        const mode = statSync(configPath).mode & 0o777;
        if (mode !== 0o600) {
          chmodSync(configPath, 0o600);
          log.verbose(`Set ${configPath} permissions to 600 (owner-only).`);
        }
      } catch {
        // Skip if permissions can't be changed
      }
    }
  }

  const merged = {
    ...DEFAULT_CONFIG,
    ...globalConfig,
    ...fileConfig,
    ...(cliOptions.model ? { model: cliOptions.model } : {}),
    apiKey,
  };

  // --routing CLI flag enables model routing
  if (cliOptions.routing) {
    merged.modelRouting = { ...merged.modelRouting, enabled: true };
  }

  return merged;
}
