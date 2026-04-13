// pages/index/index.ts
import { getExpiryStatus, getExpiryText, daysBetween } from '../../utils/date'
import { CATEGORY_INFO, EXPIRY_STATUS } from '../../utils/constants'

// 获取应用实例（安全获取）
let _app: any = null
try { _app = getApp() } catch(e) {}

interface FoodItem {
  _id: string
  name: string
  brand: string
  category: string
  quantity: number
  unit: string
  location: string
  expiryDate: string
  productionDate: string
  shelfLifeDays: number
  status: string
}

interface RecipeSummary {
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
}

interface Stats {
  total: number
  expiring: number
  expired: number
  canCookRecipes: number | null
}

Page({
  data: {
    // 用户信息（从全局同步）
    userInfo: { nickName: '', avatarUrl: '' } as any,
    isLoggedIn: false,
    displayGreeting: '',       // 派生字段：问候语 + 昵称（WXML不支持三元拼接）
    // 问候语
    greetingText: '',
    // 场景模式
    scenario: 'single',
    // 统计数据
    stats: { total: 0, expiring: 0, expired: 0, canCookRecipes: null } as Stats,
    // 临期食材列表（最多5个）
    expiringItems: [] as any[],
    // 今日推荐菜谱（最多3个）
    todayRecipes: [] as RecipeSummary[],
    // 最近添加的食材（最多4个）
    recentItems: [] as any[],
    // 快捷操作
    quickActions: [
      { icon: '➕', label: '添加', path: '/pages/add-food/add-food', bgColor: 'linear-gradient(135deg, #FF9A8B, #FF6A88)' },
      { icon: '📷', label: '扫码', path: '/pages/add-food/add-food?mode=scan', bgColor: 'linear-gradient(135deg, #74C0FC, #4DABF7)' },
      { icon: '🍳', label: '菜谱', path: '/pages/recipes/recipes', bgColor: 'linear-gradient(135deg, #FFE066, #FFD43B)' },
      { icon: '🛒', label: '购物', path: '/pages/shopping-list/shopping-list', bgColor: 'linear-gradient(135deg, #A8E6CF, #69DB7C)' },
    ],
    // 加载状态
    loading: false,
    // 填充度（用于进度条）
    fillLevel: '0',
  },

  onLoad() {
    // ⭐ 立即设置问候语（不依赖任何异步数据，保证页面有内容）
    this._setGreeting()
    this._syncUserInfo()
    const app = _app || getApp()
    this.setData({ scenario: (app?.globalData?.scenario) || 'single' })
    // 延迟加载数据（让页面先渲染出基础框架）
    setTimeout(() => {
      this.loadAllData()
    }, 100)
  },

  onShow() {
    // 每次显示时刷新数据 + 同步用户信息
    this._syncUserInfo()
    this.refreshData()
  },

  onPullDownRefresh() {
    this.refreshData().then(() => {
      wx.stopPullDownRefresh()
    })
  },

  /**
   * 设置问候语 — 根据时间段变化
   */
  _setGreeting() {
    const hour = new Date().getHours()
    let text = '早上好 ☀️'
    if (hour >= 12 && hour < 14) text = '中午好 🌤'
    else if (hour >= 14 && hour < 18) text = '下午好 ⛅'
    else if (hour >= 18 && hour < 22) text = '晚上好 🌙'
    else if (hour >= 22 || hour < 6) text = '夜深了 🌃'
    this.setData({ greetingText: text })
  },

  /**
   * 加载所有首页数据
   */
  async loadAllData() {
    this.setData({ loading: true })

    try {
      // 先加载食材数据（核心内容）
      await this._loadFoodItems()
      // 再并行加载菜谱（次要内容，失败不影响主界面）
      this._loadRecipeRecommendations()
    } catch (e) {
      console.error('加载数据失败:', e)
      // ⭐ 失败时也确保有基础数据展示（使用演示数据兜底）
      const demo = this._getDemoItems()
      let expiringCount = 0, expiredCount = 0
      for (const item of demo) {
        const s = item.status || getExpiryStatus(item.expiryDate)
        if (s === EXPIRY_STATUS.EXPIRING) expiringCount++
        if (s === EXPIRY_STATUS.EXPIRED) expiredCount++
      }
      this.setData({
        stats: { total: demo.length, expiring: expiringCount, expired: expiredCount, canCookRecipes: null },
        expiringItems: [],
        recentItems: demo.slice(0, 4),
        fillLevel: String(Math.min(demo.length * 3, 100)),
        todayRecipes: [],
      })
    } finally {
      this.setData({ loading: false })
    }
  },

  /**
   * 刷新数据
   */
  async refreshData(): Promise<void> {
    try {
      await Promise.all([
        this._loadFoodItems(),
        this._loadRecipeRecommendations(),
      ])
    } catch (e) {
      console.error('刷新数据失败:', e)
    }
  },

  /**
   * 从数据库加载食材列表
   * 如果集合不存在或数据为空，使用演示数据
   */
  async _loadFoodItems() {
    let items: any[] = []

    try {
      const db = wx.cloud.database()
      const _ = db.command
      const res = await db.collection('fridge_items')
        .where({ status: _.in(['fresh', 'expiring', 'expired']) })
        .orderBy('updatedAt', 'desc')
        .limit(50)
        .get()

      items = res.data || []
      console.log(`🧊 [首页] 查询到 ${items.length} 条食材`)
    } catch (e) {
      // 数据库查询失败 → 使用演示数据兜底（真机常见：权限/网络问题）
      console.warn('⚠️ [首页] 食材查询失败（可能是数据库未初始化或网络问题）:', e)
    }

    // ★ 无论是否查到数据，都确保有内容展示
    if (items.length === 0) {
      items = this._getDemoItems()
      console.log('🎭 [首页] 使用演示数据')
    }

      // 计算统计
      let expiringCount = 0
      let expiredCount = 0

      const enrichedItems = items.map(item => {
        if (!item.expiryDate) return item
        
        const status = item.status || getExpiryStatus(item.expiryDate)
        if (status === EXPIRY_STATUS.EXPIRING) expiringCount++
        if (status === EXPIRY_STATUS.EXPIRED) expiredCount++

        return {
          ...item,
          status,
          expiryText: getExpiryText(item.expiryDate),
          categoryColor: CATEGORY_INFO[item.category]?.color || CATEGORY_INFO.other?.color,
        }
      })

      // 取临期/过期的前5条作为提醒
      const alertItems = enrichedItems
        .filter(i => i.status === EXPIRY_STATUS.EXPIRING || i.status === EXPIRY_STATUS.EXPIRED)
        .slice(0, 5)

      // 最近添加的4条
      const recent = enrichedItems.slice(0, 4)

      this.setData({
        stats: {
          total: items.length,
          expiring: expiringCount,
          expired: expiredCount,
          canCookRecipes: null, // 稍后由菜谱接口更新
        },
        expiringItems: alertItems,
        recentItems: recent,
        fillLevel: String(Math.min(items.length * 3, 100)),
      })
  },

  /**
   * 演示用假数据（数据库为空时使用）
   */
  _getDemoItems() {
    const today = new Date()
    const fmt = (d: number) => {
      const t = new Date(today); t.setDate(t.getDate() + d)
      return t.toISOString().slice(0, 10)
    }

    return [
      { _id: 'demo_001', name: '西红柿', brand: '', category: 'vegetable', quantity: 4, unit: '个', location: 'fridge', expiryDate: fmt(3), productionDate: fmt(-5), shelfLifeDays: 7 },
      { _id: 'demo_002', name: '鸡蛋', brand: '德青源', category: 'other', quantity: 8, unit: '个', location: 'fridge', expiryDate: fmt(14), productionDate: fmt(-7), shelfLifeDays: 21 },
      { _id: 'demo_003', name: '五花肉', brand: '金龙鱼', category: 'meat', quantity: 500, unit: 'g', location: 'freeze', expiryDate: fmt(30), productionDate: fmt(-10), shelfLifeDays: 90 },
      { _id: 'demo_004', name: '纯牛奶', brand: '蒙牛', category: 'dairy', quantity: 2, unit: '盒', location: 'fridge', expiryDate: fmt(5), productionDate: fmt(-12), shelfLifeDays: 21 },
      { _id: 'demo_005', name: '西兰花', brand: '', category: 'vegetable', quantity: 2, unit: '颗', location: 'fridge', expiryDate: fmt(1), productionDate: fmt(-3), shelfLifeDays: 5 },
      { _id: 'demo_006', name: '苹果', brand: '', category: 'fruit', quantity: 6, unit: '个', location: 'fridge', expiryDate: fmt(10), productionDate: fmt(-7), shelfLifeDays: 21 },
      { _id: 'demo_007', name: '鸡中翅', brand: '圣农', category: 'meat', quantity: 12, unit: '只', location: 'freeze', expiryDate: fmt(45), productionDate: fmt(-15), shelfLifeDays: 180 },
      { _id: 'demo_008', name: '酸奶', brand: '简爱', category: 'dairy', quantity: 4, unit: '杯', location: 'fridge', expiryDate: fmt(-1), productionDate: fmt(-22), shelfLifeDays: 21 },
      { _id: 'demo_009', name: '大葱', brand: '', category: 'vegetable', quantity: 3, unit: '根', location: 'fridge', expiryDate: fmt(0), productionDate: fmt(-7), shelfLifeDays: 7 },
      { _id: 'demo_010', name: '酱油', brand: '海天', category: 'condiment', quantity: 1, unit: '瓶', location: 'door', expiryDate: fmt(365), productionDate: fmt(-100), shelfLifeDays: 730 },
    ]
  },

  /**
   * 加载今日推荐菜谱（纯 MealDB 数据源，无兜底）
   * 规则：无图 = 不展示
   */
  async _loadRecipeRecommendations() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'getRecipeRecommendations',
        data: {
          scenario: this.data.scenario,
          limit: 3,
        },
      })

      if (res.result?.recipes && Array.isArray(res.result.recipes)) {
        // ★ 二次过滤：确保只保留有图片的菜谱
        const recipes = res.result.recipes
          .filter((r: any) => r.image && r.image.trim())
          .map((r: any) => ({ ...r }))

        this.setData({
          todayRecipes: recipes,
          'stats.canCookRecipes': recipes.filter((r: any) => r.canCook).length,
        })
      } else {
        // 无数据 → 空列表（不使用兜底数据）
        this.setData({ todayRecipes: [], 'stats.canCookRecipes': 0 })
      }
    } catch (e) {
      console.error('加载菜谱推荐失败:', e)
      // 失败也显示空（不使用任何本地兜底）
      this.setData({ todayRecipes: [], 'stats.canCookRecipes': 0 })
    }
  },

  /**
   * 从全局同步用户信息（头像/昵称/登录状态）
   */
  _syncUserInfo() {
    const app = _app || getApp<IAppOption>() || {}
    const globalInfo = app.globalData?.userInfo
    const nick = globalInfo?.nickName || ''
    const baseGreeting = (this.data as any).greetingText || this._getGreetingText()

    // 派生字段：WXML 不支持三元运算符拼接，必须在 TS 层算好
    let displayGreeting = baseGreeting
    if (nick) {
      displayGreeting += '，' + nick
    }

    this.setData({
      userInfo: {
        nickName: globalInfo?.nickName || '',
        avatarUrl: globalInfo?.avatarUrl || '',
      },
      isLoggedIn: !!(app.globalData && app.globalData.openid),
      displayGreeting,
    })
  },

  /** 快速获取问候语文本（供 _syncUserInfo 调用） */
  _getGreetingText(): string {
    const hour = new Date().getHours()
    if (hour < 6) return '夜深了'
    if (hour < 11) return '早上好 ☀️'
    if (hour < 14) return '中午好 🌤️'
    if (hour < 18) return '下午好 🌥️'
    if (hour < 22) return '晚上好 🌙'
    return '夜深了 🌟'
  },

  /** 导航方法们 */
  goProfile() {
    wx.switchTab({ url: '/pages/profile/profile' })
  },

  goAddFood() {
    wx.navigateTo({ url: '/pages/add-food/add-food' })
  },

  goFridgeDetail() {
    wx.switchTab({ url: '/pages/fridge/fridge' })
  },

  goRecipes() {
    wx.switchTab({ url: '/pages/recipes/recipes' })
  },

  goFoodDetail(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id
    if (id) {
      wx.navigateTo({ url: `/pages/food-detail/food-detail?id=${id}` })
    }
  },

  onRecipeTap(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id
    if (id) {
      wx.navigateTo({ url: `/pages/recipe-detail/recipe-detail?id=${id}` })
    }
  },

  navigateTo(e: WechatMiniprogram.TouchEvent) {
    const path = e.currentTarget.dataset.path
    if (path.startsWith('/pages/') && !path.includes('?')) {
      // tabBar页面用switchTab
      const tabPages = ['index', 'fridge', 'recipes', 'profile']
      const pageName = path.split('/').pop()
      if (tabPages.includes(pageName)) {
        wx.switchTab({ url: path })
      } else {
        wx.navigateTo({ url: path })
      }
    } else if (path.includes('?mode=')) {
      wx.navigateTo({ url: path })
    }
  },
})
