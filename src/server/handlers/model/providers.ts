/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WsRouter } from '../../router/WsRouter';
import type { IProvider } from '@/common/config/storage';
import { isNewApiPlatform } from '@/common/utils/platformConstants';
import { isGoogleApisHost } from '@/common/utils/urlValidation';
import { uuid } from '@/common/utils';
import { ProcessConfig } from '@process/utils/initStorage';
import OpenAI from 'openai';
import { BedrockClient, ListInferenceProfilesCommand } from '@aws-sdk/client-bedrock';

/**
 * OpenAI compatible API common path patterns
 * Used to auto-fix user-provided base URLs
 */
const API_PATH_PATTERNS = [
  '/v1', // Standard: OpenAI, DeepSeek, Moonshot, Mistral, SiliconFlow
  '/api/v1', // Proxy: OpenRouter
  '/openai/v1', // Groq
  '/compatible-mode/v1', // Alibaba Cloud DashScope
  '/compatibility/v1', // Cohere
  '/v2', // Baidu Qianfan
  '/api/v3', // Volcengine Ark
  '/api/paas/v4', // Zhipu
];

/**
 * Bedrock model ID to friendly name mapping
 */
const BEDROCK_MODEL_NAMES: Record<string, string> = {
  'anthropic.claude-opus-4-5-20251101-v1:0': 'Claude Opus 4.5',
  'anthropic.claude-sonnet-4-5-20250929-v1:0': 'Claude Sonnet 4.5',
  'anthropic.claude-haiku-4-5-20251001-v1:0': 'Claude Haiku 4.5',
  'anthropic.claude-sonnet-4-20250514-v1:0': 'Claude Sonnet 4',
  'anthropic.claude-3-7-sonnet-20250219-v1:0': 'Claude 3.7 Sonnet',
  'anthropic.claude-3-5-sonnet-20241022-v2:0': 'Claude 3.5 Sonnet v2',
  'anthropic.claude-3-5-sonnet-20240620-v1:0': 'Claude 3.5 Sonnet',
  'anthropic.claude-3-opus-20240229-v1:0': 'Claude 3 Opus',
  'anthropic.claude-3-sonnet-20240229-v1:0': 'Claude 3 Sonnet',
  'anthropic.claude-3-sonnet-20240229-v1:0:28k': 'Claude 3 Sonnet (28k)',
  'anthropic.claude-3-sonnet-20240229-v1:0:200k': 'Claude 3 Sonnet (200k)',
  'anthropic.claude-3-haiku-20240307-v1:0': 'Claude 3 Haiku',
};

/**
 * Get friendly display name for a Bedrock model ID
 * @param modelId - The Bedrock model ID
 * @returns The friendly display name, or the original ID if not found
 */
function getBedrockModelDisplayName(modelId: string): string {
  return BEDROCK_MODEL_NAMES[modelId] || modelId;
}

/**
 * Check if the base URL belongs to MiniMax API
 * Uses URL parsing to ensure only real MiniMax domains match
 */
function isMiniMaxAPI(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    const hostname = url.hostname.toLowerCase();
    return (
      hostname === 'minimaxi.com' ||
      hostname.endsWith('.minimaxi.com') ||
      hostname === 'minimax.io' ||
      hostname.endsWith('.minimax.io')
    );
  } catch {
    return false;
  }
}

/**
 * Check if the base URL belongs to DashScope Coding Plan API
 * DashScope Coding Plan does not provide /v1/models endpoint (returns 404)
 */
function isDashScopeCodingAPI(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    const hostname = url.hostname.toLowerCase();
    return hostname === 'coding.dashscope.aliyuncs.com' || hostname === 'coding-intl.dashscope.aliyuncs.com';
  } catch {
    return false;
  }
}

type FetchModelListParams = {
  base_url?: string;
  api_key: string;
  try_fix?: boolean;
  platform?: string;
  bedrockConfig?: {
    authMethod: 'accessKey' | 'profile';
    region: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    profile?: string;
  };
};

type FetchModelListResult = {
  success: boolean;
  msg?: string;
  data?: { mode: Array<string | { id: string; name: string }>; fix_base_url?: string };
};

/**
 * Core logic for fetching model list from various providers.
 * Extracted as a named function to support recursive calls during URL auto-fix.
 */
