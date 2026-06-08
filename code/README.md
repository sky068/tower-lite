# Tower Lite

简化版 Tower 的 V0 工程。当前采用前后端分离的 npm workspace：

```text
code/
├── client/   # React + Vite 前端
├── server/   # Express + Prisma 后端
├── shared/   # 前后端共享类型
├── docs/     # 手动接口验证示例
└── docker-compose.yml
```

## 环境要求

- Node.js 18.18+
- npm 9+
- PostgreSQL
- Redis

如果本机有 Docker，可以用 `docker-compose.yml` 启动 PostgreSQL 和 Redis。

## 初始化

```bash
npm install
cp .env.example .env
npm run prisma:generate
```

首次连接数据库后执行：

```bash
npm run prisma:migrate
npm run prisma:seed
```

如果当前机器的 Prisma CLI 触发二进制断言，可以使用 Docker 初始化 SQL 路径：

```bash
npm run docker:reset
npm run doctor
npm run prisma:generate
npm run prisma:seed
```

`docker:reset` 会删除当前 Docker 里的本项目开发数据库卷，并用 `server/prisma/migrations/20260606000100_init/migration.sql` 重新初始化 PostgreSQL。

演示账号：

```text
demo@tower.local / password123
```

## 开发命令

```bash
npm run dev:client
npm run dev:server
npm run dev:up
npm run dev:down
npm run dev:init
npm run dev:all
npm run docker:up
npm run docker:down
npm run docker:reset
npm run doctor
npm run test
npm run test:integration
npm run test:e2e
npm run test:acceptance
npm run typecheck
npm run build
npm run check:v0
```

前端默认地址：

```text
http://localhost:5173
```

后端默认地址：

```text
http://localhost:4000/api/v1
```

一键启动 / 关闭前后端：

```bash
npm run dev:up
npm run dev:down
```

`dev:init` 和 `dev:all` 会调用 Docker Compose，因此需要先启动 Docker Desktop：

```bash
open -a Docker
```

等 Docker 启动完成后，先确认 daemon 正常：

```bash
docker ps
```

首次启动或重置数据库后，先初始化数据库并写入 demo 账号：

```bash
npm run dev:init
```

Prisma 命令会自动读取项目根目录的 `.env`。如果提示 `DATABASE_URL is missing`，先创建环境变量文件：

```bash
cp .env.example .env
```

如果想“一步到位”完成 Docker、迁移、seed，并启动前后端：

```bash
npm run dev:all
```

`dev:up` 只会后台启动后端和前端，不会自动启动 Docker、执行迁移或 seed；它会把 PID 和日志写入 `.tmp/dev/`：

```text
.tmp/dev/server.pid
.tmp/dev/server.log
.tmp/dev/client.pid
.tmp/dev/client.log
```

`dev:down` 会优先按 PID 文件停止进程；如果 PID 文件不存在，也会检查 `4000` 和 `5173` 端口，并只停止当前项目目录下启动的相关进程。

demo 登录账号：

```text
demo@tower.local / password123
teammate@tower.local / password123
```

如果 demo 登录提示密码错误，通常是当前数据库没有执行 seed，重新运行：

```bash
npm run prisma:seed
```

后端健康检查：

```text
http://localhost:4000/api/v1/health
```

手动接口示例：

```text
docs/api.http
```

更完整的本地启动、关闭和自动测试说明：

```text
docs/local-testing.md
```

## 当前已实现的 V0 后端接口

