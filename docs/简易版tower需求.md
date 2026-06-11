# 简化版 Tower 可开发规格文档

版本：v1.0

更新时间：2026-06-05

## 1. 产品定位

本项目是一个面向中小型团队的轻量任务协作工具，核心能力是：

- 项目看板
- 任务详情与评论
- 我的任务
- 站内通知
- 飞书协作通知
- 甘特图排期

第一版应优先保证任务管理闭环稳定可用，再逐步接入飞书和甘特图高级能力。

## 2. 开发分期

### V0：基础可用版

目标：完成团队内项目和任务的基础协作闭环。

包含：

- 邮箱注册、登录、退出
- 创建团队、团队成员列表
- 创建项目、编辑项目、归档项目
- 项目成员管理
- 看板视图
- 任务清单创建、重命名、排序、删除
- 任务创建、编辑、删除、拖拽移动
- 任务字段：标题、描述、多位负责人、优先级、开始日期、截止日期、标签
- 任务详情内创建、编辑、完成最多两级子任务
- 子任务数据结构使用 `parentId` 预留未来多层能力，但 V0.1 接口限制最大深度为 2
- 任务评论
- 我的任务
- 站内通知
- WebSocket 实时事件推送，用于通知、任务、项目、团队和标签变更后的前端同步
- 团队级项目回收站，支持恢复或彻底删除软删除项目
- 项目回收站，支持恢复或彻底删除已删除任务和清单

不包含：

- 飞书 OAuth 登录
- 飞书消息通知
- 甘特图拖拽
- 任务依赖
- 文件上传

### V1：飞书协作版

目标：让任务变化可以通过飞书触达负责人或被提及成员。

包含：

- 飞书账号绑定
- 飞书 OAuth 登录
- 任务分配飞书通知
- 评论 @ 成员飞书通知
- 截止前 24 小时飞书提醒
- 飞书通知失败重试
- 飞书回调验签与事件接收

V1.0 先落地飞书登录与通知基础设施：登录页支持飞书 OAuth 登录，成功后优先按飞书邮箱匹配或创建本地账号，并绑定飞书 `Open ID` / `Union ID`；如果飞书未返回邮箱，则使用 `${open_id}@feishu.local` 作为本地兜底邮箱，保证用户仍可登录，后续可在账号设置里修改为真实绑定邮箱；飞书账号绑定由 OAuth 登录自动完成，账号设置不提供手动填写 `Open ID` / `Union ID` 的入口；站内通知创建时同步创建飞书投递记录，后端 worker 在配置飞书应用密钥后发送和重试；飞书事件回调验签作为后续 V1.x 能力继续补齐。

### V2：甘特图排期版

目标：支持项目维度排期和任务依赖管理。

包含：

- 甘特图只读展示
- 周 / 月 / 季度缩放
- 按负责人、标签筛选
- 拖拽调整任务开始 / 结束日期
- 任务依赖连线
- 依赖循环校验

V2.0 先落地项目级甘特图排期基础能力：项目菜单增加“甘特图”入口，读取现有任务开始日期和截止日期生成时间轴；默认按天展示，支持天 / 周 / 月 / 季度缩放，时间轴日期使用两位年份以支持跨年排期识别；支持关键词、负责人、优先级、完成状态筛选，筛选命中子任务时保留父任务上下文。甘特图按项目级父子关系展示任务树，任务树节点可折叠，折叠状态按项目记忆；搜索或筛选时默认展开匹配路径，用户仍可在筛选结果中临时折叠任务树。点击任务名称或时间轴任务条打开任务详情。甘特图任务列和未排期任务显示负责人头像，鼠标悬停头像时显示负责人姓名；超过 15 条任务时，排期区或未排期区使用独立滚动。具备任务编辑权限且项目未归档时，可以左右拖动有完整起止时间的任务条中间区域来整体调整开始 / 截止日期，拖动只允许横向移动，松手时按任务条左端移动后的时间格作为新开始时间，并保持任务原持续时间不变；也可以拖动任务条左边缘单独调整开始日期，拖动右边缘单独调整截止日期，调整时任务至少保留 1 个时间格长度。有完整自身排期的任务条统一显示绿色；任务状态为已完成时，任务条统一显示灰色。父任务没有真实日期但子孙任务有真实排期时，父任务显示红色汇总条，范围取子孙任务最早开始日期到最晚截止日期；汇总条只用于展示和打开详情，不写回父任务日期，也不支持拖动改期。子任务没有真实日期时不继承父任务日期，不显示时间条；未排期任务可以在任务树中作为空白行出现，所在任务树没有任何真实排期时归入“未排期任务”，暂不支持依赖连线。

## 3. 角色与权限

### 3.1 系统与团队角色

| 角色 | 说明 |
|------|------|
| 系统 ADMIN | 部署管理员，可创建和删除团队，设置默认团队 / 默认项目，并可管理所有团队和项目 |
| 团队 ADMIN | 团队管理员，可管理团队信息、成员、邀请、团队内项目和项目成员 |
| 团队 MEMBER | 普通成员，可参与被授权的项目 |

### 3.2 项目角色

| 角色 | 说明 |
|------|------|
| ADMIN | 项目管理员，可管理项目基础信息、生命周期和项目成员 |
| EDITOR | 任务协作者，可创建、编辑、分配任务，评论任务，并管理标签 |
| VIEWER | 只读查看项目内容 |

系统 ADMIN 拥有所有团队和项目的管理权限，但不自动计入团队 ADMIN；团队 ADMIN 默认拥有团队内所有项目的管理权限。

当前 V0 实现中，项目成员三种权限的区别如下：

| 能力 | ADMIN | EDITOR | VIEWER |
|------|-------|--------|--------|
| 查看项目、看板、任务详情、标签、项目成员 | 是 | 是 | 是 |
| 查看“我的任务”中分配给自己的任务 | 是 | 是 | 是 |
| 创建、编辑、移动、删除任务 | 是 | 是 | 否 |
| 创建、编辑、删除最多两级子任务 | 是 | 是 | 否 |
| 创建评论、删除自己发布的评论 | 是 | 是 | 否 |
| 删除他人的评论 | 是 | 否 | 否 |
| 创建、编辑、删除标签，给任务增删标签 | 是 | 是 | 否 |
| 创建、重命名、排序、删除看板清单 | 是 | 否 | 否 |
| 编辑项目基础信息 | 是 | 否 | 否 |
| 添加、移除项目成员，修改项目成员角色 | 是 | 否 | 否 |
| 归档项目、删除项目 | 是 | 否 | 否 |

补充规则：

- 系统 ADMIN 是系统级兜底权限；团队 ADMIN 负责团队日常管理，即使不是项目成员，也拥有团队内已有项目的管理权限，等同或高于项目 ADMIN。
- VIEWER 只能查看已授权项目内容，不能创建评论，也不能修改任务、清单、标签或项目设置。
- EDITOR 聚焦任务协作，可以创建、编辑、移动、删除任务和子任务，也可以分配负责人，但不能修改项目基础信息、管理项目成员、管理看板清单或归档/删除项目。
- 项目归档后，ADMIN / EDITOR 也不能继续修改任务、清单、标签或评论；归档项目以只读方式展示。
- 项目至少保留一名 ADMIN；最后一名项目 ADMIN 不允许被降级或移除。

