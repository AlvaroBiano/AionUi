/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Model protocol detection handler.
 * Extracted from modelBridge.ts — mode.detect-protocol endpoint.
 */

import type { WsRouter } from '../../router/WsRouter';
import {
  type ProtocolDetectionRequest,
  type ProtocolDetectionResponse,
  type ProtocolType,
  type MultiKeyTestResult,
  parseApiKeys,
  maskApiKey,
  normalizeBaseUrl,
  removeApiPathSuffix,
  guessProtocolFromUrl,
  guessProtocolFromKey,
  getProtocolDisplayName,
} from '@/common/utils/protocolDetector';
import { isGoogleApisHost } from '@/common/utils/urlValidation';

export function registerModelDetectionHandlers(router: WsRouter): void {
  router.handle('mode.detect-protocol', async (request: ProtocolDetectionRequest): Promise<{
    success: boolean;
    msg?: string;
    data?: ProtocolDetectionResponse;
  }> => {
    const {
      baseUrl: rawBaseUrl,
      apiKey: apiKeyString,
      timeout = 10000,
      testAllKeys = false,
      preferredProtocol,
    } = request;

    const baseUrl = normalizeBaseUrl(rawBaseUrl);
    const baseUrlCandidates = buildBaseUrlCandidates(baseUrl);
    const apiKeys = parseApiKeys(apiKeyString);

    if (!baseUrl) {
      return {
        success: false,
        msg: 'Base URL is required',
        data: {
          success: false,
          protocol: 'unknown',
          confidence: 0,
          error: 'Base URL is required',
        },
      };
    }

    if (apiKeys.length === 0) {
      return {
        success: false,
        msg: 'API Key is required',
        data: {
          success: false,
          protocol: 'unknown',
          confidence: 0,
          error: 'API Key is required',
        },
      };
    }

    const firstKey = apiKeys[0];

    // Smart prediction: guess protocol from URL and key format
    const urlGuess = guessProtocolFromUrl(baseUrl);
    const keyGuess = guessProtocolFromKey(firstKey);

    // Determine test order: prioritize guessed protocols
    const protocolsToTest: ProtocolType[] = [];

    if (preferredProtocol && preferredProtocol !== 'unknown') {
      protocolsToTest.push(preferredProtocol);
    }
    if (urlGuess && !protocolsToTest.includes(urlGuess)) {
      protocolsToTest.push(urlGuess);
    }
    if (keyGuess && !protocolsToTest.includes(keyGuess)) {
      protocolsToTest.push(keyGuess);
    }
    // Add remaining protocols
    for (const p of ['gemini', 'openai', 'anthropic'] as ProtocolType[]) {
      if (!protocolsToTest.includes(p)) {
        protocolsToTest.push(p);
      }
    }

    let detectedProtocol: ProtocolType = 'unknown';
    let confidence = 0;
    let models: string[] = [];
    let detectionError: string | undefined;
    let fixedBaseUrl: string | undefined;
    let detectedBaseUrl: string | undefined;

    // Test each protocol in order
    for (const protocol of protocolsToTest) {
      for (const candidateBaseUrl of baseUrlCandidates) {
        const result = await testProtocol(candidateBaseUrl, firstKey, protocol, timeout);

        if (result.success) {
          detectedProtocol = protocol;
          confidence = result.confidence;
          models = result.models || [];
          fixedBaseUrl = result.fixedBaseUrl;
          detectedBaseUrl = candidateBaseUrl;
          break;
        } else if (!detectionError) {
          detectionError = result.error;
        }
      }
      if (detectedProtocol !== 'unknown') {
        break;
      }
    }

    // Multi-key testing
    let multiKeyResult: MultiKeyTestResult | undefined;
    const baseUrlForTesting = detectedBaseUrl || baseUrlCandidates[0] || baseUrl;
    if (testAllKeys && apiKeys.length > 1 && detectedProtocol !== 'unknown') {
      multiKeyResult = await testMultipleKeys(baseUrlForTesting, apiKeys, detectedProtocol, timeout);
    }

    // Generate suggestion
    const suggestion = generateSuggestion(detectedProtocol, confidence, baseUrlForTesting, detectionError);

    const response: ProtocolDetectionResponse = {
      success: detectedProtocol !== 'unknown',
      protocol: detectedProtocol,
      confidence,
      error: detectedProtocol === 'unknown' ? detectionError : undefined,
      fixedBaseUrl,
      suggestion,
      multiKeyResult,
      models,
    };

    return {
      success: true,
      data: response,
    };
  });
}

/**
 * Build candidate URL list
 *
 * Strategy:
 * 1. Try user's original URL first
 * 2. If original URL contains known API path suffix, add suffix-removed version as fallback
 * 3. Use whichever succeeds first
 */
