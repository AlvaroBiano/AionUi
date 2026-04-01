/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * File operations handler — read, write, copy, remove, zip, metadata, image.
 * Extracted from fsBridge.ts.
 */

import type { WsRouter } from '../../router/WsRouter';
import { AIONUI_TIMESTAMP_SEPARATOR } from '@/common/config/constants';
import fs from 'fs/promises';
import path from 'path';
import https from 'node:https';
import http from 'node:http';
import JSZip from 'jszip';
import { getSystemDir } from '@process/utils/initStorage';
import { readDirectoryRecursive } from '@process/utils';

// V8 string length limit is ~512MB; guard against RangeError on oversized files
const MAX_READ_FILE_SIZE = 256 * 1024 * 1024; // 256 MB

/**
 * Download remote resource with protocol & redirect guard.
 * Restrict to a whitelist of hosts for safety.
 */
const downloadRemoteBuffer = (
  targetUrl: string,
  redirectCount = 0,
): Promise<{ buffer: Buffer; contentType?: string }> => {
  const allowedProtocols = new Set(['http:', 'https:']);
  const parsedUrl = new URL(targetUrl);
  if (!allowedProtocols.has(parsedUrl.protocol)) {
    throw new Error('Unsupported protocol');
  }

  const allowedHosts = ['github.com', 'raw.githubusercontent.com', 'contrib.rocks', 'img.shields.io'];
  const isAllowedHost = allowedHosts.some(
    (host) => parsedUrl.hostname === host || parsedUrl.hostname.endsWith(`.${host}`),
  );
  if (!isAllowedHost) {
    throw new Error('URL not allowed for remote fetch');
  }

  return new Promise((resolve, reject) => {
    try {
      const client = parsedUrl.protocol === 'https:' ? https : http;
      const request = client.get(
        targetUrl,
        {
          headers: {
            'User-Agent': 'AionUI-Preview',
            Referer: 'https://github.com/iOfficeAI/AionUi',
          },
        },
        (response) => {
          const { statusCode = 0, headers } = response;

          if (statusCode >= 300 && statusCode < 400 && headers.location && redirectCount < 5) {
            const redirectUrl = new URL(headers.location, targetUrl).toString();
            response.resume();
            resolve(downloadRemoteBuffer(redirectUrl, redirectCount + 1));
            return;
          }

          if (statusCode >= 400) {
            response.resume();
            reject(new Error(`Failed to fetch image: HTTP ${statusCode}`));
            return;
          }

          const chunks: Buffer[] = [];
          let receivedBytes = 0;
          const MAX_BYTES = 5 * 1024 * 1024; // 5MB limit

          response.on('data', (chunk: Buffer) => {
            receivedBytes += chunk.length;
            if (receivedBytes > MAX_BYTES) {
              response.destroy(new Error('Remote image exceeds size limit (5MB)'));
              return;
            }
            chunks.push(chunk);
          });

          response.on('end', () => {
            resolve({
              buffer: Buffer.concat(chunks),
              contentType: headers['content-type'],
            });
          });
          response.on('error', (error) => reject(error));
        },
      );

      request.setTimeout(15000, () => {
        request.destroy(new Error('Remote image request timed out'));
      });

      request.on('error', (error) => reject(error));
    } catch (error) {
      reject(error);
    }
  });
};

