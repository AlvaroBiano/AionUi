// src/process/acp/infra/AcpClientFactory.ts

/**
 * CLI process spawner for ACP agent backends.
 *
 * For npx-based backends (claude, codex, codebuddy): uses battle-tested
 * connect*() functions with full shell env, npx resolution, retry logic.
 * For all other backends: delegates to spawnGenericBackend().
 */

import type { AcpClient, ClientFactory } from '@process/acp/infra/IAcpClient';
import { ProcessAcpClient } from '@process/acp/infra/ProcessAcpClient';
import type { AgentConfig, ProtocolHandlers } from '@process/acp/types';
import {
  connectClaude,
  connectCodebuddy,
  connectCodex,
  spawnGenericBackend,
  type NpxConnectHooks,
  type SpawnResult,
} from '@process/agent/acp/acpConnectors';
import { AcpError } from '@process/acp/errors/AcpError';
import type { ChildProcess } from 'node:child_process';

type BuiltinConnectFn = (cwd: string, hooks: NpxConnectHooks) => Promise<void>;

const NPX_BACKENDS: Record<string, BuiltinConnectFn> = {
  codex: connectCodex,
  claude: connectClaude,
  codebuddy: connectCodebuddy,
};

export class AcpClientFactory implements ClientFactory {
  create(config: AgentConfig, handlers: ProtocolHandlers): AcpClient {
    const spawnFn = () => spawnLegacyChild(config);
    return new ProcessAcpClient(spawnFn, { backend: config.agentBackend, handlers });
  }
}

/**
 * Extract just the child-process spawn from the old connector logic.
 * ProcessAcpClient manages stderr capture, lifecycle, and transport internally,
 * so we only need to produce the ChildProcess.
 */
async function spawnLegacyChild(config: AgentConfig): Promise<ChildProcess> {
  const backend = config.agentBackend;
  const cwd = config.cwd;

  const npxConnect = NPX_BACKENDS[backend];
  if (npxConnect) {
    return spawnViaNpxHooks(npxConnect, cwd);
  }
  if (config.command) {
    const result = await spawnGenericBackend(backend, config.command, cwd, config.args, config.env);
    return result.child;
  }
  throw new AcpError('CONNECTION_FAILED', `No CLI path for backend "${backend}"`, { retryable: false });
}

function spawnViaNpxHooks(connectFn: BuiltinConnectFn, cwd: string): Promise<ChildProcess> {
  return new Promise<ChildProcess>((resolve, reject) => {
    let resolved = false;
    let lastChild: ChildProcess | null = null;

    const hooks: NpxConnectHooks = {
      setup: async (result: SpawnResult) => {
        if (!resolved) {
          resolved = true;
          lastChild = result.child;
          resolve(result.child);
        }
      },
      cleanup: async () => {
        if (lastChild) {
          try {
            lastChild.kill();
          } catch {
            /* already dead */
          }
          lastChild = null;
        }
      },
    };

    connectFn(cwd, hooks).catch((err) => {
      if (!resolved) {
        reject(
          new AcpError('CONNECTION_FAILED', `Failed to connect: ${(err as Error).message}`, {
            cause: err,
            retryable: true,
          })
        );
      }
    });
  });
}