function buildBaseUrlCandidates(baseUrl: string): string[] {
  if (!baseUrl) return [];

  const candidates: string[] = [];

  const hasProtocol = /^https?:\/\//i.test(baseUrl);
  const urlsToProcess = hasProtocol ? [baseUrl] : [`https://${baseUrl}`, `http://${baseUrl}`];

  for (const url of urlsToProcess) {
    // 1. Original URL first
    candidates.push(url);

    // 2. If contains known path suffix, add suffix-removed version
    const strippedUrl = removeApiPathSuffix(url);
    if (strippedUrl && strippedUrl !== url && !candidates.includes(strippedUrl)) {
      candidates.push(strippedUrl);
    }
  }

  return candidates;
}

/**
 * Test a single protocol
 */
async function testProtocol(
  baseUrl: string,
  apiKey: string,
  protocol: ProtocolType,
  timeout: number,
): Promise<{
  success: boolean;
  confidence: number;
  error?: string;
  models?: string[];
  fixedBaseUrl?: string;
}> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    switch (protocol) {
      case 'gemini':
        return await testGeminiProtocol(baseUrl, apiKey, controller.signal);
      case 'openai':
        return await testOpenAIProtocol(baseUrl, apiKey, controller.signal);
      case 'anthropic':
        return await testAnthropicProtocol(baseUrl, apiKey, controller.signal);
      default:
        return { success: false, confidence: 0, error: 'Unknown protocol' };
    }
  } catch (error: any) {
    if (error.name === 'AbortError') {
      return { success: false, confidence: 0, error: 'Request timeout' };
    }
    return { success: false, confidence: 0, error: error.message || String(error) };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Test Gemini protocol
 */
async function testGeminiProtocol(
  baseUrl: string,
  apiKey: string,
  signal: AbortSignal,
): Promise<{ success: boolean; confidence: number; error?: string; models?: string[]; fixedBaseUrl?: string }> {
  // Gemini API Key format: AIza...
  const endpoints = [
    { url: `${baseUrl}/v1beta/models?key=${encodeURIComponent(apiKey)}`, version: 'v1beta' },
    { url: `${baseUrl}/v1/models?key=${encodeURIComponent(apiKey)}`, version: 'v1' },
    { url: `${baseUrl}/models?key=${encodeURIComponent(apiKey)}`, version: 'root' },
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint.url, {
        method: 'GET',
        signal,
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const data = await response.json();
        if (data.models && Array.isArray(data.models)) {
          const models = data.models.map((m: any) => {
            const name = m.name || '';
            return name.startsWith('models/') ? name.substring(7) : name;
          });
          return {
            success: true,
            confidence: 95,
            models,
            fixedBaseUrl: endpoint.version !== 'v1beta' ? baseUrl : undefined,
          };
        }
      }

      // Check specific Gemini error responses
      if (response.status === 400 || response.status === 403) {
        const errorData = await response.json().catch(() => ({}));
        if (errorData.error?.message?.includes('API key')) {
          return { success: false, confidence: 80, error: 'Invalid API key format for Gemini' };
        }
      }
    } catch (_e) {
      // Continue trying next endpoint
    }
  }

  return { success: false, confidence: 0, error: 'Not a Gemini API endpoint' };
}

/**
 * Test OpenAI protocol
 */
