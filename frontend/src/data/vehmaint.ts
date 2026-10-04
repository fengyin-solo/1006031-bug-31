import type { ActionResult, EntryRow } from './types'

/**
 * 维保记录领域逻辑：状态机、在修标记、在修名单、特种车辆可用清单、三方对账。
 *
 * 这是维保数据的唯一判定来源，页面动作层（views/vehmaint、views/vehiclefleet）
 * 与本地数据层（api/local-service → data/local-store）都走这里，不允许各写一份判断。
 */

export const VEHMAINT_KEY = 'vehmaint'

// 维保环节固定顺序：待进厂 → 维保中 → 待验收 → 已出厂。
export const VEHMAINT_STATUSES = ['待进厂', '维保中', '待验收', '已出厂'] as const
// 与状态一一对应的推进动作：第 i 个动作把记录从第 i 态推到第 i+1 态。
export const VEHMAINT_ACTIONS = ['送厂维保', '提交验收', '确认出厂'] as const

const VEHMAINT_STATUS_FIELD = '维保状态'
const ORDER_NO_FIELD = '维保单号'
const VEHICLE_NO_FIELD = '车辆编号'
const PROJECT_FIELD = '维修项目'
const VENDOR_FIELD = '承修单位'
const ENTER_DATE_FIELD = '进厂日期'
const LEAVE_DATE_FIELD = '出厂日期'

export type VehmaintRow = EntryRow

/** 已送厂但尚未确认出厂的状态：维保中、待验收——在修名单只认这两态。 */
export function isInRepairStatus(status: string): boolean {
  return status === '维保中' || status === '待验收'
}

