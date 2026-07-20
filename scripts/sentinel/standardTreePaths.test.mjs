// @vitest-environment node
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { diagnoseProbe, guessFilesFromTestTitle } from './diagnose.mjs';
import { APP_SOURCE_RELATIVE, SENTINEL_FIX_PROMPT_RELATIVE, appSourcePath } from './paths.mjs';
import { inspectA11ySources, probeVoiceCoverage } from './runner.mjs';

const repoRoot = resolve(import.meta.dirname, '../..');
const temporaryRoots = [];

function makeTemporaryRoot() {
  const root = mkdtempSync(join(tmpdir(), 'nodebench-sentinel-paths-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  while (temporaryRoots.length > 0) {
    rmSync(temporaryRoots.pop(), { recursive: true, force: true });
  }
});

describe('Scenario: a release operator runs Sentinel against the migrated web application', () => {
  it('resolves the voice, routing, accessibility, and fixer inputs from canonical paths', async () => {
    const requiredPaths = [
      appSourcePath('hooks/useVoiceIntentRouter.ts'),
      appSourcePath('hooks/useCockpitRouting.ts'),
      appSourcePath('layouts/CockpitLayout.tsx'),
      appSourcePath('components/SkipLinks.tsx'),
      SENTINEL_FIX_PROMPT_RELATIVE,
    ];

    expect(requiredPaths.filter((path) => !existsSync(resolve(repoRoot, path)))).toEqual([]);

    const voiceResult = await probeVoiceCoverage({ root: repoRoot });
    expect(voiceResult).toMatchObject({
      status: 'pass',
      summary: '0 voice coverage gaps',
      failures: [],
    });
  });

  it('keeps generated operator guidance on apps/web/src and evals after repeated use', () => {
    const indexSource = readFileSync(resolve(repoRoot, 'scripts/sentinel/index.mjs'), 'utf8');
    const swarmSource = readFileSync(resolve(repoRoot, 'scripts/sentinel/swarm.mjs'), 'utf8');

    for (let iteration = 0; iteration < 100; iteration += 1) {
      expect(appSourcePath('hooks/useVoiceIntentRouter.ts')).toBe(
        'apps/web/src/hooks/useVoiceIntentRouter.ts',
      );
    }
    expect(indexSource).toContain('SENTINEL_FIX_PROMPT_RELATIVE');
    expect(swarmSource).toContain("appSourcePath('hooks/useVoiceIntentRouter.ts')");
    expect(indexSource).not.toContain('tests/prompts/sentinel-self-test.md');
    expect(swarmSource).not.toContain('tests/prompts/sentinel-self-test.md');
  });
});

describe('Scenario: CI must not certify accessibility when source inspection is degraded', () => {
  it('fails closed when the canonical source directory is missing or empty', () => {
    const root = makeTemporaryRoot();
    const missing = inspectA11ySources(join(root, APP_SOURCE_RELATIVE), { repoRoot: root });

    const emptySourceRoot = join(root, 'empty', APP_SOURCE_RELATIVE);
    mkdirSync(emptySourceRoot, { recursive: true });
    const empty = inspectA11ySources(emptySourceRoot, { repoRoot: join(root, 'empty') });

    for (const result of [missing, empty]) {
      expect(result.status).toBe('fail');
      expect(result.meta.inspectedSourceFileCount).toBe(0);
      expect(result.failures[0]).toContain('A11y source inspection failed');
    }
  });

  it('inspects a sustained 120-file app tree and still surfaces an adversarial small target', () => {
    const root = makeTemporaryRoot();
    const sourceRoot = join(root, APP_SOURCE_RELATIVE);
    mkdirSync(sourceRoot, { recursive: true });

    for (let index = 0; index < 120; index += 1) {
      writeFileSync(
        join(sourceRoot, `ReleaseControl${index}.tsx`),
        `export const ReleaseControl${index} = () => <button aria-label="release" className="min-w-11 min-h-11" onClick={() => {}}>Ship</button>;\n`,
      );
    }
    writeFileSync(
      join(sourceRoot, 'AdversarialCompactControl.tsx'),
      'export const AdversarialCompactControl = () => <button className="w-8 h-8" onClick={() => {}}>X</button>;\n',
    );

    const result = inspectA11ySources(sourceRoot, { repoRoot: root });

    expect(result.status).toBe('warn');
    expect(result.meta.sourceFileCount).toBe(121);
    expect(result.meta.inspectedSourceFileCount).toBe(121);
    expect(result.meta.interactiveFileCount).toBe(121);
    expect(result.failures).toEqual([
      expect.stringContaining('Touch target < 44px: apps/web/src/AdversarialCompactControl.tsx:1'),
    ]);
  });

  it('routes a failed-closed inspection receipt to the canonical source tree for repair', () => {
    const diagnoses = diagnoseProbe({
      probe: 'a11y:static',
      category: 'a11y',
      status: 'fail',
      failures: ['A11y source inspection failed: source directory missing'],
    });

    expect(diagnoses).toEqual([
      expect.objectContaining({
        affectedFiles: ['apps/web/src/'],
        severity: 1,
      }),
    ]);
    expect(guessFilesFromTestTitle('voice routing remains available')).toEqual([
      'apps/web/src/hooks/useVoiceIntentRouter.ts',
      'apps/web/src/components/hud/JarvisHUDLayout.tsx',
    ]);

    const voiceDiagnoses = diagnoseProbe({
      probe: 'voice:router-coverage',
      category: 'voice',
      status: 'warn',
      failures: ['VIEW_ALIASES missing spoken alias: legal'],
    });
    expect(voiceDiagnoses).toEqual([
      expect.objectContaining({
        affectedFiles: ['apps/web/src/hooks/useVoiceIntentRouter.ts'],
        suggestedFix: expect.stringContaining('"legal"'),
      }),
    ]);
  });
});
