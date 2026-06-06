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
npm run docker:up
npm run docker:down
npm run docker:reset
npm run doctor
npm run test
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

手动接口示例：

```text
docs/api.http
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
- 在看板列里快速创建任务，默认分配给当前用户
- 打开任务详情，编辑标题和描述
- 设置负责人、优先级、开始日期和截止日期，并在前端校验日期范围
- 在任务详情里创建一层子任务
- 在任务详情里添加评论
- 在任务详情里移动任务到其他列
- 拖拽任务到同列或其他列，更新排序和状态
- 创建、重命名、删除、排序看板列表；删除非空列表时需要明确选择任务迁移目标
- 创建标签并给任务添加或移除标签
- 管理团队成员
- 从团队成员下拉列表添加项目成员，管理项目成员、归档项目、删除项目
- 在工作台查看我的任务和通知
- 单条或批量标记通知已读
- 后端每 10 分钟扫描未来 24 小时内到期任务，生成站内提醒

## 当前环境备注

- 当前机器没有可用的 `docker` 命令，因此还没有在本地启动 PostgreSQL / Redis。
- Prisma CLI 的部分命令在本机触发二进制断言；因此已手写初始迁移文件到 `server/prisma/migrations/20260606000100_init/migration.sql`，真实数据库联调需要在可用 PostgreSQL 环境执行。
- `npm run test`、`npm run typecheck`、`npm run build` 和 `npm run check:v0` 已通过；`npx prisma validate --schema server/prisma/schema.prisma` 当前受上述 Prisma 本机二进制问题阻塞。
