import simpleGit from 'simple-git';
import { join, normalize, resolve, sep } from 'path';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';

const CLONE_TIMEOUT_MS = 60000; // 60 seconds

export class GitCloneError extends Error {
  readonly url: string;
  readonly isTimeout: boolean;
  readonly isAuthError: boolean;

  constructor(message: string, url: string, isTimeout = false, isAuthError = false) {
    super(message);
    this.name = 'GitCloneError';
    this.url = url;
    this.isTimeout = isTimeout;
    this.isAuthError = isAuthError;
  }
}

export async function cloneRepo(url: string, ref?: string): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), 'skills-'));
  const git = simpleGit({
    timeout: { block: CLONE_TIMEOUT_MS },
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      // Skills are text files (HTML/MD/JSON) and never LFS-tracked. Registry
      // repos frequently track unrelated large media (test fixtures, demos,
      // docs videos) via LFS. Downloading those during clone adds tens or
      // hundreds of MB of bandwidth for files the installer never reads, and
      // is the main reason `skills add` times out against larger registries
      // (e.g. heygen-com/hyperframes, see upstream report #300).
      GIT_LFS_SKIP_SMUDGE: '1',
    },
  });
  const cloneOptions = ref ? ['--depth', '1', '--branch', ref] : ['--depth', '1'];

  try {
    await git.clone(url, tempDir, cloneOptions);
    return tempDir;
  } catch (error) {
    // Clean up temp dir on failure
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});

    const errorMessage = error instanceof Error ? error.message : String(error);
    const isTimeout = errorMessage.includes('block timeout') || errorMessage.includes('timed out');
    const isAuthError =
      errorMessage.includes('Authentication failed') ||
      errorMessage.includes('could not read Username') ||
      errorMessage.includes('Permission denied') ||
      errorMessage.includes('Repository not found');

    if (isTimeout) {
      throw new GitCloneError(
        `克隆在60秒后超时。这通常发生在需要认证的私有仓库上。\n` +
          `  确保您有访问权限且 SSH 密钥或凭据已配置:\n` +
          `  - SSH: ssh-add -l (检查已加载的密钥)\n` +
          `  - HTTPS: gh auth status (如果使用 GitHub CLI)`,
        url,
        true,
        false
      );
    }

    if (isAuthError) {
      throw new GitCloneError(
        `${url} 认证失败。\n` +
          `  - 对于私有仓库，确保您有访问权限\n` +
          `  - SSH: 使用 'ssh -T git@github.com' 检查密钥\n` +
          `  - HTTPS: 运行 'gh auth login' 或配置 git 凭据`,
        url,
        false,
        true
      );
    }

    throw new GitCloneError(`克隆 ${url} 失败: ${errorMessage}`, url, false, false);
  }
}

export async function cleanupTempDir(dir: string): Promise<void> {
  // Validate that the directory path is within tmpdir to prevent deletion of arbitrary paths
  const normalizedDir = normalize(resolve(dir));
  const normalizedTmpDir = normalize(resolve(tmpdir()));

  if (!normalizedDir.startsWith(normalizedTmpDir + sep) && normalizedDir !== normalizedTmpDir) {
    throw new Error('Attempted to clean up directory outside of temp directory');
  }

  await rm(dir, { recursive: true, force: true });
}
