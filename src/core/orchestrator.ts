import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { resolve, relative, isAbsolute, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { LLMClient } from "./llm-client.js";
import { ReviewerAgent } from "../agents/reviewer.js";
import { CoderAgent } from "../agents/coder.js";
import { TesterAgent } from "../agents/tester.js";
import { PlannerAgent } from "../agents/planner.js";
import { DocsAgent } from "../agents/docs.js";
import { SecurityAgent } from "../agents/security.js";
import { DesignerAgent } from "../agents/designer.js";
import { CustomAgent } from "../agents/custom.js";
import { collectFiles } from "../utils/files.js";
import { formatReviewResult, formatCoderResult, formatTestResult, formatPlanResult, formatDocsResult, formatSecurityResult, formatDesignerResult, formatJson } from "../utils/formatter.js";
import { log } from "../utils/logger.js";
import { CostTracker } from "../utils/cost.js";
import { loadMemory, saveMemory, updateMemory, buildMemoryContext, formatMemoryStatus } from "../utils/memory.js";
import type { PatchPilotsConfig } from "../types/index.js";
import type { ReviewResult, CoderResult, TestResult, PlanResult, DocsResult, SecurityResult, DesignerResult, AuditResult } from "../types/review.js";

function assertWithinBase(absPath: string, base: string): void {
  const rel = relative(base, absPath);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Path escape detected: ${absPath} is outside ${base}`);
  }
}

export interface OrchestratorOptions {
  json?: boolean;
  verbose?: boolean;
  write?: boolean;
  backup?: boolean;
  severity?: string;
  framework?: string;
  task?: string;
  skip?: string[];
}

export class Orchestrator {
  private llmClient: LLMClient;
  private config: PatchPilotsConfig;
  private costTracker: CostTracker;

  constructor(config: PatchPilotsConfig) {
    this.config = config;
    this.llmClient = new LLMClient(config.apiKey, config.model);
    this.costTracker = new CostTracker(config.model);
  }

  private async gatherFiles(targetPath: string, verbose?: boolean): Promise<Awaited<ReturnType<typeof collectFiles>> | null> {
    log.step("Collecting files...");
    const files = await collectFiles(targetPath, this.config);
    if (files.length === 0) {
      log.warn("No matching files found.");
      return null;
    }
    log.info(`Found ${files.length} file(s) to ${verbose ? "audit" : "review"}`);
    if (verbose) {
      for (const f of files) log.verbose(`  ${f.path}`);
    }
    return files;
  }

  private applyPatches(coderResult: CoderResult, options: { backup?: boolean }): void {
    const base = process.cwd();
    for (const file of coderResult.improvedFiles) {
      const absPath = resolve(file.path);
      assertWithinBase(absPath, base);
      if (options.backup) {
        copyFileSync(absPath, absPath + ".bak");
        log.verbose(`Backed up ${file.path} → ${file.path}.bak`);
      }
      let content = readFileSync(absPath, "utf-8");
      let applied = 0;
      for (const patch of file.patches) {
        if (content.includes(patch.find)) {
          content = content.replace(patch.find, patch.replace);
          applied++;
        } else {
          log.warn(`Patch skipped (no match): ${patch.description}`);
        }
      }
      if (applied > 0) {
        writeFileSync(absPath, content, "utf-8");
        log.success(`Patched ${file.path} (${applied}/${file.patches.length})`);
      }
    }
  }

  private printCost(json?: boolean): void {
    if (!json) {
      console.error(this.costTracker.formatSummary());
    }
  }

  private trackCost(agentName: string, result: { tokensUsed: { input: number; output: number }; model?: string }): void {
    this.costTracker.track(agentName, result.tokensUsed, result.model);
  }

  private createStreamCallback(verbose: boolean) {
    let thinkingStarted = false;
    return (token: string) => {
      if (verbose) {
        if (!thinkingStarted) {
          log.verbose("Agent is thinking...");
          thinkingStarted = true;
        }
        process.stderr.write(".");
      }
    };
  }

  /**
   * Run local static analysis (tsc --noEmit) before AI agents.
   * Returns findings for any TypeScript errors found — these are
   * free to detect and don't need AI.
   */
  private runTypeScriptCheck(targetPath: string): ReviewResult["findings"] {
    const absPath = resolve(targetPath);
    try {
      // Resolve tsc from PatchPilots' own node_modules to prevent binary planting
      const ownDir = dirname(fileURLToPath(import.meta.url));
      const tscPath = resolve(ownDir, "../../node_modules/.bin/tsc");
      execFileSync(tscPath, ["--noEmit"], { cwd: absPath, encoding: "utf-8", timeout: 30000, stdio: ["pipe", "pipe", "pipe"] });
      return [];
    } catch (err: unknown) {
      const output = (err as { stdout?: string; stderr?: string }).stdout ?? (err as { stderr?: string }).stderr ?? "";
      if (!output.trim()) return [];

      const findings: ReviewResult["findings"] = [];
      const lines = output.split("\n").filter(l => l.includes("error TS"));

      for (const line of lines) {
        // Parse: src/file.tsx(10,5): error TS6133: 'X' is declared but its value is never read.
        const match = line.match(/^(.+?)\((\d+),\d+\):\s*error\s+(TS\d+):\s*(.+)$/);
        if (match) {
          const [, file, lineNum, code, message] = match;
          findings.push({
            file,
            line: parseInt(lineNum, 10),
            severity: code === "TS2554" || code === "TS2345" ? "critical" : "warning",
            category: "bug",
            title: `TypeScript ${code}: ${message.slice(0, 80)}`,
            description: message,
            suggestion: code === "TS6133" ? "Remove the unused import" : "Fix the type error",
          });
        }
      }

      return findings;
    }
  }

  async review(targetPath: string, options: OrchestratorOptions = {}): Promise<ReviewResult> {
    const files = await this.gatherFiles(targetPath, options.verbose);
    if (!files) return { findings: [], summary: "No files to review." };

    // Pre-flight: run TypeScript compiler check (free, instant)
    log.step("⚡ Running TypeScript pre-check...");
    const tsFindings = this.runTypeScriptCheck(targetPath);
    if (tsFindings.length > 0) {
      log.warn(`Found ${tsFindings.length} TypeScript error(s) before AI review`);
    } else {
      log.info("TypeScript check passed");
    }

    // Load project memory
    const memory = loadMemory(targetPath);
    const memoryContext = buildMemoryContext(memory);
    if (memory.totalRuns > 0 && !options.json) {
      log.info(`Project memory: ${memory.totalRuns} previous runs, ${memory.findings.filter(f => f.status === "open").length} open issues`);
    }

    log.step("🔍 Reviewer agent analyzing code...");
    const onToken = this.createStreamCallback(options.verbose ?? false);
    const reviewer = new ReviewerAgent(this.llmClient);
    const result = await reviewer.executeBatched(
      { files, config: this.config, memoryContext },
      (results) => ({
        findings: results.flatMap(r => r.findings),
        summary: results.map(r => r.summary).join(" "),
      }),
      onToken,
    );
    const reviewResult = result.data as ReviewResult;
    // Merge TypeScript pre-check findings into review results
    if (tsFindings.length > 0) {
      reviewResult.findings = [...tsFindings, ...reviewResult.findings];
      reviewResult.summary = `TypeScript: ${tsFindings.length} error(s). ${reviewResult.summary}`;
    }
    this.trackCost("Reviewer", result);

    if (options.verbose) {
      console.error(""); // newline after dots
      log.verbose(`Tokens used: ${result.tokensUsed.input} in / ${result.tokensUsed.output} out`);
    }

    // Update and save memory
    const updatedMemory = updateMemory(memory, reviewResult.findings.map(f => ({
      file: f.file, title: f.title, severity: f.severity, category: f.category,
    })));
    saveMemory(targetPath, updatedMemory);

    // Filter by severity if specified
    if (options.severity) {
      const levels: Record<string, number> = { critical: 3, warning: 2, info: 1 };
      const minLevel = levels[options.severity] ?? 1;
      reviewResult.findings = reviewResult.findings.filter(
        (f) => (levels[f.severity] ?? 1) >= minLevel
      );
    }

    if (options.json) {
      console.log(formatJson(reviewResult));
    } else {
      console.log(formatReviewResult(reviewResult));
    }

    this.printCost(options.json);
    return reviewResult;
  }

  async improve(targetPath: string, options: OrchestratorOptions = {}): Promise<{
    review: ReviewResult;
    coder: CoderResult;
  }> {
    // Step 1: Review
    const reviewResult = await this.review(targetPath, { ...options, json: false });

    if (reviewResult.findings.length === 0) {
      log.success("No issues found — nothing to improve!");
      return { review: reviewResult, coder: { improvedFiles: [], summary: "No changes needed." } };
    }

    // Step 2: Improve
    log.step("✨ Coder agent improving code...");
    const onToken = this.createStreamCallback(options.verbose ?? false);
    const files = await collectFiles(targetPath, this.config);
    const coder = new CoderAgent(this.llmClient);
    const coderResultRaw = await coder.execute(
      {
        files,
        config: this.config,
        previousResults: {
          agentName: "Reviewer",
          success: true,
          data: reviewResult,
          rawResponse: "",
          tokensUsed: { input: 0, output: 0 },
        },
      },
      onToken,
    );
    const coderResult = coderResultRaw.data as CoderResult;
    this.trackCost("Coder", coderResultRaw);

    if (options.verbose) {
      console.error(""); // newline after dots
      log.verbose(`Tokens used: ${coderResultRaw.tokensUsed.input} in / ${coderResultRaw.tokensUsed.output} out`);
    }

    if (options.json) {
      console.log(formatJson({ review: reviewResult, improvements: coderResult }));
    } else {
      console.log(formatCoderResult(coderResult));
    }

    // Apply patches if requested
    if (options.write && coderResult.improvedFiles.length > 0) {
      this.applyPatches(coderResult, options);
    } else if (!options.write && coderResult.improvedFiles.length > 0) {
      log.info("Dry run — use --write to apply changes to disk.");
    }

    this.printCost(options.json);
    return { review: reviewResult, coder: coderResult };
  }

  async generateTests(targetPath: string, options: OrchestratorOptions = {}): Promise<TestResult> {
    const files = await this.gatherFiles(targetPath, options.verbose);
    if (!files) return { testFiles: [], summary: "No files to test." };

    log.step("🧪 Tester agent generating tests...");
    const onToken = this.createStreamCallback(options.verbose ?? false);
    const tester = new TesterAgent(this.llmClient, options.framework ?? "vitest");
    const result = await tester.execute({ files, config: this.config }, onToken);
    const testResult = result.data as TestResult;
    this.trackCost("Tester", result);

    if (options.verbose) {
      console.error("");
      log.verbose(`Tokens used: ${result.tokensUsed.input} in / ${result.tokensUsed.output} out`);
    }

    if (options.json) {
      console.log(formatJson(testResult));
    } else {
      console.log(formatTestResult(testResult));
    }

    // Write test files if requested
    if (options.write && testResult.testFiles.length > 0) {
      const base = process.cwd();
      for (const file of testResult.testFiles) {
        const absPath = resolve(file.path);
        assertWithinBase(absPath, base);
        writeFileSync(absPath, file.content, "utf-8");
        log.success(`Created ${file.path}`);
      }
    } else if (!options.write && testResult.testFiles.length > 0) {
      log.info("Dry run — use --write to write test files to disk.");
    }

    this.printCost(options.json);
    return testResult;
  }

  async plan(targetPath: string, options: OrchestratorOptions = {}): Promise<PlanResult> {
    const files = await this.gatherFiles(targetPath, options.verbose);
    if (!files) return { goal: "", tasks: [], risks: [], summary: "No files to analyze." };

    log.step("🧠 Planner agent creating plan...");
    const onToken = this.createStreamCallback(options.verbose ?? false);
    const planner = new PlannerAgent(this.llmClient, options.task);
    const result = await planner.execute({ files, config: this.config }, onToken);
    const planResult = result.data as PlanResult;
    this.trackCost("Planner", result);

    if (options.verbose) {
      console.error("");
      log.verbose(`Tokens used: ${result.tokensUsed.input} in / ${result.tokensUsed.output} out`);
    }

    if (options.json) {
      console.log(formatJson(planResult));
    } else {
      console.log(formatPlanResult(planResult));
    }

    this.printCost(options.json);
    return planResult;
  }

  async generateDocs(targetPath: string, options: OrchestratorOptions = {}): Promise<DocsResult> {
    const files = await this.gatherFiles(targetPath, options.verbose);
    if (!files) return { docs: [], summary: "No files to document." };

    log.step("📝 Docs agent generating documentation...");
    const onToken = this.createStreamCallback(options.verbose ?? false);
    const docs = new DocsAgent(this.llmClient);
    const result = await docs.execute({ files, config: this.config }, onToken);
    const docsResult = result.data as DocsResult;
    this.trackCost("Docs", result);

    if (options.verbose) {
      console.error("");
      log.verbose(`Tokens used: ${result.tokensUsed.input} in / ${result.tokensUsed.output} out`);
    }

    if (options.json) {
      console.log(formatJson(docsResult));
    } else {
      console.log(formatDocsResult(docsResult));
    }

    // Write documented files if requested
    if (options.write && docsResult.docs.length > 0) {
      const base = process.cwd();
      for (const doc of docsResult.docs) {
        const absPath = resolve(doc.file);
        assertWithinBase(absPath, base);
        if (options.backup) {
          copyFileSync(absPath, absPath + ".bak");
          log.verbose(`Backed up ${doc.file} → ${doc.file}.bak`);
        }
        writeFileSync(absPath, doc.content, "utf-8");
        log.success(`Updated ${doc.file}`);
      }
    } else if (!options.write && docsResult.docs.length > 0) {
      log.info("Dry run — use --write to write documented files to disk.");
    }

    this.printCost(options.json);
    return docsResult;
  }

  async securityAudit(targetPath: string, options: OrchestratorOptions = {}): Promise<SecurityResult> {
    const files = await this.gatherFiles(targetPath, options.verbose);
    if (!files) return { findings: [], riskScore: "none", summary: "No files to audit." };

    // Load project memory
    const memory = loadMemory(targetPath);
    const memoryContext = buildMemoryContext(memory);

    log.step("🔒 Security agent auditing code...");
    const onToken = this.createStreamCallback(options.verbose ?? false);
    const security = new SecurityAgent(this.llmClient);
    const result = await security.executeBatched(
      { files, config: this.config, memoryContext },
      (results) => {
        const allFindings = results.flatMap(r => r.findings);
        const worstRisk = results.reduce((worst, r) => {
          const order = ["none", "low", "medium", "high", "critical"];
          return order.indexOf(r.riskScore) > order.indexOf(worst) ? r.riskScore : worst;
        }, "none" as SecurityResult["riskScore"]);
        return { findings: allFindings, riskScore: worstRisk, summary: results.map(r => r.summary).join(" ") };
      },
      onToken,
    );
    const securityResult = result.data as SecurityResult;
    this.trackCost("Security", result);

    if (options.verbose) {
      console.error("");
      log.verbose(`Tokens used: ${result.tokensUsed.input} in / ${result.tokensUsed.output} out`);
    }

    // Update and save memory
    const updatedMemory = updateMemory(memory, securityResult.findings.map(f => ({
      file: f.file, title: f.title, severity: f.severity, category: f.category,
    })));
    saveMemory(targetPath, updatedMemory);

    // Filter by severity if specified
    if (options.severity) {
      const levels: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
      const minLevel = levels[options.severity] ?? 1;
      securityResult.findings = securityResult.findings.filter(
        (f) => (levels[f.severity] ?? 1) >= minLevel
      );
    }

    if (options.json) {
      console.log(formatJson(securityResult));
    } else {
      console.log(formatSecurityResult(securityResult));
    }

    this.printCost(options.json);
    return securityResult;
  }

  async designAudit(targetPath: string, options: OrchestratorOptions = {}): Promise<DesignerResult> {
    const files = await this.gatherFiles(targetPath, options.verbose);
    if (!files) return { findings: [], designHealthScore: "none", summary: "No files to audit." };

    // Load project memory
    const memory = loadMemory(targetPath);
    const memoryContext = buildMemoryContext(memory);

    log.step("🎨 Designer agent auditing code...");
    const onToken = this.createStreamCallback(options.verbose ?? false);
    const designer = new DesignerAgent(this.llmClient);
    const result = await designer.executeBatched(
      { files, config: this.config, memoryContext },
      (results) => {
        const allFindings = results.flatMap(r => r.findings);
        const order = ["none", "low", "medium", "high", "critical"];
        const worst = results.reduce((w, r) => order.indexOf(r.designHealthScore) > order.indexOf(w) ? r.designHealthScore : w, "none" as DesignerResult["designHealthScore"]);
        return { findings: allFindings, designHealthScore: worst, summary: results.map(r => r.summary).join(" ") };
      },
      onToken,
    );
    const designerResult = result.data as DesignerResult;
    this.trackCost("Designer", result);

    if (options.verbose) {
      console.error("");
      log.verbose(`Tokens used: ${result.tokensUsed.input} in / ${result.tokensUsed.output} out`);
    }

    // Update and save memory
    const updatedMemory = updateMemory(memory, designerResult.findings.map(f => ({
      file: f.file, title: f.title, severity: f.severity, category: f.category,
    })));
    saveMemory(targetPath, updatedMemory);

    // Filter by severity if specified
    if (options.severity) {
      const levels: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
      const minLevel = levels[options.severity] ?? 1;
      designerResult.findings = designerResult.findings.filter(
        (f) => (levels[f.severity] ?? 1) >= minLevel
      );
    }

    if (options.json) {
      console.log(formatJson(designerResult));
    } else {
      console.log(formatDesignerResult(designerResult));
    }

    this.printCost(options.json);
    return designerResult;
  }

  async audit(targetPath: string, options: OrchestratorOptions = {}): Promise<AuditResult> {
    // Pre-flight: TypeScript check
    log.step("⚡ Running TypeScript pre-check...");
    const tsFindings = this.runTypeScriptCheck(targetPath);
    if (tsFindings.length > 0) {
      log.warn(`Found ${tsFindings.length} TypeScript error(s) before AI audit`);
    } else {
      log.info("TypeScript check passed");
    }

    const skip = new Set(options.skip ?? []);
    const files = await this.gatherFiles(targetPath, options.verbose);

    if (!files) {
      return {
        review: { findings: [], summary: "" },
        security: { findings: [], riskScore: "none", summary: "" },
        coder: { improvedFiles: [], summary: "" },
        totalFindings: 0, totalPatches: 0, riskScore: "none", summary: "No files to audit.",
      };
    }
    const onToken = this.createStreamCallback(options.verbose ?? false);
    const context = { files, config: this.config };

    // 1. Plan (optional)
    let planResult: PlanResult | undefined;
    if (!skip.has("plan")) {
      log.step("🧠 Planner agent analyzing codebase...");
      const planner = new PlannerAgent(this.llmClient, options.task);
      const r = await planner.execute(context, onToken);
      planResult = r.data as PlanResult;
      this.trackCost("Planner", r);
      if (options.verbose) { console.error(""); log.verbose(`Planner: ${r.tokensUsed.input} in / ${r.tokensUsed.output} out`); }
    }

    // 2. Review (batched)
    log.step("🔍 Reviewer agent analyzing code...");
    const reviewer = new ReviewerAgent(this.llmClient);
    const reviewRaw = await reviewer.executeBatched(
      context,
      (results) => ({ findings: results.flatMap(r => r.findings), summary: results.map(r => r.summary).join(" ") }),
      onToken,
    );
    const reviewResult = reviewRaw.data as ReviewResult;
    // Merge TypeScript pre-check findings into audit review results
    if (tsFindings.length > 0) {
      reviewResult.findings = [...tsFindings, ...reviewResult.findings];
      reviewResult.summary = `TypeScript: ${tsFindings.length} error(s). ${reviewResult.summary}`;
    }
    this.trackCost("Reviewer", reviewRaw);
    if (options.verbose) { console.error(""); log.verbose(`Reviewer: ${reviewRaw.tokensUsed.input} in / ${reviewRaw.tokensUsed.output} out`); }

    // 3. Security (batched)
    log.step("🔒 Security agent auditing code...");
    const security = new SecurityAgent(this.llmClient);
    const securityRaw = await security.executeBatched(
      context,
      (results) => {
        const order = ["none", "low", "medium", "high", "critical"];
        const worst = results.reduce((w, r) => order.indexOf(r.riskScore) > order.indexOf(w) ? r.riskScore : w, "none" as SecurityResult["riskScore"]);
        return { findings: results.flatMap(r => r.findings), riskScore: worst, summary: results.map(r => r.summary).join(" ") };
      },
      onToken,
    );
    const securityResult = securityRaw.data as SecurityResult;
    this.trackCost("Security", securityRaw);
    if (options.verbose) { console.error(""); log.verbose(`Security: ${securityRaw.tokensUsed.input} in / ${securityRaw.tokensUsed.output} out`); }

    // 4. Designer (optional, batched)
    let designerResult: DesignerResult | undefined;
    if (!skip.has("designer")) {
      log.step("🎨 Designer agent auditing code...");
      const designer = new DesignerAgent(this.llmClient);
      const designerRaw = await designer.executeBatched(
        context,
        (results) => {
          const order = ["none", "low", "medium", "high", "critical"];
          const worst = results.reduce((w, r) => order.indexOf(r.designHealthScore) > order.indexOf(w) ? r.designHealthScore : w, "none" as DesignerResult["designHealthScore"]);
          return { findings: results.flatMap(r => r.findings), designHealthScore: worst, summary: results.map(r => r.summary).join(" ") };
        },
        onToken,
      );
      designerResult = designerRaw.data as DesignerResult;
      this.trackCost("Designer", designerRaw);
      if (options.verbose) { console.error(""); log.verbose(`Designer: ${designerRaw.tokensUsed.input} in / ${designerRaw.tokensUsed.output} out`); }
    }

    // 5. Coder (batched, fix review + security findings)
    let coderResult: CoderResult = { improvedFiles: [], summary: "No findings to fix." };
    if (reviewResult.findings.length > 0 || securityResult.findings.length > 0) {
      log.step("✨ Coder agent generating patches...");
      const coder = new CoderAgent(this.llmClient);
      const coderRaw = await coder.executeBatched(
        {
          ...context,
          previousResults: {
            agentName: "Reviewer+Security",
            success: true,
            data: {
              findings: [...reviewResult.findings, ...securityResult.findings.map(f => ({
                file: f.file, line: f.line, severity: f.severity === "high" ? "critical" as const : f.severity === "low" ? "info" as const : f.severity as "critical" | "warning" | "info",
                category: "security" as const, title: f.title, description: f.description, suggestion: f.remediation,
              }))],
              summary: `${reviewResult.summary} ${securityResult.summary}`,
            },
            rawResponse: "",
            tokensUsed: { input: 0, output: 0 },
          },
        },
        (results) => ({ improvedFiles: results.flatMap(r => r.improvedFiles), summary: results.map(r => r.summary).join(" ") }),
        onToken,
      );
      coderResult = coderRaw.data as CoderResult;
      this.trackCost("Coder", coderRaw);
      if (options.verbose) { console.error(""); log.verbose(`Coder: ${coderRaw.tokensUsed.input} in / ${coderRaw.tokensUsed.output} out`); }
    }

    // 6. Tester (optional, batched)
    let testResult: TestResult | undefined;
    if (!skip.has("test")) {
      log.step("🧪 Tester agent generating tests...");
      const tester = new TesterAgent(this.llmClient, options.framework ?? "vitest");
      const r = await tester.executeBatched(
        context,
        (results) => ({ testFiles: results.flatMap(r => r.testFiles), summary: results.map(r => r.summary).join(" ") }),
        onToken,
      );
      testResult = r.data as TestResult;
      this.trackCost("Tester", r);
      if (options.verbose) { console.error(""); log.verbose(`Tester: ${r.tokensUsed.input} in / ${r.tokensUsed.output} out`); }
    }

    // 7. Docs (optional, batched)
    let docsResult: DocsResult | undefined;
    if (!skip.has("docs")) {
      log.step("📝 Docs agent generating documentation...");
      const docs = new DocsAgent(this.llmClient);
      const r = await docs.executeBatched(
        context,
        (results) => ({ docs: results.flatMap(r => r.docs), summary: results.map(r => r.summary).join(" ") }),
        onToken,
      );
      docsResult = r.data as DocsResult;
      this.trackCost("Docs", r);
      if (options.verbose) { console.error(""); log.verbose(`Docs: ${r.tokensUsed.input} in / ${r.tokensUsed.output} out`); }
    }

    // Build audit result
    const totalFindings = reviewResult.findings.length + securityResult.findings.length + (designerResult?.findings.length ?? 0);
    const totalPatches = coderResult.improvedFiles.reduce((sum, f) => sum + f.patches.length, 0);

    const auditResult: AuditResult = {
      plan: planResult,
      review: reviewResult,
      security: securityResult,
      designer: designerResult,
      coder: coderResult,
      tests: testResult,
      docs: docsResult,
      totalFindings,
      totalPatches,
      riskScore: securityResult.riskScore,
      summary: `${totalFindings} findings, ${totalPatches} patches, ${testResult?.testFiles.length ?? 0} test files, ${docsResult?.docs.length ?? 0} docs`,
    };

    if (options.json) {
      console.log(formatJson(auditResult));
    } else {
      // Import and use audit formatter
      const { formatAuditResult } = await import("../utils/formatter.js");
      console.log(formatAuditResult(auditResult));
    }

    // Apply changes if --write
    if (options.write) {
      const base = process.cwd();
      // Apply patches
      this.applyPatches(coderResult, options);
      // Write tests
      if (testResult) {
        for (const file of testResult.testFiles) {
          const absPath = resolve(file.path);
          assertWithinBase(absPath, base);
          writeFileSync(absPath, file.content, "utf-8");
          log.success(`Created ${file.path}`);
        }
      }
      // Write docs
      if (docsResult) {
        for (const doc of docsResult.docs) {
          const absPath = resolve(doc.file);
          assertWithinBase(absPath, base);
          if (options.backup) copyFileSync(absPath, absPath + ".bak");
          writeFileSync(absPath, doc.content, "utf-8");
          log.success(`Documented ${doc.file}`);
        }
      }
    } else if (totalPatches > 0 || (testResult?.testFiles.length ?? 0) > 0) {
      log.info("Dry run — use --write to apply all changes to disk.");
    }

    this.printCost(options.json);
    return auditResult;
  }

  async runCustomAgent(agentName: string, targetPath: string, options: OrchestratorOptions = {}): Promise<ReviewResult> {
    const agentConfig = this.config.customAgents?.find(a => a.name === agentName);
    if (!agentConfig) {
      const available = this.config.customAgents?.map(a => a.name).join(", ") || "none";
      throw new Error(`Custom agent "${agentName}" not found. Available: ${available}`);
    }

    const files = await this.gatherFiles(targetPath, options.verbose);
    if (!files) return { findings: [], summary: "No files to review." };

    log.step(`🔧 Custom agent "${agentConfig.name}" reviewing code...`);
    const onToken = this.createStreamCallback(options.verbose ?? false);
    const agent = new CustomAgent(this.llmClient, agentConfig);
    const result = await agent.execute({ files, config: this.config }, onToken);
    const reviewResult = result.data as ReviewResult;
    this.trackCost(agentConfig.name, result);

    if (options.verbose) {
      console.error("");
      log.verbose(`Tokens used: ${result.tokensUsed.input} in / ${result.tokensUsed.output} out`);
    }

    if (options.severity) {
      const levels: Record<string, number> = { critical: 3, warning: 2, info: 1 };
      const minLevel = levels[options.severity] ?? 1;
      reviewResult.findings = reviewResult.findings.filter(
        (f) => (levels[f.severity] ?? 1) >= minLevel
      );
    }

    if (options.json) {
      console.log(formatJson(reviewResult));
    } else {
      console.log(formatReviewResult(reviewResult));
    }

    this.printCost(options.json);
    return reviewResult;
  }

  listCustomAgents(): string[] {
    return this.config.customAgents?.map(a => `${a.name} — ${a.description}`) ?? [];
  }
}
