<template>
  <section class="page" data-module="vehiclefleet">
    <header class="page-head">
      <div>
        <h2>特种车辆可用清单</h2>
        <p class="page-desc">
          车辆能否派用以维保记录为唯一依据：在修名单从「特种车辆维保」记录实时派生，本页不维护第二份名单，确认出厂后车辆自动回到可用侧。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="reload">刷新清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">在册车辆</span>
        <strong class="stat-value">{{ availability.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">可用车辆</span>
        <strong class="stat-value">{{ availableCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">在修车辆（不可派用）</span>
        <strong class="stat-value">{{ inRepairRows.length }}</strong>
      </article>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th>车辆编号</th>
          <th>是否可用</th>
          <th>最新维保环节</th>
          <th>维保单号</th>
          <th>承修单位</th>
          <th>维修项目</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in availability" :key="item.vehicleNo">
          <td>{{ item.vehicleNo }}</td>
          <td>{{ item.available ? '可用' : '在修，不可派用' }}</td>
          <td>{{ item.status }}</td>
          <td>{{ item.orderNo || '—' }}</td>
          <td>{{ item.vendor || '—' }}</td>
          <td>{{ item.project || '—' }}</td>
        </tr>
        <tr v-if="!availability.length">
          <td colspan="6" class="empty-state">暂无维保记录，车辆台账将在登记维保后建立</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>名单来源：维保记录（待进厂/已出厂为可用，维保中/待验收为在修），与维保页在修名单同源</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { inRepairVehicles, vehicleAvailability } from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import type { VehicleAvailability } from '@/data/vehmaint'

const availability = ref<VehicleAvailability[]>([])
const inRepairRows = ref<EntryRow[]>([])
const availableCount = computed(() => availability.value.filter((item) => item.available).length)

function reload() {
  // 两处读的是同一个门面、同一份维保记录派生结果，车辆侧绝不另存一份在修名单。
  availability.value = vehicleAvailability()
  inRepairRows.value = inRepairVehicles()
}

onMounted(reload)
</script>