async function testOpenAIProtocol(
  baseUrl: string,
  apiKey: string,
  signal: AbortSignal,
): Promise<{ success: boolean; confidence: number; error?: string; models?: string[]; fixedBaseUrl?: string }> {
  const endpoints = [
    { url: `${baseUrl}/models`, path: '' },
    { url: `${baseUrl}/v1/models`, path: '/v1' },
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint.url, {
        method: 'GET',
        signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        if (data.data && Array.isArray(data.data)) {
          const models = data.data.map((m: any) => m.id);
          return {
            success: true,
            confidence: 95,
            models,
            fixedBaseUrl: endpoint.path ? `${baseUrl}${endpoint.path}` : undefined,
          };
        }
        // Some OpenAI-compatible APIs return models instead of data
        if (data.models && Array.isArray(data.models)) {
          const models = data.models.map((m: any) => m.id || m.name);
          return {
            success: true,
            confidence: 85,
            models,
            fixedBaseUrl: endpoint.path ? `${baseUrl}${endpoint.path}` : undefined,
          };
        }
      }

      // 401 indicates OpenAI protocol but invalid key
      if (response.status === 401) {
        return { success: false, confidence: 70, error: 'Invalid API key for OpenAI protocol' };
      }
    } catch (_e) {
      // Continue trying next endpoint
    }
  }

  // /models endpoints all failed (e.g. 404). Probe /chat/completions to confirm
  // the endpoint is OpenAI-compatible even when it doesn't support model listing
  // (DashScope Coding Plan, some proxies, etc.)
  const chatProbeEndpoints = [
    { url: `${baseUrl}/chat/completions`, path: '' },
    { url: `${baseUrl}/v1/chat/completions`, path: '/v1' },
  ];

  for (const endpoint of chatProbeEndpoints) {
    try {
      const response = await fetch(endpoint.url, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model: '_probe', messages: [{ role: 'user', content: '' }], max_tokens: 1 }),
      });

      if (response.status === 401) {
        return { success: false, confidence: 70, error: 'Invalid API key for OpenAI protocol' };
      }

      const data = await response.json().catch((): null => null);
      if (data?.error && typeof data.error === 'object' && 'message' in data.error) {
        // OpenAI-style error response confirms the protocol
        return {
          success: true,
          confidence: 75,
          fixedBaseUrl: endpoint.path ? `${baseUrl}${endpoint.path}` : undefined,
        };
      }
      if (data?.choices && Array.isArray(data.choices)) {
        return {
          success: true,
          confidence: 85,
          fixedBaseUrl: endpoint.path ? `${baseUrl}${endpoint.path}` : undefined,
        };
      }
    } catch {
      // Continue
    }
  }

  return { success: false, confidence: 0, error: 'Not an OpenAI-compatible API endpoint' };
}

/**
 * Check if response is in Anthropic format
 *
 * Anthropic response/error format characteristics:
 * - Success: { id: "msg_...", type: "message", ... }
 * - Error: { type: "error", error: { type: "...", message: "..." } }
 */
function isAnthropicResponse(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;

  // Success response format
  if (obj.type === 'message' && typeof obj.id === 'string' && obj.id.startsWith('msg_')) {
    return true;
  }

  // Error response format
  if (obj.type === 'error' && obj.error && typeof obj.error === 'object') {
    const errorObj = obj.error as Record<string, unknown>;
    if (typeof errorObj.type === 'string' && typeof errorObj.message === 'string') {
      return true;
    }
  }

  return false;
}

/**
 * Test Anthropic protocol
 */
async function testAnthropicProtocol(
  baseUrl: string,
  apiKey: string,
  signal: AbortSignal,
): Promise<{ success: boolean; confidence: number; error?: string; models?: string[]; fixedBaseUrl?: string }> {
  // Anthropic has no models endpoint, test with messages endpoint
  const endpoints = [
    { url: `${baseUrl}/v1/messages`, path: '/v1' },
    { url: `${baseUrl}/messages`, path: '' },
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint.url, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
      });

      let responseData: unknown;
      try {
        responseData = await response.json();
      } catch {
        // Cannot parse JSON, not Anthropic protocol
        continue;
      }

      // 200 means success
      if (response.ok && isAnthropicResponse(responseData)) {
        const models = [
          'claude-3-opus-20240229',
          'claude-3-sonnet-20240229',
          'claude-3-haiku-20240307',
          'claude-3-5-sonnet-20241022',
        ];
        return {
          success: true,
          confidence: 95,
          models,
          fixedBaseUrl: endpoint.path ? `${baseUrl}${endpoint.path}` : undefined,
        };
      }

      // 400/401 need to verify if it's Anthropic-format error response
      if ((response.status === 400 || response.status === 401) && isAnthropicResponse(responseData)) {
        if (response.status === 401) {
          return { success: false, confidence: 70, error: 'Invalid API key for Anthropic protocol' };
        }
        // 400 parameter error but auth succeeded (Anthropic format verified)
        const models = [
          'claude-3-opus-20240229',
          'claude-3-sonnet-20240229',
          'claude-3-haiku-20240307',
          'claude-3-5-sonnet-20241022',
        ];
        return {
          success: true,
          confidence: 90,
          models,
          fixedBaseUrl: endpoint.path ? `${baseUrl}${endpoint.path}` : undefined,
        };
      }
    } catch (_e) {
      // Continue trying next endpoint
    }
  }

  return { success: false, confidence: 0, error: 'Not an Anthropic API endpoint' };
}

/**
 * Test connectivity for multiple keys (concurrent execution)
 *
 * Reference GPT-Load design, use concurrent testing for efficiency
 */
