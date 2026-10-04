/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
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
  /** 为 true 时状态必须按 statuses 顺序逐级流转，越级与回退都拒绝受理（目前用于维保记录）。 */
  orderedFlow?: boolean
}

/** 在修名单条目：由维保记录按状态现算，不单独落库，保证随时能稳定重建。 */
export type UnderRepairEntry = {
  id: number
  维保单号: string
  车辆编号: string
  承修单位: string
  维修项目: string
  维保状态: string
}

/** 特种车辆可用清单条目：按车辆编号聚合同一份维保记录，在修车辆带上在修单的关键字段。 */
export type VehicleAvailability = {
  车辆编号: string
  在修: boolean
  维保单号: string
  承修单位: string
  维修项目: string
  维保状态: string
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