async function fetchModelList(params: FetchModelListParams): Promise<FetchModelListResult> {
  const { base_url, api_key, try_fix, platform, bedrockConfig } = params;

  // If multiple keys (comma or newline separated), use only the first one
  let actualApiKey = api_key?.trim();
  if (actualApiKey && (actualApiKey.includes(',') || actualApiKey.includes('\n'))) {
    actualApiKey = actualApiKey.split(/[,\n]/)[0].trim();
  }

  // For Vertex AI platform, return the supported model list directly
  if (platform?.includes('vertex-ai')) {
    console.log('[ModelHandler] Using Vertex AI model list');
    const vertexAIModels = ['gemini-2.5-pro', 'gemini-2.5-flash'];
    return { success: true, data: { mode: vertexAIModels } };
  }

  // MiniMax does not provide /v1/models endpoint, return hardcoded list
  if (base_url && isMiniMaxAPI(base_url)) {
    console.log('[ModelHandler] Using MiniMax model list (text models only)');
    const minimaxModels = [
      'MiniMax-M2.7',
      'MiniMax-M2.5',
      'MiniMax-M2.1',
      'MiniMax-M2.1-lightning',
      'MiniMax-M2',
      'M2-her',
    ];
    return { success: true, data: { mode: minimaxModels } };
  }

  // DashScope Coding Plan does not provide /v1/models endpoint (returns 404)
  // Validate API key via /chat/completions probe, then return hardcoded list
  if (base_url && isDashScopeCodingAPI(base_url)) {
    const codingPlanModels = [
      'qwen3-coder-plus',
      'qwen3-coder-next',
      'qwen3.5-plus',
      'qwen3-max-2026-01-23',
      'glm-4.7',
      'glm-5',
      'MiniMax-M2.5',
      'kimi-k2.5',
    ];

    // Validate the API key by probing the chat/completions endpoint
    if (actualApiKey) {
      try {
        const probeUrl = `${base_url.replace(/\/+$/, '')}/chat/completions`;
        const probeResponse = await fetch(probeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${actualApiKey}` },
          body: JSON.stringify({
            model: codingPlanModels[0],
            messages: [{ role: 'user', content: 'hi' }],
            max_tokens: 1,
          }),
        });
        if (probeResponse.status === 401) {
          const errorData = await probeResponse.json().catch(() => ({}));
          const errorMsg = errorData?.error?.message || errorData?.message || 'Invalid API key or token expired';
          return { success: false, msg: errorMsg };
        }
      } catch {
        // Network error during probe - still return model list, user will see error when chatting
      }
    }

    return { success: true, data: { mode: codingPlanModels } };
  }

  // For Anthropic/Claude platform, use Anthropic API to fetch models
  if (platform?.includes('anthropic') || platform?.includes('claude')) {
    try {
      const anthropicUrl = base_url ? `${base_url}/v1/models` : 'https://api.anthropic.com/v1/models';

      const response = await fetch(anthropicUrl, {
        headers: {
          'x-api-key': actualApiKey,
          'anthropic-version': '2023-06-01',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (!data.data || !Array.isArray(data.data)) {
        throw new Error('Invalid response format');
      }

      // Extract model IDs from response
      const modelList = data.data.map((model: { id: string }) => model.id);

      return { success: true, data: { mode: modelList } };
    } catch (e: unknown) {
      // Fall back to default model list on API failure
      const errorMessage = e instanceof Error ? e.message : String(e);
      console.warn(
        '[ModelHandler] Failed to fetch Anthropic models via API, falling back to default list:',
        errorMessage
      );
      const defaultAnthropicModels = [
        'claude-sonnet-4-20250514',
        'claude-opus-4-20250514',
        'claude-3-7-sonnet-20250219',
        'claude-3-haiku-20240307',
      ];
      return { success: true, data: { mode: defaultAnthropicModels } };
    }
  }

  // For New API gateway, use OpenAI-compatible protocol to fetch model list
  // new-api exposes standard /v1/models endpoint, use OpenAI path directly
  if (isNewApiPlatform(platform)) {
    // Validate API key before creating OpenAI client to avoid unhandled 'Missing credentials' error
    if (!actualApiKey) {
      return { success: false, msg: 'API key is required. Please configure your API key in settings.' };
    }

    // Ensure base_url has /v1 suffix
    let openaiBaseUrl = base_url?.replace(/\/+$/, '') || '';
    if (openaiBaseUrl && !openaiBaseUrl.endsWith('/v1')) {
      openaiBaseUrl = `${openaiBaseUrl}/v1`;
    }

    try {
      const openai = new OpenAI({
        baseURL: openaiBaseUrl,
        apiKey: actualApiKey,
        defaultHeaders: {
          'User-Agent': 'AionUI/1.0',
        },
      });

      const res = await openai.models.list();
      if (res.data?.length === 0) {
        throw new Error('Invalid response: empty data');
      }
      return { success: true, data: { mode: res.data.map((v) => v.id) } };
    } catch (e: any) {
      return { success: false, msg: e.message || e.toString() };
    }
  }

  // For AWS Bedrock platform, use AWS API to dynamically fetch model list
  if (platform?.includes('bedrock') && bedrockConfig?.region) {
    try {
      const region = bedrockConfig.region;

      // Store original environment variables
      const originalEnv = {
        AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
        AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
        AWS_PROFILE: process.env.AWS_PROFILE,
        AWS_REGION: process.env.AWS_REGION,
      };

      try {
        // Set environment variables based on auth method
        if (bedrockConfig.authMethod === 'accessKey') {
          process.env.AWS_ACCESS_KEY_ID = bedrockConfig.accessKeyId;
          process.env.AWS_SECRET_ACCESS_KEY = bedrockConfig.secretAccessKey;
          delete process.env.AWS_PROFILE;
        } else if (bedrockConfig.authMethod === 'profile') {
          process.env.AWS_PROFILE = bedrockConfig.profile;
          delete process.env.AWS_ACCESS_KEY_ID;
          delete process.env.AWS_SECRET_ACCESS_KEY;
        }
        process.env.AWS_REGION = region;

        // Create Bedrock client
        const bedrockClient = new BedrockClient({ region });

        // List inference profiles (cross-region inference endpoints)
        const command = new ListInferenceProfilesCommand({});
        const response = await bedrockClient.send(command);

        // Filter inference profiles that contain Claude models
        const inferenceProfiles = response.inferenceProfileSummaries || [];
        const claudeProfiles = inferenceProfiles.filter((profile) =>
          profile.inferenceProfileId?.includes('anthropic.claude')
        );

        if (claudeProfiles.length === 0) {
          return {
            success: false,
            msg: `No Claude models available in region ${region}. Try a different region.`,
          };
        }

        // Map to objects with friendly names
        const modelsWithNames = claudeProfiles.map((profile) => ({
          id: profile.inferenceProfileId || '',
          name: getBedrockModelDisplayName(profile.inferenceProfileId || ''),
        }));

        return { success: true, data: { mode: modelsWithNames } };
      } finally {
        // Restore original environment variables
        if (originalEnv.AWS_ACCESS_KEY_ID !== undefined) {
          process.env.AWS_ACCESS_KEY_ID = originalEnv.AWS_ACCESS_KEY_ID;
        } else {
          delete process.env.AWS_ACCESS_KEY_ID;
        }
        if (originalEnv.AWS_SECRET_ACCESS_KEY !== undefined) {
          process.env.AWS_SECRET_ACCESS_KEY = originalEnv.AWS_SECRET_ACCESS_KEY;
        } else {
          delete process.env.AWS_SECRET_ACCESS_KEY;
        }
        if (originalEnv.AWS_PROFILE !== undefined) {
          process.env.AWS_PROFILE = originalEnv.AWS_PROFILE;
        } else {
          delete process.env.AWS_PROFILE;
        }
        if (originalEnv.AWS_REGION !== undefined) {
          process.env.AWS_REGION = originalEnv.AWS_REGION;
        } else {
          delete process.env.AWS_REGION;
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        msg: `Failed to fetch Bedrock models: ${errorMessage}`,
      };
    }
  }

  // For Gemini platform, use Gemini API protocol
  if (platform?.includes('gemini')) {
    try {
      const geminiBaseUrlRaw = base_url?.replace(/\/+$/, '') || 'https://generativelanguage.googleapis.com';
      const geminiBaseUrl = geminiBaseUrlRaw.replace(/\/(v1beta|v1)$/, '');
      const geminiUrl = `${geminiBaseUrl}/v1beta/models?key=${encodeURIComponent(actualApiKey)}`;

      const response = await fetch(geminiUrl);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (!data.models || !Array.isArray(data.models)) {
        throw new Error('Invalid response format');
      }

      // Extract model names, remove "models/" prefix
      const modelList = data.models.map((model: { name: string }) => {
        const name = model.name;
        return name.startsWith('models/') ? name.substring(7) : name;
      });

      return { success: true, data: { mode: modelList } };
    } catch (e: any) {
      // For Gemini platform, fall back to default model list on API failure
      if (platform?.includes('gemini')) {
        console.warn('[ModelHandler] Failed to fetch Gemini models via API, falling back to default list:', e.message);
        const defaultGeminiModels = ['gemini-2.5-pro', 'gemini-2.5-flash'];
        return { success: true, data: { mode: defaultGeminiModels } };
      }
      return { success: false, msg: e.message || e.toString() };
    }
  }

  // Validate API key before creating OpenAI client to avoid unhandled 'Missing credentials' error
  if (!actualApiKey) {
    return { success: false, msg: 'API key is required. Please configure your API key in settings.' };
  }

  try {
    const openai = new OpenAI({
      baseURL: base_url,
      apiKey: actualApiKey,
      // Use custom User-Agent to avoid some API proxies blocking OpenAI SDK's default User-Agent
      defaultHeaders: {
        'User-Agent': 'AionUI/1.0',
      },
    });

    const res = await openai.models.list();
    // Check if response data is valid, LM Studio returns empty data on failure
    if (res.data?.length === 0) {
      throw new Error('Invalid response: empty data');
    }
    return { success: true, data: { mode: res.data.map((v) => v.id) } };
  } catch (e) {
    const errRes = { success: false, msg: e.message || e.toString() };

    if (!try_fix) return errRes;

    // If it's a clear API key issue, return error directly without trying to fix URL
    // Note: 403 could be URL error (missing /v1) or permission issue, need to check error message
    const isAuthError =
      e.status === 401 ||
      e.message?.includes('401') ||
      e.message?.includes('Unauthorized') ||
      e.message?.includes('Invalid API key');
    const isPermissionError =
      e.message?.includes('已被禁用') ||
      e.message?.includes('disabled') ||
      e.message?.includes('quota') ||
      e.message?.includes('rate limit');
    if (isAuthError || isPermissionError) {
      return errRes;
    }

    // User's URL request failed, try multiple possible URL formats with priority
    let url: URL;
    try {
      url = new URL(base_url);
    } catch {
      return { success: false, msg: `Invalid URL: ${base_url}` };
    }
    const pathname = url.pathname.replace(/\/+$/, '');
    const base = `${url.protocol}//${url.host}`;

    // Build prioritized candidate URL list
    // Priority 1: User path variants
    const userPathUrls = new Set<string>();
    // Priority 2: Standard API path patterns
    const standardUrls = new Set<string>();

    // 1. User path + common suffixes (for proxy scenarios)
    if (pathname && pathname !== '/') {
      userPathUrls.add(`${base}${pathname}/v1`);
      // Also try user's path itself (might just be missing trailing slash)
      userPathUrls.add(`${base}${pathname}`);
    }

    // 2. Try all known API path patterns
    API_PATH_PATTERNS.forEach((pattern) => standardUrls.add(`${base}${pattern}`));

    // Remove original URL (already tried)
    userPathUrls.delete(base_url);
    standardUrls.delete(base_url);

    const tryFetch = (candidateUrl: string) =>
      fetchModelList({ base_url: candidateUrl, api_key, try_fix: false }).then((res) => {
        if (res.success) {
          return { ...res, data: { mode: res.data.mode, fix_base_url: candidateUrl } };
        }
        return Promise.reject(res);
      });

    // Implement Promise.any: resolve on first success, reject only if all fail
    const promiseAny = <T>(promises: Promise<T>[]): Promise<T> =>
      new Promise((resolve, reject) => {
        let rejectCount = 0;
        if (promises.length === 0) {
          reject(new Error('No promises to try'));
          return;
        }
        promises.forEach((p) =>
          p.then(resolve).catch(() => {
            rejectCount++;
            if (rejectCount === promises.length) reject(new Error('All promises rejected'));
          })
        );
      });

    // Try in priority order: user path variants first, then standard patterns
    try {
      // Priority 1: Try user path variants in parallel
      if (userPathUrls.size > 0) {
        try {
          return await promiseAny([...userPathUrls].map(tryFetch));
        } catch {
          // User path variants all failed, continue to standard patterns
        }
      }

      // Priority 2: Try standard API path patterns in parallel
      if (standardUrls.size > 0) {
        return await promiseAny([...standardUrls].map(tryFetch));
      }

      return errRes;
    } catch {
      // All attempts failed, return original error
      return errRes;
    }
  }
}

/**
 * Register model provider handlers on the WsRouter.
 * Replaces the fetchModelList portion of initModelBridge() from modelBridge.ts.
 */
export function registerModelProviderHandlers(router: WsRouter): void {
  router.handle('mode.get-model-list', async (params) => {
    return fetchModelList(params);
  });
}
