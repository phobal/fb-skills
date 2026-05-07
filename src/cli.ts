#!/usr/bin/env node

import { spawnSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { basename, join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import * as p from '@clack/prompts';
import { runAdd, parseAddOptions, initTelemetry } from './add.ts';
import { runFind } from './find.ts';
import { runInstallFromLock } from './install.ts';
import { runList } from './list.ts';
import { removeCommand, parseRemoveOptions } from './remove.ts';
import { sanitizeMetadata } from './sanitize.ts';
import { runSync, parseSyncOptions } from './sync.ts';
import { track } from './telemetry.ts';
import { fetchSkillFolderHash, getGitHubToken } from './skill-lock.ts';
import { readLocalLock, type LocalSkillLockEntry } from './local-lock.ts';
import {
  buildUpdateInstallSource,
  buildLocalUpdateSource,
  formatSourceInput,
} from './update-source.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

function getVersion(): string {
  try {
    const pkgPath = join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

const VERSION = getVersion();
initTelemetry(VERSION);

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
// 256-color grays - visible on both light and dark backgrounds
const DIM = '\x1b[38;5;102m'; // darker gray for secondary text
const TEXT = '\x1b[38;5;145m'; // lighter gray for primary text

const LOGO_LINES = [
  '███████╗██╗  ██╗██╗██╗     ██╗     ███████╗',
  '██╔════╝██║ ██╔╝██║██║     ██║     ██╔════╝',
  '███████╗█████╔╝ ██║██║     ██║     ███████╗',
  '╚════██║██╔═██╗ ██║██║     ██║     ╚════██║',
  '███████║██║  ██╗██║███████╗███████╗███████║',
  '╚══════╝╚═╝  ╚═╝╚═╝╚══════╝╚══════╝╚══════╝',
];

// 256-color middle grays - visible on both light and dark backgrounds
const GRAYS = [
  '\x1b[38;5;250m', // lighter gray
  '\x1b[38;5;248m',
  '\x1b[38;5;245m', // mid gray
  '\x1b[38;5;243m',
  '\x1b[38;5;240m',
  '\x1b[38;5;238m', // darker gray
];

function showLogo(): void {
  console.log();
  LOGO_LINES.forEach((line, i) => {
    console.log(`${GRAYS[i]}${line}${RESET}`);
  });
}

function showBanner(): void {
  showLogo();
  console.log();
  console.log(`${DIM}开放 agent 技能生态系统${RESET}`);
  console.log();
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx skills add ${DIM}<package>${RESET}        ${DIM}添加新技能${RESET}`
  );
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx skills remove${RESET}               ${DIM}移除已安装的技能${RESET}`
  );
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx skills list${RESET}                 ${DIM}列出已安装的技能${RESET}`
  );
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx skills find ${DIM}[query]${RESET}         ${DIM}搜索技能${RESET}`
  );
  console.log();
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx skills update${RESET}               ${DIM}更新已安装的技能${RESET}`
  );
  console.log();
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx skills experimental_install${RESET} ${DIM}从 skills-lock.json 恢复${RESET}`
  );
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx skills init ${DIM}[name]${RESET}          ${DIM}创建新技能${RESET}`
  );
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx skills experimental_sync${RESET}    ${DIM}从 node_modules 同步技能${RESET}`
  );
  console.log();
  console.log(`${DIM}试试:${RESET} npx skills add vercel-labs/agent-skills`);
  console.log();
  console.log(`探索更多技能：${TEXT}https://skills.sh/${RESET}`);
  console.log();
}

