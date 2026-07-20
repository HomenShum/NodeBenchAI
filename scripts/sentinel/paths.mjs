import { WEB_SOURCE_RELATIVE_PATH } from '../lib/standardTreePaths.mjs';

export const APP_SOURCE_RELATIVE = WEB_SOURCE_RELATIVE_PATH;
export const SENTINEL_FIX_PROMPT_RELATIVE = 'evals/prompts/sentinel-self-test.md';

export function appSourcePath(relativePath = '') {
  const suffix = String(relativePath).replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
  return suffix ? `${APP_SOURCE_RELATIVE}/${suffix}` : `${APP_SOURCE_RELATIVE}/`;
}
