import { describe, expect, it } from 'vitest';

import { ExtensionManifestSchema, ExtensionMetaSchema } from '../../src/process/extensions/types';

/**
 * Fuzz / boundary tests for aion-extension.json manifest parsing.
 * Verifies that Zod schema rejects malformed, malicious, or edge-case inputs
 * without crashing.
 */

// ---------------------------------------------------------------------------
// Helper: minimal valid manifest for mutating one field at a time
// ---------------------------------------------------------------------------
function validManifest(overrides: Record<string, unknown> = {}) {
  return {
    name: 'test-ext',
    displayName: 'Test Extension',
    version: '1.0.0',
    contributes: {
      acpAdapters: [
        {
          id: 'test-adapter',
          name: 'Test Adapter',
          cliCommand: 'test-cli',
          connectionType: 'cli',
        },
      ],
    },
    ...overrides,
  };
}

describe('Manifest Fuzz — missing required fields', () => {
  it('rejects empty object {}', () => {
    const result = ExtensionManifestSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects manifest without name', () => {
    const m = validManifest();
    delete (m as any).name;
    const result = ExtensionManifestSchema.safeParse(m);
    expect(result.success).toBe(false);
  });

  it('rejects manifest without version', () => {
    const m = validManifest();
    delete (m as any).version;
    const result = ExtensionManifestSchema.safeParse(m);
    expect(result.success).toBe(false);
  });

  it('rejects manifest without contributes', () => {
    const m = validManifest();
    delete (m as any).contributes;
    const result = ExtensionManifestSchema.safeParse(m);
    expect(result.success).toBe(false);
  });

  it('rejects manifest without displayName', () => {
    const m = validManifest();
    delete (m as any).displayName;
    const result = ExtensionManifestSchema.safeParse(m);
    expect(result.success).toBe(false);
  });
});

describe('Manifest Fuzz — type errors', () => {
  it('rejects name as number', () => {
    const result = ExtensionManifestSchema.safeParse(validManifest({ name: 42 }));
    expect(result.success).toBe(false);
  });

  it('rejects version as null', () => {
    const result = ExtensionManifestSchema.safeParse(validManifest({ version: null }));
    expect(result.success).toBe(false);
  });

  it('rejects name as boolean', () => {
    const result = ExtensionManifestSchema.safeParse(validManifest({ name: true }));
    expect(result.success).toBe(false);
  });

  it('rejects contributes as string', () => {
    const result = ExtensionManifestSchema.safeParse(validManifest({ contributes: 'bad' }));
    expect(result.success).toBe(false);
  });

  it('rejects contributes as array', () => {
    const result = ExtensionManifestSchema.safeParse(validManifest({ contributes: [] }));
    expect(result.success).toBe(false);
  });

  it('rejects version as object', () => {
    const result = ExtensionManifestSchema.safeParse(validManifest({ version: { major: 1 } }));
    expect(result.success).toBe(false);
  });
});

describe('Manifest Fuzz — name validation (kebab-case, reserved prefixes)', () => {
  it('rejects name with uppercase letters', () => {
    const result = ExtensionManifestSchema.safeParse(validManifest({ name: 'Test-Ext' }));
    expect(result.success).toBe(false);
  });

  it('rejects name with underscores', () => {
    const result = ExtensionManifestSchema.safeParse(validManifest({ name: 'test_ext' }));
    expect(result.success).toBe(false);
  });

  it('rejects name with spaces', () => {
    const result = ExtensionManifestSchema.safeParse(validManifest({ name: 'test ext' }));
    expect(result.success).toBe(false);
  });

  it('rejects name with dots', () => {
    const result = ExtensionManifestSchema.safeParse(validManifest({ name: 'test.ext' }));
    expect(result.success).toBe(false);
  });

  it('rejects empty string name', () => {
    const result = ExtensionManifestSchema.safeParse(validManifest({ name: '' }));
    expect(result.success).toBe(false);
  });

  it('rejects single character name (min 2)', () => {
    const result = ExtensionManifestSchema.safeParse(validManifest({ name: 'a' }));
    expect(result.success).toBe(false);
  });

  it('rejects name exceeding 64 characters', () => {
    const result = ExtensionManifestSchema.safeParse(validManifest({ name: 'a'.repeat(65) }));
    expect(result.success).toBe(false);
  });

  it('accepts name at exactly 64 characters', () => {
    const result = ExtensionManifestSchema.safeParse(validManifest({ name: 'a'.repeat(64) }));
    expect(result.success).toBe(true);
  });

  it('accepts name at exactly 2 characters', () => {
    const result = ExtensionManifestSchema.safeParse(validManifest({ name: 'ab' }));
    expect(result.success).toBe(true);
  });

  it('rejects reserved prefix aion-', () => {
    const result = ExtensionManifestSchema.safeParse(validManifest({ name: 'aion-my-ext' }));
    expect(result.success).toBe(false);
  });

  it('rejects reserved prefix internal-', () => {
    const result = ExtensionManifestSchema.safeParse(validManifest({ name: 'internal-ext' }));
    expect(result.success).toBe(false);
  });

  it('rejects reserved prefix builtin-', () => {
    const result = ExtensionManifestSchema.safeParse(validManifest({ name: 'builtin-feature' }));
    expect(result.success).toBe(false);
  });

  it('rejects reserved prefix system-', () => {
    const result = ExtensionManifestSchema.safeParse(validManifest({ name: 'system-core' }));
    expect(result.success).toBe(false);
  });
});

