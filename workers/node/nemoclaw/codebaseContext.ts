/**
 * NemoClaw Codebase Context Module
 *
 * Provides workspace awareness: file reading, code search,
 * project structure, git status, and smart file discovery.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

const MAX_FILE_SIZE = 100_000; // 100KB max file read
const MAX_RESULTS = 50;

/**
 * Get project structure (top-level directories + key files)
 */
export async function getProjectStructure(
  rootPath: string = process.cwd(),
  depth: number = 2
): Promise<string> {
  try {
    // Use tree-like output via find
    const { stdout } = await execAsync(
      `find "${rootPath}" -maxdepth ${depth} -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/dist/*" -not -path "*/.next/*" | head -100`,
      { timeout: 10000, cwd: rootPath }
    );
    return stdout;
  } catch {
    // Fallback for Windows
    const { stdout } = await execAsync(
      `dir /s /b /ad "${rootPath}" | findstr /v "node_modules" | findstr /v ".git"`,
      { timeout: 10000 }
    );
    return stdout;
  }
}

/**
 * Read a file with size guard
 */
export async function readFile(
  filePath: string,
  options: { startLine?: number; endLine?: number } = {}
): Promise<{ content: string; lineCount: number; truncated: boolean }> {
  const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);

  const stat = await fs.stat(resolvedPath);
  if (stat.size > MAX_FILE_SIZE) {
    // Read only first chunk
    const fd = await fs.open(resolvedPath, 'r');
    const buffer = Buffer.alloc(MAX_FILE_SIZE);
    await fd.read(buffer, 0, MAX_FILE_SIZE, 0);
    await fd.close();
    const content = buffer.toString('utf-8');
    return {
      content,
      lineCount: content.split('\n').length,
      truncated: true,
    };
  }

  const content = await fs.readFile(resolvedPath, 'utf-8');
  const lines = content.split('\n');

  if (options.startLine !== undefined || options.endLine !== undefined) {
    const start = (options.startLine || 1) - 1;
    const end = options.endLine || lines.length;
    const sliced = lines.slice(start, end).join('\n');
    return { content: sliced, lineCount: end - start, truncated: false };
  }

  return { content, lineCount: lines.length, truncated: false };
}

/**
 * Write to a file
 */
export async function writeFile(
  filePath: string,
  content: string
): Promise<{ success: boolean; path: string }> {
  const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
  await fs.writeFile(resolvedPath, content, 'utf-8');
  return { success: true, path: resolvedPath };
}

/**
 * Search for files by glob pattern
 */
export async function findFiles(
  pattern: string,
  rootPath: string = process.cwd()
): Promise<string[]> {
  try {
    const { stdout } = await execAsync(
      `find "${rootPath}" -name "${pattern}" -not -path "*/node_modules/*" -not -path "*/.git/*" | head -${MAX_RESULTS}`,
      { timeout: 10000 }
    );
    return stdout.trim().split('\n').filter(Boolean);
  } catch {
    // Windows fallback
    const { stdout } = await execAsync(
      `dir /s /b "${rootPath}\\${pattern}" 2>nul | findstr /v "node_modules" | findstr /v ".git"`,
      { timeout: 10000 }
    );
    return stdout.trim().split('\n').filter(Boolean).slice(0, MAX_RESULTS);
  }
}

/**
 * Search file contents (grep-like)
 */
export async function searchCode(
  query: string,
  rootPath: string = process.cwd(),
  options: { fileType?: string; caseSensitive?: boolean } = {}
): Promise<Array<{ file: string; line: number; content: string }>> {
  const flags = options.caseSensitive ? '' : '-i';
  const typeFlag = options.fileType ? `--include="*.${options.fileType}"` : '';

  try {
    const { stdout } = await execAsync(
      `grep -rn ${flags} ${typeFlag} "${query}" "${rootPath}" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist | head -${MAX_RESULTS}`,
      { timeout: 15000 }
    );

    return stdout.trim().split('\n').filter(Boolean).map(line => {
      const match = line.match(/^(.+?):(\d+):(.+)$/);
      if (match) {
        return { file: match[1], line: parseInt(match[2]), content: match[3].trim() };
      }
      return { file: '', line: 0, content: line };
    });
  } catch {
    return [];
  }
}

/**
 * Get git status
 */
export async function getGitStatus(
  rootPath: string = process.cwd()
): Promise<{ branch: string; status: string; recentCommits: string }> {
  try {
    const [branch, status, log] = await Promise.all([
      execAsync('git branch --show-current', { cwd: rootPath }).then(r => r.stdout.trim()),
      execAsync('git status --short', { cwd: rootPath }).then(r => r.stdout.trim()),
      execAsync('git log --oneline -10', { cwd: rootPath }).then(r => r.stdout.trim()),
    ]);
    return { branch, status, recentCommits: log };
  } catch {
    return { branch: 'unknown', status: 'not a git repo', recentCommits: '' };
  }
}

/**
 * Get git diff (staged + unstaged)
 */
export async function getGitDiff(rootPath: string = process.cwd()): Promise<string> {
  try {
    const { stdout } = await execAsync('git diff HEAD', { cwd: rootPath, maxBuffer: 1024 * 1024 });
    return stdout.slice(0, MAX_FILE_SIZE); // Cap output
  } catch {
    return '';
  }
}

/**
 * Get workspace summary — overview of the project
 */
export async function getWorkspaceSummary(
  rootPath: string = process.cwd()
): Promise<{
  name: string;
  type: string;
  mainFiles: string[];
  gitInfo: { branch: string; status: string };
}> {
  const name = path.basename(rootPath);

  // Detect project type
  let type = 'unknown';
  try {
    await fs.access(path.join(rootPath, 'package.json'));
    const pkg = JSON.parse(await fs.readFile(path.join(rootPath, 'package.json'), 'utf-8'));
    type = pkg.dependencies?.react ? 'react' :
           pkg.dependencies?.next ? 'nextjs' :
           pkg.dependencies?.express ? 'express' :
           'node';
  } catch { /* not a node project */ }

  // Find key files
  const keyPatterns = ['README.md', 'CLAUDE.md', 'package.json', 'tsconfig.json', '.env.example'];
  const mainFiles: string[] = [];
  for (const pattern of keyPatterns) {
    try {
      await fs.access(path.join(rootPath, pattern));
      mainFiles.push(pattern);
    } catch { /* doesn't exist */ }
  }

  const gitInfo = await getGitStatus(rootPath);

  return {
    name,
    type,
    mainFiles,
    gitInfo: { branch: gitInfo.branch, status: gitInfo.status },
  };
}

export const codebaseTools = {
  project_structure: { fn: getProjectStructure, description: 'Get project directory structure' },
  read_file: { fn: readFile, description: 'Read a file (with optional line range)' },
  write_file: { fn: writeFile, description: 'Write content to a file' },
  find_files: { fn: findFiles, description: 'Find files by name pattern (e.g., *.ts, *.tsx)' },
  search_code: { fn: searchCode, description: 'Search file contents for a string/regex' },
  git_status: { fn: getGitStatus, description: 'Get git branch, status, and recent commits' },
  git_diff: { fn: getGitDiff, description: 'Get git diff of all changes' },
  workspace_summary: { fn: getWorkspaceSummary, description: 'Get workspace overview (project type, key files, git info)' },
};
