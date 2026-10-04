# 机场地面保障作业管理平台

面向航班保障、机位分配、廊桥靠接、摆渡车调度、行李装卸、航油加注、除冰作业与延误处置的一体化机场地面保障作业工作台。

这是一个**纯前端**管理平台：Vue 3 + Vite + TypeScript，仓库里没有后端服务。业务数据由
`frontend/src/data/` 下的本地数据层提供：首次打开用示例数据播种，之后的登记、筛选与状态流转
结果都持久化在浏览器 `localStorage` 里，刷新或重开浏览器都还在。dev server 已关掉自动打开页面，
启动后按终端打印的地址手工打开。

## 目录结构

```text
.
├── frontend/                 Vue 3 + Vite + TypeScript 前端（唯一运行单元）
│   ├── src/views/            每个业务模块一个页面
│   ├── src/api/local-service.ts   本地数据服务：列表、筛选、动作流转、导出
│   ├── src/data/             模块元数据 / 示例数据 / localStorage 持久化
│   ├── src/stores/           会话与筛选状态
│   └── vite.config.ts        dev server 配置（open: false，无 /api 代理）
├── .gitignore
└── docker-compose.yml
```

## 启动

```bash
cd frontend
npm install
npm run dev
```

前端默认监听 `http://127.0.0.1:5173/`，dev server 不会自动打开浏览器，需要自己访问。

生产构建：

```bash
cd frontend
npm run build
```

## 业务模块

| 模块 | 目录 | 业务对象 | 主要字段 |
| --- | --- | --- | --- |
| 航班保障 | `flight` | 航班保障任务 | 保障编号、航班号、机型 |
| 机位分配 | `stand` | 停机位 | 机位编号、机位类型、适用机型 |
| 廊桥靠接 | `bridge` | 廊桥作业 | 作业编号、廊桥编号、对应机位 |
| 摆渡车调度 | `shuttle` | 摆渡车 | 车辆编号、核载人数、驾驶员 |
| 行李装卸 | `baggage` | 行李作业 | 作业编号、航班号、行李件数 |
| 机务勤务 | `line` | 勤务任务 | 任务编号、航班号、勤务项目 |
| 航油加注 | `fueling` | 加油作业 | 作业编号、航班号、油品规格 |
| 除冰作业 | `deice` | 除冰任务 | 任务编号、航班号、除冰液型号 |
| 地面电源 | `gpu` | 电源车 | 设备编号、设备类型、功率等级 |
| 航空器牵引 | `tow` | 牵引任务 | 任务编号、航班号、牵引车号 |
| 航空配餐 | `catering` | 配餐作业 | 作业编号、航班号、餐食数量 |
| 客舱清洁 | `cabin` | 清洁作业 | 作业编号、航班号、清洁班组 |
| 保障班组 | `team` | 保障班组 | 班组编号、班组名称、负责区域 |
| 特种车辆维保 | `vehmaint` | 维保记录 | 维保单号、车辆编号、维保类型 |
| 要客保障 | `vip` | 要客保障单 | 保障编号、航班号、要客等级 |
| 延误处置 | `delay` | 延误事件 | 事件编号、航班号、延误原因 |
| 机坪安全巡查 | `apron` | 巡查记录 | 巡查编号、巡查区域、巡查人员 |
| 保障资源调度 | `resplan` | 资源计划 | 计划编号、保障时段、机位需求 |

## 约定

- 每个模块的页面在 `frontend/src/views/<模块>/index.vue`，页面只负责渲染，读写统一走
  `frontend/src/api/local-service.ts`。
- 字段、状态、动作与流转目标集中在 `frontend/src/data/modules.ts`；示例数据在
  `frontend/src/data/seed.ts`。
- 状态流转只允许在 `local-service.ts` 里改，页面组件不做业务判断。
- 想回到初始数据：清掉浏览器里 `airport-ground-ops:entries` 这一项，或调用 `resetModule(模块)`。

### 特种车辆维保链路

维保记录的全部判定集中在 `frontend/src/data/vehmaint.ts`，页面动作层
（`views/vehmaint`、`views/vehiclefleet`）与本地数据层（`api/local-service.ts` →
`data/local-store.ts`）都走同一个门面，不允许各写一份。

- **全链路**：页面动作 → `runAction('vehmaint', …)` → `advanceVehmaint` 判定 →
  一次 `saveRows` 落库；维保页、运营概览、特种车辆可用清单读取时统一经过
  `normalizeVehmaintRows` 对齐，写入与读出看到的是同一份结果。
- **状态与在修标记同一笔落库**：确认出厂时 `status=已出厂`、`inRepair=false`、
  展示字段「维保状态」一起写齐，页面层不单独清标记，只清页面标记不算修复。
- **冲突判定依据**：`status` 是记录在状态机里的唯一位置，是权威字段；`inRepair`
  只是状态的派生冗余值。历史数据出现「已出厂却仍挂在修标记」时一律按状态重算标记。
- **重复确认出厂只清一次标记**：第一次确认出厂时标记随状态清掉；再次提交直接拒绝
  受理，不触发第二次写入。
- **顺序流转**：待进厂 → 维保中 → 待验收 → 已出厂（模块元数据 `strictOrder`）。
  越级动作挡回并提示缺哪一环，例如待进厂直接确认出厂会提示先完成「送厂维保、提交验收」；
  重复动作拒绝受理。
- **在修名单可重建**：`listInRepairVehicles` 从维保记录状态实时派生（维保中、待验收
  在册；待进厂、已出厂不在册），承修单位回传的维修项目归档、确认出厂后名单随之更新。
- **可用清单同源**：`views/vehiclefleet` 的特种车辆可用清单与在修名单来自同一派生结果，
  车辆侧没有第二份数据；维保单号、承修单位、维修项目由 `reconcileVehmaint` 三方对账。
- **示例数据重置**：维保页在开发环境（`import.meta.env.DEV`）提供「重置维保示例数据」，
  只重置 `vehmaint` 这一个存储键，其它模块运行数据不受影响；运行数据只存在浏览器
  localStorage 里，`npm run build` 的产物不携带任何运行数据（仓库内仅打包 `seed.ts`
  这份示例数据）。