describe('Manifest Fuzz — path traversal in name/version', () => {
  it('rejects name containing "../"', () => {
    const result = ExtensionManifestSchema.safeParse(validManifest({ name: '../etc/passwd' }));
    expect(result.success).toBe(false);
  });

  it('rejects name containing "/"', () => {
    const result = ExtensionManifestSchema.safeParse(validManifest({ name: 'foo/bar' }));
    expect(result.success).toBe(false);
  });

  it('rejects name containing "\\"', () => {
    const result = ExtensionManifestSchema.safeParse(validManifest({ name: 'foo\\bar' }));
    expect(result.success).toBe(false);
  });

  it('rejects version containing "../"', () => {
    const result = ExtensionManifestSchema.safeParse(validManifest({ version: '../../etc/passwd' }));
    expect(result.success).toBe(false);
  });

  it('rejects version containing path separators', () => {
    const result = ExtensionManifestSchema.safeParse(validManifest({ version: '1.0.0/../../root' }));
    expect(result.success).toBe(false);
  });

  it('rejects version with null bytes', () => {
    const result = ExtensionManifestSchema.safeParse(validManifest({ version: '1.0.0\x00evil' }));
    expect(result.success).toBe(false);
  });
});

describe('Manifest Fuzz — version format', () => {
  it('accepts standard semver', () => {
    const result = ExtensionManifestSchema.safeParse(validManifest({ version: '1.2.3' }));
    expect(result.success).toBe(true);
  });

  it('accepts semver with prerelease', () => {
    const result = ExtensionManifestSchema.safeParse(validManifest({ version: '1.0.0-beta.1' }));
    expect(result.success).toBe(true);
  });

  it('rejects non-semver version', () => {
    const result = ExtensionManifestSchema.safeParse(validManifest({ version: 'latest' }));
    expect(result.success).toBe(false);
  });

  it('rejects empty version', () => {
    const result = ExtensionManifestSchema.safeParse(validManifest({ version: '' }));
    expect(result.success).toBe(false);
  });
});

describe('Manifest Fuzz — Unicode and special characters', () => {
  it('rejects name with Unicode characters', () => {
    const result = ExtensionManifestSchema.safeParse(validManifest({ name: 'ext-中文' }));
    expect(result.success).toBe(false);
  });

  it('rejects name with emoji', () => {
    const result = ExtensionManifestSchema.safeParse(validManifest({ name: 'ext-🚀' }));
    expect(result.success).toBe(false);
  });

  it('rejects name with null byte', () => {
    const result = ExtensionManifestSchema.safeParse(validManifest({ name: 'ext\x00evil' }));
    expect(result.success).toBe(false);
  });
});

describe('Manifest Fuzz — deeply nested / oversized inputs', () => {
  it('rejects non-JSON string input', () => {
    const result = ExtensionManifestSchema.safeParse('<html>not json</html>');
    expect(result.success).toBe(false);
  });

  it('rejects null input', () => {
    const result = ExtensionManifestSchema.safeParse(null);
    expect(result.success).toBe(false);
  });

  it('rejects undefined input', () => {
    const result = ExtensionManifestSchema.safeParse(undefined);
    expect(result.success).toBe(false);
  });

  it('rejects array input', () => {
    const result = ExtensionManifestSchema.safeParse([validManifest()]);
    expect(result.success).toBe(false);
  });

  it('rejects manifest with unknown top-level fields (strict mode)', () => {
    const result = ExtensionManifestSchema.safeParse(validManifest({ unknownField: 'hack' }));
    // ExtensionMetaSchema uses .strict(), so unknown keys should be rejected
    expect(result.success).toBe(false);
  });
});

