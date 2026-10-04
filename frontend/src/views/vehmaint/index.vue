<template>
  <section class="page" data-module="vehmaint">
    <header class="page-head">
      <div>
        <h2>特种车辆维保管理</h2>
        <p class="page-desc">维护维保记录，围绕维保单号、车辆编号、维保类型、进厂日期做登记、筛选与状态流转。</p>
        <p class="page-desc">流转顺序：待进厂 → 维保中 → 待验收 → 已出厂，越级与回退一律拒绝受理。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记维保记录</button>
        <button class="btn" type="button" @click="exportRows">导出特种车辆维保清单</button>
        <button class="btn ghost" type="button" @click="resetSeed">重置维保示例数据</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无特种车辆维保数据，可先登记维保记录</td>
        </tr>
      </tbody>
    </table>

    <section class="panel">
      <h3>在修名单</h3>
      <p class="panel-note">由维保记录按状态现算：未「已出厂」即在修，确认出厂后自动移出，不单独维护。</p>
      <table class="data-table">
        <thead>
          <tr>
            <th>维保单号</th>
            <th>车辆编号</th>
            <th>承修单位</th>
            <th>维修项目</th>
            <th>当前状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in underRepair" :key="item.id">
            <td>{{ item.维保单号 }}</td>
            <td>{{ item.车辆编号 }}</td>
            <td>{{ item.承修单位 }}</td>
            <td>{{ item.维修项目 }}</td>
            <td>{{ item.维保状态 }}</td>
          </tr>
          <tr v-if="!underRepair.length">
            <td colspan="5" class="empty-state">当前没有在修车辆</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="panel">
      <h3>特种车辆可用清单</h3>
      <p class="panel-note">按车辆编号聚合同一份维保记录：有未出厂记录的车算在修，出厂结论落库即同步。</p>
      <table class="data-table">
        <thead>
          <tr>
            <th>车辆编号</th>
            <th>可用状态</th>
            <th>关联维保单号</th>
            <th>承修单位</th>
            <th>维修项目</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in availability" :key="item.车辆编号">
            <td>{{ item.车辆编号 }}</td>
            <td>{{ item.在修 ? '在修' : '可用' }}</td>
            <td>{{ item.维保单号 || '—' }}</td>
            <td>{{ item.承修单位 || '—' }}</td>
            <td>{{ item.维修项目 || '—' }}</td>
          </tr>
          <tr v-if="!availability.length">
            <td colspan="5" class="empty-state">暂无车辆台账数据</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条特种车辆维保记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  listUnderRepair,
  listVehicleAvailability,
  moduleMeta,
  resetModule,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow, UnderRepairEntry, VehicleAvailability } from '@/data/types'

const meta = moduleMeta('vehmaint')
const columns = ["维保单号", "车辆编号", "维保类型", "进厂日期", "出厂日期", "维修项目", "承修单位", "维保状态"]
const actions = ["送厂维保", "提交验收", "确认出厂"]
const statuses = ["待进厂", "维保中", "待验收", "已出厂"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
// 在修名单与可用清单都从数据层现算，页面不另存标记，刷新即与落库数据对齐
const underRepair = ref<UnderRepairEntry[]>([])
const availability = ref<VehicleAvailability[]>([])

const stats = computed(() => [
  { label: '待进厂车辆', value: countStatus('待进厂') },
  { label: '维保中车辆', value: countStatus('维保中') },
  { label: '待验收车辆', value: countStatus('待验收') },
])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: countStatus(status),
  })),
)

function countStatus(status: string): number {
  return rows.value.filter((row) => String(row.status) === status).length
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '维保记录登记入口尚未接入审批流'
}

function resetSeed() {
  // 只重置维保这一个模块的示例数据，其他模块的本地数据不受影响
  resetModule(meta.key)
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    underRepair.value = listUnderRepair()
    availability.value = listVehicleAvailability()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '特种车辆维保列表读取失败'
  }
}

onMounted(reload)
</script>
