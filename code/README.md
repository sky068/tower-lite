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

本项目仍处于开发阶段，不保留旧数据兼容路径。数据库结构变化后，直接清空开发数据库并重新执行迁移和 seed：

```bash
npm run dev:reset
```

如果需要拆开排查，可以等价执行：

```bash
npm run docker:reset
npm run prisma:migrate
npm run prisma:seed
```

开发环境检查和 Prisma Client 生成仍可单独执行：

```bash
npm run doctor
npm run prisma:generate
```

`dev:reset` 会删除并重建 PostgreSQL / Redis 数据卷，然后重新执行迁移和 seed；`prisma:migrate` 会先等待 PostgreSQL 可查询，再按顺序执行仓库内的 SQL 迁移文件，要求目标数据库为空。

演示账号：

```text
demo@tower.local / password123
```

## 开发命令

```bash
# 单独启动前端 Vite dev server，默认 http://localhost:5173
npm run dev:client

# 单独启动后端 API server，默认 http://localhost:4000/api/v1
npm run dev:server

# 后台启动前后端，不启动 Docker、不迁移、不 seed
npm run dev:up

# 关闭 dev:up 启动的前后端进程
npm run dev:down

# 启动 Docker Compose，并执行数据库迁移和 seed
npm run dev:init

# 清空并重建开发数据库，再执行迁移和 seed
npm run dev:reset

# 一步完成 dev:init，并后台启动前后端
npm run dev:all

# 启动 PostgreSQL / Redis 容器
npm run docker:up

# 关闭 PostgreSQL / Redis 容器
npm run docker:down

# 删除 PostgreSQL / Redis 数据卷并重新启动容器，会清空本地开发数据
npm run docker:reset

# 检查本机 Node、Docker、数据库、Redis 等开发环境
npm run doctor

# 运行后端单元测试
npm run test

# 运行后端集成测试，需要本地数据库可连接
npm run test:integration

# 运行 Playwright E2E，会自动启动测试用前后端
npm run test:e2e

# 复用当前已启动的前后端运行 Playwright E2E
npm run test:e2e:reuse

# 串联运行 test:integration 和 test:e2e
npm run test:acceptance

# 串联运行 test:integration 和 test:e2e:reuse
npm run test:acceptance:reuse

# TypeScript 类型检查
npm run typecheck

# 构建前端、后端和 shared workspace
npm run build

# V0 功能检查脚本
npm run check:v0

# 生成甘特图 / 任务树测试任务，会先清理上次生成的 [测试排期] 任务
npm run prisma:test-tasks
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

系统管理员通过 `.env` 初始化。后端启动时会读取这些变量：如果邮箱已存在，会把该用户升级为系统管理员；如果邮箱不存在，会自动创建系统管理员账号。

```bash
DEFAULT_ADMIN_EMAIL="admin@tower.local"
DEFAULT_ADMIN_PASSWORD="password123"
DEFAULT_ADMIN_NAME="系统管理员"
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

系统管理员和邮箱预加成员配置流程：

1. 在 `.env` 配置 `DEFAULT_ADMIN_EMAIL`、`DEFAULT_ADMIN_PASSWORD`、`DEFAULT_ADMIN_NAME`。
2. 启动或重启后端，让系统管理员账号自动创建或升级。
3. 使用系统管理员账号登录工作台。
4. 点击“创建团队”，填写团队名称和团队管理员邮箱。邮箱对应账号已存在时会直接加入团队并设为团队 `ADMIN`；账号不存在时会生成待认领团队 `ADMIN`，成员行展示注册链接。
5. 创建项目时，系统管理员需要选择一个当前团队成员作为项目 `ADMIN`；系统管理员自己不会自动成为项目成员。
6. 普通用户完成邮箱验证、飞书返回邮箱登录或通过验证链接确认修改邮箱时，系统才会认领同邮箱的待认领成员；不会因为系统配置或项目存在而自动加入团队或项目。
7. 登录默认进入工作台，不自动跳转到团队或项目；工作台聚合当前用户所有可访问项目中的个人任务，并支持按团队、项目和状态筛选。

如果 demo 登录提示密码错误，通常是当前数据库没有执行 seed，重新运行：

```bash
npm run prisma:seed
```

生成甘特图 / 任务树测试任务：

```bash
npm run prisma:test-tasks
```

默认写入 `Demo Project`。如果要写入指定项目：

```bash
TEST_TASK_PROJECT_ID=<project-id> npm run prisma:test-tasks
```