### 3.3 权限矩阵

| 操作 | 系统 ADMIN | 团队 ADMIN | 项目 ADMIN | 项目 EDITOR | 项目 VIEWER |
|------|------------|------------|------------|-------------|-------------|
| 创建 / 删除团队 | 是 | 否 | 否 | 否 | 否 |
| 设置默认团队 / 默认项目 | 是 | 否 | 否 | 否 | 否 |
| 修改团队信息 | 是 | 是 | 否 | 否 | 否 |
| 邀请 / 移除团队成员 | 是 | 是 | 否 | 否 | 否 |
| 创建项目 | 是 | 是 | 否 | 否 | 否 |
| 修改项目基础信息 | 是 | 是 | 是 | 否 | 否 |
| 归档项目 | 是 | 是 | 是 | 否 | 否 |
| 删除项目 | 是 | 是 | 是 | 否 | 否 |
| 管理项目成员 | 是 | 是 | 是 | 否 | 否 |
| 管理看板清单 | 是 | 是 | 是 | 否 | 否 |
| 创建 / 编辑任务 | 是 | 是 | 是 | 是 | 否 |
| 删除任务 | 是 | 是 | 是 | 是 | 否 |
| 评论任务 | 是 | 是 | 是 | 是 | 否 |
| 查看项目 | 是 | 是 | 是 | 是 | 是 |

实现要求：

- 所有后端接口必须做服务端权限校验。
- 前端隐藏无权限操作按钮，但不能只依赖前端判断。
- 用户必须是团队成员，才可以成为项目成员或任务负责人。
- 系统 ADMIN 如果没有被加入团队 / 项目成员，不应出现在任务负责人或 @ 提及候选列表中；系统 ADMIN 只有在同时是项目成员时才可以被指派。
- 系统 ADMIN 是平台管理身份，不默认进入业务协作关系；系统 ADMIN 创建项目时必须指定一名当前团队成员作为项目 ADMIN。

## 4. 核心业务规则

### 4.1 团队

- 系统管理员账号可通过 `.env` 的 `DEFAULT_ADMIN_EMAIL`、`DEFAULT_ADMIN_PASSWORD`、`DEFAULT_ADMIN_NAME` 初始化；普通用户注册或登录后默认不是系统管理员。
- 只有系统 ADMIN 可以创建团队；创建团队时必须填写团队管理员邮箱。
- 如果管理员邮箱对应账号已存在，系统直接把该用户加入团队并设为团队 ADMIN；如果账号不存在，系统生成一条团队 ADMIN 邀请。
- 如果被邀请邮箱的用户未通过邀请链接而是自行注册或登录，后端会自动接受匹配邮箱的待接受团队 ADMIN 邀请，并把该用户设为团队 ADMIN。
- 系统 ADMIN 不自动计入团队 ADMIN；每个团队必须至少保留一名团队 ADMIN，或至少保留一条待接受且未过期的团队 ADMIN 邀请。
- 降级 / 移除最后一名团队 ADMIN、撤销最后一条团队 ADMIN 邀请时，后端必须拒绝。
- 删除团队仅允许系统 ADMIN 操作，且需要二次确认。
- 系统 ADMIN 可以把任意已有团队成员设为团队 ADMIN，也可以向任意邮箱生成团队 ADMIN 邀请。
- 系统 ADMIN 可在团队详情页里设置或取消默认团队；默认团队用于普通用户注册或登录时自动加入。
- 团队下仍存在未删除项目时，不允许删除团队，必须先删除团队下所有项目。
- 团队删除为软删除，仅写入 `deletedAt`，不物理删除团队、成员或历史协作数据。
- 同一用户可以加入多个团队。
- 团队邀请和项目邀请生成后需要展示邀请链接；待接受邀请记录中的邀请链接需要提供复制按钮。
- 未删除团队之间不允许重名。

### 4.2 项目

- 项目必须属于某个团队。
- 团队 ADMIN 创建项目时，如果未指定项目管理员，则创建人自动成为项目 ADMIN。
- 系统 ADMIN 创建项目时必须指定项目管理员，且该管理员必须是当前团队成员；系统 ADMIN 自己不会因为创建项目而自动成为项目成员或任务负责人候选。
- 项目归档后默认不可新建任务、移动任务、发表评论。
- 项目归档后可以由系统 ADMIN、项目 ADMIN 或团队 ADMIN 取消归档，取消归档后恢复正常协作。
- 项目删除为软删除，保留数据用于恢复和审计。
- 系统 ADMIN 或团队 ADMIN 可在团队详情页打开团队级项目回收站，查看已删除项目、删除人和删除时间，并恢复项目。
- 系统 ADMIN 可在项目设置里设置或取消默认项目；默认项目必须属于默认团队，设置默认项目时会同步把项目所属团队设为默认团队。
- 普通用户注册或登录时，如果存在默认团队 / 默认项目，后端会幂等地把用户加入默认团队为 MEMBER、加入默认项目为 EDITOR；用户工作台刷新时仍优先保留个人上次选择的团队和项目。
- 恢复项目时如果同一团队已有同名未删除项目，恢复失败，不自动改名。
- 同一团队内未删除项目不允许重名。

### 4.2.1 系统管理员和默认团队 / 默认项目配置流程

1. 部署时在 `.env` 配置 `DEFAULT_ADMIN_EMAIL`、`DEFAULT_ADMIN_PASSWORD`、`DEFAULT_ADMIN_NAME`。
2. 后端启动时读取默认管理员配置：如果邮箱已存在，则把该用户升级为系统 ADMIN；如果邮箱不存在，则自动创建系统 ADMIN 账号。
3. 系统 ADMIN 登录后从左侧团队分组创建团队，并填写团队管理员邮箱。
4. 如果团队管理员邮箱对应账号已存在，系统直接把该用户加入团队并设为团队 ADMIN；如果账号不存在，系统生成团队 ADMIN 邀请。
5. 系统 ADMIN 可在团队详情页里设置或取消默认团队。
6. 系统 ADMIN 创建项目时必须选择当前团队成员作为项目 ADMIN；系统 ADMIN 不会因为创建项目而自动成为项目成员。
7. 系统 ADMIN 可在项目设置里设置或取消默认项目；设置默认项目时会同步把项目所属团队设为默认团队。
8. 普通用户注册或登录时，如果存在默认团队 / 默认项目，系统会自动加入默认团队为 MEMBER、加入默认项目为 EDITOR。

### 4.2.2 导航信息架构

