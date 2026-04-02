/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Document Conversion Handler
 *
 * Handles office document format conversions (Word -> Markdown,
 * Excel -> JSON, PowerPoint -> JSON). Replaces initDocumentBridge()
 * from src/process/bridge/documentBridge.ts.
 */

import path from 'path';
import type { DocumentConversionTarget } from '@/common/types/conversion';
import { conversionService } from '@server/services/conversionService';
import type { WsRouter } from '../router/WsRouter';

// Supported file extension sets
const WORD_EXTENSIONS = new Set(['.doc', '.docx']);
const EXCEL_EXTENSIONS = new Set(['.xls', '.xlsx']);
const PPT_EXTENSIONS = new Set(['.ppt', '.pptx']);

/**
 * Generate an unsupported conversion result.
 */
const unsupportedResult = (to: DocumentConversionTarget, message: string) => ({
  to,
  result: {
    success: false,
    error: message,
  },
});

/**
 * Check if a file extension is in the allowed set.
 */
const ensureExtension = (filePath: string, allowed: Set<string>) => {
  const ext = path.extname(filePath).toLowerCase();
  return allowed.has(ext);
};

/**
 * Register document conversion endpoint handlers on the WsRouter.
 * Replaces initDocumentBridge() from src/process/bridge/documentBridge.ts.
 */
export function registerDocumentHandlers(router: WsRouter): void {
  router.handle('document.convert', async ({ filePath, to }) => {
    switch (to) {
      case 'markdown': {
        if (!ensureExtension(filePath, WORD_EXTENSIONS)) {
          return unsupportedResult(to, 'Only Word documents can be converted to markdown');
        }
        const result = await conversionService.wordToMarkdown(filePath);
        return { to, result };
      }
      case 'excel-json': {
        if (!ensureExtension(filePath, EXCEL_EXTENSIONS)) {
          return unsupportedResult(to, 'Only Excel workbooks can be converted to JSON');
        }
        const result = await conversionService.excelToJson(filePath);
        return { to, result };
      }
      case 'ppt-json': {
        if (!ensureExtension(filePath, PPT_EXTENSIONS)) {
          return unsupportedResult(to, 'Only PowerPoint files can be converted to JSON');
        }
        const result = await conversionService.pptToJson(filePath);
        return { to, result };
      }
      default:
        return unsupportedResult(to, `Unsupported target format: ${to}`);
    }
  });
}