function showHelp(): void {
  console.log(`
${BOLD}用法:${RESET} skills <command> [options]

${BOLD}管理技能:${RESET}
  add <package>        添加技能包 (别名: a)
                       例如 vercel-labs/agent-skills
                            https://github.com/vercel-labs/agent-skills
  remove [skills]      移除已安装的技能
  list, ls             列出已安装的技能
  find [query]         交互式搜索技能

${BOLD}更新:${RESET}
  update [skills...]   更新技能到最新版本 (别名: upgrade)

${BOLD}更新选项:${RESET}
  -g, --global           仅更新全局技能
  -p, --project          仅更新项目技能
  -y, --yes              跳过范围提示 (自动检测：在项目中则项目，否则全局)

${BOLD}项目:{RESET}
  experimental_install 从 skills-lock.json 恢复技能
  init [name]           初始化一个技能 (创建 <name>/SKILL.md 或 ./SKILL.md)
  experimental_sync     从 node_modules 同步技能到 agent 目录

${BOLD}添加选项:${RESET}
  -g, --global           全局安装 (用户级) 而非项目级
  -a, --agent <agents>   指定安装到的 agents (使用 '*' 表示所有 agents)
  -s, --skill <skills>   指定要安装的技能名称 (使用 '*' 表示所有技能)
  -l, --list             列出仓库中可用的技能而不安装
  -y, --yes              跳过确认提示
  --copy                 复制文件而非符号链接到 agent 目录
  --all                  等同于 --skill '*' --agent '*' -y
  --full-depth           当存在根 SKILL.md 时仍搜索所有子目录

${BOLD}移除选项:${RESET}
  -g, --global           从全局范围移除
  -a, --agent <agents>   从指定 agents 移除 (使用 '*' 表示所有 agents)
  -s, --skill <skills>   指定要移除的技能 (使用 '*' 表示所有技能)
  -y, --yes              跳过确认提示
  --all                  等同于 --skill '*' --agent '*' -y

${BOLD}实验性同步选项:${RESET}
  -a, --agent <agents>   指定安装到的 agents (使用 '*' 表示所有 agents)
  -y, --yes              跳过确认提示

${BOLD}列表选项:${RESET}
  -g, --global           列出全局技能 (默认: 项目)
  -a, --agent <agents>   按 agents 过滤
  --json                 JSON 输出 (机器可读，无 ANSI 代码)

${BOLD}选项:${RESET}
  --help, -h        显示此帮助信息
  --version, -v     显示版本号

${BOLD}示例:${RESET}
  ${DIM}$${RESET} skills add vercel-labs/agent-skills
  ${DIM}$${RESET} skills add vercel-labs/agent-skills -g
  ${DIM}$${RESET} skills add vercel-labs/agent-skills --agent claude-code cursor
  ${DIM}$${RESET} skills add vercel-labs/agent-skills --skill pr-review commit
  ${DIM}$${RESET} skills remove                        ${DIM}# 交互式移除${RESET}
  ${DIM}$${RESET} skills remove web-design             ${DIM}# 按名称移除${RESET}
  ${DIM}$${RESET} skills rm --global frontend-design
  ${DIM}$${RESET} skills list                          ${DIM}# 列出项目技能${RESET}
  ${DIM}$${RESET} skills ls -g                         ${DIM}# 列出全局技能${RESET}
  ${DIM}$${RESET} skills ls -a claude-code             ${DIM}# 按 agent 过滤${RESET}
  ${DIM}$${RESET} skills ls --json                      ${DIM}# JSON 输出${RESET}
  ${DIM}$${RESET} skills find                          ${DIM}# 交互式搜索${RESET}
  ${DIM}$${RESET} skills find typescript               ${DIM}# 按关键词搜索${RESET}
  ${DIM}$${RESET} skills update
  ${DIM}$${RESET} skills update my-skill             ${DIM}# 更新单个技能${RESET}
  ${DIM}$${RESET} skills update -g                    ${DIM}# 仅更新全局技能${RESET}
  ${DIM}$${RESET} skills experimental_install            ${DIM}# 从 skills-lock.json 恢复${RESET}
  ${DIM}$${RESET} skills init my-skill
  ${DIM}$${RESET} skills experimental_sync              ${DIM}# 从 node_modules 同步${RESET}
  ${DIM}$${RESET} skills experimental_sync -y           ${DIM}# 无提示同步${RESET}

探索更多技能：${TEXT}https://skills.sh/${RESET}
`);
}