- 左侧边栏是应用主导航，包含工作台、团队、项目三类入口。
- 工作台只承载个人视角内容，例如我的任务和通知入口，不再承载完整团队 / 项目管理列表。
- 团队入口下展示当前用户可见的所有团队；系统 ADMIN 额外显示创建团队入口。
- 点击团队进入团队详情页，展示团队基础信息、团队成员和团队项目；团队 ADMIN / 系统 ADMIN 额外显示邀请成员、邀请记录、成员操作、默认团队、审计日志和删除团队等管理内容。
- 项目入口按团队分组展示当前用户可访问的项目；系统 ADMIN 和团队 ADMIN 可看到管理范围内的项目，并可从对应团队项目分组的加号创建项目。
- 点击项目进入该项目看板；项目内部继续通过顶部菜单切换看板、列表、甘特图、设置和回收站。
- 甘特图是项目视图，始终放在项目内，不作为左侧全局入口；未来如果做跨项目排期，应单独设计为“排期总览”。

### 4.3 看板清单

- 项目创建时自动生成一个名为“默认清单”的清单，不自动生成待处理、进行中、已完成三列。
- 清单只负责任务分组，不表达任务状态。
- 清单支持创建、重命名、排序和删除，且同一项目内不允许清单重名。
- 看板和项目列表页的清单标题右侧显示加号，点击后在该清单内新建任务；看板清单在有清单管理权限时，加号右侧显示三点菜单。
- 清单三点菜单提供“编辑清单”和“删除清单”；只有进入编辑模式后才显示拖拽排序、重命名、保存和取消。
- 新建任务不传清单时默认进入项目的第一个清单；后端保留无清单异常数据的默认清单兜底。
- 默认清单不能编辑、删除或排序，不显示相关操作入口。
- 删除清单时，如果清单内有任务，必须二次确认；确认后删除清单，并连同清单内任务及其子任务一起删除。
- 删除清单为软删除；清单内当前未删除任务会跟随清单进入回收站，恢复清单时仅恢复本次跟随清单删除的任务。
- 恢复清单时如果当前项目已存在同名未删除清单，后端拒绝恢复并提示用户先处理重名清单，不自动加后缀。
- 项目列表页按清单分组展示全部任务，清单分组可折叠；清单内任务按父子树形结构展示，任务树节点可折叠。
- 项目列表页使用统一表头：任务标题、优先级、截止时间、负责人；优先级以固定小方形标签展示，截止时间有开始日期时显示为开始-截止，没有开始日期时只显示截止时间，负责人显示头像和名字。
- 项目列表页和看板使用一致的关键词、负责人、优先级、完成状态筛选；筛选命中子任务时必须保留父任务上下文。看板仍只展示顶层任务卡，子任务命中时展示对应顶层任务卡。
- 项目甘特图使用任务开始日期和截止日期展示排期，默认按天展示，并支持天 / 周 / 月 / 季度缩放；筛选规则与看板和项目列表页保持一致，点击任务名称或任务条进入任务详情；甘特图按项目级父子关系展示任务树，任务树节点可折叠并按项目记忆折叠状态，筛选时默认展开且仍可临时折叠；有完整自身排期的任务条统一显示绿色；任务状态为已完成时，任务条统一显示灰色；父任务没有真实日期但子孙任务有真实排期时，父任务显示红色汇总条，范围取子孙任务最早开始日期到最晚截止日期；汇总条只用于展示和打开详情，不写回父任务日期，也不支持拖动改期；子任务没有真实日期时不继承父任务日期，不显示时间条；未排期任务可以在任务树中作为空白行出现，所在任务树没有任何真实排期时归入“未排期任务”；任务列和未排期任务显示负责人头像，头像悬停显示负责人姓名；超过 15 条任务时使用独立滚动；具备任务编辑权限且项目未归档时，可左右拖动完整排期任务条中间区域整体调整排期，排期位置按任务条左端所在时间格计算；拖动任务条左边缘单独调整开始日期，拖动右边缘单独调整截止日期。

### 4.4 任务

- 任务必须属于一个任务清单，任务清单必须属于一个项目。
- 任务和子任务均支持多位负责人，负责人必须是项目成员。
- 新建任务默认负责人只能取当前项目成员；系统 ADMIN 仅有管理权限但不是项目成员时，不自动设为负责人。
- 任务和子任务均必须支持状态选择，状态独立于清单，固定为待处理、进行中、已完成。
- 任务和子任务负责人必须可编辑，支持新增指派和取消指派。
- 团队成员、项目成员、任务负责人展示和负责人选择器应显示用户头像；未上传头像时显示默认头像。
- 被指定为任一负责人后，该用户登录后必须能在“我的任务”中看到对应任务或子任务。
- 成员从项目或团队移除后，历史任务负责人关系必须保留，不得从任务中自动清理；任务详情和看板中应显示为 `姓名(已移除)`。
- 已移除负责人不再收到任务完成或到期提醒，也不能再通过“我的任务”访问无权限项目。
- 子任务和父任务必须属于同一个项目。
- 子任务数据模型使用 `parentId` 邻接表结构，预留未来多层子任务能力。
- V0.1 产品和 API 支持最多两级子任务，即普通任务可以创建一级子任务，一级子任务可以继续创建二级子任务，二级子任务不能继续创建子任务。
- V0.1 创建子任务时，后端必须校验父任务深度不超过允许层级；违反时返回 `BUSINESS_RULE_VIOLATION`。
- 未来支持多层子任务时，需要补充最大层级、树形查询、节点移动、循环校验和父子完成状态联动规则。
- 任务开始日期不得晚于截止日期。
- 任务或子任务保存时，如果只填写开始日期未填写截止日期，则截止日期默认等于开始日期；如果只填写截止日期未填写开始日期，则开始日期默认等于截止日期。
- 移动任务只更新 `taskListId` 和排序字段，不改变任务状态。
- 任务状态使用固定枚举 `TaskStatus` 表达。
- 任务状态改为已完成时必须写入 `completedAt` 和 `completedById`；从已完成改为其他状态时必须清空完成信息。
- 看板任务卡和工作台“我的任务”列表需要展示已完成任务的完成人和完成时间，完成时间显示为今天、昨天或具体日期。
- 工作台“我的任务”需要使用与项目任务列表一致的任务树列表样式，主任务标题加粗加黑，子任务标题不加粗且字号小一号；支持任务树折叠 / 展开，并记住上次折叠状态。
- 工作台“我的任务”需要提供项目下拉筛选，默认选中全部项目；项目筛选与未完成、已完成、全部状态筛选并列展示，并与搜索条件共同生效。

### 4.4.1 项目回收站

- 团队详情页提供“项目回收站”入口，仅系统 ADMIN、当前团队 ADMIN 可见。
- 团队级项目回收站展示当前团队内软删除项目，并显示删除人和删除时间；恢复项目和彻底删除项目都需要二次确认。
- 项目菜单提供“回收站”入口，仅系统 ADMIN、项目 ADMIN、团队 ADMIN 可见。
- 回收站展示当前项目内已删除清单和单独删除的任务，并显示删除人和删除时间。
- 清单恢复需要二次确认；确认后恢复清单及跟随该清单删除的任务；如果当前存在同名未删除清单，恢复失败，不自动改名。
- 单独删除的任务可以恢复，恢复前需要二次确认；如果任务所在清单或父任务仍在回收站，必须先恢复清单或父任务。
- 彻底删除需要二次确认；彻底删除清单会物理删除清单内任务、评论、负责人、标签关联和依赖关系。
- 项目归档后回收站只读，不允许恢复或彻底删除。
- 恢复和彻底删除必须写入项目审计日志。

