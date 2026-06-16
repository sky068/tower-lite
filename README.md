# Tower Lite

Tower Lite 是一个轻量级团队协作与项目任务管理系统，提供工作台、团队与项目管理、任务看板、任务列表、任务详情、通知、审计日志、回收站、飞书登录 / 通知、邮箱验证，以及项目级甘特图能力。

## 功能概览

- 系统管理员、团队管理员、项目管理员和项目成员权限体系。
- 团队成员预添加、邮箱认领、CSV 批量导入和成员管理。
- 项目看板、清单、列表视图、任务树、两级子任务和多人负责人。
- 任务优先级、开始 / 截止日期、状态、评论、@ 提及和实时通知。
- 项目级甘特图，包括任务甘特图和人员甘特图。
- 项目 / 清单 / 任务软删除、恢复、彻底删除和审计日志。
- 邮箱验证、修改邮箱二次验证、密码重置和 SMTP 邮件发送。
- 飞书 OAuth 登录、飞书机器人通知、投递记录和失败重试。
- Docker Compose 一键部署。

## 技术栈

- 前端：React、Vite、TypeScript、TanStack Query、Zustand、React Router、Lucide React。
- 后端：Node.js、Express、TypeScript、Prisma、PostgreSQL、Redis、BullMQ、WebSocket、Zod。
- 测试：Node test runner、Playwright。
- 部署：Docker Compose、Nginx、PostgreSQL、Redis。

## 开源组件

本工程使用了多个开源组件和运行时镜像，包括但不限于 React、Vite、Express、Prisma、PostgreSQL、Redis、TanStack Query、BullMQ、Zod、Playwright、Nginx 等。

Tower Lite 自身代码按本仓库 `LICENSE` 文件声明的 MIT License 发布。第三方依赖、工具链和容器镜像仍分别遵循其原始项目的开源协议和使用条款；发布或再分发时请同时遵守这些依赖的许可证要求。

## 快速开始

进入实际工程目录：

```bash
cd code
```

安装依赖：

```bash
npm install
```

准备本地配置：

```bash
cp .env.local .env
```

启动本地开发环境：

```bash
npm run dev:all
```

默认访问地址：

```text
http://localhost:5173
```

更多本地启动、重置数据库和测试说明见：

- `code/README.md`
- `code/docs/local-testing.md`

## Docker 部署

进入工程目录并准备线上配置：

```bash
cd code
cp .env.online .env
```

编辑 `.env`，至少确认：

- `APP_BASE_URL`
- `DEPLOY_APP_BASE_URL`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `DEFAULT_ADMIN_EMAIL`
- `DEFAULT_ADMIN_PASSWORD`
- SMTP 配置
- 飞书应用配置

启动生产 Docker Compose：

```bash
npm run deploy:up
```

查看日志：

```bash
npm run deploy:logs
```

停止服务：

```bash
npm run deploy:down
```

更完整的发布说明见：

- `code/docs/release-v1.5.0.md`

## 测试

```bash
cd code
npm run typecheck
npm run test:integration
npm run test:e2e
npm run build
```

一条命令运行主要验收：

```bash
npm run test:acceptance
```

## 许可证

本项目采用 MIT License，详见 `LICENSE`。
