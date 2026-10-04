<template>
  <section class="page" data-module="vehmaint">
    <header class="page-head">
      <div>
        <h2>特种车辆维保管理</h2>
        <p class="page-desc">维护维保记录，围绕维保单号、车辆编号、维保类型、进厂日期做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记维保记录</button>
        <button class="btn" type="button" @click="exportRows">导出特种车辆维保清单</button>
        <button v-if="isDev" class="btn ghost" type="button" @click="resetSample">重置维保示例数据</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in liveStats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">在修名单（含待验收）</span>
        <strong class="stat-value">{{ inRepairRows.length }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <!-- 在修名单：直接从维保记录状态派生，车辆可用清单读的也是这同一份，不存在第二份数据 -->
    <section class="data-card">
      <h3 class="card-title">在修名单（按维保记录重建）</h3>
      <table class="data-table">
        <thead>
          <tr><th>车辆编号</th><th>维保单号</th><th>承修单位</th><th>维修项目</th><th>当前环节</th></tr>
        </thead>
        <tbody>
          <tr v-for="row in inRepairRows" :key="`repair-${String(row.id)}`">
            <td>{{ row['车辆编号'] ?? '—' }}</td>
            <td>{{ row['维保单号'] ?? '—' }}</td>
            <td>{{ row['承修单位'] ?? '—' }}</td>
            <td>{{ row['维修项目'] ?? '—' }}</td>
            <td>{{ row.status }}</td>
          </tr>
          <tr v-if="!inRepairRows.length">
            <td colspan="5" class="empty-state">当前没有在修车辆，名单已按维保记录清空</td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- 三方对账：维保单号、承修单位、维修项目对不上时在此提示 -->
    <section v-if="issues.length" class="data-card">
      <h3 class="card-title">对账异常（{{ issues.length }}）</h3>
      <ul class="issue-list">
        <li v-for="issue in issues" :key="`issue-${issue.id}`" class="error-text">
          {{ issue.orderNo }}：{{ issue.message }}
        </li>
      </ul>
    </section>

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
          <th>在修标记</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.inRepair ? '在修' : '—' }}</td>
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
          <td :colspan="columns.length + 3" class="empty-state">暂无特种车辆维保数据，可先登记维保记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条特种车辆维保记录 · 流转顺序：待进厂 → 维保中 → 待验收 → 已出厂，越级不予受理</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  inRepairVehicles,
  listEntries,
  moduleMeta,
  resetVehmaintSample,
  runAction as applyAction,
  vehmaintReconcileIssues,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('vehmaint')
const columns = ["维保单号", "车辆编号", "维保类型", "进厂日期", "出厂日期", "维修项目", "承修单位", "维保状态"]
const actions = ["送厂维保", "提交验收", "确认出厂"]
const statuses = ["待进厂", "维保中", "待验收", "已出厂"]
const statLabels = ["待进厂车辆", "维保中车辆", "待验收车辆"]
// 仅本地开发环境提供示例数据重置入口；生产构建里该按钮不出现。
const isDev = import.meta.env.DEV

const rows = ref<EntryRow[]>([])
const inRepairRows = ref<EntryRow[]>([])
const issues = ref<ReturnType<typeof vehmaintReconcileIssues>>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
// 统计指标也以状态派生，跟在修名单、看板同源，不再信任历史脏标记。
const liveStats = computed(() =>
  statLabels.map((label, index) => ({
    label,
    value: rows.value.filter((row) => String(row.status) === statuses[index + 1]).length,
  })),
)

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

function resetSample() {
  const ok = window.confirm('只重置「特种车辆维保」这一块的示例数据，其它模块的运行数据不受影响，是否继续？')
  if (!ok) {
    return
  }
  resetVehmaintSample()
  errorMessage.value = ''
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  // 页面动作层只调用门面：状态、在修标记在数据层同一笔落库里写齐，页面不单独清标记。
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
    inRepairRows.value = inRepairVehicles()
    issues.value = vehmaintReconcileIssues()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '特种车辆维保列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.data-card {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 12px;
}
.card-title {
  margin: 0 0 8px;
  font-size: 14px;
}
.issue-list {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
}
</style>