### 4.5 评论与 @ 成员

- 评论内容支持纯文本和 @ 成员标记。
- 任务详情评论区输入 `@` 时触发项目成员选择，用户选择项目成员后直接插入 `@姓名` 文本，并随评论提交 `mentionIds`。
- @ 成员必须是项目成员；后端必须校验 `mentionIds` 全部属于当前项目成员，否则返回 `BUSINESS_RULE_VIOLATION`。
- 评论需要保存被 @ 成员关系，便于后续飞书通知和审计排查；前端评论条目只展示评论正文中的 `@姓名`，不额外展示独立 @ 成员列表。
- 被 @ 的成员收到 `COMMENT_MENTION` 站内通知；评论作者本人不通知。
- 如果被 @ 成员同时也是任务创建者或负责人，只收到 @ 通知，不再重复收到“任务有新评论”通知。
- 删除评论仅允许评论作者、系统 ADMIN、项目 ADMIN、团队 ADMIN 操作。

### 4.6 标签

- 标签属于项目。
- 同一项目内标签名称唯一。
- 删除标签时自动解除任务关联。

### 4.7 通知

触发站内通知的事件：

- 任务被分配给用户
- 任务或子任务状态发生变化
- 任务截止前 24 小时
- 评论中 @ 用户
- 任务有新评论时，通知任务创建者和当前负责人；评论作者本人不通知，被 @ 的用户仅收到 @ 通知，避免重复通知
- 用户被加入项目

通知生成要求：

- 同一事件只生成一次通知，使用 `dedupeKey` 保证幂等。
- 通知应包含标题、正文、跳转链接、触发人、项目、任务。
- 站内通知生成成功不依赖飞书通知成功。
- V0 使用 WebSocket 向登录用户推送通知、任务、项目、团队和标签变更事件；前端收到事件后刷新对应查询缓存，不使用定时轮询。
- 系统 ADMIN 即使不是团队或项目成员，也应收到团队 / 项目管理相关 WebSocket 事件，用于刷新团队详情页、项目设置、邀请记录、默认团队 / 默认项目和回收站等管理视图。
- 项目管理员可按日期区间和状态手动清理飞书通知投递记录，但 `PENDING` 待发送记录不清理；清理操作必须二次确认，并写入项目审计日志。

### 4.8 审计日志

- 团队详情页中的团队审计日志只展示团队管理层事件：团队成员添加、角色调整、移除，团队邀请创建、撤销、接受，以及项目创建、归档、取消归档、删除、恢复、彻底删除。
- 项目设置中的项目审计日志只展示当前项目事件：项目更新、归档、删除，项目成员添加、角色调整、移除，项目邀请创建、撤销、接受，以及清单、任务、评论等项目协作事件。
- 任务创建、更新、移动、状态变更、删除，清单创建、更新、删除、排序，以及评论创建、删除，不应出现在团队详情页的团队审计日志中。
- 团队审计日志对系统 ADMIN、团队 ADMIN 可见；项目审计日志对系统 ADMIN、项目 ADMIN、团队 ADMIN 可见。
- 系统 ADMIN、团队 ADMIN 可按日期区间清理团队审计日志；系统 ADMIN、项目 ADMIN、团队 ADMIN 可按日期区间清理当前项目审计日志。清理操作不可恢复，必须二次确认，并写入新的“清理审计日志”记录，记录清理范围和删除数量。

## 5. 技术选型

### 5.1 前端

| 技术 | 选型 |
|------|------|
| 框架 | React 18 |
| 语言 | TypeScript |
| 构建 | Vite |
| 路由 | React Router v6 |
| 服务端状态 | TanStack Query |
| 客户端状态 | Zustand |
| 样式 | 原生 CSS，统一维护在前端样式文件 |
| 组件 | 项目内自研轻量组件 |
| 看板拖拽 | HTML5 Drag and Drop，后端事务持久化排序 |
| 甘特图 | DHTMLX Gantt 或可替代甘特图库 |
| 请求 | Axios |
| 表单 | React 受控表单，后端 Zod 校验 |

注意：

- 如果项目闭源或商业化，需要在 V2 前确认 DHTMLX Gantt 授权是否满足使用场景。
- V0 不引入 Socket.io；使用 `ws` 实现轻量 WebSocket 事件通道，前端收到事件后通过 TanStack Query 精准失效相关缓存。

### 5.1.1 前端控件规范

- 所有表单控件使用统一轻量风格：白色背景、浅灰边框、8px 左右圆角、蓝色 focus ring。
- 普通下拉框必须去掉系统原生外观，统一使用项目内的自定义箭头、边框、圆角和间距。
- 新增输入框、下拉框、文本域和按钮时，优先复用现有 CSS 类，不为单个入口临时写一套不一致的控件样式。
- 侧边栏宽度固定为 280px；侧边栏内表单、列表、下拉框和长文本必须限制在容器内，不能撑破边栏。
- 确认按钮使用蓝色实心样式；取消、删除、彻底删除等危险或中止操作使用红色实心样式和白色文字。

### 5.2 后端

| 技术 | 选型 |
|------|------|
| 运行时 | Node.js LTS |
| 框架 | Express |
| 语言 | TypeScript |
| ORM | Prisma |
| 数据库 | PostgreSQL |
| 队列 | BullMQ + Redis |
| 认证 | JWT access token + refresh token |
| 密码 | bcrypt 或 argon2 |
| 参数校验 | Zod |
| 日志 | pino |

### 5.3 飞书集成

| 能力 | 实现方式 |
|------|----------|
| 飞书登录 | OAuth 2.0 |
| 飞书账号绑定 | 通过 open_id / union_id 关联本地用户 |
| 单聊通知 | 飞书应用机器人 Bot API |
| 消息内容 | 飞书消息卡片 |
| 失败重试 | BullMQ，最多 3 次，指数退避 |
| 回调安全 | challenge 校验、签名校验、事件幂等 |

不建议用群自定义 Webhook 实现个人任务通知，因为它不适合按负责人进行一对一触达。

## 6. 数据模型

以下为 Prisma Schema 风格的核心模型。字段可在实现中按 Prisma 语法微调。

### User

```prisma
model User {
  id             String   @id @default(uuid())
  email          String   @unique
  passwordHash   String?
  name           String
  avatarUrl      String?
  systemRole     SystemRole @default(USER)
  feishuOpenId   String?  @unique
  feishuUnionId  String?  @unique
  emailVerifiedAt DateTime?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  deletedAt      DateTime?

  teamMembers    TeamMember[]
  projectMembers ProjectMember[]
  createdProjects Project[] @relation("ProjectCreator")
  invitationsSent Invitation[] @relation("InvitationInviter")
  taskAssignments TaskAssignee[]
  createdTasks   Task[] @relation("TaskCreator")
  comments       Comment[]
  notifications  Notification[] @relation("NotificationRecipient")
  notificationActions Notification[] @relation("NotificationActor")
}

enum SystemRole {
  USER
  ADMIN
}
```

### Team