认证：

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`

用户：

- `GET /api/v1/users/me`
- `GET /api/v1/users/me/tasks`
- `GET /api/v1/users/me/notifications`
- `PATCH /api/v1/users/me/notifications/:id/read`
- `PATCH /api/v1/users/me/notifications/read-all`

团队：

- `POST /api/v1/teams`
- `GET /api/v1/teams`
- `GET /api/v1/teams/:teamId`
- `PATCH /api/v1/teams/:teamId`
- `GET /api/v1/teams/:teamId/members`
- `POST /api/v1/teams/:teamId/members`
- `PATCH /api/v1/teams/:teamId/members/:userId/role`
- `DELETE /api/v1/teams/:teamId/members/:userId`

项目：

- `GET /api/v1/teams/:teamId/projects`
- `POST /api/v1/teams/:teamId/projects`
- `GET /api/v1/projects/:projectId`
- `PATCH /api/v1/projects/:projectId`
- `PATCH /api/v1/projects/:projectId/archive`
- `DELETE /api/v1/projects/:projectId`
- `GET /api/v1/projects/:projectId/members`
- `POST /api/v1/projects/:projectId/members`
- `PATCH /api/v1/projects/:projectId/members/:userId/role`
- `DELETE /api/v1/projects/:projectId/members/:userId`

看板与任务：

- `GET /api/v1/projects/:projectId/lists`
- `POST /api/v1/projects/:projectId/lists`
- `PATCH /api/v1/projects/:projectId/lists/:listId`
- `DELETE /api/v1/projects/:projectId/lists/:listId`
- `PATCH /api/v1/projects/:projectId/lists/reorder`
- `POST /api/v1/projects/:projectId/tasks`
- `GET /api/v1/tasks/:taskId`
- `PATCH /api/v1/tasks/:taskId`
- `DELETE /api/v1/tasks/:taskId`
- `PATCH /api/v1/tasks/:taskId/move`
- `GET /api/v1/tasks/:taskId/comments`
- `POST /api/v1/tasks/:taskId/comments`
- `DELETE /api/v1/tasks/:taskId/comments/:commentId`

标签：

- `GET /api/v1/projects/:projectId/tags`
- `POST /api/v1/projects/:projectId/tags`
- `PATCH /api/v1/projects/:projectId/tags/:tagId`
- `DELETE /api/v1/projects/:projectId/tags/:tagId`
- `POST /api/v1/tasks/:taskId/tags/:tagId`
- `DELETE /api/v1/tasks/:taskId/tags/:tagId`

## V0 子任务规则

任务通过 `parentId` 预留未来多层子任务能力，但 V0 只开放一层：

- 普通任务可以创建子任务。
- 子任务不能再创建子任务。
- 父任务和子任务必须在同一个项目内。
- 后端在创建任务时会校验这些规则。

## 当前前端已接入流程

- 注册账号
- 登录账号
- 退出登录
- 创建团队
- 查看我的团队
- 选择团队
- 创建项目
- 查看项目列表
- 进入项目看板并读取后端任务列表
- 看板任务卡显示多位负责人、状态、截止日期、子任务数量和标签
- 已被移出项目的历史负责人会保留在任务上，并显示为“姓名(已移除)”
- 看板支持按关键词、负责人、优先级、完成状态筛选任务
- 在看板列里快速创建任务，默认分配给当前用户
- 通过新建任务弹窗创建任务，可以直接选择状态、多位负责人、优先级、开始日期和截止日期
- 打开任务详情，编辑标题和描述
- 设置任务状态、多位负责人、优先级、开始日期和截止日期，并在前端校验日期范围；负责人支持新增指派和取消指派
- 在任务详情里创建一层子任务，并为子任务单独设置多位负责人、开始日期和截止日期
- 子任务可以从父任务详情里打开，作为独立任务继续编辑
- 在任务详情里添加评论
- 评论作者可以删除自己的评论
- 在任务详情里移动任务到其他列
- 在任务详情里一键标记任务为已完成，并显示完成时间
- 删除仍有子任务的父任务会被后端拒绝，避免产生孤立子任务
- 拖拽任务到同列或其他列，更新排序和状态
- 创建、重命名、删除、排序自定义看板列表；默认的待处理、进行中、已完成列表不允许改名、排序或删除，自定义列表删除非空时需要明确选择任务迁移目标
- 创建标签并给任务添加或移除标签
- 管理团队成员
- 从团队成员下拉列表添加项目成员，管理项目成员、归档项目、删除项目
- 已归档项目的看板进入只读状态，后端也会拒绝任务、列表、标签和评论写操作
- 在工作台查看我的任务和通知
- 我的任务包含分配给自己的顶层任务和子任务；多人负责人中的任一成员登录后都能看到分配给自己的任务，且支持按未完成、已完成、全部筛选，并支持按任务、项目、列表搜索
- 单条或批量标记通知已读；点击通知任务链接时会自动标记已读
- 后端每 10 分钟扫描未来 24 小时内到期任务，生成站内提醒

## 当前环境备注

- 本项目仍处于开发阶段，数据库结构变更优先使用 `npm run docker:reset` 清空开发数据并重新初始化，不保留旧 schema 兼容路径。
- Prisma CLI 的部分命令在本机曾触发二进制断言；因此已手写初始迁移文件到 `server/prisma/migrations/20260606000100_init/migration.sql`，真实数据库联调建议优先使用 Docker 初始化 SQL 路径。
- `npm run test`、`npm run typecheck`、`npm run build` 和 `npm run check:v0` 已通过。
- `npm run test:integration` 会连接本地 PostgreSQL，运行前需要先确保 `npm run doctor` 的数据库检查通过。
- `npm run test:e2e` 会通过 Playwright 自动启动后端和前端，并用 Chromium 跑浏览器验收；首次运行前如果提示缺少浏览器，请执行 `npx playwright install chromium`。
- `npm run test:acceptance` 会依次运行后端集成测试和前端 E2E，适合 V0 回归验收。
