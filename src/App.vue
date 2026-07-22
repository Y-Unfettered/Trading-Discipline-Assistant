<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  BarChart3, Bell, BookOpenCheck, CalendarCheck2, ChartNoAxesCombined, CircleHelp, CircleDollarSign,
  ArrowUp, ClipboardCheck, Database, LayoutDashboard, Moon, RefreshCw, Search, Settings,
  ShieldCheck, Sun, Target, UserRound, WalletCards,
} from 'lucide-vue-next'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarProvider, SidebarRail, SidebarTrigger,
} from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'
import { Spinner } from '@/components/ui/spinner'
import OverviewPage from '@/pages/OverviewPage.vue'
import AssetsPage from '@/pages/AssetsPage.vue'
import PlanPage from '@/pages/PlanPage.vue'
import IntradayPage from '@/pages/IntradayPage.vue'
import PostmarketPage from '@/pages/PostmarketPage.vue'
import FundsPage from '@/pages/FundsPage.vue'
import StockPnlPage from '@/pages/StockPnlPage.vue'
import DataPage from '@/pages/DataPage.vue'
import { api, dateTime, money, type TradeDashboard, type TradeStore } from '@/lib/trade-api'

const navGroups = [
  {
    label: '每日工作流',
    items: [
      { label: '纪律驾驶舱', page: 'overview', icon: LayoutDashboard },
      { label: '交易标的中心', page: 'assets', icon: Target },
      { label: '下一交易日计划', page: 'plan', icon: CalendarCheck2 },
      { label: '盘中行动卡', page: 'intraday', icon: ClipboardCheck },
      { label: '盘后核对与复盘', page: 'postmarket', icon: BookOpenCheck },
    ],
  },
  {
    label: '数据与分析',
    items: [
      { label: '资金轨迹', page: 'funds', icon: CircleDollarSign },
      { label: '个股盈亏', page: 'stock-pnl', icon: BarChart3 },
      { label: '数据与恢复', page: 'data', icon: Database },
    ],
  },
]
const allNavItems = navGroups.flatMap(group => group.items)
const validPages = new Set(allNavItems.map(item => item.page))
function pageFromLocation() {
  const page = window.location.hash.slice(1)
  return validPages.has(page) ? page : 'overview'
}

const currentPage = ref(pageFromLocation())
const store = ref<TradeStore>({})
const dashboard = ref<TradeDashboard>({})
const loading = ref(true)
const loadError = ref('')
const sidebarOpen = ref(localStorage.getItem('trade-discipline-sidebar-collapsed') !== 'true')
const isDarkMode = ref(document.documentElement.classList.contains('dark'))
const now = ref(new Date())
const utilityPanel = ref<'settings' | 'help' | null>(null)
const searchOpen = ref(false)
const searchQuery = ref('')
const accountOpen = ref(false)
const healthOpen = ref(false)
const workspaceScroll = ref<HTMLElement | null>(null)
const showBackToTop = ref(false)
let clockTimer: number | undefined

watch(sidebarOpen, open => localStorage.setItem('trade-discipline-sidebar-collapsed', String(!open)))
const activeNav = computed(() => allNavItems.find(item => item.page === currentPage.value) || allNavItems[0])
const filteredNavItems = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  return query ? allNavItems.filter(item => item.label.toLowerCase().includes(query)) : allNavItems
})

async function loadData() {
  loading.value = true
  loadError.value = ''
  try {
    const [nextStore, nextDashboard] = await Promise.all([
      api<TradeStore>('/api/store'),
      api<TradeDashboard>('/api/dashboard'),
    ])
    store.value = nextStore
    dashboard.value = nextDashboard
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '数据加载失败'
  } finally {
    loading.value = false
  }
}

function navigate(page: string) {
  if (!validPages.has(page)) return
  currentPage.value = page
  history.replaceState(null, '', page === 'overview' ? `${location.pathname}${location.search}` : `#${page}`)
  workspaceScroll.value?.scrollTo({ top: 0, behavior: 'smooth' })
  searchOpen.value = false
}

function handleWorkspaceScroll() {
  showBackToTop.value = Number(workspaceScroll.value?.scrollTop || 0) > 480
}

function scrollWorkspaceToTop() {
  workspaceScroll.value?.scrollTo({ top: 0, behavior: 'smooth' })
}

function toggleTheme() {
  isDarkMode.value = !isDarkMode.value
  document.documentElement.classList.toggle('dark', isDarkMode.value)
  localStorage.setItem('trade-discipline-theme', isDarkMode.value ? 'dark' : 'light')
}