function showRemoveHelp(): void {
  console.log(`
${BOLD}用法:${RESET} skills remove [skills...] [options]

${BOLD}描述:${RESET}
  从 agents 移除已安装的技能。如果未提供技能名称，
  将显示交互式选择菜单。

${BOLD}参数:${RESET}
  skills            可选的要移除的技能名称 (空格分隔)

${BOLD}选项:${RESET}
  -g, --global       从全局范围 (~/) 移除而非项目范围
  -a, --agent        从指定 agents 移除 (使用 '*' 表示所有 agents)
  -s, --skill        指定要移除的技能 (使用 '*' 表示所有技能)
  -y, --yes          跳过确认提示
  --all              等同于 --skill '*' --agent '*' -y

${BOLD}示例:${RESET}
  ${DIM}$${RESET} skills remove                           ${DIM}# 交互式选择${RESET}
  ${DIM}$${RESET} skills remove my-skill                   ${DIM}# 移除特定技能${RESET}
  ${DIM}$${RESET} skills remove skill1 skill2 -y           ${DIM}# 移除多个技能${RESET}
  ${DIM}$${RESET} skills remove --global my-skill          ${DIM}# 从全局范围移除${RESET}
  ${DIM}$${RESET} skills rm --agent claude-code my-skill   ${DIM}# 从特定 agent 移除${RESET}
  ${DIM}$${RESET} skills remove --all                      ${DIM}# 移除所有技能${RESET}
  ${DIM}$${RESET} skills remove --skill '*' -a cursor      ${DIM}# 从 cursor 移除所有技能${RESET}

探索更多技能：${TEXT}https://skills.sh/${RESET}
`);
}

function runInit(args: string[]): void {
  const cwd = process.cwd();
  const skillName = args[0] || basename(cwd);
  const hasName = args[0] !== undefined;

  const skillDir = hasName ? join(cwd, skillName) : cwd;
  const skillFile = join(skillDir, 'SKILL.md');
  const displayPath = hasName ? `${skillName}/SKILL.md` : 'SKILL.md';

  if (existsSync(skillFile)) {
    console.log(`${TEXT}技能已存在于此路径 ${DIM}${displayPath}${RESET}`);
    return;
  }

  if (hasName) {
    mkdirSync(skillDir, { recursive: true });
  }

  const skillContent = `---
name: ${skillName}
description: A brief description of what this skill does
---

# ${skillName}

Instructions for the agent to follow when this skill is activated.

## When to use

Describe when this skill should be used.

## Instructions

1. First step
2. Second step
3. Additional steps as needed
`;

  writeFileSync(skillFile, skillContent);

  console.log(`${TEXT}已初始化技能: ${DIM}${skillName}${RESET}`);
  console.log();
  console.log(`${DIM}已创建:${RESET}`);
  console.log(`  ${displayPath}`);
  console.log();
  console.log(`${DIM}下一步:${RESET}`);
  console.log(`  1. 编辑 ${TEXT}${displayPath}${RESET} 来定义你的技能指令`);
  console.log(`  2. 更新前言中的 ${TEXT}name${RESET} 和 ${TEXT}description${RESET}`);
  console.log();
  console.log(`${DIM}发布:${RESET}`);
  console.log(
    `  ${DIM}GitHub:${RESET}  推送到仓库，然后 ${TEXT}npx skills add <owner>/<repo>${RESET}`
  );
  console.log(
    `  ${DIM}URL:${RESET}     托管文件，然后 ${TEXT}npx skills add https://example.com/${displayPath}${RESET}`
  );
  console.log();
  console.log(`在 ${TEXT}https://skills.sh/${RESET} 浏览现有技能获取灵感`);
  console.log();
}

// ============================================
// Check and Update Commands
// ============================================

const AGENTS_DIR = '.agents';
const LOCK_FILE = '.skill-lock.json';
const CURRENT_LOCK_VERSION = 3; // Bumped from 2 to 3 for folder hash support

interface SkillLockEntry {
  source: string;
  sourceType: string;
  sourceUrl: string;
  ref?: string;
  skillPath?: string;
  /** GitHub tree SHA for the entire skill folder (v3) */
  skillFolderHash: string;
  installedAt: string;
  updatedAt: string;
}

interface SkillLockFile {
  version: number;
  skills: Record<string, SkillLockEntry>;
}

function getSkillLockPath(): string {
  const xdgStateHome = process.env.XDG_STATE_HOME;
  if (xdgStateHome) {
    return join(xdgStateHome, 'skills', LOCK_FILE);
  }
  return join(homedir(), AGENTS_DIR, LOCK_FILE);
}

