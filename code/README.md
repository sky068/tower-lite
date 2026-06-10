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
npm run dev:client
npm run dev:server
npm run dev:up
npm run dev:down
npm run dev:init
npm run dev:reset
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
- `PATCH /api/v1/users/me/profile`
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
- `PATCH /api/v1/teams/:teamId/members/:userId/role`
- `DELETE /api/v1/teams/:teamId/members/:userId`

邀请：

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
- `PATCH /api/v1/projects/:projectId/members/:userId/role`
- `DELETE /api/v1/projects/:projectId/members/:userId`

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

## V0.2 邀请流程规则

V0.2 增加团队邀请和项目邀请，当前只生成站内邀请链接，不发送邮件或飞书消息：

- 团队 OWNER 可以创建团队邀请、查看团队邀请记录、撤销待接受的团队邀请。
- 项目 ADMIN 或团队 OWNER / ADMIN 可以创建项目邀请、查看项目邀请记录、撤销待接受的项目邀请。
- 邀请链接需要登录后接受；如果未登录，会先进入登录页，登录或注册成功后继续接受邀请。
- 接受邀请时，当前登录邮箱必须和邀请邮箱一致，否则后端会拒绝。
- 团队邀请只会把用户加入团队，不会自动加入团队下的项目。
- 普通团队成员只能看到自己已经加入的项目；团队 OWNER / ADMIN 可以看到团队下全部项目。
- 项目邀请会同时把用户加入团队和指定项目，团队角色默认 `MEMBER`，项目角色默认 `EDITOR`。
- 已接受的邀请重复打开会返回成功，不会重复创建团队成员或项目成员。
- 已接受、已撤销或已过期的邀请不能再撤销。
- 接受邀请、撤销邀请和邀请状态变化会通过 WebSocket 刷新相关成员、项目和邀请记录。

## V0.3 审计日志规则

V0.3 增加团队和项目的操作日志，用于管理者回溯关键操作：

- 团队审计日志入口只对团队 `OWNER` 显示，后端接口也只允许团队 `OWNER` 访问。
- 项目审计日志入口只对项目 `ADMIN`、团队 `OWNER`、团队 `ADMIN` 显示，后端接口使用同样的权限校验。
- 团队设置中的团队审计日志只展示团队管理层事件：团队成员添加、角色调整、移除，团队邀请创建、撤销、接受，以及项目创建、归档、取消归档、删除、恢复、彻底删除。
- 项目设置中的项目审计日志展示当前项目事件：项目更新、归档、删除，项目成员添加、角色调整、移除，项目邀请创建、撤销、接受。
- 任务协作日志只展示在项目审计日志中，记录清单创建、更新、删除、排序，任务创建、更新、移动、状态变更、删除，以及评论创建、删除。
- 日志保留操作者、操作时间、团队、项目、任务和简要 metadata；当前 V0.3 只提供最近 100 条记录，不提供导出或全文搜索。
- 日志用于审计和排查，不替代通知；通知仍通过 WebSocket 推送给相关负责人。

## V0.4 回收站规则

V0.4 启用项目回收站，用于恢复误删任务和清单：

- 回收站入口只对项目 `ADMIN`、团队 `OWNER`、团队 `ADMIN` 显示，后端接口使用同样权限校验；回收站列表显示删除人和删除时间。
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
- 飞书账号绑定由 OAuth 登录自动完成，账号设置不提供手动填写 `Open ID` / `Union ID` 的入口。
- 所有站内通知统一写入 `Notification`，并固定创建 `IN_APP/SENT` 投递记录。
- 如果接收人已绑定飞书 `Open ID`，创建站内通知时会额外创建 `FEISHU/PENDING` 投递记录。
- 后端启动时如果配置了 `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET`，会启动飞书投递 worker，定期发送待投递消息。
- 飞书通知使用机器人卡片消息发送，卡片包含通知标题、正文和详情入口。
- 飞书消息发送失败会记录 `lastError` 并增加 `attemptCount`，最多重试 3 次。
- 项目设置中的飞书投递列表支持按状态筛选；失败、跳过或待发送记录可以由项目管理员手动重试。
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

飞书事件回调地址为 `POST /api/v1/feishu/webhook`，支持 URL verification challenge、token 校验、加密 payload 解密和事件幂等记录。项目管理员可通过 `GET /api/v1/projects/:projectId/feishu-deliveries` 查看最近 100 条飞书通知投递状态、重试次数和失败原因，也可通过 `POST /api/v1/projects/:projectId/feishu-deliveries/:deliveryId/retry` 手动重试未成功投递。

如果投递失败原因显示“飞书应用缺少机器人发消息权限”，说明应用尚未开通应用身份发消息权限；在飞书开放平台开通 `im:message:send` 后，需要发布版本并等待企业管理员审核生效，再重启后端服务验证。

如果投递失败原因显示“飞书应用尚未启用机器人能力”，说明应用后台没有开启机器人；启用机器人能力、发布版本并审核生效后，再重启后端服务验证。

## 当前前端已接入流程