export function registerFileOpsHandlers(router: WsRouter): void {
  const canceledZipRequests = new Set<string>();

  router.handle('get-file-by-dir', async ({ dir }) => {
    try {
      const tree = await readDirectoryRecursive(dir);
      return tree ? [tree] : [];
    } catch (error) {
      console.error('[FsHandler] Failed to read directory:', dir, error);
      return [];
    }
  });

  router.handle('get-image-base64', async ({ path: filePath }) => {
    try {
      const ext = (path.extname(filePath) || '').toLowerCase().replace(/^\./, '');
      const mimeMap: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        bmp: 'image/bmp',
        svg: 'image/svg+xml',
        ico: 'image/x-icon',
        tif: 'image/tiff',
        tiff: 'image/tiff',
        avif: 'image/avif',
      };
      const mime = mimeMap[ext] || 'application/octet-stream';
      const base64 = await fs.readFile(filePath, { encoding: 'base64' });
      return `data:${mime};base64,${base64}`;
    } catch {
      return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZGRkIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCwgc2Fucy1zZXJpZiIgZm9udC1zaXplPSIxNCIgZmlsbD0iIzk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkltYWdlIG5vdCBmb3VuZDwvdGV4dD48L3N2Zz4=';
    }
  });

  router.handle('fetch-remote-image', async ({ url }) => {
    try {
      const { buffer, contentType } = await downloadRemoteBuffer(url);
      const base64 = buffer.toString('base64');
      return `data:${contentType || 'application/octet-stream'};base64,${base64}`;
    } catch (error) {
      console.warn('[FsHandler] Failed to fetch remote image:', (error as Error).message);
      return '';
    }
  });

  router.handle('create-temp-file', async ({ fileName }) => {
    try {
      const { cacheDir } = getSystemDir();
      const tempDir = path.join(cacheDir, 'temp');
      await fs.mkdir(tempDir, { recursive: true });

      const safeFileName = fileName.replace(/[<>:"/\\|?*]/g, '_');
      let tempFilePath = path.join(tempDir, safeFileName);

      const fileExists = await fs
        .access(tempFilePath)
        .then(() => true)
        .catch(() => false);

      if (fileExists) {
        const timestamp = Date.now();
        const ext = path.extname(safeFileName);
        const name = path.basename(safeFileName, ext);
        const tempFileName = `${name}${AIONUI_TIMESTAMP_SEPARATOR}${timestamp}${ext}`;
        tempFilePath = path.join(tempDir, tempFileName);
      }

      await fs.writeFile(tempFilePath, Buffer.alloc(0));
      return tempFilePath;
    } catch (error) {
      console.error('Failed to create temp file:', error);
      throw error;
    }
  });

  router.handle('read-file', async ({ path: filePath }) => {
    try {
      const stat = await fs.stat(filePath);
      if (stat.size > MAX_READ_FILE_SIZE) {
        console.warn(`[FsHandler] File too large to read as text (${stat.size} bytes): ${filePath}`);
        return null;
      }
      const content = await fs.readFile(filePath, 'utf-8');
      return content;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'EBUSY') {
        return null;
      }
      console.error('Failed to read file:', error);
      throw error;
    }
  });

  router.handle('read-file-buffer', async ({ path: filePath }) => {
    try {
      const buffer = await fs.readFile(filePath);
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'EBUSY') {
        return null;
      }
      console.error('Failed to read file buffer:', error);
      throw error;
    }
  });

  router.handle('write-file', async ({ path: filePath, data }) => {
    try {
      if (typeof data === 'string') {
        await fs.writeFile(filePath, data, 'utf-8');

        // Emit file stream update event for preview panel real-time updates
        try {
          const pathSegments = filePath.split(path.sep);
          const fileName = pathSegments[pathSegments.length - 1];
          const workspace = pathSegments.slice(0, -1).join(path.sep);

          router.emit('file-stream-content-update', {
            filePath: filePath,
            content: data,
            workspace: workspace,
            relativePath: fileName,
            operation: 'write',
          });
        } catch (emitError) {
          console.error('[FsHandler] Failed to emit file stream update:', emitError);
        }

        return true;
      }

      let bufferData;

      if (data && typeof data === 'object' && data.constructor?.name === 'Object') {
        const keys = Object.keys(data);
        const isTypedArrayLike = keys.length > 0 && keys.every((key) => /^\d+$/.test(key));

        if (isTypedArrayLike) {
          const values = Object.values(data).map((v) => (typeof v === 'number' ? v : parseInt(v, 10)));
          bufferData = Buffer.from(values);
        } else {
          bufferData = data;
        }
      } else if (data instanceof Uint8Array) {
        bufferData = Buffer.from(data);
      } else if (Buffer.isBuffer(data)) {
        bufferData = data;
      } else {
        bufferData = data;
      }

      await fs.writeFile(filePath, bufferData);
      return true;
    } catch (error) {
      console.error('Failed to write file:', error);
      return false;
    }
  });

  router.handle('cancel-zip-file', async ({ requestId }) => {
    if (!requestId) return false;
    canceledZipRequests.add(requestId);
    return true;
  });

  router.handle('create-zip-file', async ({ path: filePath, files, requestId }) => {
    const isCanceled = () => Boolean(requestId && canceledZipRequests.has(requestId));
    try {
      const zip = new JSZip();

      for (const file of files) {
        if (isCanceled()) {
          throw new Error('Zip export canceled');
        }

        if (!file?.name) {
          continue;
        }

        if (typeof file.sourcePath === 'string' && file.sourcePath) {
          try {
            const entryStat = await fs.lstat(file.sourcePath);
            let isRegularFile = entryStat.isFile();

            if (!isRegularFile && entryStat.isSymbolicLink()) {
              try {
                const targetStat = await fs.stat(file.sourcePath);
                isRegularFile = targetStat.isFile();
              } catch {
                isRegularFile = false;
              }
            }

            if (!isRegularFile) {
              continue;
            }

            const abortController = new AbortController();
            const timeoutId = setTimeout(() => {
              abortController.abort();
            }, 10000);

            try {
              if (isCanceled()) {
                abortController.abort();
              }
              const fileBuffer = await fs.readFile(file.sourcePath, {
                signal: abortController.signal,
              });
              if (isCanceled()) {
                throw new Error('Zip export canceled');
              }
              zip.file(file.name, fileBuffer);
            } finally {
              clearTimeout(timeoutId);
            }
          } catch (error) {
            console.warn('[FsHandler] Skip source file while creating zip:', file.sourcePath, error);
          }
          continue;
        }

        if (typeof file.content === 'string') {
          zip.file(file.name, file.content);
          continue;
        }

        if (file.content instanceof Uint8Array) {
          zip.file(file.name, Buffer.from(file.content));
          continue;
        }

        // Handle serialized Uint8Array from IPC payload
        if (file.content && typeof file.content === 'object') {
          const objectLike = file.content as Record<string, unknown>;
          const keys = Object.keys(objectLike);
          const isTypedArrayLike = keys.length > 0 && keys.every((key) => /^\d+$/.test(key));
          if (isTypedArrayLike) {
            const values = keys
              .toSorted((a, b) => Number(a) - Number(b))
              .map((key) => {
                const value = objectLike[key];
                return typeof value === 'number' ? value : Number(value ?? 0);
              });
            zip.file(file.name, Buffer.from(values));
            continue;
          }
        }
      }

      const zipBuffer = await zip.generateAsync(
        {
          type: 'nodebuffer',
          compression: 'DEFLATE',
          compressionOptions: { level: 9 },
        },
        () => {
          if (isCanceled()) {
            throw new Error('Zip export canceled');
          }
        },
      );

      if (isCanceled()) {
        throw new Error('Zip export canceled');
      }
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, zipBuffer);
      return true;
    } catch (error) {
      if (error instanceof Error && error.message.includes('canceled')) {
        console.log('[FsHandler] Zip export canceled:', requestId || '(no requestId)');
      } else {
        console.error('Failed to create zip file:', error);
      }
      return false;
    } finally {
      if (requestId) {
        canceledZipRequests.delete(requestId);
      }
    }
  });

  router.handle('get-file-metadata', async ({ path: filePath }) => {
    try {
      const stats = await fs.stat(filePath);
      return {
        name: path.basename(filePath),
        path: filePath,
        size: stats.size,
        type: '',
        lastModified: stats.mtime.getTime(),
      };
    } catch (error) {
      console.error('[FsHandler] Failed to get file metadata:', filePath, error);
      return {
        name: path.basename(filePath),
        path: filePath,
        size: -1,
        type: '',
        lastModified: 0,
      };
    }
  });

  router.handle('copy-files-to-workspace', async ({ filePaths, workspace, sourceRoot }) => {
    try {
      const copiedFiles: string[] = [];
      const failedFiles: Array<{ path: string; error: string }> = [];

      await fs.mkdir(workspace, { recursive: true });

      for (const filePath of filePaths) {
        try {
          let targetPath: string;

          if (sourceRoot) {
            const relativePath = path.relative(sourceRoot, filePath);
            targetPath = path.join(workspace, relativePath);
            await fs.mkdir(path.dirname(targetPath), { recursive: true });
          } else {
            const fileName = path.basename(filePath);
            targetPath = path.join(workspace, fileName);
          }

          const exists = await fs
            .access(targetPath)
            .then(() => true)
            .catch(() => false);

          let finalTargetPath = targetPath;
          if (exists) {
            const timestamp = Date.now();
            const ext = path.extname(targetPath);
            const name = path.basename(targetPath, ext);
            const dir = path.dirname(targetPath);
            const newFileName = `${name}${AIONUI_TIMESTAMP_SEPARATOR}${timestamp}${ext}`;
            finalTargetPath = path.join(dir, newFileName);
          }

          await fs.copyFile(filePath, finalTargetPath);
          copiedFiles.push(finalTargetPath);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`Failed to copy file ${filePath}:`, message);
          failedFiles.push({ path: filePath, error: message });
        }
      }

      const success = failedFiles.length === 0;
      const msg = success ? undefined : 'Some files failed to copy';

      return {
        success,
        data: { copiedFiles, failedFiles },
        msg,
      };
    } catch (error) {
      console.error('Failed to copy files to workspace:', error);
      return {
        success: false,
        msg: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  router.handle('remove-entry', async ({ path: targetPath }) => {
    try {
      const stats = await fs.lstat(targetPath);
      if (stats.isDirectory()) {
        await fs.rm(targetPath, { recursive: true, force: true });
      } else {
        await fs.unlink(targetPath);

        // Emit file stream delete event for preview panel
        try {
          const pathSegments = targetPath.split(path.sep);
          const fileName = pathSegments[pathSegments.length - 1];
          const workspace = pathSegments.slice(0, -1).join(path.sep);

          router.emit('file-stream-content-update', {
            filePath: targetPath,
            content: '',
            workspace: workspace,
            relativePath: fileName,
            operation: 'delete',
          });
        } catch (emitError) {
          console.error('[FsHandler] Failed to emit file stream delete:', emitError);
        }
      }
      return { success: true };
    } catch (error) {
      console.error('Failed to remove entry:', error);
      return {
        success: false,
        msg: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  router.handle('rename-entry', async ({ path: targetPath, newName }) => {
    try {
      const directory = path.dirname(targetPath);
      const newPath = path.join(directory, newName);

      if (newPath === targetPath) {
        return { success: true, data: { newPath } };
      }

      const exists = await fs
        .access(newPath)
        .then(() => true)
        .catch(() => false);

      if (exists) {
        return { success: false, msg: 'Target path already exists' };
      }

      await fs.rename(targetPath, newPath);
      return { success: true, data: { newPath } };
    } catch (error) {
      console.error('Failed to rename entry:', error);
      return {
        success: false,
        msg: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
}
