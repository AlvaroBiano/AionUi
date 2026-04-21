// src/process/acp/runtime/InputPipeline.ts

import type { PromptContent } from '@process/acp/types';
import { InputPreprocessor } from '@process/acp/session/InputPreprocessor';
import * as fs from 'fs';

const AIONUI_FILES_MARKER = '[[AION_FILES]]';

// ─── Injection Context ──────────────────────────────────────────

/**
 * Content to inject on the first user message.
 * AcpRuntime resolves these (from config, skills, team) before calling the pipeline.
 * The pipeline just wraps and prepends — it doesn't know how to fetch skills/presets.
 */
export type InjectionContext = {
  presetContext?: string;
  skillsIndex?: string;
  teamGuidePrompt?: string;
};

// ─── InputPipeline ──────────────────────────────────────────────

/**
 * Transforms user input into PromptContent for the agent.
 *
 * Stages (in order):
 * 1. Strip AIONUI_FILES_MARKER
 * 2. First message injection (preset, skills, teamGuide) — once per lifetime
 * 3. @file reference resolution + uploaded file content
 */
export class InputPipeline {
  private readonly firstMessageInjector = new FirstMessageInjector();
  private readonly fileRefProcessor: InputPreprocessor;

  constructor(cwd: string) {
    this.fileRefProcessor = new InputPreprocessor((filePath) => fs.readFileSync(filePath, 'utf-8'), cwd);
  }

  /**
   * Process user input through all pipeline stages.
   *
   * @param text       Raw user message text
   * @param files      Uploaded file paths (from drag-drop or attach)
   * @param injection  First-message injection context (ignored after first call)
   */
  process(text: string, files?: string[], injection?: InjectionContext): PromptContent {
    // 1. Strip [[AION_FILES]] marker (appended by renderer for uploaded files)
    let processed = text;
    if (processed.includes(AIONUI_FILES_MARKER)) {
      processed = processed.split(AIONUI_FILES_MARKER)[0].trimEnd();
    }

    // 2. First message injection
    processed = this.firstMessageInjector.process(processed, injection);

    // 3. @file resolution + uploaded file content → PromptContent (ContentBlock[])
    return this.fileRefProcessor.process(processed, files);
  }

  /** Whether the first message injection has been consumed. */
  get firstMessageConsumed(): boolean {
    return this.firstMessageInjector.consumed;
  }
}

// ─── FirstMessageInjector ───────────────────────────────────────

/**
 * Wraps the first user message with [Assistant Rules] + [User Request] structure.
 * Injects presetContext, skillsIndex, and teamGuidePrompt if provided.
 *
 * Stateful: fires once, then becomes a no-op for the rest of the conversation.
 */
class FirstMessageInjector {
  private _consumed = false;

  get consumed(): boolean {
    return this._consumed;
  }

  process(text: string, injection?: InjectionContext): string {
    if (this._consumed || !injection) return text;

    const parts: string[] = [];
    if (injection.presetContext) parts.push(injection.presetContext);
    if (injection.skillsIndex) parts.push(injection.skillsIndex);
    if (injection.teamGuidePrompt) parts.push(injection.teamGuidePrompt);

    this._consumed = true;

    if (parts.length === 0) return text;

    return `[Assistant Rules - You MUST follow these instructions]\n${parts.join('\n\n')}\n\n[User Request]\n${text}`;
  }
}