```prisma
model Team {
  id        String   @id @default(uuid())
  name      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt DateTime?

  members   TeamMember[]
  projects  Project[]
  invites   Invitation[]
}
```

### TeamMember

```prisma
model TeamMember {
  id        String   @id @default(uuid())
  role      TeamRole
  userId    String
  teamId    String
  createdAt DateTime @default(now())

  user      User @relation(fields: [userId], references: [id])
  team      Team @relation(fields: [teamId], references: [id])

  @@unique([userId, teamId])
  @@index([teamId, role])
}

enum TeamRole {
  ADMIN
  MEMBER
}
```

### SystemSetting

```prisma
model SystemSetting {
  key         String   @id
  value       String?
  updatedById String?
  updatedAt   DateTime @updatedAt
}
```

### Project

```prisma
model Project {
  id          String        @id @default(uuid())
  name        String
  description String?
  color       String?
  icon        String?
  status      ProjectStatus @default(ACTIVE)
  teamId      String
  createdById String
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt
  deletedAt   DateTime?

  team        Team            @relation(fields: [teamId], references: [id])
  createdBy   User            @relation("ProjectCreator", fields: [createdById], references: [id])
  members     ProjectMember[]
  taskLists   TaskList[]
  tags        Tag[]
  tasks       Task[]
  invites     Invitation[]

  @@index([teamId, status])
}

enum ProjectStatus {
  ACTIVE
  ARCHIVED
}
```

### ProjectMember

```prisma
model ProjectMember {
  id        String      @id @default(uuid())
  role      ProjectRole
  projectId String
  userId    String
  createdAt DateTime    @default(now())

  project   Project @relation(fields: [projectId], references: [id])
  user      User    @relation(fields: [userId], references: [id])

  @@unique([projectId, userId])
  @@index([userId])
}

enum ProjectRole {
  ADMIN
  EDITOR
  VIEWER
}
```

### Invitation

```prisma
model Invitation {
  id          String           @id @default(uuid())
  email       String
  token       String           @unique
  status      InvitationStatus @default(PENDING)
  teamRole    TeamRole?
  projectRole ProjectRole?
  teamId      String
  projectId   String?
  inviterId   String
  expiresAt   DateTime
  acceptedAt  DateTime?
  createdAt   DateTime         @default(now())

  team        Team @relation(fields: [teamId], references: [id])
  project     Project? @relation(fields: [projectId], references: [id])
  inviter     User @relation("InvitationInviter", fields: [inviterId], references: [id])

  @@index([email, status])
  @@index([teamId, status])
}

enum InvitationStatus {
  PENDING
  ACCEPTED
  EXPIRED
  REVOKED
}
```

### TaskList

```prisma
model TaskList {
  id        String       @id @default(uuid())
  name      String
  sortKey   Decimal
  projectId String
  createdAt DateTime     @default(now())
  updatedAt DateTime     @updatedAt

  project   Project @relation(fields: [projectId], references: [id])
  tasks     Task[]

  @@index([projectId, sortKey])
}
```

### Task

```prisma
model Task {
  id          String    @id @default(uuid())
  title       String
  description String?
  status      TaskStatus @default(TODO)
  priority    Priority  @default(MEDIUM)
  sortKey     Decimal
  startDate   DateTime?
  dueDate     DateTime?
  taskListId  String
  projectId   String
  creatorId   String
  parentId    String?
  completedAt DateTime?
  completedById String?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  deletedAt   DateTime?

  taskList    TaskList  @relation(fields: [taskListId], references: [id])
  project     Project   @relation(fields: [projectId], references: [id])
  creator     User      @relation("TaskCreator", fields: [creatorId], references: [id])
  completedBy User?     @relation("TaskCompleter", fields: [completedById], references: [id])
  parent      Task?     @relation("SubTasks", fields: [parentId], references: [id])

enum TaskStatus {
  TODO
  IN_PROGRESS
  DONE
}
  subTasks    Task[]    @relation("SubTasks")
  assignees   TaskAssignee[]
  tags        TaskTag[]
  comments    Comment[]
  dependencies TaskDependency[] @relation("DependentTask")
  dependents   TaskDependency[] @relation("PrerequisiteTask")

  @@index([projectId])
  @@index([taskListId, sortKey])
  @@index([parentId])
}

enum Priority {
  LOW
  MEDIUM
  HIGH
  URGENT
}
```

### TaskAssignee

```prisma
model TaskAssignee {
  taskId    String
  userId    String
  createdAt DateTime @default(now())

  task      Task @relation(fields: [taskId], references: [id])
  user      User @relation(fields: [userId], references: [id])

  @@id([taskId, userId])
  @@index([userId])
}
```

### TaskDependency

```prisma
model TaskDependency {
  id                String         @id @default(uuid())
  type              DependencyType @default(FINISH_TO_START)
  dependentTaskId   String
  prerequisiteId    String
  lagDays           Int            @default(0)
  createdAt         DateTime       @default(now())

  dependentTask     Task @relation("DependentTask", fields: [dependentTaskId], references: [id])
  prerequisite      Task @relation("PrerequisiteTask", fields: [prerequisiteId], references: [id])

  @@unique([dependentTaskId, prerequisiteId])
}

enum DependencyType {
  FINISH_TO_START
  START_TO_START
  FINISH_TO_FINISH
  START_TO_FINISH
}
```

约束：

- `dependentTaskId` 不能等于 `prerequisiteId`。
- 两个任务必须属于同一个项目。
- 创建依赖时必须检测循环依赖。

### Tag

```prisma
model Tag {
  id        String @id @default(uuid())
  name      String
  color     String
  projectId String

  tasks     TaskTag[]

  @@unique([projectId, name])
}

model TaskTag {
  taskId String
  tagId  String

  task   Task @relation(fields: [taskId], references: [id])
  tag    Tag  @relation(fields: [tagId], references: [id])

  @@id([taskId, tagId])
}
```

### Comment

```prisma
model Comment {
  id        String   @id @default(uuid())
  content   String
  taskId    String
  authorId  String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt DateTime?

  task      Task @relation(fields: [taskId], references: [id])
  author    User @relation(fields: [authorId], references: [id])

  @@index([taskId, createdAt])
}
```

### Notification

```prisma
model Notification {
  id          String           @id @default(uuid())
  type        NotificationType
  title       String
  content     String
  link        String?
  payload     Json?
  isRead      Boolean          @default(false)
  readAt      DateTime?
  dedupeKey   String?          @unique
  recipientId String
  actorId     String?
  teamId      String?
  projectId   String?
  taskId      String?
  createdAt   DateTime         @default(now())

  recipient   User @relation("NotificationRecipient", fields: [recipientId], references: [id])
  actor       User? @relation("NotificationActor", fields: [actorId], references: [id])
  deliveries  NotificationDelivery[]

  @@index([recipientId, isRead, createdAt])
  @@index([taskId])
}

enum NotificationType {
  TASK_ASSIGNED
  TASK_DUE_SOON
  COMMENT_MENTION
  TASK_COMMENTED
  TASK_COMPLETED
  TASK_STATUS_CHANGED
  TASK_ASSIGNEES_CHANGED
  PROJECT_JOINED
}
```

