/* ============================================
   🧊 FridgeMate - 常量定义
   ============================================ */

/** 场景模式 */
export const SCENARIOS = {
  SINGLE: 'single',
  COUPLE: 'couple',
  FAMILY: 'family',
} as const

export const SCENARIO_LABELS: Record<string, string> = {
  [SCENARIOS.SINGLE]: '一人食',
  [SCENARIOS.COUPLE]: '两人食',
  [SCENARIOS.FAMILY]: '家庭餐',
}

export const SCENARIO_ICONS: Record<string, string> = {
  [SCENARIOS.SINGLE]: '🍱',
  [SCENARIOS.COUPLE]: '💑',
  [SCENARIOS.FAMILY]: '👨‍👩‍👧‍👦',
}

/** 食材分类 */
export const CATEGORIES = {
  VEGETABLE: 'vegetable',    // 蔬菜
  FRUIT: 'fruit',            // 水果
  MEAT: 'meat',              // 肉类
  DAIRY: 'dairy',           // 乳制品
  BEVERAGE: 'beverage',     // 饮料
  CONDIMENT: 'condiment',   // 调料
  OTHER: 'other',           // 其他
} as const

export const CATEGORY_INFO: Record<string, { label: string; icon: string; color: string }> = {
  [CATEGORIES.VEGETABLE]: { label: '蔬菜', icon: '🥬', color: '#51CF66' },
  [CATEGORIES.FRUIT]: { label: '水果', icon: '🍎', color: '#FF922B' },
  [CATEGORIES.MEAT]: { label: '肉类', icon: '🥩', color: '#FF6B6B' },
  [CATEGORIES.DAIRY]: { label: '乳制品', icon: '🥛', color: '#74C0FC' },
  [CATEGORIES.BEVERAGE]: { label: '饮料', icon: '🥤', color: '#E599F7' },
  [CATEGORIES.CONDIMENT]: { label: '调料', icon: '🧂', color: '#FFE066' },
  [CATEGORIES.OTHER]: { label: '其他', icon: '📦', color: '#B197FC' },
}

/** 存储位置 */
export const LOCATIONS = {
  FRIDGE: 'fridge',     // 冷藏室
  FREEZE: 'freeze',     // 冷冻室
  DOOR: 'door',         // 门架
} as const

export const LOCATION_LABELS: Record<string, string> = {
  [LOCATIONS.FRIDGE]: '冷藏室',
  [LOCATIONS.FREEZE]: '冷冻室',
  [LOCATIONS.DOOR]: '门架',
}

/** 保质期状态 */
export const EXPIRY_STATUS = {
  FRESH: 'fresh',           // 新鲜
  EXPIRING: 'expiring',     // 临期（3天内）
  EXPIRED: 'expired',       // 已过期
  CONSUMED: 'consumed',     // 已消耗
} as const

export const STATUS_LABELS: Record<string, string> = {
  [EXPIRY_STATUS.FRESH]: '新鲜',
  [EXPIRY_STATUS.EXPIRING]: '临期',
  [EXPIRY_STATUS.EXPIRED]: '已过期',
  [EXPIRY_STATUS.CONSUMED]: '已用完',
}

export const STATUS_COLORS: Record<string, string> = {
  [EXPIRY_STATUS.FRESH]: '#51CF66',
  [EXPIRY_STATUS.EXPIRING]: '#FFD43B',
  [EXPIRY_STATUS.EXPIRED]: '#FF6B6B',
  [EXPIRY_STATUS.CONSUMED]: '#BCAAA4',
}

/** 添加来源 */
export const FOOD_SOURCE = {
  MANUAL: 'manual',      // 手动录入
  SCAN: 'scan',          // 扫码
  PHOTO: 'photo',        // 拍照识别
} as const

/** 菜谱难度 */
export const DIFFICULTY = {
  EASY: 'easy',          // 简单
  MEDIUM: 'medium',      // 中等
  HARD: 'hard',          // 困难
} as const

export const DIFFICULTY_LABELS: Record<string, string> = {
  [DIFFICULTY.EASY]: '简单',
  [DIFFICULTY.MEDIUM]: '中等',
  [DIFFICULTY.HARD]: '较难',
}

/** 数据库集合名 */
export const COLLECTIONS = {
  USERS: 'users',                        // 用户信息（四期新增）
  FRIDGE_ITEMS: 'fridge_items',           // 食材
  RECIPES: 'recipes',                     // 菜谱
  BRAND_SHELF_LIFE: 'brand_shelf_life',   // 品牌保质期库
  USER_SETTINGS: 'user_settings',         // 用户设置
  SHOPPING_LIST: 'shopping_list',         // 购物清单
  SHARED_FRIDGES: 'shared_fridges',       // 冰箱共享组
} as const

/** 云函数名 */
export const CLOUD_FUNCTIONS = {
  LOGIN: 'login',                              // 四期：微信一键登录
  ADD_FOOD_ITEM: 'addFoodItem',
  SCAN_BARCODE: 'scanBarcode',
  GET_RECIPES: 'getRecipeRecommendations',
  CONSUME_INGREDIENTS: 'consumeIngredients',
  CHECK_EXPIRY: 'checkExpiry',
  SEARCH_BRAND: 'searchBrandProduct',
  INVITE_SHARE: 'inviteShare',
  ACCEPT_INVITE: 'acceptInvite',
  FETCH_XIACHUFANG: 'fetchXiachufang',       // 二期：下厨房数据源（已废弃，保留兼容）
  FETCH_MEALDB: 'fetchMealDB',             // TheMealDB 海外菜谱数据源
  RECOGNIZE_FOOD: 'recognizeFood',             // 二期：AI拍照识别食材
} as const

/** 默认提醒天数 */
export const DEFAULT_NOTIFY_BEFORE_DAYS = 3

/** 分类排序顺序 */
export const CATEGORY_ORDER = [
  CATEGORIES.VEGETABLE,
  CATEGORIES.FRUIT,
  CATEGORIES.MEAT,
  CATEGORIES.DAIRY,
  CATEGORIES.BEVERAGE,
  CATEGORIES.CONDIMENT,
  CATEGORIES.OTHER,
]
