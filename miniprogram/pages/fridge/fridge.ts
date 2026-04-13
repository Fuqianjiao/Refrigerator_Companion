// pages/fridge/fridge.ts
import {
  CATEGORIES,
  CATEGORY_INFO,
  CATEGORY_ORDER,
  EXPIRY_STATUS,
} from '../../utils/constants'
import { getExpiryStatus, getExpiryText, daysBetween } from '../../utils/date'

interface FoodItemData {
  _id: string
  name: string
  brand: string
  category: string
  categoryColor?: string
  quantity: number
  unit: string
  location: string
  expiryDate: string
  productionDate: string
  shelfLifeDays: number
  status: string
  expiryText?: string
}

type SortType = 'expiry' | 'name' | 'added' | 'category'

Page({
  data: {
    // 搜索关键词
    searchKey: '',
    // 当前选中分类
    currentCategory: 'all',
    // 分类列表（带数量）
    categories: [] as any[],
    // 筛选后的食材列表
    filteredItems: [] as FoodItemData[],
    // 原始全部食材
    allItems: [] as FoodItemData[],
    // 排序类型
    currentSort: 'expiry' as SortType,
    sortLabels: { expiry: '过期时间', name: '名称', added: '添加时间', category: '分类' } as Record<string, string>,
    sortAsc: true,
    // 只看临期筛选
    showExpiryFilter: false,
    expiryFilter: false,
    // 加载状态
    loading: false,
  },

  onLoad() {
    this._buildCategories()
    this.loadFoodItems()
  },

  onShow() {
    this.loadFoodItems()
  },

  onPullDownRefresh() {
    this.loadFoodItems().then(() => wx.stopPullDownRefresh())
  },

  /**
   * 构建分类标签列表（含"全部"）
   */
  _buildCategories() {
    const categories = [
      { value: 'all', label: '全部', icon: '🧊', count: 0 },
    ]
    
    for (const cat of CATEGORY_ORDER) {
      const info = CATEGORY_INFO[cat]
      if (info) {
        categories.push({
          value: cat,
          label: info.label,
          icon: info.icon,
          count: 0,
        })
      }
    }

    this.setData({ categories })
  },

  /**
   * 从数据库加载所有食材
   */
  async loadFoodItems(): Promise<void> {
    this.setData({ loading: true })

    try {
      const db = wx.cloud.database()
      const _ = db.command
      const res = await db.collection('fridge_items')
        .where({ status: _.in(['fresh', 'expiring', 'expired']) })
        .orderBy('updatedAt', 'desc')
        .limit(100)
        .get()

      let items: FoodItemData[] = (res.data || []).map((item: any) => ({
        ...item,
        status: item.status || (item.expiryDate ? getExpiryStatus(item.expiryDate) : 'fresh'),
        expiryText: item.expiryDate ? getExpiryText(item.expiryDate) : '',
        categoryColor: CATEGORY_INFO[item.category]?.color || CATEGORY_INFO.other?.color,
      })) as FoodItemData[]

      // 数据库为空时使用演示数据
      if (items.length === 0) {
        items = this._getDemoItems()
      }

      this.setData({
        allItems: items,
      }, () => {
        this._updateCategoryCounts(items)
        this.applyFiltersAndSort()
      })
    } catch (e) {
      console.warn('食材数据加载失败（可能是数据库未初始化）:', e)
      // 使用演示数据
      const items = this._getDemoItems()
      this.setData({
        allItems: items,
      }, () => {
        this._updateCategoryCounts(items)
        this.applyFiltersAndSort()
      })
    } finally {
      this.setData({ loading: false })
    }
  },

  /**
   * 演示用假数据（数据库为空时使用）
   */
  _getDemoItems(): FoodItemData[] {
    const today = new Date()
    const fmt = (d: number) => {
      const t = new Date(today); t.setDate(t.getDate() + d)
      return t.toISOString().slice(0, 10)
    }

    return [
      { _id: 'demo_001', name: '西红柿', brand: '', category: 'vegetable', categoryColor: '#51CF66',
        quantity: 4, unit: '个', location: 'fridge', expiryDate: fmt(3), productionDate: fmt(-5), shelfLifeDays: 7, status: getExpiryStatus(fmt(3)), expiryText: getExpiryText(fmt(3)) },
      { _id: 'demo_002', name: '鸡蛋', brand: '德青源', category: 'other', categoryColor: '#B197FC',
        quantity: 8, unit: '个', location: 'fridge', expiryDate: fmt(14), productionDate: fmt(-7), shelfLifeDays: 21, status: getExpiryStatus(fmt(14)), expiryText: getExpiryText(fmt(14)) },
      { _id: 'demo_003', name: '五花肉', brand: '金龙鱼', category: 'meat', categoryColor: '#FF6B6B',
        quantity: 500, unit: 'g', location: 'freeze', expiryDate: fmt(30), productionDate: fmt(-10), shelfLifeDays: 90, status: getExpiryStatus(fmt(30)), expiryText: getExpiryText(fmt(30)) },
      { _id: 'demo_004', name: '纯牛奶', brand: '蒙牛', category: 'dairy', categoryColor: '#74C0FC',
        quantity: 2, unit: '盒', location: 'fridge', expiryDate: fmt(5), productionDate: fmt(-12), shelfLifeDays: 21, status: getExpiryStatus(fmt(5)), expiryText: getExpiryText(fmt(5)) },
      { _id: 'demo_005', name: '西兰花', brand: '', category: 'vegetable', categoryColor: '#51CF66',
        quantity: 2, unit: '颗', location: 'fridge', expiryDate: fmt(1), productionDate: fmt(-3), shelfLifeDays: 5, status: getExpiryStatus(fmt(1)), expiryText: getExpiryText(fmt(1)) },
      { _id: 'demo_006', name: '苹果', brand: '', category: 'fruit', categoryColor: '#FF922B',
        quantity: 6, unit: '个', location: 'fridge', expiryDate: fmt(10), productionDate: fmt(-7), shelfLifeDays: 21, status: getExpiryStatus(fmt(10)), expiryText: getExpiryText(fmt(10)) },
      { _id: 'demo_007', name: '鸡中翅', brand: '圣农', category: 'meat', categoryColor: '#FF6B6B',
        quantity: 12, unit: '只', location: 'freeze', expiryDate: fmt(45), productionDate: fmt(-15), shelfLifeDays: 180, status: getExpiryStatus(fmt(45)), expiryText: getExpiryText(fmt(45)) },
      { _id: 'demo_008', name: '酸奶', brand: '简爱', category: 'dairy', categoryColor: '#74C0FC',
        quantity: 4, unit: '杯', location: 'fridge', expiryDate: fmt(-1), productionDate: fmt(-22), shelfLifeDays: 21, status: getExpiryStatus(fmt(-1)), expiryText: getExpiryText(fmt(-1)) },
      { _id: 'demo_009', name: '大葱', brand: '', category: 'vegetable', categoryColor: '#51CF66',
        quantity: 3, unit: '根', location: 'fridge', expiryDate: fmt(0), productionDate: fmt(-7), shelfLifeDays: 7, status: getExpiryStatus(fmt(0)), expiryText: getExpiryText(fmt(0)) },
      { _id: 'demo_010', name: '酱油', brand: '海天', category: 'condiment', categoryColor: '#FFE066',
        quantity: 1, unit: '瓶', location: 'door', expiryDate: fmt(365), productionDate: fmt(-100), shelfLifeDays: 730, status: getExpiryStatus(fmt(365)), expiryText: getExpiryText(fmt(365)) },
      { _id: 'demo_011', name: '胡萝卜', brand: '', category: 'vegetable', categoryColor: '#51CF66',
        quantity: 3, unit: '根', location: 'fridge', expiryDate: fmt(7), productionDate: fmt(-5), shelfLifeDays: 14, status: getExpiryStatus(fmt(7)), expiryText: getExpiryText(fmt(7)) },
      { _id: 'demo_012', name: '可乐', brand: '可口可乐', category: 'beverage', categoryColor: '#E599F7',
        quantity: 1, unit: '瓶', location: 'fridge', expiryDate: fmt(180), productionDate: fmt(-60), shelfLifeDays: 365, status: getExpiryStatus(fmt(180)), expiryText: getExpiryText(fmt(180)) },
    ]
  },

  /**
   * 更新各分类的计数
   */
  _updateCategoryCounts(items: FoodItemData[]) {
    const counts: Record<string, number> = { all: items.length }
    for (const item of items) {
      counts[item.category] = (counts[item.category] || 0) + 1
    }

    const categories = this.data.categories.map(cat => ({
      ...cat,
      count: counts[cat.value] || 0,
    }))
    this.setData({ categories })
  },

  /**
   * 应用筛选和排序
   */
  applyFiltersAndSort() {
    let items = [...this.data.allItems]

    // 搜索过滤
    if (this.data.searchKey.trim()) {
      const key = this.data.searchKey.trim().toLowerCase()
      items = items.filter(item =>
        item.name.toLowerCase().includes(key) ||
        (item.brand && item.brand.toLowerCase().includes(key))
      )
    }

    // 分类过滤
    if (this.data.currentCategory !== 'all') {
      items = items.filter(item => item.category === this.data.currentCategory)
    }

    // 临期过滤
    if (this.data.expiryFilter) {
      items = items.filter(
        item => item.status === EXPIRY_STATUS.EXPIRING || item.status === EXPIRY_STATUS.EXPIRED
      )
      this.setData({ showExpiryFilter: true })
    }

    // 排序
    items = this._sortItems(items)

    this.setData({ filteredItems: items })
  },

  /**
   * 排序逻辑
   */
  _sortItems(items: FoodItemData[]): FoodItemData[] {
    const { currentSort, sortAsc } = this.data
    const sorted = [...items]

    switch (currentSort) {
      case 'expiry':
        sorted.sort((a, b) => {
          if (!a.expiryDate) return 1
          if (!b.expiryDate) return -1
          return sortAsc
            ? new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime()
            : new Date(b.expiryDate).getTime() - new Date(a.expiryDate).getTime()
        })
        break
      case 'name':
        sorted.sort((a, b) => sortAsc
          ? a.name.localeCompare(b.name)
          : b.name.localeCompare(a.name)
        )
        break
      case 'added': // 已经按 updatedAt desc 排序了
        break
      case 'category':
        const order = ['all', ...CATEGORY_ORDER]
        sorted.sort((a, b) => sortAsc
          ? order.indexOf(a.category) - order.indexOf(b.category)
          : order.indexOf(b.category) - order.indexOf(a.category)
        )
        break
    }

    return sorted
  },

  /* === 事件处理 === */

  /** 搜索输入 */
  onSearchInput(e: WechatMiniprogram.Input) {
    this.setData({ searchKey: e.detail.value })
    clearTimeout(this.searchTimer as any)
    this.searchTimer = setTimeout(() => {
      this.applyFiltersAndSort()
    }, 300) as any
  },

  /** 确认搜索 */
  onSearch() {
    this.applyFiltersAndSort()
  },

  /** 清除搜索 */
  clearSearch() {
    this.setData({ searchKey: '' }, () => this.applyFiltersAndSort())
  },

  /** 切换分类 */
  onCategoryChange(e: WechatMiniprogram.TouchEvent) {
    const value = e.currentTarget.dataset.value
    this.setData({ currentCategory: value }, () => this.applyFiltersAndSort())
  },

  /** 切换临期筛选 */
  toggleExpiryFilter() {
    this.setData({ expiryFilter: !this.data.expiryFilter }, () => this.applyFiltersAndSort())
  },

  /** 切换排序 */
  toggleSort() {
    const sorts: SortType[] = ['expiry', 'name', 'added', 'category']
    const currentIndex = sorts.indexOf(this.data.currentSort)
    const nextIndex = (currentIndex + 1) % sorts.length
    this.setData({
      currentSort: sorts[nextIndex],
      sortAsc: nextIndex === 0 ? false : true, // 默认过期时间从近到远排
    }, () => this.applyFiltersAndSort())
  },

  /** 跳转详情页 */
  goDetail(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id
    if (id) {
      wx.navigateTo({ url: `/pages/food-detail/food-detail?id=${id}` })
    }
  },

  /** 跳转添加页面 */
  goAddFood() {
    wx.navigateTo({ url: '/pages/add-food/add-food' })
  },
})
