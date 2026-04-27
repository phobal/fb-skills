# fb-skills 自定义服务器使用指南

## 简介

本项目修改了 [vercel-labs/skills](https://github.com/vercel-labs/skills) 以支持从自定义服务器下载 skills，无需每次在命令行指定服务器地址。

## 配置

### 1. 创建 .env 文件

在根目录下创建或编辑 `.env` 文件：

```bash
CUSTOME_SKILLS_SERVER_BASE_URL=http://localhost:8000
```

### 2. 构建项目

```bash
pnpm install
pnpm build
```

## 使用方式

### 基本语法

```bash
# 完整语法：author/name@version
npx fb-skills add twinsgeeks/adopt-a-kraken@1.0.3

# 省略版本号（默认 1.0.0）
npx fb-skills add twinsgeeks/adopt-a-kraken

# 配合全局安装
npx fb-skills add twinsgeeks/adopt-a-kraken -g

# 跳过确认提示
npx fb-skills add twinsgeeks/adopt-a-kraken -y
```

### 命令行选项

| 选项 | 说明 |
|------|------|
| `-g, --global` | 全局安装（安装到用户主目录） |
| `-y, --yes` | 跳过所有确认提示 |
| `-a, --agent <agents>` | 指定要安装到的 agent |
| `-s, --skill <skills>` | 指定要安装的 skill |
| `--copy` | 使用复制模式而非符号链接 |
| `--all` | 安装所有 skills 到所有 agents |

### 安装流程

1. **下载 skill**：从配置的服务器下载 ZIP 并解压
2. **选择 agents**：如果检测到多个 agent，会提示选择
3. **选择安装范围**：Project（项目目录）或 Global（全局）
4. **选择安装方式**：Symlink（符号链接）或 Copy（复制）
5. **确认并安装**：显示安装摘要，确认后执行

## 与原有功能的兼容性

以下原有命令保持不变：

```bash
# 从 GitHub 安装
npx fb-skills add vercel-labs/agent-skills

# 指定具体 skill
npx fb-skills add vercel-labs/agent-skills -s my-skill

# 从 URL 安装
npx fb-skills add http://example.com/skills

# 本地路径
npx fb-skills add ./my-local-skills
```

## 后端 API 要求

服务器需要提供以下接口：

### 1. 下载 skill ZIP

```
GET /api/public/skills/download/{author}/{skill}
GET /api/public/skills/download/{author}/{skill}/{version}
```

**响应**：
- `Content-Type: application/zip`
- 返回 skill 目录的 ZIP 压缩包

**响应示例**：
```
Content-Disposition: attachment; filename=adopt-a-kraken.zip
Content-Type: application/zip

[ZIP 二进制内容]
```

### 2. rebuild-index 接口

用于重建 `static/.well-known/agent-skills/` 目录：

```
POST /api/admin/skills/rebuild-index
```

### 目录结构

服务器上的 skills 目录结构：

```
static/.well-known/agent-skills/
├── author1/
│   ├── skill-name-1-0-0/
│   │   ├── SKILL.md
│   │   └── README.md
│   └── another-skill-2-0-1/
│       └── ...
├── author2/
│   └── ...
└── index.json
```

`index.json` 格式：

```json
{
  "skills": [
    {
      "name": "author1/skill-name-1-0-0",
      "description": "...",
      "files": ["SKILL.md", "README.md"],
      "skill_id": 1
    }
  ]
}
```

## 故障排除

### 下载失败

1. 确认服务器正在运行：`curl http://localhost:8000/api/public/skills/download/twinsgeeks/adopt-a-kraken`
2. 检查 `.env` 中的 URL 是否正确
3. 确认 skill 目录存在于服务器上

### 构建失败

1. 确认 `.env` 文件存在且格式正确
2. 重新安装依赖：`pnpm install`
3. 清除缓存后重新构建：`rm -rf dist node_modules/.cache && pnpm build`

## 示例项目

参考 `e:\Code\420-project` 后端项目，它提供了完整的 skill 服务器实现。