### NotificationDelivery

```prisma
model NotificationDelivery {
  id             String         @id @default(uuid())
  notificationId String
  channel        DeliveryChannel
  status         DeliveryStatus @default(PENDING)
  attemptCount   Int            @default(0)
  lastError      String?
  sentAt         DateTime?
  createdAt      DateTime       @default(now())
  updatedAt      DateTime       @updatedAt

  notification   Notification @relation(fields: [notificationId], references: [id])

  @@index([status, channel])
  @@index([notificationId, channel])
}

enum DeliveryChannel {
  IN_APP
  FEISHU
}

enum DeliveryStatus {
  PENDING
  SENT
  FAILED
  SKIPPED
}
```

## 7. API 设计

所有接口统一前缀 `/api/v1`。

除注册、登录、OAuth 回调外，接口必须携带：

```http
Authorization: Bearer <access_token>
```

统一响应格式：

```json
{
  "data": {},
  "requestId": "req_xxx"
}
```

统一错误格式：

```json
{
  "error": {
    "code": "PROJECT_NOT_FOUND",
    "message": "Project not found",
    "details": {}
  },
  "requestId": "req_xxx"
}
```

### 7.1 认证

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/auth/register` | 邮箱注册 |
| POST | `/auth/login` | 邮箱登录 |
| POST | `/auth/refresh` | 刷新 access token |
| POST | `/auth/logout` | 注销 refresh token |
| GET | `/auth/feishu/authorize-url` | 获取飞书授权地址 |
| POST | `/auth/feishu/callback` | 飞书 OAuth code 换本地登录态 |

登录响应：

```json
{
  "data": {
    "accessToken": "jwt",
    "refreshToken": "jwt",
    "user": {
      "id": "user_id",
      "email": "user@example.com",
      "name": "Alice"
    }
  },
  "requestId": "req_xxx"
}
```

### 7.2 当前用户

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/users/me` | 当前用户信息 |
| PATCH | `/users/me/profile` | 更新昵称、头像；头像支持图片 URL 或前端上传后生成的图片 data URL |
| PATCH | `/users/me/email` | 更新绑定邮箱；用于飞书未返回邮箱时补充真实邮箱，也用于后续邀请邮箱匹配 |
| PATCH | `/users/me/password` | 修改密码 |
| GET | `/users/me/tasks` | 我的任务 |
| GET | `/users/me/notifications` | 通知列表 |
| PATCH | `/users/me/notifications/:id/read` | 标记已读 |
| PATCH | `/users/me/notifications/read-all` | 全部标记已读 |

`GET /users/me/tasks` 支持参数：

- `teamId`
- `projectId`
- `status`：`open` / `done` / `all`
- `due`：`today` / `week` / `overdue`

返回任务需要包含：

- `completedAt`：任务完成时间，未完成为 `null`。
- `completedBy`：完成操作人，未完成为 `null`；工作台“我的任务”右侧使用该字段显示 `姓名 今天完成`、`姓名 昨天完成` 或 `姓名 日期完成`。

### 7.3 团队

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/teams` | 创建团队 |
| GET | `/teams` | 我的团队列表 |
| GET | `/teams/:teamId` | 团队详情 |
| PATCH | `/teams/:teamId` | 更新团队 |
| GET | `/teams/:teamId/members` | 成员列表 |
| POST | `/teams/:teamId/invitations` | 邀请成员 |
| DELETE | `/teams/:teamId/members/:userId` | 移除成员 |
| PATCH | `/teams/:teamId/members/:userId/role` | 修改角色 |

### 7.4 项目

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/teams/:teamId/projects` | 团队项目列表 |
| POST | `/teams/:teamId/projects` | 创建项目 |
| GET | `/teams/:teamId/project-trash` | 团队级项目回收站 |
| PATCH | `/teams/:teamId/project-trash/:projectId/restore` | 恢复已删除项目 |
| DELETE | `/teams/:teamId/project-trash/:projectId` | 彻底删除已删除项目 |
| GET | `/projects/:projectId` | 项目详情 |
| PATCH | `/projects/:projectId` | 更新项目 |
| PATCH | `/projects/:projectId/archive` | 归档项目 |
| PATCH | `/projects/:projectId/unarchive` | 取消归档项目 |
| DELETE | `/projects/:projectId` | 软删除项目 |
| GET | `/projects/:projectId/members` | 项目成员 |
| POST | `/projects/:projectId/members` | 添加项目成员 |
| PATCH | `/projects/:projectId/members/:userId/role` | 修改项目角色 |
| DELETE | `/projects/:projectId/members/:userId` | 移除项目成员 |

### 7.5 看板清单

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/projects/:projectId/lists` | 获取任务清单和任务 |
| GET | `/projects/:projectId/tasks` | 获取项目列表页任务视图，按清单返回全部非删除任务，包含子任务 |
| POST | `/projects/:projectId/lists` | 创建清单 |
| PATCH | `/projects/:projectId/lists/:listId` | 重命名清单 |
| DELETE | `/projects/:projectId/lists/:listId` | 删除清单 |
| PATCH | `/projects/:projectId/lists/reorder` | 清单排序 |
| GET | `/projects/:projectId/trash` | 项目回收站 |
| PATCH | `/projects/:projectId/trash/lists/:listId/restore` | 恢复清单 |
| DELETE | `/projects/:projectId/trash/lists/:listId` | 彻底删除清单 |

清单排序请求：

```json
{
  "items": [
    { "id": "list_1", "sortKey": "1000" },
    { "id": "list_2", "sortKey": "2000" }
  ]
}
```

删除清单不需要请求体；如果清单内有任务，前端必须先二次确认，后端确认删除时会连同清单内任务及其子任务一起删除。

### 7.6 任务

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/projects/:projectId/tasks` | 创建任务 |
| GET | `/tasks/:taskId` | 任务详情 |
| PATCH | `/tasks/:taskId` | 更新任务 |
| DELETE | `/tasks/:taskId` | 软删除任务 |
| PATCH | `/tasks/:taskId/restore` | 恢复任务 |
| DELETE | `/tasks/:taskId/purge` | 彻底删除任务 |
| PATCH | `/tasks/:taskId/move` | 移动任务 |
| POST | `/tasks/:taskId/comments` | 创建评论 |
| GET | `/tasks/:taskId/comments` | 评论列表 |
| DELETE | `/tasks/:taskId/comments/:commentId` | 删除评论 |

创建任务请求：

```json
{
  "taskListId": "list_id，可选；不传时进入项目的第一个清单",
  "title": "完成登录页",
  "description": "包含邮箱登录和错误提示",
  "assigneeIds": ["user_id_1", "user_id_2"],
  "status": "TODO",
  "priority": "HIGH",
  "startDate": "2026-06-08T00:00:00.000Z",
  "dueDate": "2026-06-12T23:59:59.000Z",
  "tagIds": ["tag_id"]
}
```

移动任务请求：

```json
{
  "targetTaskListId": "list_id",
  "sortKey": "1500"
}
```

实现要求：

