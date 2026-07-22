export type TradeStore = Record<string, any>
export type TradeDashboard = Record<string, any>

export async function api<T = any>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` }))
  if (!response.ok) throw new Error(payload.error || '请求失败')
  return payload as T
}

export function money(value: unknown) {
  return `¥${Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function decimal(value: unknown, digits = 3) {
  return Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function dateTime(value?: string) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚未记录'
}

export function localDateKey(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

export function planStatusLabel(status?: string) {
  return ({
    draft: '草稿',
    pending_confirmation: '待确认',
    confirmed: '已确认',
    active: '已确认生效',
    adjusted: '已调整',
    invalidated: '已失效',
    completed: '已完成',
    archived: '已归档',
  } as Record<string, string>)[status || ''] || status || '尚未创建'
}

export function planLabel(plan?: Record<string, any> | null) {
  if (!plan) return '尚未创建有效计划'
  return `${plan.planForDate || ''} · ${planStatusLabel(plan.status)} · V${plan.version || 1}`
}

export function holdingPnl(holding: Record<string, any>) {
  return holding.brokerPnl == null
    ? holdingMarketValue(holding) - Number(holding.cost) * Number(holding.quantity) + Number(holding.pnlAdjustment || 0)
    : Number(holding.brokerPnl)
}

export function holdingMarketValue(holding: Record<string, any>) {
  const latestPrice = Number(holding.lastPrice)
  return Number(holding.quantity || 0) * (Number.isFinite(latestPrice) && latestPrice >= 0 ? latestPrice : 0)
}

export function pnlClass(value: unknown) {
  const number = Number(value || 0)
  return number > 0 ? 'text-emerald-600' : number < 0 ? 'text-red-600' : 'text-muted-foreground'
}