describe('Manifest Fuzz — installedBinaryPath security', () => {
  it('accepts valid relative binary path', () => {
    const m = validManifest({
      contributes: {
        acpAdapters: [
          {
            id: 'agent',
            name: 'Agent',
            cliCommand: 'agent',
            connectionType: 'cli',
            installedBinaryPath: 'node_modules/.bin/agent',
          },
        ],
      },
    });
    const result = ExtensionManifestSchema.safeParse(m);
    expect(result.success).toBe(true);
  });

  // NOTE: The schema itself does NOT validate installedBinaryPath for path traversal.
  // This is documented in the cross-review findings. The path is only used in
  // verifyInstallation() with path.join() under a managed directory, so the risk is limited.
  it('schema accepts installedBinaryPath with path traversal (schema-level, no path validation)', () => {
    const m = validManifest({
      contributes: {
        acpAdapters: [
          {
            id: 'agent',
            name: 'Agent',
            cliCommand: 'agent',
            connectionType: 'cli',
            installedBinaryPath: '../../etc/passwd',
          },
        ],
      },
    });
    const result = ExtensionManifestSchema.safeParse(m);
    // Schema allows it — path safety is enforced at runtime in verifyInstallation
    expect(result.success).toBe(true);
  });

  it('schema accepts installedBinaryPath pointing to absolute path', () => {
    const m = validManifest({
      contributes: {
        acpAdapters: [
          {
            id: 'agent',
            name: 'Agent',
            cliCommand: 'agent',
            connectionType: 'cli',
            installedBinaryPath: '/usr/bin/rm',
          },
        ],
      },
    });
    const result = ExtensionManifestSchema.safeParse(m);
    // Schema allows it — no absolute path validation in schema
    expect(result.success).toBe(true);
  });
});

describe('Manifest Fuzz — lifecycle hooks', () => {
  it('accepts valid string lifecycle hook', () => {
    const result = ExtensionManifestSchema.safeParse(
      validManifest({
        lifecycle: { onInstall: 'scripts/install.js' },
      })
    );
    expect(result.success).toBe(true);
  });

  it('accepts valid object lifecycle hook with script', () => {
    const result = ExtensionManifestSchema.safeParse(
      validManifest({
        lifecycle: { onInstall: { script: 'scripts/install.js', timeout: 60000 } },
      })
    );
    expect(result.success).toBe(true);
  });

  it('rejects lifecycle hook object without script or shell', () => {
    const result = ExtensionManifestSchema.safeParse(
      validManifest({
        lifecycle: { onInstall: { timeout: 60000 } },
      })
    );
    expect(result.success).toBe(false);
  });

  it('rejects lifecycle hook with negative timeout', () => {
    const result = ExtensionManifestSchema.safeParse(
      validManifest({
        lifecycle: { onInstall: { script: 'install.js', timeout: -1 } },
      })
    );
    expect(result.success).toBe(false);
  });
});

describe('Manifest Fuzz — acpAdapter validation', () => {
  it('rejects adapter without id', () => {
    const result = ExtensionManifestSchema.safeParse(
      validManifest({
        contributes: {
          acpAdapters: [{ name: 'Agent', cliCommand: 'agent', connectionType: 'cli' }],
        },
      })
    );
    expect(result.success).toBe(false);
  });

  it('rejects adapter with empty id', () => {
    const result = ExtensionManifestSchema.safeParse(
      validManifest({
        contributes: {
          acpAdapters: [{ id: '', name: 'Agent', cliCommand: 'agent', connectionType: 'cli' }],
        },
      })
    );
    expect(result.success).toBe(false);
  });

  it('rejects CLI adapter without cliCommand or defaultCliPath', () => {
    const result = ExtensionManifestSchema.safeParse(
      validManifest({
        contributes: {
          acpAdapters: [{ id: 'agent', name: 'Agent', connectionType: 'cli' }],
        },
      })
    );
    expect(result.success).toBe(false);
  });

  it('rejects duplicate adapter IDs', () => {
    const result = ExtensionManifestSchema.safeParse(
      validManifest({
        contributes: {
          acpAdapters: [
            { id: 'dup', name: 'Agent1', cliCommand: 'a', connectionType: 'cli' },
            { id: 'dup', name: 'Agent2', cliCommand: 'b', connectionType: 'cli' },
          ],
        },
      })
    );
    expect(result.success).toBe(false);
  });
});

describe('Manifest — dist field (stampIntegrity round-trip)', () => {
  it('accepts manifest with dist.integrity (stamped by HubInstaller)', () => {
    const result = ExtensionManifestSchema.safeParse(
      validManifest({
        dist: { integrity: 'sha256-9cbcfe1cdf5a512608c72e7d458e6ee92020ed6842469449a88cbcd254b17279' },
      })
    );
    expect(result.success).toBe(true);
  });

  it('accepts manifest without dist field', () => {
    const result = ExtensionManifestSchema.safeParse(validManifest());
    expect(result.success).toBe(true);
  });

  it('accepts manifest with dist.integrity undefined', () => {
    const result = ExtensionManifestSchema.safeParse(
      validManifest({ dist: {} })
    );
    expect(result.success).toBe(true);
  });

  it('preserves dist.integrity value after parsing', () => {
    const integrity = 'sha256-abc123';
    const result = ExtensionManifestSchema.safeParse(
      validManifest({ dist: { integrity } })
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as any).dist?.integrity).toBe(integrity);
    }
  });
});