- 移动任务必须校验目标清单属于同一个项目。
- 移动任务只改变所在清单和排序，不改变任务状态。
- 更新任务状态为 `DONE` 时写入 `completedAt` 和 `completedById`。
- 从 `DONE` 更新为其他状态时清空 `completedAt` 和 `completedById`。

### 7.7 标签

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/projects/:projectId/tags` | 标签列表 |
| POST | `/projects/:projectId/tags` | 创建标签 |
| PATCH | `/projects/:projectId/tags/:tagId` | 更新标签 |
| DELETE | `/projects/:projectId/tags/:tagId` | 删除标签 |
| POST | `/tasks/:taskId/tags/:tagId` | 添加任务标签 |
| DELETE | `/tasks/:taskId/tags/:tagId` | 移除任务标签 |

### 7.8 甘特图

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/projects/:projectId/gantt` | 获取甘特图数据 |
| PATCH | `/tasks/:taskId/schedule` | 更新任务排期 |
| POST | `/tasks/:taskId/dependencies` | 创建依赖 |
| DELETE | `/tasks/:taskId/dependencies/:dependencyId` | 删除依赖 |

甘特图数据响应：

```json
{
  "data": {
    "tasks": [
      {
        "id": "task_id",
        "text": "完成登录页",
        "startDate": "2026-06-08",
        "endDate": "2026-06-12",
        "progress": 0,
        "assigneeIds": ["user_id_1", "user_id_2"],
        "tagIds": ["tag_id"]
      }
    ],
    "links": [
      {
        "id": "dep_id",
        "source": "task_a",
        "target": "task_b",
        "type": "FINISH_TO_START"
      }
    ]
  },
  "requestId": "req_xxx"
}
```