function readSkillLock(): SkillLockFile {
  const lockPath = getSkillLockPath();
  try {
    const content = readFileSync(lockPath, 'utf-8');
    const parsed = JSON.parse(content) as SkillLockFile;
    if (typeof parsed.version !== 'number' || !parsed.skills) {
      return { version: CURRENT_LOCK_VERSION, skills: {} };
    }
    // If old version, wipe and start fresh (backwards incompatible change)
    // v3 adds skillFolderHash - we want fresh installs to populate it
    if (parsed.version < CURRENT_LOCK_VERSION) {
      return { version: CURRENT_LOCK_VERSION, skills: {} };
    }
    return parsed;
  } catch {
    return { version: CURRENT_LOCK_VERSION, skills: {} };
  }
}

// ============================================
// Scope Detection and Prompt
// ============================================

type UpdateScope = 'project' | 'global' | 'both';

interface UpdateCheckOptions {
  global?: boolean;
  project?: boolean;
  yes?: boolean;
  /** Optional skill name(s) to filter on (positional args) */
  skills?: string[];
}

function parseUpdateOptions(args: string[]): UpdateCheckOptions {
  const options: UpdateCheckOptions = {};
  const positional: string[] = [];
  for (const arg of args) {
    if (arg === '-g' || arg === '--global') {
      options.global = true;
    } else if (arg === '-p' || arg === '--project') {
      options.project = true;
    } else if (arg === '-y' || arg === '--yes') {
      options.yes = true;
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }
  if (positional.length > 0) {
    options.skills = positional;
  }
  return options;
}

/**
 * Check whether the current working directory has project-level skills.
 * Returns true if either:
 * - skills-lock.json exists in cwd, OR
 * - .agents/skills/ contains at least one subdirectory with a SKILL.md
 */
function hasProjectSkills(cwd?: string): boolean {
  const dir = cwd || process.cwd();

  // Check 1: skills-lock.json exists
  const lockPath = join(dir, 'skills-lock.json');
  if (existsSync(lockPath)) {
    return true;
  }

  // Check 2: .agents/skills/ has at least one skill
  const skillsDir = join(dir, '.agents', 'skills');
  try {
    const entries = readdirSync(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillMd = join(skillsDir, entry.name, 'SKILL.md');
        if (existsSync(skillMd)) {
          return true;
        }
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return false;
}

/**
 * Determine the update/check scope via interactive prompt or auto-detection.
 *
 * Interactive mode (default):
 *   Shows a prompt with Project / Global / Both options.
 *
 * Non-interactive mode (-y flag or non-TTY):
 *   If cwd has project-level skills → 'project'
 *   Otherwise → 'global'
 *
 * Explicit flags override everything:
 *   -g → 'global'
 *   -p → 'project'
 *   -g -p → 'both'
 */
async function resolveUpdateScope(options: UpdateCheckOptions): Promise<UpdateScope> {
  // When targeting specific skills, search both scopes to find them
  if (options.skills && options.skills.length > 0) {
    if (options.global) return 'global';
    if (options.project) return 'project';
    return 'both';
  }

  // Explicit flags take precedence
  if (options.global && options.project) {
    return 'both';
  }
  if (options.global) {
    return 'global';
  }
  if (options.project) {
    return 'project';
  }

  // Non-interactive auto-detection
  if (options.yes || !process.stdin.isTTY) {
    return hasProjectSkills() ? 'project' : 'global';
  }

  // Interactive prompt
  const scope = await p.select({
    message: '更新范围',
    options: [
      {
        value: 'project' as UpdateScope,
        label: '项目',
        hint: '更新当前目录中的技能',
      },
      {
        value: 'global' as UpdateScope,
        label: '全局',
        hint: '更新主目录中的技能',
      },
      {
        value: 'both' as UpdateScope,
        label: '全部',
        hint: '更新所有技能',
      },
    ],
  });

  if (p.isCancel(scope)) {
    p.cancel('已取消');
    process.exit(0);
  }

  return scope as UpdateScope;
}

/**
 * Check if a skill name matches any of the filter names (case-insensitive).
 * Returns true if no filter is set (match all).
 */
function matchesSkillFilter(name: string, filter?: string[]): boolean {
  if (!filter || filter.length === 0) return true;
  const lower = name.toLowerCase();
  return filter.some((f) => f.toLowerCase() === lower);
}

interface SkippedSkill {
  name: string;
  reason: string;
  sourceUrl: string;
  sourceType: string;
  ref?: string;
}

/**
 * Determine why a skill cannot be checked for updates automatically.
 */
function getSkipReason(entry: SkillLockEntry): string {
  if (entry.sourceType === 'local') {
    return '本地路径';
  }
  if (entry.sourceType === 'git') {
    return 'Git URL';
  }
  if (entry.sourceType === 'well-known') {
    return '已知技能';
  }
  if (!entry.skillFolderHash) {
    return '私有或已删除的仓库';
  }
  if (!entry.skillPath) {
    return '未记录技能路径';
  }
  return '无版本跟踪';
}

/**
 * For well-known skills, strip the .well-known/... path and /SKILL.md suffix
 * to produce the base URL the user originally used to install.
 * e.g., "https://mintlify.com/docs/.well-known/skills/mintlify/SKILL.md"
 *    -> "https://mintlify.com/docs"
 */
function getInstallSource(skill: SkippedSkill): string {
  let url = skill.sourceUrl;
  if (skill.sourceType === 'well-known') {
    // Strip everything from /.well-known/ onwards
    const idx = url.indexOf('/.well-known/');
    if (idx !== -1) {
      url = url.slice(0, idx);
    }
  }
  return formatSourceInput(url, skill.ref);
}

/**
 * Print a list of skills that cannot be checked automatically,
 * with the reason and a manual update command for each.
 * Skills from the same source are grouped together.
 */
function printSkippedSkills(skipped: SkippedSkill[]): void {
  if (skipped.length === 0) return;
  console.log();
  console.log(`${DIM}${skipped.length} 个技能无法自动检查:${RESET}`);

  // Group by install source to dedupe skills from the same repo
  const grouped = new Map<string, SkippedSkill[]>();
  for (const skill of skipped) {
    const source = getInstallSource(skill);
    const existing = grouped.get(source) || [];
    existing.push(skill);
    grouped.set(source, existing);
  }

  for (const [source, skills] of grouped) {
    if (skills.length === 1) {
      const skill = skills[0]!;
      console.log(
        `  ${TEXT}•${RESET} ${sanitizeMetadata(skill.name)} ${DIM}(${skill.reason})${RESET}`
      );
    } else {
      const reason = skills[0]!.reason;
      const names = skills.map((s) => sanitizeMetadata(s.name)).join(', ');
      console.log(`  ${TEXT}•${RESET} ${names} ${DIM}(${reason})${RESET}`);
    }
    console.log(`    ${DIM}更新方法: ${TEXT}npx skills add ${source} -g -y${RESET}`);
  }
}

// ============================================
// Project Skills Discovery
// ============================================

async function getProjectSkillsForUpdate(
  skillFilter?: string[]
): Promise<Array<{ name: string; source: string; entry: LocalSkillLockEntry }>> {
  const localLock = await readLocalLock();
  const skills: Array<{ name: string; source: string; entry: LocalSkillLockEntry }> = [];

  for (const [name, entry] of Object.entries(localLock.skills)) {
    if (!matchesSkillFilter(name, skillFilter)) continue;
    // Skip node_modules and local path skills - they are managed by sync/manually
    if (entry.sourceType === 'node_modules' || entry.sourceType === 'local') {
      continue;
    }
    skills.push({ name, source: entry.source, entry });
  }

  return skills;
}

// ============================================
// Update: Global Skills
// ============================================

async function updateGlobalSkills(
  skillFilter?: string[]
): Promise<{ successCount: number; failCount: number; checkedCount: number }> {
  const lock = readSkillLock();
  const skillNames = Object.keys(lock.skills);
  let successCount = 0;
  let failCount = 0;

  if (skillNames.length === 0) {
    if (!skillFilter) {
      console.log(`${DIM}锁定文件中没有跟踪的全局技能。${RESET}`);
      console.log(`${DIM}使用${RESET} ${TEXT}npx skills add <package> -g${RESET} 安装技能`);
    }
    return { successCount, failCount, checkedCount: 0 };
  }

  const token = getGitHubToken();
  const updates: Array<{ name: string; source: string; entry: SkillLockEntry }> = [];
  const skipped: SkippedSkill[] = [];
  const checkable: Array<{ name: string; entry: SkillLockEntry }> = [];

  for (const skillName of skillNames) {
    if (!matchesSkillFilter(skillName, skillFilter)) continue;

    const entry = lock.skills[skillName];
    if (!entry) continue;

    if (!entry.skillFolderHash || !entry.skillPath) {
      skipped.push({
        name: skillName,
        reason: getSkipReason(entry),
        sourceUrl: entry.sourceUrl,
        sourceType: entry.sourceType,
        ref: entry.ref,
      });
      continue;
    }

    checkable.push({ name: skillName, entry });
  }

  for (let i = 0; i < checkable.length; i++) {
    const { name: skillName, entry } = checkable[i]!;
    process.stdout.write(
      `\r${DIM}正在检查全局技能 ${i + 1}/${checkable.length}: ${sanitizeMetadata(skillName)}${RESET}\x1b[K`
    );

    try {
      const latestHash = await fetchSkillFolderHash(
        entry.source,
        entry.skillPath!,
        token,
        entry.ref
      );
      if (latestHash && latestHash !== entry.skillFolderHash) {
        updates.push({ name: skillName, source: entry.source, entry });
      }
    } catch {
      // Skip skills that fail to check
    }
  }

  if (checkable.length > 0) {
    process.stdout.write('\r\x1b[K');
  }

  const checkedCount = checkable.length + skipped.length;

  if (checkable.length === 0 && skipped.length === 0) {
    if (!skillFilter) {
      console.log(`${DIM}没有可检查的全局技能。${RESET}`);
    }
    return { successCount, failCount, checkedCount: 0 };
  }

  if (checkable.length === 0 && skipped.length > 0) {
    printSkippedSkills(skipped);
    return { successCount, failCount, checkedCount };
  }

  if (updates.length === 0) {
    console.log(`${TEXT}✓ 所有全局技能都是最新版本${RESET}`);
    return { successCount, failCount, checkedCount };
  }

  console.log(`${TEXT}发现 ${updates.length} 个全局更新${RESET}`);
  console.log();

  for (const update of updates) {
    const safeName = sanitizeMetadata(update.name);
    console.log(`${TEXT}正在更新 ${safeName}...${RESET}`);
    const installUrl = buildUpdateInstallSource(update.entry);

    const cliEntry = join(__dirname, '..', 'bin', 'cli.mjs');
    if (!existsSync(cliEntry)) {
      failCount++;
      console.log(`  ${DIM}✗ 更新 ${safeName} 失败: 未在 ${cliEntry} 找到 CLI 入口${RESET}`);
      continue;
    }
    const result = spawnSync(process.execPath, [cliEntry, 'add', installUrl, '-g', '-y'], {
      stdio: ['inherit', 'pipe', 'pipe'],
      encoding: 'utf-8',
      shell: process.platform === 'win32',
    });

    if (result.status === 0) {
      successCount++;
      console.log(`  ${TEXT}✓${RESET} 已更新 ${safeName}`);
    } else {
      failCount++;
      console.log(`  ${DIM}✗ 更新 ${safeName} 失败${RESET}`);
    }
  }

  printSkippedSkills(skipped);
  return { successCount, failCount, checkedCount };
}

// ============================================
// Update: Project Skills
// ============================================

async function updateProjectSkills(
  skillFilter?: string[]
): Promise<{ successCount: number; failCount: number; foundCount: number }> {
  const projectSkills = await getProjectSkillsForUpdate(skillFilter);
  let successCount = 0;
  let failCount = 0;

  if (projectSkills.length === 0) {
    if (!skillFilter) {
      console.log(`${DIM}没有要更新的项目技能。${RESET}`);
      console.log(`${DIM}使用${RESET} ${TEXT}npx skills add <package>${RESET} 安装项目技能`);
    }
    return { successCount, failCount, foundCount: 0 };
  }

  console.log(`${TEXT}正在刷新 ${projectSkills.length} 个项目技能...${RESET}`);
  console.log();

  for (const skill of projectSkills) {
    const safeName = sanitizeMetadata(skill.name);
    console.log(`${TEXT}正在更新 ${safeName}...${RESET}`);
    const installUrl = buildLocalUpdateSource(skill.entry);

    const cliEntry = join(__dirname, '..', 'bin', 'cli.mjs');
    if (!existsSync(cliEntry)) {
      failCount++;
      console.log(`  ${DIM}✗ 更新 ${safeName} 失败: 未在 ${cliEntry} 找到 CLI 入口${RESET}`);
      continue;
    }

    // Re-clone without -g to install at project scope
    const result = spawnSync(process.execPath, [cliEntry, 'add', installUrl, '-y'], {
      stdio: ['inherit', 'pipe', 'pipe'],
      encoding: 'utf-8',
      shell: process.platform === 'win32',
    });

    if (result.status === 0) {
      successCount++;
      console.log(`  ${TEXT}✓${RESET} 已更新 ${safeName}`);
    } else {
      failCount++;
      console.log(`  ${DIM}✗ 更新 ${safeName} 失败${RESET}`);
    }
  }

  return { successCount, failCount, foundCount: projectSkills.length };
}

// ============================================
// runUpdate
// ============================================

async function runUpdate(args: string[] = []): Promise<void> {
  const options = parseUpdateOptions(args);
  const scope = await resolveUpdateScope(options);

  if (options.skills) {
    console.log(`${TEXT}正在更新 ${options.skills.join(', ')}...${RESET}`);
  } else {
    console.log(`${TEXT}正在检查技能更新...${RESET}`);
  }
  console.log();

  let totalSuccess = 0;
  let totalFail = 0;
  let totalFound = 0;

  // ---- Global update ----
  if (scope === 'global' || scope === 'both') {
    if (scope === 'both' && !options.skills) {
      console.log(`${BOLD}全局技能${RESET}`);
    }
    const { successCount, failCount, checkedCount } = await updateGlobalSkills(options.skills);
    totalSuccess += successCount;
    totalFail += failCount;
    totalFound += checkedCount;
    if (scope === 'both' && !options.skills) {
      console.log();
    }
  }

  // ---- Project update ----
  if (scope === 'project' || scope === 'both') {
    if (scope === 'both' && !options.skills) {
      console.log(`${BOLD}项目技能${RESET}`);
    }
    const { successCount, failCount, foundCount } = await updateProjectSkills(options.skills);
    totalSuccess += successCount;
    totalFail += failCount;
    totalFound += foundCount;
  }

  // If filtering by name and nothing was found anywhere, tell the user
  if (options.skills && totalFound === 0) {
    console.log(`${DIM}未找到匹配的已安装技能: ${options.skills.join(', ')}${RESET}`);
  }

  console.log();
  if (totalSuccess > 0) {
    console.log(`${TEXT}✓ 已更新 ${totalSuccess} 个技能${RESET}`);
  }
  if (totalFail > 0) {
    console.log(`${DIM}更新 ${totalFail} 个技能失败${RESET}`);
  }
  if (totalSuccess === 0 && totalFail === 0) {
    // No updates found/attempted - the sub-functions already printed their messages
  }

  // Track telemetry
  track({
    event: 'update',
    scope,
    skillCount: String(totalSuccess + totalFail),
    successCount: String(totalSuccess),
    failCount: String(totalFail),
  });

  console.log();
}

// ============================================
// Main
// ============================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    showBanner();
    return;
  }

  const command = args[0];
  const restArgs = args.slice(1);

  switch (command) {
    case 'find':
    case 'search':
    case 'f':
    case 's':
      showLogo();
      console.log();
      await runFind(restArgs);
      break;
    case 'init':
      showLogo();
      console.log();
      runInit(restArgs);
      break;
    case 'experimental_install': {
      showLogo();
      await runInstallFromLock(restArgs);
      break;
    }
    case 'i':
    case 'install':
    case 'a':
    case 'add': {
      showLogo();
      const { source: addSource, options: addOpts } = parseAddOptions(restArgs);
      await runAdd(addSource, addOpts);
      break;
    }
    case 'remove':
    case 'rm':
    case 'r':
      // Check for --help or -h flag
      if (restArgs.includes('--help') || restArgs.includes('-h')) {
        showRemoveHelp();
        break;
      }
      const { skills, options: removeOptions } = parseRemoveOptions(restArgs);
      await removeCommand(skills, removeOptions);
      break;
    case 'experimental_sync': {
      showLogo();
      const { options: syncOptions } = parseSyncOptions(restArgs);
      await runSync(restArgs, syncOptions);
      break;
    }
    case 'list':
    case 'ls':
      await runList(restArgs);
      break;
    case 'check':
    case 'update':
    case 'upgrade':
      await runUpdate(restArgs);
      break;
    case '--help':
    case '-h':
      showHelp();
      break;
    case '--version':
    case '-v':
      console.log(VERSION);
      break;

    default:
      console.log(`未知命令: ${command}`);
      console.log(`运行 ${BOLD}skills --help${RESET} 查看用法。`);
  }
}

main();