- 注册账号
- 登录账号
- 右上角头像菜单展示用户名字和邮箱，并提供账号设置和退出登录
- 账号设置支持修改名字、绑定邮箱、上传自定义头像、恢复默认头像和修改密码，并统一通过一个保存按钮提交
- 团队成员、项目成员、任务负责人和负责人选择器统一展示用户头像；未上传头像时显示默认头像
- 创建团队
- 查看我的团队
- 工作台团队列表和项目列表超过三行半后在列表内部滚动，避免撑高页面
- 团队名称不能与现有未删除团队重名
- 选择团队
- 创建项目
- 查看项目列表
- 同一团队内未删除项目不能重名
- 进入项目看板并读取后端任务清单
- 看板任务卡显示多位负责人头像、状态、截止日期、子任务数量和标签
- 已被移出项目的历史负责人会保留在任务上，并显示为“姓名(已移除)”
- 看板支持按关键词、负责人、优先级、完成状态筛选任务；筛选会同时检查子任务，子任务命中时保留顶层任务卡片
- 项目列表页支持按清单分组展示全部任务，任务按父子树形结构显示，清单分组和任务树节点均可折叠
- 项目列表页表头为任务标题、优先级、截止时间、负责人；优先级以固定小方形标签展示，截止时间有开始日期时显示为开始-截止，负责人显示头像和名字
- 项目列表页和看板使用一致的搜索、负责人、优先级、完成状态筛选；子任务命中时保留父任务上下文
- 项目、任务不存在或无权限时显示正式状态页，提供返回工作台或上一页入口
- 在看板或项目列表页的清单标题右侧点击加号可直接为该清单创建任务，默认分配给当前用户
- 通过新建任务弹窗创建任务，可以直接选择状态、多位负责人、优先级、开始日期和截止日期
- 打开任务详情，编辑标题和描述
- 从工作台或看板打开任务详情时使用背景路由弹窗，底层页面不卸载，URL 会同步为 `/tasks/:taskId`
- 直接打开 `/tasks/:taskId` 链接时显示独立任务详情，关闭或返回时进入工作台
- 设置任务状态、多位负责人、优先级、开始日期和截止日期，并在前端校验日期范围；负责人支持新增指派和取消指派
- 在任务详情里创建最多两级子任务，并为子任务单独设置多位负责人、开始日期和截止日期
- 子任务可以从父任务详情里打开，作为独立任务继续编辑
- 在任务详情里添加评论，并通过输入 `@` 提及项目成员
- 评论作者可以删除自己的评论
- 在任务详情里移动任务到其他清单
- 在任务详情里一键标记任务为已完成；看板任务卡和工作台“我的任务”右侧会显示完成人和完成时间，如今天、昨天或具体日期
- 删除仍有子任务的父任务会被后端拒绝，避免产生孤立子任务
- 拖拽任务到同一清单或其他清单，只更新清单归属和排序，不改变任务状态
- 创建项目时自动生成“默认清单”；创建、重命名、删除、排序看板清单；清单只负责任务分组，任务状态独立为待处理、进行中、已完成
- 清单标题区默认显示清单名称和加号；看板清单在有管理权限时加号右侧显示三点菜单，可通过三点菜单进入编辑清单，编辑态才显示拖拽排序、重命名、保存和取消操作；删除有任务的清单时必须二次确认，确认后会连同清单内任务一起删除
- 工作台提供团队级项目回收站，团队 OWNER / ADMIN 可查看已删除项目、删除人和删除时间，并恢复或彻底删除软删除项目；彻底删除需要二次确认，恢复项目遇到同团队同名未删除项目时会提示冲突，不自动改名
- 项目回收站支持查看、恢复和彻底删除已删除任务与清单；恢复清单遇到同名未删除清单时会提示冲突，不自动改名
- 项目归档后可以在项目设置中取消归档，恢复正常协作
- 创建标签并给任务添加或移除标签
- 管理团队成员
- 团队 OWNER 可以创建团队邀请，复制邀请链接给指定邮箱用户；邀请接受前可以撤销，接受邀请时要求当前登录邮箱和邀请邮箱一致
- 项目 ADMIN 或团队 OWNER / ADMIN 可以创建项目邀请，接受后会同时加入团队和项目；V0.2 仅生成站内邀请链接，不发送邮件
- 团队 OWNER 可以在团队设置查看审计日志；项目 ADMIN 或团队 OWNER / ADMIN 可以在项目设置查看审计日志
- 从团队成员下拉列表添加项目成员，管理项目成员、归档项目、删除项目
- 已归档项目的看板进入只读状态，后端也会拒绝任务、清单、标签和评论写操作
- 在工作台查看我的任务；右上角通知入口支持查看最近通知和打开全部通知弹窗
- 我的任务包含分配给自己的顶层任务和子任务；多人负责人中的任一成员登录后都能看到分配给自己的任务，子任务按最多两层的父子片段展示，且支持按项目下拉、未完成、已完成、全部筛选，并支持按任务、父任务、项目、清单搜索；已完成任务在右侧显示完成人和完成时间
- 单条或批量标记通知已读；点击通知任务链接时会自动标记已读；通知支持未读筛选并显示相对时间
- 后端每 10 分钟扫描未来 24 小时内到期任务，生成站内提醒

## 当前环境备注

- 本项目仍处于开发阶段，数据库结构变更优先使用 `npm run dev:reset` 清空开发数据并重建 schema / seed，不保留旧 schema 兼容路径。
- Prisma CLI 的部分迁移命令在本机曾触发 schema engine 错误；因此 `npm run prisma:migrate` 已改为直接按顺序执行仓库内 SQL 迁移文件。
- `npm run test`、`npm run typecheck`、`npm run build` 和 `npm run check:v0` 已通过。
- `npm run test:integration` 会连接本地 PostgreSQL，运行前需要先确保 `npm run doctor` 的数据库检查通过。
- `npm run test:e2e` 会通过 Playwright 自动启动后端和前端，并用 Chromium 跑浏览器验收；首次运行前如果提示缺少浏览器，请执行 `npx playwright install chromium`。
- `npm run test:acceptance` 会依次运行后端集成测试和前端 E2E，适合 V0 回归验收。
