/**
 * Error phases for ACP startup failures — used by UI to show contextual guidance.
 *
 * | Phase     | Meaning                                | User Action             |
 * |-----------|----------------------------------------|-------------------------|
 * | hub       | Failed to fetch agent list from Hub    | Retry / check network   |
 * | install   | Agent install (onInstall hook) failed   | Retry / view logs       |
 * | runtime   | Agent CLI failed to start              | View logs / retry       |
 * | auth      | Authentication required                | Authenticate CTA        |
 * | unknown   | Unclassified error                     | View logs               |
 */
export type AcpStartupErrorPhase = 'hub' | 'install' | 'runtime' | 'auth' | 'unknown';

export interface AcpStartupError {
  phase: AcpStartupErrorPhase;
  message: string;
  /** Raw stderr for diagnostics */
  stderr?: string;
}

/**
 * Classify an ACP startup failure into a phase with a user-friendly message.
 * Exported for unit testing.
 */
export function classifyStartupError(
  backend: string,
  code: number | null,
  signal: NodeJS.Signals | null,
  stderrCombined: string,
  spawnErrorMessage: string | undefined,
  resolvedBackend: string | null
): AcpStartupError {
  const combinedDiag = stderrCombined + (spawnErrorMessage ?? '');

  // --- Auth phase: detect authentication errors ---
  if (
    code !== 0 &&
    /auth_required|authentication required|login required|unauthorized|needs? auth/i.test(combinedDiag)
  ) {
    return {
      phase: 'auth',
      message: `${backend} requires authentication. Please sign in and try again.`,
      stderr: stderrCombined || undefined,
    };
  }

  // --- Install phase: detect installation failures ---
  if (code !== 0 && /install failed|installation failed|onInstall .* failed/i.test(combinedDiag)) {
    return {
      phase: 'install',
      message: `${backend} installation failed. Check logs for details and try again.`,
      stderr: stderrCombined || undefined,
    };
  }

  // --- Runtime phase: command not found ---
  if (code !== 0 && /not recognized|not found|No such file|command not found|ENOENT/i.test(combinedDiag)) {
    const cliHint = resolvedBackend ?? backend;
    return {
      phase: 'runtime',
      message: `'${cliHint}' CLI not found. Please install it from Agent Hub or update the CLI path in Settings.`,
      stderr: stderrCombined || undefined,
    };
  }

  // --- Runtime phase: config loading error ---
  if (code !== 0 && /error loading config/i.test(stderrCombined)) {
    const configPathMatch = stderrCombined.match(/error loading config:\s*([^\s:]+)/i);
    const configHint = configPathMatch?.[1] ?? 'the CLI config file';
    return {
      phase: 'runtime',
      message:
        `${backend} CLI failed to start due to a config file error. ` +
        `Please review or temporarily rename ${configHint} and try again.`,
      stderr: stderrCombined || undefined,
    };
  }

  // --- Runtime phase: ACP mode not supported (exit 0 with no output) ---
  if (code === 0 && !stderrCombined) {
    return {
      phase: 'runtime',
      message:
        `${backend} CLI exited without error but did not start ACP mode. ` +
        `This usually means the installed version does not support ACP. Please upgrade to a newer version.`,
    };
  }

  // --- Runtime phase: generic startup failure ---
  if (stderrCombined) {
    return {
      phase: 'runtime',
      message: `${backend} failed to start (code: ${code}).`,
      stderr: stderrCombined,
    };
  }

  return {
    phase: 'unknown',
    message: `${backend} ACP process exited during startup (code: ${code}, signal: ${signal}).`,
  };
}

/**
 * Build a user-friendly error message for ACP startup failures.
 * Detects known error patterns (CLI not found, config errors) and
 * provides actionable guidance instead of raw stderr.
 *
 * Exported for unit testing.
 */
export function buildStartupErrorMessage(
  backend: string,
  code: number | null,
  signal: NodeJS.Signals | null,
  stderrCombined: string,
  spawnErrorMessage: string | undefined,
  resolvedBackend: string | null
): string {
  const classified = classifyStartupError(backend, code, signal, stderrCombined, spawnErrorMessage, resolvedBackend);
  return classified.stderr ? `${classified.message}\n${classified.stderr}` : classified.message;
}
