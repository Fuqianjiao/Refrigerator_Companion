// pages/cook-history/cook-history.ts
// 做菜历史页面 — 从云端读取做菜记录

interface CookRecord {
  _id: string
  recipeId: string          // 关联的菜谱 ID（MealDB idMeal）
  name: string              // 菜名
  image: string             // 菜谱封面图
  cookedAt: number          // 做菜时间戳 (ms)
  dateStr: string           // 格式化的日期 "2026-04-11"
  timeStr: string           // 时间 "18:30"
  ingredients: string[]     // 消耗的冰箱食材列表
}

interface MonthTab {
  value: string    // 'all' | 'thisMonth' | 'lastMonth'
  label: string    // '全部' | '本月' | '上月'
}

interface Stats {
  monthCount: number      // 本月做菜次数
  totalSaved: number      // 累计节省金额(元)
  favoriteDish: string    // 最常做的菜名
}

Page({
  data: {
    // === 筛选 ===
    tabs: [
      { value: 'all', label: '全部' },
      { value: 'thisMonth', label: '本月' },
      { value: 'lastMonth', label: '上月' },
    ] as MonthTab[],
    currentTab: 'all',

    // === 统计 ===
    stats: {
      monthCount: 0,
      totalSaved: 0,
      favoriteDish: '--',
    } as Stats,

    // === 列表 ===
    records: [] as CookRecord[],
    filteredRecords: [] as CookRecord[],

    // === 状态 ===
    loading: true,
    isEmpty: false,
  },

  // ==================== 生命周期 ====================

  onLoad() {
    this._loadData()
  },

  onShow() {
    // 每次显示时刷新（从菜谱详情页"标记做过"返回时需要更新）
    if (!this.data.loading) {
      this._loadData()
    }
  },

  onPullDownRefresh() {
    this._loadData().then(() => wx.stopPullDownRefresh())
  },

  // ==================== 数据加载 ====================

  async _loadData(): Promise<void> {
    this.setData({ loading: true })

    try {
      const res = await wx.cloud.callFunction({
        name: 'getCookHistory',
        data: {},
      })

      const result = res.result as any

      if (result?.success && Array.isArray(result.records)) {
        const records = result.records.map((r: any) => ({
          ...r,
          dateStr: r.dateStr || this._formatDate(r.cookedAt || Date.now()).dateStr,
          timeStr: r.timeStr || this._formatDate(r.cookedAt || Date.now()).timeStr,
        }))

        const stats: Stats = result.stats || {
          monthCount: records.length,
          totalSaved: records.length * 4,
          favoriteDish: this._findFavorite(records),
        }

        this.setData({ records, stats, loading: false }, () => {
          this._applyFilter()
        })
      } else {
        // 云函数返回失败或无数据 → 显示空列表
        console.warn('getCookHistory 返回异常:', result?.errMsg)
        this.setData({
          records: [],
          filteredRecords: [],
          stats: { monthCount: 0, totalSaved: 0, favoriteDish: '--' },
          isEmpty: true,
          loading: false,
        })
      }
    } catch (e) {
      console.error('加载做菜历史失败:', e)
      // 失败也显示空状态（不用模拟数据，保证数据真实性）
      this.setData({
        records: [],
        filteredRecords: [],
        stats: { monthCount: 0, totalSaved: 0, favoriteDish: '--' },
        isEmpty: true,
        loading: false,
      })
    }
  },

  // ==================== 工具方法 ====================

  /** 格式化时间戳为日期字符串 */
  _formatDate(timestamp: number): { dateStr: string; timeStr: string } {
    const d = new Date(timestamp)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const h = String(d.getHours()).padStart(2, '0')
    const min = String(d.getMinutes()).padStart(2, '0')
    return { dateStr: `${y}-${m}-${day}`, timeStr: `${h}:${min}` }
  },

  /** 找出出现次数最多的菜名 */
  _findFavorite(records: CookRecord[]): string {
    if (!records || records.length === 0) return '--'
    const freq: Record<string, number> = {}
    let maxCount = 0
    let fav = ''
    for (const r of records) {
      freq[r.name] = (freq[r.name] || 0) + 1
      if (freq[r.name] > maxCount) {
        maxCount = freq[r.name]
        fav = r.name
      }
    }
    return maxCount > 1 ? fav : (records[records.length - 1]?.name || '--')
  },

  // ==================== 筛选逻辑 ====================

  onTabChange(e: WechatMiniprogram.TouchEvent) {
    const tab = e.currentTarget.dataset.value as string
    if (tab === this.data.currentTab) return
    this.setData({ currentTab: tab })
    this._applyFilter()
  },

  _applyFilter(): void {
    const { currentTab, records } = this.data
    if (currentTab === 'all') {
      this.setData({
        filteredRecords: records,
        isEmpty: records.length === 0,
        loading: false,
      })
      return
    }

    const now = new Date()
    const curYear = now.getFullYear()
    const curMonth = now.getMonth()

    let filterFn: (r: CookRecord) => boolean
    if (currentTab === 'thisMonth') {
      filterFn = (r: CookRecord) => {
        const d = new Date(r.cookedAt)
        return d.getFullYear() === curYear && d.getMonth() === curMonth
      }
    } else { // lastMonth
      const lastMonth = curMonth === 0 ? 11 : curMonth - 1
      const lastYear = curMonth === 0 ? curYear - 1 : curYear
      filterFn = (r: CookRecord) => {
        const d = new Date(r.cookedAt)
        return d.getFullYear() === lastYear && d.getMonth() === lastMonth
      }
    }

    const filtered = records.filter(filterFn)
    this.setData({
      filteredRecords: filtered,
      isEmpty: filtered.length === 0,
      loading: false,
    })
  },

  // ==================== 事件处理 ====================

  /** 点击"再做一次"→ 跳转菜谱详情 */
  goRecipeDetail(e: WechatMiniprogram.TouchEvent) {
    const recipeId = e.currentTarget.dataset.id as string
    if (recipeId) {
      wx.navigateTo({
        url: `/pages/recipe-detail/recipe-detail?id=${recipeId}`,
      })
    }
  },

  /** 空状态按钮：去发现菜谱 */
  goDiscoverRecipes(): void {
    wx.switchTab({ url: '/pages/recipes/recipes' })
  },
})
