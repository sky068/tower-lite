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

`prisma:migrate` 会等待 PostgreSQL 可查询后执行仓库内的 SQL 迁移文件，不依赖 Prisma schema engine；当前开发阶段要求目标数据库为空，不做旧 schema 兼容。

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
npm run dev:reset
```

`dev:reset` 会执行 `docker:reset`，再执行带数据库等待的 `prisma:migrate` 和 `prisma:seed`，用于开发阶段快速清空并重建数据库。

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

注意：`dev:all` 不会清空数据库；`npm run dev:reset` 会清空 Docker 数据卷，并重新执行迁移和 seed。

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
npm run dev:down
npm run test:e2e
```

E2E 默认会启动一套 fresh 前后端，避免复用旧服务测到陈旧代码。如果你确实想复用当前正在运行的 4000 / 5173 服务，可以临时执行：

```bash
PLAYWRIGHT_REUSE_EXISTING_SERVER=1 npm run test:e2e
```

如果 4000 或 5173 端口被旧进程占用，可以临时指定 E2E 端口；默认启动和日常开发不受影响：

```bash
PLAYWRIGHT_API_PORT=4100 PLAYWRIGHT_CLIENT_PORT=5174 npm run test:e2e
```

当前 E2E 会覆盖：登录、右上角头像菜单、账号设置统一保存、账号资料、自定义头像上传、绑定邮箱修改、密码修改、团队级项目回收站入口、项目恢复、项目彻底删除、项目看板、新建项目后自动显示默认清单、不存在项目的正式状态页、新建任务弹窗、看板筛选匹配子任务、项目列表页、列表页筛选条、列表页按清单分组和任务树形展示、列表页清单折叠、列表页任务详情背景路由、清单标题加号、清单三点菜单、清单编辑态、删除有任务清单的二次提示、项目回收站入口、回收站删除人展示、恢复已删除清单的二次确认、恢复清单内任务、背景路由任务详情弹窗、任务详情字段编辑保存、直接任务链接、两级子任务、评论与 @ 成员、拖拽任务到其他清单、通过任务状态标记已完成、我的任务项目筛选、我的任务和已完成任务信息、分配通知、@ 通知、通知已读、WebSocket 评论通知、项目归档只读、取消归档，以及 EDITOR / VIEWER 的入口权限。

后端集成测试额外覆盖 V0.2 邀请规则：团队邀请、项目邀请、接受邀请、重复接受邀请、并发接受邀请、撤销邀请、已接受邀请不可撤销、邮箱不匹配不可接受，以及团队邀请不会让普通团队成员看到未加入的项目。集成测试也覆盖团队重名、同团队项目重名的拒绝规则。V0.2 的邀请流程不会发送邮件，需要由管理员在团队设置或项目设置里复制邀请链接并发给成员；成员打开链接后，如果未登录会先进入登录页，登录或注册成功后继续接受邀请。

后端集成测试也覆盖 V0.3 审计日志：团队 OWNER 可查看团队日志、团队 ADMIN 不能查看团队日志；团队日志只返回团队管理层事件，不包含任务、清单、评论或项目邀请日志；项目 ADMIN 与团队 ADMIN 可查看项目日志，项目 EDITOR 不能查看；任务创建、状态变更、任务删除和评论会写入项目日志，项目归档和取消归档会同时进入项目审计和团队审计。集成测试还覆盖 V0.4 回收站：任务和清单软删除、恢复、彻底删除，清单恢复重名冲突，以及团队级项目软删除、恢复、彻底删除、恢复重名冲突和权限限制。集成测试还覆盖 V0.5 评论 @ 成员：保存 mention 关系、非项目成员不可被 @、被 @ 成员只收到 @ 通知且作者本人不通知。集成测试还覆盖 V1.0 飞书登录与通知基础设施：未配置飞书应用时授权入口返回正式状态、飞书账号绑定冲突，以及已绑定用户收到通知时创建 `FEISHU/PENDING` 投递记录。集成测试还覆盖团队删除成功路径、项目取消归档和截止前 24 小时站内提醒的去重生成。

### 配置飞书登录

如需本地验证真实飞书登录，需要先在飞书开放平台创建一个企业自建应用，再把应用信息写入本地 `.env`。

1. 打开飞书开放平台，进入 `开发者后台`，创建或选择一个企业自建应用。
2. 在应用后台的 `凭证与基础信息` 页面复制 `App ID` 和 `App Secret`。
3. 在应用后台找到 `安全设置` 或 `重定向 URL` 配置，添加网页登录回调地址：

