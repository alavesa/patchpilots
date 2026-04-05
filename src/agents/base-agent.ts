import type { z } from "zod";
import type { LLMClient } from "../core/llm-client.js";
import type { AgentContext, AgentResult, FileContent } from "../types/index.js";
import { log } from "../utils/logger.js";
import { type ModelRoutingConfig, DEFAULT_ROUTING, routeFiles, tierToModel, logRoutingSummary } from "../utils/model-router.js";

function escapeXmlAttr(value: string): string {
  return value.replace(/[<>"&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", '"': "&quot;", "&": "&amp;" })[c]!);
}

export function wrapUntrustedFile(path: string, language: string, content: string): string {
  const safePath = escapeXmlAttr(path);
  const safeLang = escapeXmlAttr(language);
  return [
    `## File: ${safePath} (${safeLang})`,
    `<UNTRUSTED_FILE path="${safePath}">`,
    "```" + safeLang,
    content,
    "```",
    "</UNTRUSTED_FILE>\n",
  ].join("\n");
}

export abstract class BaseAgent<T = unknown> {
  abstract readonly name: string;
  abstract readonly description: string;

  constructor(protected llmClient: LLMClient) {}

  protected abstract getSystemPrompt(): string;
  protected abstract buildUserMessage(context: AgentContext): string;
  protected abstract getOutputSchema(): z.ZodType<T>;

  async execute(
    context: AgentContext,
    onToken?: (text: string) => void,
    modelOverride?: string,
  ): Promise<AgentResult> {
    const systemPrompt = this.getSystemPrompt();
    const userMessage = this.buildUserMessage(context);
    const schema = this.getOutputSchema();

    const response = await this.llmClient.chatStructured(
      systemPrompt,
      userMessage,
      schema,
      {
        maxTokens: context.config.maxTokens,
        temperature: context.config.temperature,
        model: modelOverride,
      },
      onToken,
    );

    return {
      agentName: this.name,
      success: true,
      data: response.data,
      rawResponse: JSON.stringify(response.data),
      tokensUsed: response.usage,
      model: modelOverride,
    };
  }

  async executeBatched(
    context: AgentContext,
    mergeResults: (results: T[]) => T,
    onToken?: (text: string) => void,
  ): Promise<AgentResult> {
    const batchSize = context.config.batchSize ?? 5;
    const routingUserConfig = context.config.modelRouting;
    const routingEnabled = routingUserConfig?.enabled === true;

    // Build routing config by merging user overrides with defaults
    const routingConfig: ModelRoutingConfig = routingEnabled
      ? { ...DEFAULT_ROUTING, ...routingUserConfig, enabled: true }
      : DEFAULT_ROUTING;

    // If routing is enabled, group files by model tier first
    if (routingEnabled) {
      const groups = routeFiles(context.files, routingConfig);
      log.info(`Smart routing: ${context.files.length} files across ${groups.size} model tier(s)`);
      logRoutingSummary(groups, routingConfig);

      const allResults: T[] = [];
      let totalInput = 0;
      let totalOutput = 0;
      const modelsUsed: string[] = [];

      for (const [tier, files] of groups) {
        const model = tierToModel(tier, routingConfig);
        modelsUsed.push(model);

        // Batch within each tier
        const batches: FileContent[][] = [];
        for (let i = 0; i < files.length; i += batchSize) {
          batches.push(files.slice(i, i + batchSize));
        }

        for (let i = 0; i < batches.length; i++) {
          log.verbose(`  ${tier} batch ${i + 1}/${batches.length} (${batches[i].length} files → ${model})`);

          const batchContext: AgentContext = { ...context, files: batches[i] };
          const result = await this.executeWithRetry(batchContext, onToken, model);
          allResults.push(result.data as T);
          totalInput += result.tokensUsed.input;
          totalOutput += result.tokensUsed.output;
        }
      }

      const merged = mergeResults(allResults);

      return {
        agentName: this.name,
        success: true,
        data: merged,
        rawResponse: JSON.stringify(merged),
        tokensUsed: { input: totalInput, output: totalOutput },
        model: modelsUsed.length === 1 ? modelsUsed[0] : undefined,
        modelsUsed: modelsUsed.length > 1 ? [...new Set(modelsUsed)] : undefined,
      };
    }

    // Standard path: no routing
    const files = context.files;

    // No batching needed for small file sets
    if (files.length <= batchSize) {
      return this.executeWithRetry(context, onToken);
    }

    // Split into batches
    const batches: FileContent[][] = [];
    for (let i = 0; i < files.length; i += batchSize) {
      batches.push(files.slice(i, i + batchSize));
    }

    log.info(`Processing ${files.length} files in ${batches.length} batches of ${batchSize}`);

    const allResults: T[] = [];
    let totalInput = 0;
    let totalOutput = 0;

    for (let i = 0; i < batches.length; i++) {
      log.verbose(`  Batch ${i + 1}/${batches.length} (${batches[i].length} files)`);

      const batchContext: AgentContext = {
        ...context,
        files: batches[i],
      };

      const result = await this.executeWithRetry(batchContext, onToken);
      allResults.push(result.data as T);
      totalInput += result.tokensUsed.input;
      totalOutput += result.tokensUsed.output;
    }

    const merged = mergeResults(allResults);

    return {
      agentName: this.name,
      success: true,
      data: merged,
      rawResponse: JSON.stringify(merged),
      tokensUsed: { input: totalInput, output: totalOutput },
    };
  }

  private async executeWithRetry(
    context: AgentContext,
    onToken?: (text: string) => void,
    modelOverride?: string,
  ): Promise<AgentResult> {
    try {
      return await this.execute(context, onToken, modelOverride);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);

      // If it's a JSON parsing error (token limit), retry with half the files
      if ((msg.includes("JSON") || msg.includes("Unterminated")) && context.files.length > 1) {
        const half = Math.ceil(context.files.length / 2);
        log.warn(`Batch failed (${context.files.length} files) — retrying with ${half} files`);

        const firstHalf = await this.executeWithRetry(
          { ...context, files: context.files.slice(0, half) },
          onToken,
          modelOverride,
        );
        const secondHalf = await this.executeWithRetry(
          { ...context, files: context.files.slice(half) },
          onToken,
          modelOverride,
        );

        // Merge the two results by combining their raw data
        return {
          agentName: this.name,
          success: true,
          data: firstHalf.data, // Caller handles merging via executeBatched
          rawResponse: firstHalf.rawResponse,
          tokensUsed: {
            input: firstHalf.tokensUsed.input + secondHalf.tokensUsed.input,
            output: firstHalf.tokensUsed.output + secondHalf.tokensUsed.output,
          },
          model: modelOverride,
        };
      }

      throw error;
    }
  }
}
