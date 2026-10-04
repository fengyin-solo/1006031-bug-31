/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  // 维保模块的「在修」标记：维保中/待验收为 true，待进厂/已出厂为 false。
  // 该标记是 status 的派生冗余值，一切冲突以 status 为准（见 data/vehmaint.ts）。
  inRepair?: boolean
  [field: string]: string | number | boolean | undefined
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
  // 开启后动作只能按 actions 顺序逐步推进：重复提交拒绝、越级提交挡回并指出缺哪一环。
  // 目前仅维保模块启用；未开启的模块沿用原先的通用跳转流转。
  strictOrder?: boolean
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