### 7.9 飞书

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/feishu/webhook` | 飞书事件回调 |
| GET | `/projects/:projectId/feishu-deliveries` | 项目飞书通知投递排查 |
| POST | `/projects/:projectId/feishu-deliveries/clear` | 按日期和状态清理非待发送飞书投递记录 |
| POST | `/projects/:projectId/feishu-deliveries/:deliveryId/retry` | 手动重试飞书通知投递 |

要求：

- 飞书账号绑定由 OAuth 登录自动完成，不提供手动绑定和解绑入口。
- 回调接口必须处理飞书 challenge。
- 回调接口必须支持 `FEISHU_VERIFICATION_TOKEN` 校验。
- 回调接口配置 `FEISHU_ENCRYPT_KEY` 后必须支持加密 payload 解密。
- 所有回调事件必须通过事件 ID 做幂等。
- 飞书投递排查接口仅项目管理员可访问。
- 飞书通知使用应用机器人卡片消息发送，卡片包含通知标题、正文和详情入口。
- 飞书投递列表支持按状态筛选，未成功投递可以手动重试。

## 8. 前端结构

```text
src/
├── app/
│   ├── App.tsx
│   ├── router.tsx
│   └── providers.tsx
├── components/
│   ├── ui/
│   ├── layout/
│   └── shared/
├── features/
│   ├── auth/
│   ├── team/
│   ├── project/
│   ├── board/
│   ├── task/
│   ├── my-tasks/
│   ├── notification/
│   ├── feishu/
│   └── gantt/
├── hooks/
├── lib/
│   ├── api.ts
│   ├── queryClient.ts
│   └── permissions.ts
├── stores/
├── types/
└── main.tsx
```

### 路由

```text
/login
/register
/auth/feishu/callback
/dashboard
/teams/:teamId
/projects/:projectId/board
/projects/:projectId/list
/projects/:projectId/gantt
/projects/:projectId/settings
/tasks/:taskId
/notifications
```

### 飞书登录本地配置

本地开发验证飞书登录时，需要在飞书开放平台创建企业自建应用：

1. 在应用后台复制 `App ID` 和 `App Secret`。
2. 在应用后台配置网页登录回调地址：

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

6. 如需验证飞书事件回调，在事件订阅中配置 webhook 地址。真实回调需要把本地 API 端口通过内网穿透暴露成 HTTPS 地址：

```text
https://your-tunnel.example.com/api/v1/feishu/webhook
```

7. 权限、机器人能力或回调地址变更后，需要发布版本并等待企业管理员审核通过。
8. 在本地 `/Users/skyxu/workspace/my/tower/code/.env` 中配置：

```bash
FEISHU_APP_ID="cli_xxx"
FEISHU_APP_SECRET="xxx"
APP_BASE_URL="http://localhost:5173"
FEISHU_ENCRYPT_KEY=""
FEISHU_VERIFICATION_TOKEN=""
```

如果飞书没有返回邮箱，系统使用 `${open_id}@feishu.local` 作为本地临时邮箱，仍允许用户登录；用户可在账号设置中改为真实邮箱。

V1.0 后端需要提供 `POST /api/v1/feishu/webhook`，支持飞书 challenge、token 校验、加密 payload 解密和事件幂等记录；同时提供项目级飞书投递排查能力，便于查看投递状态、失败原因和重试次数。

### 关键页面验收

登录页：

- 邮箱、密码校验
- 登录失败提示
- 登录成功后进入最近访问团队或 dashboard

看板页：

- 可创建任务
- 可拖拽任务跨列移动
- 移动失败时回滚 UI
- 支持空列状态
- 支持加载、错误、无权限状态

任务详情：

- 可编辑标题、描述、负责人、优先级、日期、标签
- 可创建、编辑、完成最多两级子任务
- 可查看和发表评论
- 可展示子任务
- 无权限用户只读

通知中心：

- 展示未读 / 已读
- 支持单条已读和全部已读
- 点击通知跳转对应任务或项目

## 9. 后端结构

```text
src/
├── app.ts
├── server.ts
├── config/
├── middleware/
│   ├── auth.ts
│   ├── errorHandler.ts
│   ├── requestId.ts
│   └── validate.ts
├── modules/
│   ├── auth/
│   ├── users/
│   ├── teams/
│   ├── projects/
│   ├── tasks/
│   ├── notifications/
│   ├── feishu/
│   └── gantt/
├── jobs/
│   ├── queues.ts
│   ├── notification.worker.ts
│   └── due-reminder.worker.ts
├── prisma/
└── utils/
```

模块内建议结构：

```text
modules/tasks/
├── task.routes.ts
├── task.controller.ts
├── task.service.ts
├── task.repository.ts
├── task.schema.ts
└── task.policy.ts
```

## 10. 异步任务与通知

### 10.1 队列

队列：

- `notification-delivery`
- `due-reminder`
- `feishu-webhook`

任务要求：

- 队列任务必须幂等。
- 飞书通知最多重试 3 次。
- 重试间隔使用指数退避。
- 失败后记录 `NotificationDelivery.lastError`。

### 10.2 截止提醒

实现方式：

- 每 10 分钟扫描未来 24 小时内到期且未提醒的任务。
- 使用 `dedupeKey = task_due_soon:{taskId}:{dueDate}` 防止重复通知。
- 已完成任务不提醒。

## 11. 安全要求

- 密码必须哈希保存，禁止明文存储。
- 登录接口需要限流。
- JWT access token 建议 15 分钟过期。
- refresh token 需要服务端可撤销。
- 所有写接口必须校验权限。
- 所有输入必须经过 Zod 校验。
- 评论内容前端渲染时必须防 XSS。
- 飞书 App Secret 只能通过环境变量读取。
- 生产环境必须启用 HTTPS。

## 12. 环境变量

```bash
DATABASE_URL=
REDIS_URL=
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
APP_BASE_URL=
DEFAULT_ADMIN_EMAIL=
DEFAULT_ADMIN_PASSWORD=
DEFAULT_ADMIN_NAME=
FEISHU_APP_ID=
FEISHU_APP_SECRET=
FEISHU_ENCRYPT_KEY=
FEISHU_VERIFICATION_TOKEN=
NODE_ENV=
```

## 13. 错误码

| HTTP | code | 说明 |
|------|------|------|
| 400 | VALIDATION_ERROR | 参数校验失败 |
| 401 | UNAUTHORIZED | 未登录或 token 失效 |
| 403 | FORBIDDEN | 无权限 |
| 404 | RESOURCE_NOT_FOUND | 资源不存在 |
| 409 | CONFLICT | 资源冲突，例如重复邀请 |
| 422 | BUSINESS_RULE_VIOLATION | 违反业务规则 |
| 429 | RATE_LIMITED | 请求过快 |
| 500 | INTERNAL_ERROR | 服务端错误 |

## 14. 测试计划

### 单元测试

- 权限判断
- 排序 key 生成
- 日期校验
- 依赖循环检测
- 通知 dedupeKey 生成

### 集成测试

- V0 后端集成测试使用真实 Express app、真实 Prisma 和本地 PostgreSQL，通过 `npm run test:integration` 运行。
- 已覆盖：注册登录、创建团队、团队删除成功路径、团队成员加入、团队 MEMBER 不可创建项目、项目 ADMIN 创建项目并自动生成默认清单、团队存在项目时不可删除、创建任务默认进入已有默认清单、ADMIN 管理清单、清单删除进入回收站、清单恢复、清单恢复重名冲突、清单彻底删除、EDITOR 不可管理清单、VIEWER 不可创建任务、任务创建与多人负责人、我的任务、已完成任务返回完成人和完成时间、任务分配通知、V0.1 两级子任务限制、标签创建/查询/绑定/更新/解绑/删除、任务状态变更通知、通知单条已读和全部已读、截止前 24 小时站内提醒去重生成、评论通知、任务删除进入回收站、任务恢复、任务彻底删除、项目归档后拒绝任务和标签写入、取消归档后恢复任务写入。
- 集成测试数据使用唯一邮箱后缀创建，测试结束后按依赖顺序清理。
- 后续可继续补充：更细粒度的异常路径和并发冲突场景。
- 飞书通知重试属于 V1 范围，当前集成测试已覆盖飞书投递记录查询和失败投递重试。

### E2E 测试

- E2E 使用 Playwright，通过 `npm run test:e2e` 运行；该命令自动启动后端和前端，并连接本地 PostgreSQL。
- 已覆盖：用户登录、账号资料和自定义头像上传、团队级项目回收站入口、恢复已删除项目、进入项目看板、新建项目后自动显示默认清单、不存在项目的正式状态页、通过新建任务弹窗创建任务、看板筛选匹配子任务、项目列表页、列表页筛选条、列表页按清单分组和任务树形展示、列表页清单折叠、列表页任务详情背景路由、项目甘特图入口、排期展示、未排期子任务空白行展示、甘特图任务树折叠和折叠状态记忆、缩放和任务条可拖动状态、清单标题加号、清单三点菜单、清单编辑态、删除有任务清单的二次提示、项目回收站入口、恢复已删除清单和清单内任务、指定负责人、打开任务详情弹窗、任务详情字段编辑保存、创建两级子任务、任务详情评论、拖拽任务到其他清单、通过任务状态标记已完成、负责人登录后在工作台看到“我的任务”、我的任务项目筛选、已完成任务信息和分配通知、通知已读、通过 WebSocket 收到评论通知、项目归档只读、取消归档、EDITOR 看不到添加清单入口、VIEWER 看不到新建任务入口。
- `npm run test:acceptance` 串联后端集成测试和前端 E2E，用于 V0 自动验收。
- 后续可继续补充：更完整的移动端布局回归和复杂拖拽边界。

## 15. 性能与容量目标

V0 目标：

- 支持 50 人团队并发使用。
- 项目内 1000 个任务以内看板加载可用。
- 常规接口 P95 响应时间小于 500ms。
- 首屏加载时间小于 2 秒。

实现建议：

- 项目列表、看板任务按项目维度查询。
- 我的任务通过 `TaskAssignee.userId` 查询，再按任务 `dueDate` 排序；`TaskAssignee.userId` 必须建索引。
- 通知按 `recipientId + isRead + createdAt` 建索引。
- 看板默认只加载未删除任务。

## 16. 部署

本地开发：

- Docker Compose 启动 PostgreSQL 和 Redis。
- 前端、后端分别启动。

生产部署：

- 前端：Vercel 或 Nginx 静态资源。
- 后端：云服务器、Railway 或其他 Node.js 托管平台。
- 数据库：托管 PostgreSQL。
- 队列：托管 Redis。

最低部署单元：

- Web API 服务
- Worker 服务
- PostgreSQL
- Redis

## 17. 验收标准

V0 完成标准：

- 用户可以注册、登录、退出。
- 用户可以创建团队和项目。
- 项目创建后自动生成默认看板列。
- 项目成员可以创建、编辑、移动任务。
- 项目成员可以在任务详情内创建、编辑、完成最多两级子任务。
- 看板拖拽后刷新页面顺序不丢失。
- 用户可以在任务下发表评论。
- 被分配任务和被 @ 时可以收到站内通知。
- 我的任务能展示当前用户作为任一负责人参与的任务和子任务，并在已完成任务上显示完成人和完成时间；任务树列表支持折叠 / 展开和折叠状态记忆。
- 无权限用户无法访问或修改项目数据。
- 所有核心接口有集成测试覆盖。

V1 完成标准：

- 用户可以绑定飞书账号。
- 任务分配、评论 @、截止提醒能发送飞书消息；飞书应用需要开通应用身份发消息权限，推荐 `im:message:send`，也可使用 `im:message` 或 `im:message:send_as_bot`。
- 飞书发送失败会重试并记录失败原因。
- 飞书回调接口具备验签和幂等处理。

V2 完成标准：

- 甘特图能展示项目任务。
- 可按周 / 月 / 季度缩放。
- 可拖拽修改任务排期。
- 可创建和删除任务依赖。
- 循环依赖会被拒绝。

## 18. 待决策事项

- 是否商业化或闭源。如果是，需要确认甘特图库商业授权。
- 是否必须支持移动端拖拽。如果必须，需要单独验证交互方案。
- 是否需要邮箱验证和密码找回。建议 V0.1 补齐。
- 是否需要团队所有权转移。建议在团队成员管理上线前补齐。
- 是否需要任务活动记录。建议 V0.1 加入，便于审计和排查问题。
- 何时开放多层子任务。V0 只做数据结构预留，不开放多层创建和移动。