function statusIndex(status: string): number {
  const index = VEHMAINT_STATUSES.indexOf(status as (typeof VEHMAINT_STATUSES)[number])
  return index < 0 ? 0 : index
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function text(row: EntryRow, field: string): string {
  return String(row[field] ?? '').trim()
}

/**
 * 以 status 为唯一权威，把在修标记、待处理标记、维保状态展示字段统一对齐。
 *
 * 冲突判定依据：status 是这条记录在状态机里的唯一位置（用户动作只推进状态），
 * 在修标记是 status 的派生冗余值；历史数据里出现「已出厂却仍挂着在修标记」
 * 这类错位时，一律按 status 重算标记——这就是两处冲突时的判定规则。
 */
export function normalizeVehmaintRow(row: EntryRow): VehmaintRow {
  const status = VEHMAINT_STATUSES.includes(row.status as (typeof VEHMAINT_STATUSES)[number])
    ? row.status
    : VEHMAINT_STATUSES[0]
  const inRepair = isInRepairStatus(status)
  return {
    ...row,
    status,
    inRepair,
    // 待处理：流程没走完都算（已出厂才结清），看板统计继续用这个通用标记。
    pending: status !== '已出厂',
    [VEHMAINT_STATUS_FIELD]: status,
  }
}

/** 读出维保记录时做一次只改内存的对齐：在修名单随时能从状态稳定重建。 */
export function normalizeVehmaintRows(rows: EntryRow[]): VehmaintRow[] {
  return rows.map(normalizeVehmaintRow)
}

/**
 * 在一笔写入里推进维保记录：状态、在修标记、待处理标记、维保状态字段同生共死，
 * 页面层不再单独清标记，localStorage 也只有一次落库（由调用方 saveRows 完成）。
 *
 * 顺序规则（VEHMAINT_ACTIONS[i] 要求当前停在第 i 态）：
 * - 目标态已达成（当前态已越过本动作）：拒绝受理，不重复清标记、不重复落库；
 * - 当前态落在动作之前：越级，挡回并说明还缺哪一环；
 * - 当前态正是本动作的前置态：推进到下一态，一次写齐。
 */
export function advanceVehmaint(row: EntryRow, action: string): ActionResult & { row?: VehmaintRow } {
  const normalized = normalizeVehmaintRow(row)
  const actionIndex = VEHMAINT_ACTIONS.indexOf(action as (typeof VEHMAINT_ACTIONS)[number])
  if (actionIndex < 0) {
    return { ok: false, message: `维保记录没有登记「${action}」这个动作` }
  }
  const currentIndex = statusIndex(normalized.status)
  const target = VEHMAINT_STATUSES[actionIndex + 1]

  if (currentIndex > actionIndex) {
    // 重复确认出厂只清一次标记：标记在上次推进时已随状态一起清掉，这里直接挡回。
    return { ok: false, message: `维保记录已经是「${normalized.status}」，「${action}」已受理过，不用重复操作` }
  }
  if (currentIndex < actionIndex) {
    const missing = VEHMAINT_ACTIONS.slice(currentIndex, actionIndex)
    return {
      ok: false,
      message: `不能越级${action}：当前停在「${normalized.status}」，需先完成 ${missing.map((name) => `「${name}」`).join('、')}，缺一环都不许越过`,
    }
  }

  const updated: VehmaintRow = {
    ...normalized,
    status: target,
    [VEHMAINT_STATUS_FIELD]: target,
    // 标记与状态同一笔写出：在修标记由目标态重算，确认出厂时在此唯一一次清掉。
    inRepair: isInRepairStatus(target),
    pending: target !== '已出厂',
  }
  // 进厂/出厂日期随对应环节补登，避免空日期；承修单位回传归档不影响流转。
  if (action === '送厂维保' && !text(updated, ENTER_DATE_FIELD)) {
    updated[ENTER_DATE_FIELD] = today()
  }
  if (action === '确认出厂' && !text(updated, LEAVE_DATE_FIELD)) {
    updated[LEAVE_DATE_FIELD] = today()
  }
  return { ok: true, row: updated, message: `维保记录已${action}，当前状态「${target}」` }
}

/**
 * 在修名单：从维保记录直接派生，不另存第二份。
 * 车辆最新一张单处于「维保中/待验收」即在册；待进厂还没进厂，已出厂已恢复可用。
 */
export function listInRepairVehicles(rows: EntryRow[]): VehmaintRow[] {
  return normalizeVehmaintRows(rows).filter((row) => row.inRepair)
}

export type VehicleAvailability = {
  vehicleNo: string
  available: boolean
  status: string
  orderNo: string
  vendor: string
  project: string
}

/**
 * 特种车辆可用清单：车辆侧读到的在修名单与维保页是同一份派生结果，不存在第二份数据源。
 * 每辆车取最新一张维保单（流程走得最远的那张）为准；在修（含待验收）即不可用。
 */
export function buildVehicleAvailability(rows: EntryRow[]): VehicleAvailability[] {
  const latestByVehicle = new Map<string, VehmaintRow>()
  for (const row of normalizeVehmaintRows(rows)) {
    const vehicleNo = text(row, VEHICLE_NO_FIELD)
    if (!vehicleNo) {
      continue
    }
    const prev = latestByVehicle.get(vehicleNo)
    if (!prev || statusIndex(row.status) > statusIndex(prev.status)) {
      latestByVehicle.set(vehicleNo, row)
    }
  }
  return [...latestByVehicle.entries()].map(([vehicleNo, row]) => ({
    vehicleNo,
    available: !row.inRepair,
    status: row.status,
    orderNo: text(row, ORDER_NO_FIELD),
    vendor: text(row, VENDOR_FIELD),
    project: text(row, PROJECT_FIELD),
  }))
}

export type ReconcileIssue = {
  id: number
  orderNo: string
  message: string
}

/**
 * 维保单号、承修单位、维修项目三方对账：
 * 1) 三处都得有值，缺一处即对不上；
 * 2) 同一维保单号跨记录必须指向同一承修单位、同一维修项目（含同一车辆），否则归档对不齐。
 */
export function reconcileVehmaint(rows: EntryRow[]): ReconcileIssue[] {
  const normalized = normalizeVehmaintRows(rows)
  const issues: ReconcileIssue[] = []
  const byOrder = new Map<string, VehmaintRow[]>()

  for (const row of normalized) {
    const orderNo = text(row, ORDER_NO_FIELD)
    const missing = [
      !orderNo && ORDER_NO_FIELD,
      !text(row, VENDOR_FIELD) && VENDOR_FIELD,
      !text(row, PROJECT_FIELD) && PROJECT_FIELD,
    ].filter(Boolean) as string[]
    if (missing.length > 0) {
      issues.push({ id: row.id, orderNo: orderNo || `#${row.id}`, message: `缺少${missing.join('、')}，三方对不上` })
    }
    if (orderNo) {
      const list = byOrder.get(orderNo) ?? []
      list.push(row)
      byOrder.set(orderNo, list)
    }
  }

  for (const [orderNo, list] of byOrder) {
    if (list.length < 2) {
      continue
    }
    const first = list[0]
    for (const row of list.slice(1)) {
      const conflicts = [
        text(row, VENDOR_FIELD) !== text(first, VENDOR_FIELD) && VENDOR_FIELD,
        text(row, PROJECT_FIELD) !== text(first, PROJECT_FIELD) && PROJECT_FIELD,
        text(row, VEHICLE_NO_FIELD) !== text(first, VEHICLE_NO_FIELD) && VEHICLE_NO_FIELD,
      ].filter(Boolean) as string[]
      if (conflicts.length > 0) {
        issues.push({
          id: row.id,
          orderNo,
          message: `维保单号 ${orderNo} 的${conflicts.join('、')}与首条记录不一致，三方对不上`,
        })
      }
    }
  }
  return issues
}
