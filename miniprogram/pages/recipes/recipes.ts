// pages/recipes/recipes.ts
/**
 * 菜谱发现页 - 纯 TheMealDB 数据源
 * 规则：无图 = 不展示，无兜底数据、无占位图
 */
import { SCENARIOS } from '../../utils/constants'

interface RecipeItem {
  _id: string
  name: string
  image: string
  description: string
  cookTime: number
  difficulty: string
  tags: string[]
  matchRate: number
  canCook: boolean
  servings: Record<string, number>
  missingIngredients: any[]
  source?: string
}

Page({
  data: {
    scenario: 'single',
    searchKey: '',
    currentFilter: 'all',
    filters: [
      { label: '全部', value: 'all' },
      { label: '✅ 可做', value: 'canCook' },
      { label: '⚡ 快手菜', value: 'quick' },
      { label: '🔥 下饭菜', value: 'hearty' },
      { label: '🥗 轻食', value: 'light' },
    ] as any[],

    recipes: [] as RecipeItem[],
    foodCount: 0,
    canCookCount: 0,
    loading: false,
    loadingMore: false,
    hasMore: true,
    page: 1,
    pageSize: 10,

    currentSource: 'mealdb',
    mealdbLoading: false,
    showMealdbBanner: false,   // 不再需要 MealDB 横幅（纯 MealDB 模式）
  },

  onLoad() {
    const app = getApp<IAppOption>()
    this.setData({ scenario: app.globalData.scenario })
    this.loadRecipes()
  },

  onShow() {
    const app = getApp<IAppOption>()
    if (app.globalData.scenario !== this.data.scenario) {
      this.setData({ scenario: app.globalData.scenario }, () => this.loadRecipes())
    }
  },

  onPullDownRefresh() {
    this.loadRecipes().then(() => wx.stopPullDownRefresh())
  },

  /** 加载菜谱（纯 MealDB 数据源） */
  async loadRecipes(append = false) {
    if (this.data.loading && !append) return

    this.setData({
      loading: !append,
      loadingMore: append,
      page: append ? this.data.page + 1 : 1,
      mealdbLoading: true,
    })

    try {
      const res = await wx.cloud.callFunction({
        name: 'getRecipeRecommendations',
        data: {
          scenario: this.data.scenario,
          searchKey: this.data.searchKey.trim(),
          filter: this.data.currentFilter === 'all' ? undefined : this.data.currentFilter,
          page: append ? this.data.page + 1 : 1,
          pageSize: this.data.pageSize,
          loadMoreMealdb: append,
        },
      })

      let newRecipes: RecipeItem[] = []

      if (res?.result?.recipes && Array.isArray(res.result.recipes)) {
        newRecipes = res.result.recipes.map((r: any) => ({
          ...r,
          // ★ 确保每道菜都有图片（云函数已过滤，这里做二次保险）
        }))

        // 二次过滤：确保没有空图片的菜谱漏网
        newRecipes = newRecipes.filter((r: RecipeItem) => r.image && r.image.trim())

        this.setData({
          recipes: append ? [...this.data.recipes, ...newRecipes] : newRecipes,
          hasMore: newRecipes.length >= this.data.pageSize,
          foodCount: res.result.foodCount || 0,
          canCookCount: (append ? this.data.canCookCount : 0) + (newRecipes.filter((r: any) => r.canCook).length),
          currentSource: res.result.source || 'mealdb',
        })
      } else {
        // 无数据 → 显示空状态（不使用任何兜底）
        this.setData({
          recipes: append ? this.data.recipes : [],
          hasMore: false,
          foodCount: 0,
          canCookCount: 0,
        })
      }
    } catch (e) {
      console.error('加载菜谱失败:', e)
      this.setData({ recipes: [], hasMore: false })
    } finally {
      this.setData({ loading: false, loadingMore: false, mealdbLoading: false })
    }
  },

  /** 加载更多 */
  loadMore() {
    if (!this.data.hasMore || this.data.loadingMore) return
    this.loadRecipes(true)
  },

  /* === 事件处理 === */

  onScenarioChange(e: WechatMiniprogram.CustomEvent) {
    const value = e.detail.value
    const app = getApp<IAppOption>()
    app.setScenario(value)
    this.setData({ scenario: value }, () => this.loadRecipes())
  },

  onSearchInput(e: WechatMiniprogram.Input) {
    clearTimeout(this.searchTimer as any)
    this.setData({ searchKey: e.detail.value })
    this.searchTimer = setTimeout(() => this.loadRecipes(), 400) as any
  },

  onFilterChange(e: WechatMiniprogram.TouchEvent) {
    this.setData({ currentFilter: e.currentTarget.dataset.value }, () => this.loadRecipes())
  },

  goDetail(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id
    if (id) {
      wx.navigateTo({ url: `/pages/recipe-detail/recipe-detail?id=${id}` })
    }
  },

  goAddFood() {
    wx.navigateTo({ url: '/pages/add-food/add-food' })
  },

  /** 加载更多 MealDB 菜谱 */
  async loadMoreMealdb() {
    this.loadRecipes(true)
  },
})
