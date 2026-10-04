import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import {
  VEHMAINT_KEY,
  advanceVehmaint,
  buildVehicleAvailability,
  listInRepairVehicles,
  normalizeVehmaintRows,
  reconcileVehmaint,
} from '@/data/vehmaint'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'
import type { ReconcileIssue, VehicleAvailability } from '@/data/vehmaint'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

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
  const source = listRows(key)
  // 维保记录读出即按状态对齐在修标记：在修名单随时能从状态重建，脏标记不影响页面判断。
  // 这里只对齐内存里的副本，等下一次动作落库时随状态一并写回，避免读操作产生写副作用。
  const aligned = key === VEHMAINT_KEY ? normalizeVehmaintRows(source) : source
  const matched = filterRows(aligned, filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
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

  // 严格顺序模块（维保）：越级挡回、重复拒绝；通过后状态与在修标记在同一笔落库里写齐。
  if (meta.strictOrder) {
    const result = advanceVehmaint(rows[index], action)
    if (!result.ok || !result.row) {
      return { ok: false, message: result.message }
    }
    const next = [...rows]
    next[index] = result.row
    saveRows(key, next)
    return { ok: true, message: result.message }
  }

  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

/** 在修名单：维保页与车辆页共用的唯一派生入口，不允许任何页面自己再算一份。 */
export function inRepairVehicles(): EntryRow[] {
  return listInRepairVehicles(listRows(VEHMAINT_KEY))
}

/** 特种车辆可用清单：在修名单同源派生，确认出厂后车辆自动回到可用侧。 */
export function vehicleAvailability(): VehicleAvailability[] {
  return buildVehicleAvailability(listRows(VEHMAINT_KEY))
}

/** 维保单号 / 承修单位 / 维修项目三方对账，返回对不上的记录。 */
export function vehmaintReconcileIssues(): ReconcileIssue[] {
  return reconcileVehmaint(listRows(VEHMAINT_KEY))
}

/**
 * 本地开发环境重置维保示例数据：只重置 vehmaint 这一块，其它模块的运行数据不动。
 * 运行数据始终只在浏览器 localStorage，构建产物（dist）里不会携带任何运行数据。
 */
export function resetVehmaintSample(): PageResult {
  return resetModule(VEHMAINT_KEY)
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
    const raw = rows[meta.key] ?? []
    // 维保模块的 pending/在修标记一律按状态重算后再统计，看板与在修名单同源。
    const entries = meta.key === VEHMAINT_KEY ? normalizeVehmaintRows(raw) : raw
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
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