async function testMultipleKeys(
  baseUrl: string,
  apiKeys: string[],
  protocol: ProtocolType,
  timeout: number,
  concurrency: number = 5,
): Promise<MultiKeyTestResult> {
  const results: MultiKeyTestResult['details'] = [];

  // Execute in batches concurrently
  for (let batchStart = 0; batchStart < apiKeys.length; batchStart += concurrency) {
    const batchEnd = Math.min(batchStart + concurrency, apiKeys.length);
    const batch = apiKeys.slice(batchStart, batchEnd);

    const batchPromises = batch.map(async (key, batchIndex) => {
      const globalIndex = batchStart + batchIndex;
      const startTime = Date.now();

      try {
        const result = await testProtocol(baseUrl, key, protocol, timeout);
        return {
          index: globalIndex,
          maskedKey: maskApiKey(key),
          valid: result.success,
          error: result.error,
          latency: Date.now() - startTime,
        };
      } catch (e: unknown) {
        return {
          index: globalIndex,
          maskedKey: maskApiKey(key),
          valid: false,
          error: e instanceof Error ? e.message : String(e),
          latency: Date.now() - startTime,
        };
      }
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
  }

  // Sort by original index
  results.sort((a, b) => a.index - b.index);

  return {
    total: apiKeys.length,
    valid: results.filter((r) => r.valid).length,
    invalid: results.filter((r) => !r.valid).length,
    details: results,
  };
}

/**
 * Check if it's PackyAPI proxy service
 *
 * Use URL parsing to ensure only real packyapi.com domain matches, preventing URL injection attacks
 */
function isPackyAPI(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    const hostname = url.hostname.toLowerCase();
    return hostname === 'packyapi.com' || hostname.endsWith('.packyapi.com');
  } catch {
    return false;
  }
}

/**
 * Generate suggestion
 *
 * Return i18n key and params, frontend handles translation
 */
function generateSuggestion(
  protocol: ProtocolType,
  _confidence: number,
  baseUrl: string,
  error?: string,
): ProtocolDetectionResponse['suggestion'] {
  if (protocol === 'unknown') {
    if (error?.includes('timeout') || error?.includes('Timeout')) {
      return {
        type: 'check_key',
        message: 'Connection timeout, please check network or API URL',
        i18nKey: 'settings.protocolTimeout',
      };
    }
    if (error?.includes('API key') || error?.includes('401') || error?.includes('Unauthorized')) {
      return {
        type: 'check_key',
        message: 'Invalid API Key, please check your key',
        i18nKey: 'settings.protocolInvalidKey',
      };
    }
    return {
      type: 'check_key',
      message: 'Unable to identify API protocol, please check configuration',
      i18nKey: 'settings.protocolCheckConfig',
    };
  }

  const displayName = getProtocolDisplayName(protocol);

  // Special handling for PackyAPI
  // PackyAPI supports two protocol formats via different URLs
  if (isPackyAPI(baseUrl)) {
    if (protocol === 'openai' && baseUrl.includes('/v1')) {
      // Detected OpenAI format (with /v1), suggest Claude format (without /v1) is also available
      return {
        type: 'none',
        message:
          'PackyAPI: Detected OpenAI format. For Claude format, use URL without /v1 and select Anthropic platform',
        i18nKey: 'settings.packyapiOpenAIDetected',
      };
    }
    if (protocol === 'anthropic') {
      // Detected Anthropic format (without /v1), suggest OpenAI format (with /v1) is also available
      return {
        type: 'none',
        message:
          'PackyAPI: Detected Claude format. For OpenAI format, add /v1 to URL and select OpenAI/Custom platform',
        i18nKey: 'settings.packyapiAnthropicDetected',
      };
    }
  }

  // Detected Gemini protocol but user may have selected a different platform
  if (protocol === 'gemini' && !isGoogleApisHost(baseUrl)) {
    return {
      type: 'switch_platform',
      message: `Detected ${displayName} protocol, consider switching to Gemini for better support`,
      suggestedPlatform: 'gemini',
      i18nKey: 'settings.protocolSwitchSuggestion',
      i18nParams: { protocol: displayName, platform: 'Gemini' },
    };
  }

  // Detected Anthropic protocol
  if (protocol === 'anthropic') {
    return {
      type: 'switch_platform',
      message: `Detected ${displayName} protocol, using custom mode`,
      suggestedPlatform: 'Anthropic',
      i18nKey: 'settings.protocolSwitchSuggestion',
      i18nParams: { protocol: displayName, platform: 'Anthropic' },
    };
  }

  // OpenAI protocol is the default
  if (protocol === 'openai') {
    return {
      type: 'none',
      message: `Detected ${displayName}-compatible protocol, configuration is correct`,
      i18nKey: 'settings.protocolOpenAICompatible',
    };
  }

  return {
    type: 'none',
    message: `Identified as ${displayName} protocol`,
    i18nKey: 'settings.protocolDetected',
    i18nParams: { protocol: displayName },
  };
}