该脚本会先清理目标项目中上次生成的 `[测试排期]` 任务，再生成一组覆盖型测试任务。样本会覆盖无子任务、单子任务、多子任务、孙子任务、深层未排期树；同时覆盖有时间、无时间、单日任务、长周期跨月任务、已完成任务、父任务汇总条、未排期子任务空白行，以及 1 位负责人、2 位负责人、无负责人、不同状态和不同优先级组合。

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
- `POST /api/v1/auth/email-verification/send`
- `POST /api/v1/auth/email-verification/confirm`
- `POST /api/v1/auth/password-reset/request`
- `POST /api/v1/auth/password-reset/confirm`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`

用户：

- `GET /api/v1/users/me`
- `PATCH /api/v1/users/me/profile`
- `PATCH /api/v1/users/me/email`
- `PATCH /api/v1/users/me/password`
- `GET /api/v1/users/me/tasks`
- `GET /api/v1/users/me/notifications`
- `PATCH /api/v1/users/me/notifications/:id/read`
- `PATCH /api/v1/users/me/notifications/read-all`

团队：

- `POST /api/v1/teams`
- `GET /api/v1/teams`
- `GET /api/v1/teams/:teamId`
- `PATCH /api/v1/teams/:teamId`
- `DELETE /api/v1/teams/:teamId`
- `GET /api/v1/teams/:teamId/activity`
- `GET /api/v1/teams/:teamId/members`
- `POST /api/v1/teams/:teamId/members`
- `PATCH /api/v1/teams/:teamId/members/:memberId/role`
- `DELETE /api/v1/teams/:teamId/members/:memberId`

注册链接内部接口：

- `GET /api/v1/teams/:teamId/invitations`
- `POST /api/v1/teams/:teamId/invitations`
- `GET /api/v1/projects/:projectId/invitations`
- `POST /api/v1/projects/:projectId/invitations`
- `PATCH /api/v1/invitations/:invitationId/revoke`
- `POST /api/v1/invitations/accept`

项目：

- `GET /api/v1/teams/:teamId/projects`
- `POST /api/v1/teams/:teamId/projects`
- `GET /api/v1/teams/:teamId/project-trash`
- `PATCH /api/v1/teams/:teamId/project-trash/:projectId/restore`
- `DELETE /api/v1/teams/:teamId/project-trash/:projectId`
- `GET /api/v1/projects/:projectId`
- `PATCH /api/v1/projects/:projectId`
- `PATCH /api/v1/projects/:projectId/archive`
- `PATCH /api/v1/projects/:projectId/unarchive`
- `DELETE /api/v1/projects/:projectId`
- `GET /api/v1/projects/:projectId/activity`
- `GET /api/v1/projects/:projectId/members`
- `POST /api/v1/projects/:projectId/members`
- `PATCH /api/v1/projects/:projectId/members/:memberId/role`
- `DELETE /api/v1/projects/:projectId/members/:memberId`

看板与任务：

- `GET /api/v1/projects/:projectId/lists`
- `POST /api/v1/projects/:projectId/lists`
- `PATCH /api/v1/projects/:projectId/lists/:listId`
- `DELETE /api/v1/projects/:projectId/lists/:listId`
- `PATCH /api/v1/projects/:projectId/lists/reorder`
- `GET /api/v1/projects/:projectId/trash`
- `PATCH /api/v1/projects/:projectId/trash/lists/:listId/restore`
- `DELETE /api/v1/projects/:projectId/trash/lists/:listId`
- `POST /api/v1/projects/:projectId/tasks`
- `GET /api/v1/tasks/:taskId`
- `PATCH /api/v1/tasks/:taskId`
- `DELETE /api/v1/tasks/:taskId`
- `PATCH /api/v1/tasks/:taskId/restore`
- `DELETE /api/v1/tasks/:taskId/purge`
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

## V0.1 子任务规则

任务通过 `parentId` 预留未来多层子任务能力，但 V0.1 只开放两级子任务：

- 普通任务可以创建一级子任务。
- 一级子任务可以继续创建二级子任务。
- 二级子任务不能继续创建子任务。
- 父任务和子任务必须在同一个项目内。
- 任务详情顶部会展示父任务路径，点击父任务名称可以跳转到对应父任务。
- 工作台“我的任务”最多显示两层关系。若 `A -> B -> C` 中只有 `C` 分配给我，则显示 `B -> C`；若 `B` 和 `C` 都分配给我，则显示 `A -> B` 和 `B -> C` 两段。
- 后端在创建任务时会校验这些规则。

## V0.2 邮箱预加成员规则

V0.2 增加邮箱预加成员能力，当前只生成站内注册链接，不发送邮件或飞书消息：

- 系统管理员账号可通过 `.env` 的 `DEFAULT_ADMIN_EMAIL`、`DEFAULT_ADMIN_PASSWORD`、`DEFAULT_ADMIN_NAME` 初始化；普通注册 / 登录用户默认是普通系统用户。
- 系统管理员可以创建和删除团队，并在创建团队时指定团队管理员邮箱；邮箱账号已存在则直接加入团队为 `ADMIN`，不存在则创建待认领团队 `ADMIN` 并生成注册链接。
- 待注册邮箱用户即使没有点注册链接，只要自行注册并完成邮箱验证，或通过飞书返回同一邮箱登录，后端也会按邮箱认领对应团队 / 项目成员。
- 团队必须至少保留一名已加入的团队 `ADMIN`；待认领 `ADMIN` 不计入最后管理员保护，系统管理员也不自动计入团队 `ADMIN`。
- 系统管理员是平台管理身份，不默认进入业务协作关系；系统管理员创建项目时必须指定一名已注册并已认领的当前团队成员作为项目 `ADMIN`，自己不会因创建项目自动成为项目成员。
- 普通用户完成邮箱验证、飞书返回邮箱登录或通过验证链接确认修改邮箱时，后端只认领同邮箱的待认领团队 / 项目身份；如果没有可认领身份，工作台保持空状态，需要管理员通过邮箱添加成员。
- 团队 / 项目管理员通过邮箱添加成员；邮箱已注册时直接加入，邮箱未注册时创建待认领成员并在成员行展示“复制注册链接”。团队成员支持 CSV 批量导入，CSV 第一列为邮箱，第二列为权限；权限可写 `ADMIN` / `MEMBER`，也可写 `1` / `2`，其中 `1=ADMIN`、`2=MEMBER`。注册链接只是注册 / 登录入口，不决定权限，权限以成员列表为准。
- 创建团队成员时可设置团队角色 `ADMIN` 或 `MEMBER`；创建项目成员时可设置项目角色 `ADMIN`、`EDITOR` 或 `VIEWER`。待认领成员可以先加入项目并被指派任务，用户后续用相同邮箱注册并完成邮箱验证、通过飞书返回同一邮箱登录，或在账号设置里通过验证链接确认改成该邮箱后，会自动认领团队、项目和任务负责人身份。
- 通过邮箱添加成员不会把已有团队 `ADMIN` 降级为 `MEMBER`，也不会把已有项目高权限成员降级；降级只能通过对应成员角色管理入口完成。
- 如果用户已有同团队成员身份，后续邮箱认领会合并成员身份和任务负责人引用，不会留下重复团队成员、重复项目成员或重复负责人记录。
- 团队成员和项目成员是成员身份的唯一事实来源；取消某个邮箱未来加入资格，需要从成员列表移除对应待认领成员。
- 创建 / 更新任务时，负责人请求字段为 `projectMemberIds`，值必须是项目成员 id；任务返回的负责人会带 `status: ACTIVE | PENDING | REMOVED`。
- 用户邮箱全局唯一并统一小写；同一团队内按小写邮箱去重，同一项目成员来自团队成员，因此同一项目内同一邮箱也不能重复加入。
- 注册链接需要登录且邮箱已验证后接受；如果未登录，会先进入登录页，登录或注册成功后仍需完成邮箱验证才能认领成员身份。
- 使用注册链接时，当前登录邮箱必须和链接对应邮箱一致，否则后端会拒绝。
- 普通团队成员只能看到自己已经加入的项目；团队 ADMIN / 系统管理员可以看到团队下全部项目。
- 已使用的注册链接重复打开会返回成功，不会重复创建团队成员或项目成员。

## V0.3 账号安全规则

V0.3 补齐邮箱验证和密码找回的开发版闭环：

- 注册成功后后端生成邮箱验证 token，账号设置中也可以重新生成当前邮箱的验证链接；邮箱验证 / 邮箱变更 token 24 小时后失效。
- 修改邮箱不会立即改写 `User.email`，而是生成邮箱变更验证链接；用户打开链接确认后才更新邮箱、写入 `emailVerifiedAt`，并触发待认领团队 / 项目成员合并。
- 密码找回分两步：先通过邮箱请求重置链接，再用重置 token 设置新密码；重置成功后会撤销该用户现有 refresh token。
- 当前开发阶段未接真实邮件服务时，后端会把验证 / 重置邮件写入 `EmailOutbox` 开发邮件箱，并在非生产前端显示开发调试链接；配置 SMTP 后只走正式邮件投递，不在接口响应中暴露 token。
- 所有账号 token 只保存哈希值，带过期时间和 `usedAt`，重复生成同类型 token 会废弃旧 token。
- 成员认领状态变化会通过 WebSocket 刷新相关成员和项目视图。

## V0.3 审计日志规则

V0.3 增加团队和项目的操作日志，用于管理者回溯关键操作：

- 团队审计日志入口只对团队 `ADMIN`、系统管理员显示，后端接口也使用同样的权限校验。
- 项目审计日志入口只对项目 `ADMIN`、团队 `ADMIN`、系统管理员显示，后端接口使用同样的权限校验。
- 团队详情页中的团队审计日志只展示团队管理层事件：团队成员添加、角色调整、移除、认领，以及项目创建、归档、取消归档、删除、恢复、彻底删除。
- 项目设置中的项目审计日志展示当前项目事件：项目更新、归档、删除，项目成员添加、角色调整、移除、认领。
- 任务协作日志只展示在项目审计日志中，记录清单创建、更新、删除、排序，任务创建、更新、移动、状态变更、删除，以及评论创建、删除。
- 日志保留操作者、操作时间、团队、项目、任务和简要 metadata；当前 V0.3 只展示最近 100 条记录，不提供导出或全文搜索。
- 团队 ADMIN、系统管理员可在团队审计日志中按日期区间清理团队审计日志；项目 ADMIN、团队 ADMIN、系统管理员可在项目审计日志中按日期区间清理当前项目审计日志。清理操作不可恢复，并会写入一条新的“清理审计日志”记录，记录清理范围和删除数量。
- 日志用于审计和排查，不替代通知；通知仍通过 WebSocket 推送给相关负责人。

## V0.4 回收站规则

V0.4 启用项目回收站，用于恢复误删任务和清单：

- 回收站入口只对项目 `ADMIN`、团队 `ADMIN`、系统管理员显示，后端接口使用同样权限校验；回收站列表显示删除人和删除时间。
- 删除任务为软删除；单独删除的任务会显示在项目回收站里，恢复和彻底删除都需要二次确认。
- 删除清单为软删除；清单内当前未删除任务会跟随清单进入回收站，恢复清单需要二次确认，确认后会一起恢复跟随删除的任务。
- 恢复清单时如果当前项目已有同名未删除清单，后端会拒绝恢复，不自动加后缀。
- 彻底删除清单会物理删除清单内任务、评论、负责人、标签关联和依赖关系；彻底删除任务会物理删除该任务及其子任务相关数据。
- 项目归档后回收站只读，不允许恢复或彻底删除。
- 恢复和彻底删除会写入项目审计日志。

## V0.5 评论 @ 成员规则

V0.5 补齐评论 @ 成员能力，作为后续飞书协作通知的前置能力：

- 任务详情评论区支持输入 `@` 触发项目成员选择，选中后将 `@姓名` 直接插入评论文本，提交时会同时传递 `mentionIds`。
- 后端只接受当前项目成员作为 @ 对象；如果传入非项目成员，会返回正式业务错误。
- 评论会保存被 @ 成员关系；前端评论条目只展示评论正文中的 `@姓名`，不额外展示独立 @ 成员列表。
- 被 @ 成员收到 `COMMENT_MENTION` 站内通知；评论作者本人不通知。
- 如果被 @ 成员同时也是任务创建者或负责人，只收到 @ 通知，不再重复收到“任务有新评论”通知。
- 普通新评论仍会通知任务创建者和当前负责人，评论作者本人除外。

## V1.0 飞书登录与通知基础规则

V1.0 先接入飞书登录和飞书通知投递基础设施，事件回调验签后续继续补齐：

- 登录页支持“使用飞书登录”；后端未配置飞书应用时会返回正式提示，不影响邮箱登录。
- 飞书登录授权回调地址使用 `${APP_BASE_URL}/auth/feishu/callback`，需要在飞书开放平台应用中配置同样的回调地址。
- 飞书 OAuth 成功后，后端优先用飞书返回的邮箱匹配现有账号；不存在则创建新账号，并绑定 `Open ID` / `Union ID`。
- 授权地址会请求邮箱读取权限；如果飞书仍未返回邮箱，后端会使用 `${open_id}@feishu.local` 创建本地兜底邮箱，用户登录后可在账号设置里改为真实绑定邮箱。
- 飞书账号绑定由 OAuth 登录自动完成，账号设置不提供手动填写 `Open ID` / `Union ID` 的入口；账号设置支持解除飞书绑定，但解除前必须先设置邮箱登录密码，解除成功后会退出登录。
- 所有站内通知统一写入 `Notification`，并固定创建 `IN_APP/SENT` 投递记录。
- 如果接收人已绑定飞书 `Open ID`，创建站内通知时会额外创建 `FEISHU/PENDING` 投递记录。
- 后端启动时如果配置了 `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET`，会启动飞书投递 worker，定期发送待投递消息。
- 飞书通知使用机器人卡片消息发送，卡片包含通知标题、正文和详情入口。
- 飞书消息发送失败会记录 `lastError` 并增加 `attemptCount`，最多重试 3 次。
- 项目设置中的飞书投递列表支持按状态筛选；失败、跳过或待发送记录可以由项目管理员手动重试。
- 项目设置中的飞书投递记录支持按日期区间和状态手动清理，但 `PENDING` 待发送记录不允许清理；清理操作会写入项目审计日志。
- 未配置飞书应用密钥时不会启动飞书投递 worker，站内通知和 WebSocket 同步不受影响。

### 飞书登录本地配置

本地验证飞书登录时，需要在飞书开放平台创建企业自建应用，并完成以下配置：

1. 在应用后台复制 `App ID` 和 `App Secret`。
2. 配置网页登录回调地址：

```text
http://localhost:5173/auth/feishu/callback
```

3. 在权限管理中开通用户邮箱读取权限：

```text
contact:user.email:readonly
```

4. 如需验证飞书消息通知，在权限管理中开通应用身份发消息权限，三者开通任一即可，推荐使用：

```text
im:message:send
```

可选权限：

```text
im:message
im:message:send_as_bot
```

5. 在应用后台启用机器人能力。飞书消息通知使用应用机器人身份发送，如果没有启用机器人，投递会失败并提示 `Bot ability is not activated`。

6. 如需验证事件回调，在飞书事件订阅中配置 webhook：

```text
http://localhost:4000/api/v1/feishu/webhook
```

飞书无法直接访问本机 `localhost`；真实回调验证需要用内网穿透工具把本地 `4000` 端口暴露为 HTTPS 地址。

7. 如有权限、机器人能力或回调地址变更，发布新版本并等待企业管理员审核通过。
8. 在 `/Users/skyxu/workspace/my/tower/code/.env` 中配置：

```bash
FEISHU_APP_ID="cli_xxx"
FEISHU_APP_SECRET="xxx"
APP_BASE_URL="http://localhost:5173"
FEISHU_ENCRYPT_KEY=""
FEISHU_VERIFICATION_TOKEN=""
```

`FEISHU_ENCRYPT_KEY` 和 `FEISHU_VERIFICATION_TOKEN` 来自飞书事件订阅配置；只验证登录时可以留空。

9. 重启服务：

```bash
npm run dev:down
npm run dev:up
```

如果飞书没有返回邮箱，系统仍允许登录，并使用 `${open_id}@feishu.local` 作为临时邮箱；用户之后可在账号设置中改成真实邮箱。

飞书事件回调地址为 `POST /api/v1/feishu/webhook`，支持 URL verification challenge、token 校验、加密 payload 解密和事件幂等记录。项目管理员可通过 `GET /api/v1/projects/:projectId/feishu-deliveries` 查看最近 100 条飞书通知投递状态、重试次数和失败原因，也可通过 `POST /api/v1/projects/:projectId/feishu-deliveries/:deliveryId/retry` 手动重试未成功投递，通过 `POST /api/v1/projects/:projectId/feishu-deliveries/clear` 按日期和状态清理非待发送投递记录。

如果投递失败原因显示“飞书应用缺少机器人发消息权限”，说明应用尚未开通应用身份发消息权限；在飞书开放平台开通 `im:message:send` 后，需要发布版本并等待企业管理员审核生效，再重启后端服务验证。

如果投递失败原因显示“飞书应用尚未启用机器人能力”，说明应用后台没有开启机器人；启用机器人能力、发布版本并审核生效后，再重启后端服务验证。

## V2.0 甘特图排期规则

V2.0 先补项目级甘特图排期基础能力，后续再做依赖连线：

- 项目菜单增加“甘特图”入口。
- 甘特图读取任务开始日期和截止日期生成时间轴，点击任务名称或任务条打开任务详情。
- 甘特图默认按天展示，支持天 / 周 / 月 / 季度缩放，时间轴日期使用两位年份以支持跨年排期识别。
- 甘特图筛选与看板、列表保持一致，支持关键词、负责人、优先级和完成状态。
- 筛选命中子任务时保留父任务上下文。
- 甘特图按项目级父子关系展示任务树，任务树节点可折叠，折叠状态按项目记忆；搜索或筛选时默认展开匹配路径，用户仍可在筛选结果中临时折叠任务树。
- 有完整自身排期的任务条统一显示绿色；任务状态为已完成时，任务条统一显示灰色。
- 父任务没有真实日期但子孙任务有真实排期时，父任务显示红色汇总条，范围取子孙任务最早开始日期到最晚截止日期；汇总条只用于展示和打开详情，不写回父任务日期，也不支持拖动改期。
- 甘特图任务列和未排期任务显示负责人头像，鼠标悬停头像时显示负责人姓名；超过 15 条任务时，排期区或未排期区使用独立滚动。
- 子任务没有真实日期时不继承父任务日期，不显示时间条；未排期任务可以在任务树中作为空白行出现，所在任务树没有任何真实排期时显示在“未排期任务”区域。
- 具备任务编辑权限且项目未归档时，可左右拖动完整排期任务条中间区域整体调整开始 / 截止日期；拖动只允许横向移动，松手时按任务条左端所在时间格作为新开始时间，并保持任务原持续时间不变。
- 具备任务编辑权限且项目未归档时，可拖动任务条左边缘单独调整开始日期，拖动右边缘单独调整截止日期；调整时任务至少保留 1 个时间格长度。
- 当前不支持任务依赖连线。
- 当前甘特图不提供独立后端接口，复用 `GET /projects/:projectId/tasks` 获取项目任务树，并复用 `PATCH /tasks/:taskId` 更新 `startDate` / `dueDate`。任务依赖模型已预留，但依赖 API、循环校验、依赖线 UI 和自动排程尚未实现。

## 导航信息架构

- 左侧边栏作为应用主导航，包含工作台、团队、项目三类入口。
- 工作台只承载个人视角内容，例如我的任务和通知入口，不再承载完整团队 / 项目管理列表；我的任务支持团队、项目、状态和关键词筛选。
- 团队入口下展示当前用户可见的所有团队；系统管理员额外显示创建团队入口。
- 点击团队进入团队详情页，展示团队基础信息、团队成员和团队项目；团队 ADMIN / 系统管理员额外显示添加成员、成员操作、审计日志和删除团队等管理内容。
- 项目入口按团队分组展示当前用户可访问的项目；系统管理员和团队 ADMIN 可看到管理范围内的项目，并可从对应团队项目分组的加号创建项目。
- 点击项目进入该项目看板；项目内部继续通过顶部菜单切换看板、列表、甘特图、设置和回收站。
- 甘特图是项目视图，始终放在项目内，不作为左侧全局入口；未来如果做跨项目排期，应单独设计为“排期总览”。

## 前端控件规范

- 所有表单控件使用统一轻量风格：白色背景、浅灰边框、8px 左右圆角、蓝色 focus ring。
- 应用内可见下拉菜单不使用系统原生 `<select>`，统一使用项目内自定义下拉，避免出现系统黑色下拉层。
- 人员下拉选项展示头像、名字和邮箱；优先级下拉选项展示对应优先级颜色。
- 新增输入框、下拉框、文本域和按钮时，优先复用现有 CSS 类；不能为单个入口临时写一套不一致的控件样式。
- 侧边栏宽度固定，侧边栏内表单、列表、下拉框和长文本必须限制在容器内，避免撑破边栏。
- 确认按钮使用蓝色实心样式；取消、删除、彻底删除等危险或中止操作使用红色实心样式和白色文字。
- 按钮文字全局禁止换行；空间不足时应调整布局、按钮宽度或文案，而不是让按钮文字挤成两行。
- 使用按钮承载任务卡、列表行等整块可点击内容时，内部标题、标签和容器必须有宽度约束、截断或换行策略，不能撑破父布局。

## 当前前端已接入流程

- 注册账号
- 登录账号
- 登录页支持忘记密码，后端生成密码重置邮件；未配置 SMTP 的非生产环境会显示开发调试链接，配置 SMTP 后只提示去邮箱查收。
- 注册和账号设置支持邮箱验证；修改邮箱只生成验证链接，用户点开验证链接后才真正更新邮箱并触发待认领成员合并。
- 右上角头像菜单展示用户名字和邮箱，并提供账号设置和退出登录
- 账号设置支持修改名字、绑定邮箱、生成邮箱验证链接、上传自定义头像、恢复默认头像和修改密码，并统一通过一个保存按钮提交
- 团队成员、项目成员、任务负责人和负责人选择器统一展示用户头像；未上传头像时显示默认头像
- 左侧边栏展示工作台、团队和项目入口；团队列表和按团队分组的项目列表从左侧进入
- 系统管理员可从左侧团队分组创建团队
- 点击团队进入团队详情页，查看团队基础信息、成员和团队项目
- 团队基础信息未修改时保存按钮禁用；保存成功后展示“已保存”反馈
- 团队名称不能与现有未删除团队重名
- 团队 ADMIN 或系统管理员可在团队详情页通过邮箱添加成员、CSV 批量导入成员、复制未注册成员的注册链接、管理角色、查看审计日志和项目回收站
- 团队 ADMIN 或系统管理员可在左侧对应团队的项目分组中创建项目
- 系统管理员创建项目时需要选择项目管理员；团队 ADMIN 创建项目时不选择则默认自己成为项目 ADMIN
- 同一团队内未删除项目不能重名
- 点击左侧项目入口进入项目看板并读取后端任务清单
- 看板任务卡显示多位负责人头像、状态、截止日期、子任务数量和标签
- 已被移出项目的历史负责人会保留在任务上，并显示为“姓名(已移除)”
- 看板支持按关键词、负责人、优先级、完成状态筛选任务；筛选会同时检查子任务，子任务命中时保留顶层任务卡片
- 项目列表页支持按清单分组展示全部任务，任务按父子树形结构显示，清单分组和任务树节点均可折叠
- 项目列表页表头为任务标题、优先级、截止时间、负责人；优先级以固定小方形标签展示，截止时间有开始日期时显示为开始-截止，负责人显示头像和名字
- 项目列表页和看板使用一致的搜索、负责人、优先级、完成状态筛选；子任务命中时保留父任务上下文
- 项目甘特图支持按任务开始日期和截止日期展示排期，默认按天展示，支持天 / 周 / 月 / 季度缩放，时间轴日期使用两位年份，并复用看板、列表的筛选条件；甘特图按项目级任务树展示并支持折叠记忆，筛选时默认展开且仍可临时折叠；完整自身排期任务条为绿色，父任务无真实日期但子孙任务有真实排期时显示红色汇总条，已完成任务条为灰色；未排期任务不继承父任务日期且不显示时间条；任务列和未排期任务显示负责人头像，超过 15 条时独立滚动；有任务编辑权限时可拖动完整排期任务条中间区域整体调整排期，也可拖动左 / 右边缘单独调整开始日期或截止日期
- 项目、任务不存在或无权限时显示正式状态页，提供返回工作台或上一页入口
- 在看板或项目列表页的清单标题右侧点击加号可直接为该清单创建任务；当前用户是项目成员时默认分配给当前用户，系统管理员仅有管理权限但不是项目成员时不会自动成为负责人
- 通过新建任务弹窗创建任务，可以直接选择状态、多位负责人、优先级、开始日期和截止日期
- 任务负责人候选只来自项目成员；系统管理员如果没有加入项目成员，不会出现在负责人或 @ 提及候选列表中
- 打开任务详情，编辑标题和描述
- 从工作台或看板打开任务详情时使用背景路由弹窗，底层页面不卸载，URL 会同步为 `/tasks/:taskId`
- 直接打开 `/tasks/:taskId` 链接时显示独立任务详情，关闭或返回时进入工作台
- 设置任务状态、多位负责人、优先级、开始日期和截止日期，并在前端校验日期范围；负责人支持新增指派和取消指派
- 保存任务或子任务时，如果只填写开始日期或只填写截止日期，后端会把缺失的另一侧日期自动补为同一天，保证任务排期始终成对保存
- 在任务详情里创建最多两级子任务，并为子任务单独设置多位负责人、开始日期和截止日期
- 子任务可以从父任务详情里打开，作为独立任务继续编辑
- 在任务详情里添加评论，并通过输入 `@` 提及项目成员
- 评论作者可以删除自己的评论
- 在任务详情里移动任务到其他清单
- 在任务详情里一键标记任务为已完成；看板任务卡和工作台“我的任务”右侧会显示完成人和完成时间，如今天、昨天或具体日期
- 删除仍有子任务的父任务会被后端拒绝，避免产生孤立子任务
- 拖拽任务到同一清单或其他清单，只更新清单归属和排序，不改变任务状态
- 创建项目时自动生成“默认清单”；系统管理员创建项目不会自动加入项目成员；创建、重命名、删除、排序看板清单；清单只负责任务分组，任务状态独立为待处理、进行中、已完成
- 清单标题区默认显示清单名称和加号；看板清单在有管理权限时加号右侧显示三点菜单，可通过三点菜单进入编辑清单，编辑态才显示拖拽排序、重命名、保存和取消操作；删除有任务的清单时必须二次确认，确认后会连同清单内任务一起删除
- 团队详情页提供团队级项目回收站，系统管理员 / 团队 ADMIN 可查看已删除项目、删除人和删除时间，并恢复或彻底删除软删除项目；彻底删除需要二次确认，恢复项目遇到同团队同名未删除项目时会提示冲突，不自动改名
- 项目回收站支持查看、恢复和彻底删除已删除任务与清单；恢复清单遇到同名未删除清单时会提示冲突，不自动改名
- 项目归档后可以在项目设置中取消归档，恢复正常协作
- 项目基础信息未修改时保存按钮禁用；保存成功后展示“已保存”反馈
- 创建标签并给任务添加或移除标签
- 管理团队成员，通过邮箱单个添加或 CSV 批量导入已注册 / 未注册成员；未注册成员行展示复制注册链接
- 项目 ADMIN、团队 ADMIN 或系统管理员可以从当前团队成员下拉列表添加项目成员；项目成员必须先是团队成员，缺少成员时先到团队页面通过邮箱添加
- 团队 ADMIN 或系统管理员可以在团队详情页查看审计日志；项目 ADMIN、团队 ADMIN 或系统管理员可以在项目设置查看审计日志
- 团队 ADMIN 或系统管理员可以按日期区间清理团队审计日志；项目 ADMIN、团队 ADMIN 或系统管理员可以按日期区间清理项目审计日志，清理操作会追加审计记录
- 从团队成员下拉列表添加项目成员，管理项目成员、归档项目、删除项目
- 已归档项目的看板进入只读状态，后端也会拒绝任务、清单、标签和评论写操作
- 在工作台查看我的任务；右上角通知入口支持查看最近通知和打开全部通知弹窗
- 我的任务包含分配给自己的顶层任务和子任务；多人负责人中的任一成员登录后都能看到分配给自己的任务，子任务按最多两层的父子片段展示；列表样式与项目任务列表保持一致，支持任务树折叠 / 展开并记住上次折叠状态；支持按团队、项目、未完成、已完成、全部筛选，并支持按任务、父任务、团队、项目、清单搜索；已完成任务在右侧显示完成人和完成时间
- 单条或批量标记通知已读；点击通知任务链接时会自动标记已读；通知支持未读筛选并显示相对时间
- 后端每 10 分钟扫描未来 24 小时内到期任务，生成站内提醒

## 当前环境备注

- 本项目仍处于开发阶段，数据库结构变更优先使用 `npm run dev:reset` 清空开发数据并重建 schema / seed，不保留旧 schema 兼容路径。
- Prisma CLI 的部分迁移命令在本机曾触发 schema engine 错误；因此 `npm run prisma:migrate` 已改为直接按顺序执行仓库内 SQL 迁移文件。
- `npm run test`、`npm run typecheck`、`npm run build` 和 `npm run check:v0` 已通过。
- `npm run test:integration` 会连接本地 PostgreSQL，运行前需要先确保 `npm run doctor` 的数据库检查通过。
- `npm run test:e2e` 会通过 Playwright 自动启动后端和前端，并用 Chromium 跑浏览器验收；首次运行前如果提示缺少浏览器，请执行 `npx playwright install chromium`。
- 如果本机已经通过 `npm run dev:up` 启动了前后端，使用 `npm run test:e2e:reuse` 复用现有服务，避免端口已占用导致 Playwright 中止。
- `npm run test:acceptance` 会依次运行后端集成测试和前端 E2E，适合 V0 回归验收。
- 如果本机已经启动了前后端，使用 `npm run test:acceptance:reuse` 跑完整验收。
