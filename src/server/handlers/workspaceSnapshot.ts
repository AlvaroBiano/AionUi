/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Workspace Snapshot Handler
 *
 * File snapshot management for workspace diffing and staging.
 * Replaces initWorkspaceSnapshotBridge() from
 * src/process/bridge/workspaceSnapshotBridge.ts.
 */

import { WorkspaceSnapshotService } from '@server/services/WorkspaceSnapshotService';
import type { WsRouter } from '../router/WsRouter';

const snapshotService = new WorkspaceSnapshotService();

/**
 * Register workspace snapshot endpoint handlers on the WsRouter.
 * Replaces initWorkspaceSnapshotBridge() from src/process/bridge/workspaceSnapshotBridge.ts.
 */
export function registerWorkspaceSnapshotHandlers(router: WsRouter): void {
  router.handle('file-snapshot-init', async ({ workspace }) => {
    return snapshotService.init(workspace);
  });

  router.handle('file-snapshot-compare', async ({ workspace }) => {
    return snapshotService.compare(workspace);
  });

  router.handle('file-snapshot-baseline', async ({ workspace, filePath }) => {
    return snapshotService.getBaselineContent(workspace, filePath);
  });

  router.handle('file-snapshot-info', async ({ workspace }) => {
    return snapshotService.getInfo(workspace);
  });

  router.handle('file-snapshot-dispose', async ({ workspace }) => {
    await snapshotService.dispose(workspace);
  });

  router.handle('file-snapshot-stage-file', async ({ workspace, filePath }) => {
    await snapshotService.stageFile(workspace, filePath);
  });

  router.handle('file-snapshot-stage-all', async ({ workspace }) => {
    await snapshotService.stageAll(workspace);
  });

  router.handle('file-snapshot-unstage-file', async ({ workspace, filePath }) => {
    await snapshotService.unstageFile(workspace, filePath);
  });

  router.handle('file-snapshot-unstage-all', async ({ workspace }) => {
    await snapshotService.unstageAll(workspace);
  });

  router.handle('file-snapshot-discard-file', async ({ workspace, filePath, operation }) => {
    await snapshotService.discardFile(workspace, filePath, operation);
  });

  router.handle('file-snapshot-reset-file', async ({ workspace, filePath, operation }) => {
    await snapshotService.resetFile(workspace, filePath, operation);
  });

  router.handle('file-snapshot-get-branches', async ({ workspace }) => {
    return snapshotService.getBranches(workspace);
  });
}

/** Clean up all snapshots on app exit */
export function disposeAllSnapshots(): Promise<void> {
  return snapshotService.disposeAll();
}
