# Tower Lite v1.5.0 Release Notes

发布日期：待定

## 版本定位

`v1.5.0` 是 Tower Lite 第一个对外发布准备版本，覆盖团队 / 项目协作、任务看板、任务列表、任务详情、通知、审计日志、回收站、邮箱验证、飞书登录 / 通知，以及项目级甘特图排期能力。

## 主要功能

- 系统管理员可通过环境变量初始化，负责创建团队、指定团队管理员和管理平台级入口。
- 团队支持成员管理、邮箱预加成员、CSV 批量导入、成员角色管理和团队级审计日志。
- 项目支持项目成员管理、项目角色、归档 / 取消归档、项目回收站、项目级审计日志和飞书通知投递排查。
- 任务支持清单、看板、列表、任务详情、两级子任务、多人负责人、优先级、开始 / 截止日期、评论、标签、软删除和恢复。
- 工作台支持我的任务聚合、团队 / 项目筛选、任务树展示和通知中心。
- 通知支持站内实时通知、WebSocket 同步、任务负责人变更、状态变更、评论和 @ 提及。
- 邮箱体系支持注册邮箱验证、修改邮箱二次验证、开发环境验证链接查看、SMTP 正式发送和密码重置。
- 飞书体系支持飞书 OAuth 登录、机器人身份发送飞书通知、飞书回调校验、投递重试和投递记录清理。
- 甘特图支持“甘特图(任务)”和“甘特图(人员)”两种项目视图，支持天 / 周 / 月 / 季度缩放、任务树折叠、拖拽调整排期和人员排期汇总。

## 部署前配置

复制环境变量模板：

```bash
cp .env.online .env
```

`.env` 是服务器实际私密配置文件，不提交 git；`.env.online` 是线上部署模板，复制成 `.env` 后再填写真实 JWT、系统管理员密码、SMTP、飞书和访问地址。本地开发使用 `.env.local`；`.env.example` 仅作为完整字段参考。

正式环境至少确认以下配置：

```text
DATABASE_URL
REDIS_URL
JWT_ACCESS_SECRET
JWT_REFRESH_SECRET
APP_BASE_URL
DEPLOY_APP_BASE_URL
API_HOST
API_PORT
WEB_PORT
DEFAULT_ADMIN_EMAIL
DEFAULT_ADMIN_PASSWORD
DEFAULT_ADMIN_NAME
SMTP_HOST
SMTP_PORT
SMTP_USER
SMTP_PASSWORD
MAIL_FROM
EMAIL_DELIVERY_DISABLED
FEISHU_APP_ID
FEISHU_APP_SECRET
FEISHU_ENCRYPT_KEY
FEISHU_VERIFICATION_TOKEN
```

如果暂时不启用飞书通知，可以不配置飞书应用密钥；站内通知和 WebSocket 不受影响。如果暂时不启用正式邮件发送，开发环境可设置 `EMAIL_DELIVERY_DISABLED=1`。

## Docker 一键部署

`v1.5.0` 提供生产 Docker Compose 编排：

- `postgres`：PostgreSQL 16，持久化到 `postgres-data` 数据卷。
- `redis`：Redis 7，持久化到 `redis-data` 数据卷。
- `server`：编译后的 Express API，容器内监听 `0.0.0.0:4000`。
- `client`：Nginx 静态站点，代理 `/api` 和 WebSocket 到后端。

首次部署：

```bash
cp .env.online .env
npm run deploy:up
```

`deploy:up` 只读取 `.env`，不会自动读取 `.env.online`。每次在新服务器部署或切换环境前，都需要先复制模板并确认 `.env` 中的线上真实配置。

全新演示环境如需写入 seed：

```bash
npm run deploy:up:seed
```

默认访问地址：

```text
http://localhost:8080
```

正式域名部署时，需要把 `.env` 中的 `DEPLOY_APP_BASE_URL` 改成用户访问的外部地址；如果宿主机端口不是 `8080`，修改 `WEB_PORT`。

常用运维命令：

```bash
npm run deploy:logs
npm run deploy:down
npm run deploy:down:volumes
```

`deploy:down` 保留数据卷；`deploy:down:volumes` 会删除 PostgreSQL / Redis 数据卷并清空数据。

## 数据库

发布部署时执行：

```bash
npm run prisma:generate
npm run prisma:migrate
```

如果是全新环境，可以再执行 seed 写入演示数据：

```bash
npm run prisma:seed
```

对外发布后不要依赖清空数据库解决结构问题；后续结构变化应通过迁移脚本发布。

## 验收命令

发布前建议执行：

```bash
npm run typecheck
npm run test:integration
npm run test:e2e
npm run build
```

如果本地已经启动前后端，可以使用：

```bash
npm run test:e2e:reuse
```

一条命令验收：

```bash
npm run test:acceptance
```

## 冒烟测试

- 系统管理员登录后完成邮箱验证。
- 系统管理员创建团队，并指定团队管理员邮箱。
- 团队管理员添加团队成员、批量导入成员、创建项目。
- 项目管理员添加项目成员，并验证项目成员只能从团队成员中选择。
- 创建任务、子任务、评论、@ 提及，确认站内通知和 WebSocket 同步。
- 修改任务负责人、状态、优先级、开始日期和截止日期，确认工作台、看板、列表和甘特图刷新。
- 验证任务删除 / 恢复 / 彻底删除、清单删除 / 恢复、项目删除 / 恢复 / 彻底删除。
- 验证飞书登录、飞书通知投递、失败重试和投递记录清理。
- 验证邮箱修改、重新发送验证邮件、取消邮箱变更和密码重置。

## 已知限制

- 当前子任务开放两级，底层模型预留多层能力。
- 当前任务依赖、依赖线 UI、循环依赖校验和自动排程尚未实现。
- 甘特图是项目级视图；跨项目排期总览尚未实现。
- 系统管理员是平台管理身份，不默认成为团队或项目成员；需要作为业务成员参与任务时，应通过团队 / 项目成员入口显式添加。
- 邮箱预加成员依赖邮箱验证或飞书返回同邮箱来完成认领；未验证邮箱不能认领成员身份。

## 发布操作建议

确认验收通过后提交发布准备改动，并打 tag：

```bash
git tag v1.5.0
git push
git push origin v1.5.0
```