```text
http://localhost:5173/auth/feishu/callback
```

4. 在应用后台的 `权限管理` 中搜索并开通用户邮箱读取权限，权限标识通常为：

```text
contact:user.email:readonly
```

5. 如需验证飞书消息通知，在应用后台的 `权限管理` 中搜索并开通应用身份发消息权限，三者开通任一即可，推荐使用：

```text
im:message:send
```

可选权限：

```text
im:message
im:message:send_as_bot
```

6. 在应用后台启用机器人能力。飞书消息通知使用应用机器人身份发送，如果没有启用机器人，投递会失败并提示 `Bot ability is not activated`。

7. 如需验证飞书事件回调，在应用后台的事件订阅或回调配置中填写请求地址：

```text
http://localhost:4000/api/v1/feishu/webhook
```

本地开发机通常没有公网地址，飞书无法直接访问 `localhost`。要从飞书后台真实触发回调，需要使用内网穿透工具把本地 `4000` 端口暴露成 HTTPS 地址，再把该 HTTPS 地址填到飞书后台。

8. 如果后台提示需要发布版本，则进入 `版本管理与发布` 提交发布，并等待企业管理员审核通过。权限、机器人能力或回调地址变更未发布时，真实登录可能仍然拿不到邮箱，消息通知也可能因权限不足或机器人未启用而发送失败。
9. 在本地项目根目录的 `.env` 文件中配置：

```bash
FEISHU_APP_ID="cli_xxx"
FEISHU_APP_SECRET="xxx"
APP_BASE_URL="http://localhost:5173"
FEISHU_ENCRYPT_KEY=""
FEISHU_VERIFICATION_TOKEN=""
```

`.env` 文件路径是：

```text
/Users/skyxu/workspace/my/tower/code/.env
```

`FEISHU_VERIFICATION_TOKEN` 和 `FEISHU_ENCRYPT_KEY` 来自飞书应用后台的事件订阅配置；如果暂时只验证登录，可以先留空。

10. 重启服务让环境变量生效：

```bash
npm run dev:down
npm run dev:up
```

11. 打开登录页，点击 `使用飞书登录`。如果能跳转到飞书授权页并回到 `/auth/feishu/callback`，说明登录回调地址配置正确。

如果飞书授权后仍不返回邮箱，系统会使用 `${open_id}@feishu.local` 作为本地兜底邮箱，确保开发阶段可以先登录验证。用户登录后可以在右上角头像菜单的账号设置里把临时邮箱改为真实邮箱，便于后续接受按邮箱发出的邀请。

常见问题：

- 点击 `使用飞书登录` 提示未配置：检查 `.env` 是否包含 `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET`，并确认已重启后端。
- 飞书提示回调地址不合法：确认开放平台配置的重定向 URL 和 `APP_BASE_URL` 拼出的地址完全一致。
- 登录后邮箱是 `open_id@feishu.local`：说明飞书没有返回邮箱；检查邮箱权限是否开通、版本是否发布并审核通过。
- 飞书投递失败并提示缺少机器人发消息权限：检查是否已开通 `im:message:send`，并确认应用版本已发布且企业管理员已审核生效。
- 飞书投递失败并提示机器人能力未启用：检查应用后台是否已启用机器人，并确认应用版本已发布且企业管理员已审核生效。
- 本地前端端口不是 `5173`：需要同步修改 `APP_BASE_URL` 和飞书开放平台的重定向 URL，例如 `http://localhost:5174/auth/feishu/callback`。
- 飞书事件订阅验证失败：确认 webhook 地址能被飞书公网访问，并检查 `FEISHU_VERIFICATION_TOKEN`、`FEISHU_ENCRYPT_KEY` 是否和飞书后台一致。

飞书投递排查接口：

```text
GET /api/v1/projects/:projectId/feishu-deliveries
```

该接口仅项目管理员可访问，返回最近 100 条飞书投递状态、重试次数、失败原因、通知内容和接收人绑定状态。项目设置页也提供状态筛选和手动重试；手动重试对应接口为：

```text
POST /api/v1/projects/:projectId/feishu-deliveries/:deliveryId/retry
```

飞书通知会以应用机器人卡片消息发送，卡片包含通知标题、正文和详情入口。

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
npm run dev:reset
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
