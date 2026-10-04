import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
  UnderRepairEntry,
  VehicleAvailability,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 在修标记的唯一判定规则：状态不是终态（维保记录的终态是「已出厂」）就算在修。
// 状态是流转事实，pending 只是它的派生标记；两处冲突时一律以状态为准——
// 状态由动作链路按顺序写入、可溯源，标记只是给看板和名单用的派生视图，
// 派生数据必须能从事实重建，所以读「在修」语义的地方都走这个函数现算，不另存第二份。
function pendingFor(meta: ModuleMeta, status: string): boolean {
  return status !== meta.statuses[meta.statuses.length - 1]
}

// 概览统计里的「待处理」与写入侧用同一条规则：顺序流转模块不看存储的 pending，按状态现算。
function effectivePending(meta: ModuleMeta, row: EntryRow): boolean {
  return meta.orderedFlow ? pendingFor(meta, String(row.status)) : Boolean(row.pending)
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

// 顺序流转校验：只能走到紧邻的下一环。越级的一律挡回并点名缺哪一环；回退同样拒绝受理。
function checkOrderedFlow(meta: ModuleMeta, current: string, target: string): string {
  const order = meta.statuses
  const currentIndex = order.indexOf(current)
  const targetIndex = order.indexOf(target)
  if (currentIndex < 0 || targetIndex < 0) {
    return ''
  }
  const flow = order.join(' → ')
  if (targetIndex < currentIndex) {
    return `${meta.entity}按「${flow}」顺序流转，当前已是「${current}」，不能回退到「${target}」`
  }
  if (targetIndex > currentIndex + 1) {
    const missing = order.slice(currentIndex + 1, targetIndex)
    return `${meta.entity}缺少「${missing.join('」「')}」环节，不能从「${current}」越级到「${target}」，请先完成「${missing[0]}」`
  }
  return ''
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    // 重复动作幂等拒绝：确认出厂第一次已把在修标记清掉，再来一次直接挡回，不会清第二次。
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  if (meta.orderedFlow) {
    const blocked = checkOrderedFlow(meta, current, target)
    if (blocked) {
      return { ok: false, message: blocked }
    }
  }
  // 状态与标记收在同一笔：status、pending（在修标记）、页面状态字段一次写入、一次落库，
  // 不存在「状态变了标记没跟上」的中间态。
  const statusField = meta.fields[meta.fields.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: pendingFor(meta, target),
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
    [statusField]: target,
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

const VEHMAINT_KEY = 'vehmaint'

// 在修名单：从维保记录按状态现算（未「已出厂」即在修），不落第二份数据，随时可稳定重建。
// 维保单号、承修单位、维修项目取自同一条记录，三处天然对得上。
export function listUnderRepair(): UnderRepairEntry[] {
  const meta = moduleMeta(VEHMAINT_KEY)
  return listRows(VEHMAINT_KEY)
    .filter((row) => pendingFor(meta, String(row.status)))
    .map((row) => ({
      id: Number(row.id),
      维保单号: String(row.维保单号 ?? ''),
      车辆编号: String(row.车辆编号 ?? ''),
      承修单位: String(row.承修单位 ?? ''),
      维修项目: String(row.维修项目 ?? ''),
      维保状态: String(row.status),
    }))
}

// 特种车辆可用清单：按车辆编号聚合同一份维保记录，有未出厂记录的车算在修、其余可用。
// 车辆侧读到的就是这份派生结果，出厂结论一落库，这里下一次读取即同步，不存在第二份名单。
export function listVehicleAvailability(): VehicleAvailability[] {
  const meta = moduleMeta(VEHMAINT_KEY)
  const byVehicle = new Map<string, VehicleAvailability>()
  for (const row of listRows(VEHMAINT_KEY)) {
    const vehicle = String(row.车辆编号 ?? '')
    if (!vehicle) {
      continue
    }
    const underRepair = pendingFor(meta, String(row.status))
    const existing = byVehicle.get(vehicle)
    if (!existing) {
      byVehicle.set(vehicle, {
        车辆编号: vehicle,
        在修: underRepair,
        维保单号: underRepair ? String(row.维保单号 ?? '') : '',
        承修单位: underRepair ? String(row.承修单位 ?? '') : '',
        维修项目: underRepair ? String(row.维修项目 ?? '') : '',
        维保状态: underRepair ? String(row.status) : '',
      })
    } else if (underRepair) {
      // 同一辆车挂着多张未出厂单时，以最新登记的那张为准
      existing.在修 = true
      existing.维保单号 = String(row.维保单号 ?? '')
      existing.承修单位 = String(row.承修单位 ?? '')
      existing.维修项目 = String(row.维修项目 ?? '')
      existing.维保状态 = String(row.status)
    }
  }
  return [...byVehicle.values()]
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => effectivePending(meta, row)).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
