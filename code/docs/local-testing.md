# 本地启动与测试说明

本文档用于本机开发、调试和验收 Tower Lite V0。

## 1. 前置要求

- Node.js 18.18+
- npm 9+
- Docker Desktop

首次运行前安装依赖：

```bash
cd /Users/skyxu/workspace/my/tower/code
npm install
cp .env.example .env
npm run prisma:generate
```

如果需要跑前端 E2E，首次还需要安装 Playwright 浏览器：

```bash
npx playwright install chromium
```

## 2. 启动 Docker

先启动 Docker Desktop：

```bash
open -a Docker
```

等待 Docker 图标显示已运行后验证：

```bash
docker ps
```

如果 `docker ps` 能正常输出，说明 Docker daemon 已可用。

启动本项目的 PostgreSQL 和 Redis：

```bash
cd /Users/skyxu/workspace/my/tower/code
npm run docker:up
```

查看容器：

```bash
docker ps
```

查看 Docker 日志：

```bash
npm run docker:logs
```

关闭 Docker 容器：

```bash
npm run docker:down
```

清空本项目 Docker 数据卷并重新启动数据库：

```bash
npm run docker:reset
```

注意：`docker:reset` 会删除本项目开发数据库数据。

## 3. 初始化数据库

Docker 启动后执行：

```bash
npm run prisma:migrate
npm run prisma:seed
```

`prisma:migrate` 会执行仓库内的 SQL 迁移文件，不依赖 Prisma schema engine；当前开发阶段要求目标数据库为空，不做旧 schema 兼容。

也可以一条命令完成 Docker 启动、迁移和 seed：

```bash
npm run dev:init
```

`dev:init` 会执行：

```bash
npm run docker:up
npm run prisma:migrate
npm run prisma:seed
```

demo 账号：

```text
demo@tower.local / password123
teammate@tower.local / password123
```

如果 demo 登录提示密码错误，通常是当前数据库不是干净的开发库。直接重置并重新初始化：

```bash
npm run docker:reset
npm run prisma:migrate
npm run prisma:seed
```

## 4. 启动前后端

只启动前后端：

```bash
npm run dev:up
```

`dev:up` 会后台启动：

```text
后端：http://localhost:4000/api/v1
前端：http://localhost:5173
```

日志和 PID 文件：

```text
.tmp/dev/server.pid
.tmp/dev/server.log
.tmp/dev/client.pid
.tmp/dev/client.log
```

查看日志：

```bash
tail -f .tmp/dev/server.log
tail -f .tmp/dev/client.log
```

一条命令完成 Docker、迁移、seed，并启动前后端：

```bash
npm run dev:all
```

`dev:all` 会执行：

```bash
npm run dev:init
npm run dev:up
```

注意：`dev:all` 不会清空数据库；只有 `npm run docker:reset` 会清空 Docker 数据卷。

## 5. 关闭前后端

关闭前后端：

```bash
npm run dev:down
```

`dev:down` 会优先根据 `.tmp/dev/*.pid` 停止进程；如果 PID 文件不存在，也会检查 `4000` 和 `5173` 端口，并只停止当前项目目录下启动的相关进程。

验证端口已关闭：

```bash
lsof -nP -iTCP:4000 -sTCP:LISTEN
lsof -nP -iTCP:5173 -sTCP:LISTEN
```

没有输出表示对应端口已关闭。

## 6. 完整关闭

完整关闭前后端和 Docker：

```bash
cd /Users/skyxu/workspace/my/tower/code
npm run dev:down
npm run docker:down
```

验证：

```bash
lsof -nP -iTCP:4000 -sTCP:LISTEN
lsof -nP -iTCP:5173 -sTCP:LISTEN
docker ps
```

`docker ps` 中没有 `tower-postgres` 和 `tower-redis`，并且 4000 / 5173 没有监听，即表示已关闭干净。

如果要退出 Docker Desktop：

```bash
osascript -e 'quit app "Docker"'
```

## 7. 本地检查和自动测试

环境检查：

```bash
npm run doctor
```

后端单元测试：

```bash
npm run test
```

后端集成测试，需要 Docker/PostgreSQL 已启动：

```bash
npm run test:integration
```

前端 E2E 测试，需要 Docker/PostgreSQL 已启动：

```bash
npm run test:e2e
```

如果 4000 或 5173 端口被旧进程占用，可以临时指定 E2E 端口；默认启动和日常开发不受影响：

```bash
PLAYWRIGHT_API_PORT=4100 PLAYWRIGHT_CLIENT_PORT=5174 npm run test:e2e
```

当前 E2E 会覆盖：登录、右上角头像菜单、账号资料和密码修改、项目看板、默认三列、新建任务弹窗、背景路由任务详情弹窗、直接任务链接、两级子任务、评论、拖拽到已完成、我的任务、分配通知、WebSocket 评论通知，以及 EDITOR / VIEWER 的入口权限。

后端集成测试额外覆盖 V0.2 邀请规则：团队邀请、项目邀请、接受邀请、重复接受邀请、并发接受邀请、撤销邀请、已接受邀请不可撤销、邮箱不匹配不可接受，以及团队邀请不会让普通团队成员看到未加入的项目。V0.2 的邀请流程不会发送邮件，需要由管理员在团队设置或项目设置里复制邀请链接并发给成员；成员打开链接后，如果未登录会先进入登录页，登录或注册成功后继续接受邀请。

后端集成测试也覆盖 V0.3 审计日志：团队 OWNER 可查看团队日志、团队 ADMIN 不能查看团队日志；项目 OWNER 与团队 ADMIN 可查看项目日志，项目 EDITOR 不能查看；任务创建、状态变更和评论会写入项目日志。

V0 自动验收，串联后端集成测试和前端 E2E：

```bash
npm run test:acceptance
```

类型检查、构建和 V0 结构检查：

```bash
npm run typecheck
npm run build
npm run check:v0
```

## 8. 常见问题

### Docker daemon 未启动

报错：

```text
failed to connect to the docker API
connect: no such file or directory
```

处理：

```bash
open -a Docker
docker ps
```

等 `docker ps` 正常后重新执行启动命令。

### Prisma 找不到 DATABASE_URL

报错：

```text
Environment variable not found: DATABASE_URL
```

处理：

```bash
cd /Users/skyxu/workspace/my/tower/code
cp .env.example .env
npm run prisma:migrate
```

当前 Prisma 命令已封装为自动读取 `code/.env`；如果仍报错，先确认 `.env` 文件存在。

### demo 登录提示密码错误

处理：

```bash
npm run docker:reset
npm run prisma:migrate
npm run prisma:seed
```

然后重新登录：

```text
demo@tower.local / password123
```

### 端口被占用

查看端口：

```bash
lsof -nP -iTCP:4000 -sTCP:LISTEN
lsof -nP -iTCP:5173 -sTCP:LISTEN
```

如果是本项目进程：

```bash
npm run dev:down
```

如果不是本项目进程，请确认后再手动停止对应 PID。
