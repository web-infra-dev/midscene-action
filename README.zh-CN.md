<h1 align="center">Midscene GitHub Action</h1>

<p align="center">
  <a href="https://github.com/web-infra-dev/midscene-action/actions/workflows/ci.yml"><img src="https://github.com/web-infra-dev/midscene-action/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/web-infra-dev/midscene-action/tags"><img src="https://img.shields.io/github/v/tag/web-infra-dev/midscene-action?label=version&amp;sort=semver" alt="Latest version"></a>
  <a href="LICENSE.md"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
</p>

<p align="center"><a href="README.md">English</a> | 简体中文</p>

在 GitHub Actions 中运行 [Midscene Test](https://midscenejs.com/zh/midscene-test/overview.html) 测试，下载或分享测试报告。

## 功能

- 在工作流摘要中查看测试结果。
- 将 HTML 报告和测试数据保存为 Artifacts，供下载查看。
- 按需将报告发布到 Cloudflare Workers，每次运行都有独立链接。

## 示例

- [Basic](.github/workflows/example-basic.yml)：使用 AI 提交问候表单并检查结果。
- [TodoMVC](.github/workflows/example-todomvc.yml)：使用 AI 管理待办事项，并通过自定义 Node 验证结果。
- [ExternalAssets](.github/workflows/example-external-assets.yml)：通过无需模型的简单测试生成 `html-and-external-assets` 报告。

## 使用方法

在工作流中添加此 Action：

```yaml
- uses: web-infra-dev/midscene-action@v1
  with:
    working-directory: tests/midscene
```

默认执行 `npx midscene-test`；如需使用 `npm test` 等其他测试命令，可设置 `command`。

运行 Action 前，请安装测试依赖和浏览器、配置模型，并按需启动待测应用。

### 工作流示例

以下示例适用于位于 `tests/midscene` 的 Playwright 测试项目：

```yaml
name: Midscene E2E Tests

on:
  push:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    env:
      MIDSCENE_MODEL_API_KEY: ${{ secrets.MIDSCENE_MODEL_API_KEY }}
      MIDSCENE_MODEL_NAME: ${{ vars.MIDSCENE_MODEL_NAME }}
      MIDSCENE_MODEL_FAMILY: ${{ vars.MIDSCENE_MODEL_FAMILY }}
      MIDSCENE_MODEL_BASE_URL: ${{ vars.MIDSCENE_MODEL_BASE_URL }}
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: '24'
      - name: Install dependencies and browser
        working-directory: tests/midscene
        run: |
          npm ci
          npx playwright install --with-deps chromium
      - name: Run Midscene tests
        id: midscene
        uses: web-infra-dev/midscene-action@v1
        with:
          working-directory: tests/midscene
          command: npm test
```

在仓库的 **Settings → Secrets and variables → Actions** 中配置上述模型 Secret 和变量。

## 输入参数

完整定义见 [action.yml](action.yml)。

| 参数                     | 是否必填   | 默认值              | 说明                                                                   |
| ------------------------ | ---------- | ------------------- | ---------------------------------------------------------------------- |
| `working-directory`      | 是         | 无                  | 测试项目目录，相对于工作区。仓库根目录填 `.`。                         |
| `command`                | 否         | `npx midscene-test` | 在 Bash 中运行 Midscene 测试的命令，可按需改为 `npm test` 等项目脚本。 |
| `artifact-name`          | 否         | `midscene-results`  | Artifact 名称，同一次工作流运行中必须唯一。                            |
| `retention-days`         | 否         | `14`                | Artifact 的保留天数。                                                  |
| `publish-pages`          | 否         | `false`             | 设为 `true` 时将报告发布到 Cloudflare Workers。                        |
| `cloudflare-api-token`   | 发布时必填 | 无                  | Cloudflare API Token，通过 GitHub Actions Secret 传入。                |
| `cloudflare-account-id`  | 发布时必填 | 无                  | Cloudflare 账号 ID。                                                   |
| `cloudflare-worker-name` | 否         | `midscene-reports`  | Worker 名称。不存在时，若 Token 有相应权限，Action 会自动创建。        |

## 发布报告到 Cloudflare Workers

设置 `publish-pages: true`，将报告发布到 Cloudflare Workers。每次运行都会生成独立的 Preview 链接，并显示在工作流摘要中。

- **免费托管**：静态文件的存储和访问不收费。[计费说明](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)
- **保留上限**：免费方案每个 Worker 最多保留 100 个 Preview。达到上限时，Cloudflare 会删除最久未部署的 Preview。[限制说明](https://developers.cloudflare.com/workers/previews/#limits)
- **文件限制**：免费方案每个 Worker 版本最多包含 20,000 个文件，单个文件最大 25 MiB。[官方限制](https://developers.cloudflare.com/workers/platform/limits/#static-assets)

### 创建 API Token

根据 Worker 的配置方式选择 Token 权限：

| Worker 配置                    | 准备工作                                                                                                                                                                                                                                                                                                                     | API Token 权限                                                                                                                                                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **⭐ 使用已有 Worker（推荐）** | <ul><li>在 <strong>Workers &amp; Pages</strong> 中创建 Worker，将 <code>cloudflare-worker-name</code> 设置为其名称。</li><li>在 <strong>Domains → Worker URL</strong> 中开启 <strong>Preview</strong>。</li></ul>[![Worker 的 Preview 开关位置](assets/cloudflare-worker-preview.png)](assets/cloudflare-worker-preview.png) | 选择 **Specified Workers**，选中目标 Worker，勾选 **Individual Workers → Editor**。<br><br>[![指定 Worker 的 Editor 权限配置](assets/cloudflare-worker-editor.png)](assets/cloudflare-worker-editor.png) |
| 由 Action 创建 Worker          | 将 `cloudflare-worker-name` 设为所需的 Worker 名称。                                                                                                                                                                                                                                                                         | 选择 **Entire Account**，勾选 **Workers → Admin**，可管理该账号下的所有 Worker。<br><br>[![Workers 产品级 Admin 权限配置](assets/cloudflare-workers-admin.png)](assets/cloudflare-workers-admin.png)     |

保存确认弹窗中的 API Token 和 Account ID。Token 仅显示一次。

### 启用发布

在 **Settings → Secrets and variables → Actions** 中添加：

- 仓库 Secret：`CLOUDFLARE_API_TOKEN`。
- 仓库变量：`CLOUDFLARE_ACCOUNT_ID`。

然后启用发布：

```yaml
- name: Run tests and publish reports
  id: midscene
  uses: web-infra-dev/midscene-action@v1
  with:
    working-directory: tests/midscene
    command: npm test
    publish-pages: true
    cloudflare-api-token: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    cloudflare-account-id: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}
```

如需使用已有 Worker，将 `cloudflare-worker-name` 设为其名称。默认值为 `midscene-reports`。

## 报告

在工作流运行的 **Summary（摘要）** 中查看测试结果和下载报告。报告发布成功后，还会显示在线预览链接。

默认从 `midscene_run/` 收集结果。通过环境变量 `MIDSCENE_RUN_DIR` 可选择其他产物根目录。相对路径基于 `working-directory` 解析，也支持绝对路径；未设置或值为空时使用默认目录。

将结果保存到 `artifacts/` 时，设置环境变量：

```yaml
- uses: web-infra-dev/midscene-action@v1
  with:
    working-directory: tests/midscene
  env:
    MIDSCENE_RUN_DIR: artifacts
```

> [!NOTE]
> 使用 `MIDSCENE_RUN_DIR` 统一配置测试产物，需要 `@midscene/test` 高于 1.17.5。

![Summary 中的测试结果、报告下载和在线报告入口](assets/test-summary.png)

## 输出

给 Action 步骤设置 `id: midscene`，即可通过 `${{ steps.midscene.outputs.<name> }}` 读取输出。

| 输出                   | 说明                                                       |
| ---------------------- | ---------------------------------------------------------- |
| `test-result`          | 测试命令的执行结果。                                       |
| `report-artifact-name` | 已上传的 Artifact 名称。未上传文件时为空。                 |
| `artifact-url`         | Artifact 下载页面链接。                                    |
| `page-url`             | 在线报告链接。未成功发布时为空。                           |
| `publication-result`   | 部署结果：`success`、`failure`、`skipped` 或 `cancelled`。 |

## 参与贡献

参阅[贡献指南](CONTRIBUTING.md)。

## 许可证

[MIT](LICENSE.md)。

基于 [Midscene](https://github.com/web-infra-dev/midscene) 和 [Cloudflare Workers](https://workers.cloudflare.com/) 构建。