function handleShortcut(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    searchQuery.value = ''
    searchOpen.value = true
  }
  if (event.key === 'Escape') {
    searchOpen.value = false
    utilityPanel.value = null
  }
}

function showHealth() {
  if (currentPage.value === 'overview') {
    document.getElementById('health-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  } else {
    healthOpen.value = true
  }
}

onMounted(() => {
  loadData()
  clockTimer = window.setInterval(() => { now.value = new Date() }, 30_000)
  window.addEventListener('keydown', handleShortcut)
  window.addEventListener('hashchange', () => { currentPage.value = pageFromLocation() })
})
onUnmounted(() => {
  window.clearInterval(clockTimer)
  window.removeEventListener('keydown', handleShortcut)
})
</script>

<template>
  <SidebarProvider v-model:open="sidebarOpen" class="h-svh overflow-hidden">
    <Sidebar collapsible="icon">
      <SidebarHeader class="h-16 justify-center">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" tooltip="交易纪律助手" @click="navigate('overview')">
              <span
                class="flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg bg-red-600 text-white">
                <ChartNoAxesCombined class="size-4" />
              </span>
              <span class="text-lg font-bold">交易纪律助手 V3.0</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      
      <Separator />

      <SidebarContent>
        <SidebarGroup v-for="group in navGroups" :key="group.label">
          <SidebarGroupLabel>{{ group.label }}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem v-for="item in group.items" :key="item.page">
                <SidebarMenuButton :is-active="currentPage === item.page" :tooltip="item.label"
                  @click="navigate(item.page)">
                  <component :is="item.icon" />
                  <span>{{ item.label }}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="搜索" @click="searchQuery = ''; searchOpen = true">
              <Search />
              <span>搜索</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="设置" @click="utilityPanel = 'settings'">
              <Settings />
              <span>设置</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="帮助" @click="utilityPanel = 'help'">
              <CircleHelp />
              <span>帮助</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <SidebarMenuButton size="lg" tooltip="本地账户">
                  <Avatar class="size-8 rounded-lg">
                    <AvatarFallback class="rounded-lg bg-red-100 text-red-700">
                      <UserRound class="size-4" />
                    </AvatarFallback>
                  </Avatar>
                  <span>本地账户</span>
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="end">
                <DropdownMenuLabel>本地账户</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem @select="accountOpen = true">
                  <WalletCards class="size-4" />
                  资产口径
                </DropdownMenuItem>
                <DropdownMenuItem @select="navigate('data')">
                  <Database class="size-4" />
                  数据与恢复
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled>本地数据已连接</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>

    <SidebarInset class="h-svh min-w-0 overflow-hidden">
      <header class="flex h-16 shrink-0 items-center gap-2 border-b bg-background p-2">
        <SidebarTrigger />
        <Separator orientation="vertical" />
        <h1 class="text-base font-medium"> {{ activeNav.label }} </h1>
        <div class="ml-auto flex items-center gap-2">
          <h1 class="text-base font-medium">
            {{ now.toLocaleDateString('zh-CN') }} {{ now.toLocaleTimeString('zh-CN', {
              hour: '2-digit', minute:
                '2-digit', hour12: false }) }}
          </h1>
          <Button size="icon" variant="outline" :aria-label="isDarkMode ? '切换到浅色模式' : '切换到深色模式'" @click="toggleTheme">
            <Sun v-if="isDarkMode" class="size-4" />
            <Moon v-else class="size-4" />
          </Button>
          <Button size="icon" variant="outline" aria-label="刷新当前页面数据" :disabled="loading" @click="loadData">
            <Spinner v-if="loading" />
            <RefreshCw v-else class="size-4" />
          </Button>
          <Button size="icon" variant="outline" aria-label="查看数据健康" @click="showHealth">
            <Bell class="size-4" />
          </Button>
        </div>
      </header>
      <main ref="workspaceScroll" data-workspace-scroll class="min-h-0 min-w-0 flex-1 overflow-y-auto p-4" @scroll="handleWorkspaceScroll">
        <OverviewPage v-if="currentPage === 'overview'" :store="store" :dashboard="dashboard" :loading="loading"
          :load-error="loadError" @navigate="navigate" @account="accountOpen = true" @retry="loadData" />
        <AssetsPage v-else-if="currentPage === 'assets'" :store="store" @refresh="loadData" @navigate="navigate" />
        <PlanPage v-else-if="currentPage === 'plan'" :store="store" :dashboard="dashboard" @refresh="loadData" />
        <IntradayPage v-else-if="currentPage === 'intraday'" :store="store" :dashboard="dashboard" @refresh="loadData"
          @navigate="navigate" />
        <PostmarketPage v-else-if="currentPage === 'postmarket'" :store="store" :dashboard="dashboard"
          @refresh="loadData" @navigate="navigate" />
        <FundsPage v-else-if="currentPage === 'funds'" :store="store" :dashboard="dashboard" @refresh="loadData" @navigate="navigate" />
        <StockPnlPage v-else-if="currentPage === 'stock-pnl'" :store="store" />
        <DataPage v-else-if="currentPage === 'data'" :store="store" @refresh="loadData" />
      </main>
      <Button v-if="showBackToTop" class="absolute bottom-24 right-6" size="icon" variant="outline" aria-label="返回顶部" title="返回顶部" @click="scrollWorkspaceToTop"><ArrowUp class="size-4" /></Button>
    </SidebarInset>

    <Dialog v-model:open="searchOpen">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>搜索功能页面</DialogTitle>
          <DialogDescription>输入名称快速前往应用页面</DialogDescription>
        </DialogHeader>
        <Input v-model="searchQuery" placeholder="搜索功能页面…" />
        <div class="grid gap-2">
          <Button v-for="item in filteredNavItems" :key="item.page" variant="outline" @click="navigate(item.page)">
            <component :is="item.icon" class="size-4" />
            {{ item.label }}
          </Button>
          <Empty v-if="!filteredNavItems.length">
            <EmptyHeader>
              <EmptyTitle>没有找到相关页面</EmptyTitle>
              <EmptyDescription>请尝试输入其他关键词。</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      </DialogContent>
    </Dialog>

    <Dialog :open="utilityPanel !== null" @update:open="open => { if (!open) utilityPanel = null }">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ utilityPanel === 'settings' ? '界面设置' : '帮助与快捷键' }}</DialogTitle>
          <DialogDescription>{{ utilityPanel === 'settings' ? '调整当前工作区状态。' : '交易纪律助手的常用入口。' }}</DialogDescription>
        </DialogHeader>
        <div v-if="utilityPanel === 'settings'" class="grid gap-2">
          <Button variant="outline" @click="sidebarOpen = !sidebarOpen">
            侧栏显示方式
            <Badge variant="secondary">{{ sidebarOpen ? '完整' : '仅图标' }}</Badge>
          </Button>
          <Button variant="outline" @click="navigate('data'); utilityPanel = null">
            <Database class="size-4" />
            数据与恢复
          </Button>
        </div>
        <Alert v-else>
          <CircleHelp class="size-4" />
          <AlertTitle>键盘快捷键</AlertTitle>
          <AlertDescription>Ctrl / ⌘ + K 打开搜索，Esc 关闭弹窗。</AlertDescription>
        </Alert>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="accountOpen">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>资产口径</DialogTitle>
          <DialogDescription>截至 {{ dateTime(dashboard?.account?.asOf) }}</DialogDescription>
        </DialogHeader>
        <div class="grid gap-2 sm:grid-cols-3">
          <Card>
            <CardHeader>
              <CardDescription>成交后毛现金</CardDescription>
              <CardTitle>{{ money(dashboard?.account?.availableCash) }}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>持仓市值</CardDescription>
              <CardTitle>{{ money(dashboard?.account?.marketValue) }}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>当前总资产</CardDescription>
              <CardTitle>{{ money(dashboard?.account?.totalAssets) }}</CardTitle>
            </CardHeader>
          </Card>
        </div>
        <Alert>
          <WalletCards class="size-4" />
          <AlertTitle>计算说明</AlertTitle>
          <AlertDescription>总资产只等于可用现金加按最新价计算的持仓市值；成本只用于计算浮动盈亏。待核对差额仅用于对账，不计入总资产。</AlertDescription>
        </Alert>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="healthOpen">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>数据健康</DialogTitle>
          <DialogDescription>会影响计划与复盘可信度的问题</DialogDescription>
        </DialogHeader>
        <div v-if="dashboard?.health?.issues?.length" class="grid gap-2">
          <Alert v-for="issue in dashboard.health.issues" :key="issue.message" variant="destructive">
            <Bell class="size-4" />
            <AlertTitle>需要处理</AlertTitle>
            <AlertDescription>{{ issue.message }}</AlertDescription>
          </Alert>
        </div>
        <Alert v-else>
          <ShieldCheck class="size-4" />
          <AlertTitle>数据健康</AlertTitle>
          <AlertDescription>没有发现阻断复盘的问题。</AlertDescription>
        </Alert>
      </DialogContent>
    </Dialog>
  </SidebarProvider>
  <Toaster position="top-center" rich-colors close-button :visible-toasts="4" />
</template>
