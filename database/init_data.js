/**
 * FridgeMate - 数据库初始化脚本
 * 
 * 在微信云开发控制台或云函数中执行此脚本，
 * 初始化菜谱数据和品牌保质期库。
 */

// ==========================================
// 菜谱初始数据（50+道家常菜）
// 已内置在 getRecipeRecommendations 云函数中
// 这里提供额外的初始化数据
// ==========================================

const ADDITIONAL_RECIPES = [
  // ===== 面食类 =====
  {
    name: '阳春面',
    description: '最简单的面条，却是最治愈的味道。',
    cookTime: 10,
    difficulty: 'easy',
    tags: ['面食', '快手', '一人食'],
    servings: { single: 1, couple: 1, family: 2 },
    likes: 200,
    ingredients: [
      { name: '面条', category: 'other', amount: 100, unit: 'g', isEssential: true },
      { name: '葱', category: 'vegetable', amount: 1, unit: '根', isEssential: true },
      { name: '猪油', category: 'condiment', amount: 10, unit: 'g', isEssential: false },
      { name: '酱油', category: 'condiment', amount: 15, unit: 'ml', isEssential: false },
    ],
    steps: [
      { order: 1, text: '水烧开，下面条煮熟捞出。' },
      { order: 2, text: '碗里放葱花、酱油、猪油。' },
      { order: 3, text: '舀入热面汤化开调料。' },
      { order: 4, text: '放入面条拌匀即可享用。' },
    ],
  },

  // ===== 汤品类 =====
  {
    name: '冬瓜排骨汤',
    description: '清淡鲜美，清热解暑的养生汤品。',
    cookTime: 45,
    difficulty: 'medium',
    tags: ['汤品', '家常', '养生'],
    servings: { single: 1, couple: 2, family: 4 },
    likes: 420,
    ingredients: [
      { name: '排骨', category: 'meat', amount: 300, unit: 'g', isEssential: true },
      { name: '冬瓜', category: 'vegetable', amount: 400, unit: 'g', isEssential: true },
      { name: '姜', category: 'vegetable', amount: 3, unit: '片', isEssential: false },
      { name: '料酒', category: 'beverage', amount: 10, unit: 'ml', isEssential: false },
      { name: '盐', category: 'condiment', amount: 3, unit: 'g', isEssential: false },
    ],
    steps: [
      { order: 1, text: '排骨冷水下锅焯水去血沫，洗净备用。' },
      { order: 2, text: '砂锅加水放入排骨、姜片、料酒。' },
      { order: 3, text: '大火烧开转小火炖30分钟。' },
      { order: 4, text: '冬瓜去皮切块加入锅中。' },
      { order: 5, text: '继续炖15分钟至冬瓜透明，加盐调味即可。' },
    ],
  },

  {
    name: '酸辣汤',
    description: '酸辣开胃，暖身又暖心的快手汤。',
    cookTime: 15,
    difficulty: 'easy',
    tags: ['汤品', '快手', '开胃'],
    servings: { single: 1, couple: 2, family: 4 },
    likes: 310,
    ingredients: [
      { name: '鸡蛋', category: 'other', amount: 1, unit: '个', isEssential: true },
      { name: '豆腐', category: 'vegetable', amount: 0.5, unit: '盒', isEssential: true },
      { name: '火腿', category: 'meat', amount: 30, unit: 'g', isEssential: false },
      { name: '醋', category: 'condiment', amount: 20, unit: 'ml', isEssential: true },
      { name: '淀粉', category: 'condiment', amount: 10, unit: 'g', isEssential: true },
      { name: '胡椒粉', category: 'condiment', amount: 2, unit: 'g', isEssential: false },
    ],
    steps: [
      { order: 1, text: '豆腐和火腿切细丝备用。' },
      { order: 2, text: '水烧开，放入豆腐丝、火腿丝煮2分钟。' },
      { order: 3, text: '淋入水淀粉勾芡。' },
      { order: 4, text: '蛋液慢慢淋入形成蛋花。' },
      { order: 5, text: '加醋、盐、胡椒粉调味，淋香油出锅。' },
    ],
  },

  // ===== 素菜类 =====
  {
    name: '干煸四季豆',
    description: '外皮微焦，内里脆嫩，下饭一绝。',
    cookTime: 12,
    difficulty: 'medium',
    tags: ['素菜', '下饭', '川菜'],
    servings: { single: 1, couple: 2, family: 3 },
    likes: 370,
    ingredients: [
      { name: '四季豆', category: 'vegetable', amount: 300, unit: 'g', isEssential: true },
      { name: '肉末', category: 'meat', amount: 80, unit: 'g', isEssential: true },
      { name: '蒜', category: 'vegetable', amount: 3, unit: '瓣', isEssential: false },
      { name: '干辣椒', category: 'condiment', amount: 5, unit: '个', isEssential: false },
      { name: '花椒', category: 'condiment', amount: 2, unit: 'g', isEssential: false },
    ],
    steps: [
      { order: 1, text: '四季豆摘段洗净沥干（一定要干）。' },
      { order: 2, text: '多油中小火慢炸至表面起皱捞出。' },
      { order: 3, text: '留底油爆香蒜末、干辣椒、花椒。' },
      { order: 4, text: '倒入肉末炒至变色出香。' },
      { order: 5, text: '加入四季豆大火快炒，加盐调味出锅。' },
    ],
  },

  {
    name: '地三鲜',
    description: '土豆茄子青椒的经典东北组合。',
    cookTime: 18,
    difficulty: 'easy',
    tags: ['素菜', '东北菜', '下饭'],
    servings: { single: 1, couple: 2, family: 3 },
    likes: 340,
    ingredients: [
      { name: '土豆', category: 'vegetable', amount: 1, unit: '个', isEssential: true },
      { name: '茄子', category: 'vegetable', amount: 1, unit: '根', isEssential: true },
      { name: '青椒', category: 'vegetable', amount: 1, unit: '个', isEssential: true },
      { name: '大蒜', category: 'vegetable', amount: 3, unit: '瓣', isEssential: false },
      { name: '生抽', category: 'condiment', amount: 15, unit: 'ml', isEssential: false },
    ],
    steps: [
      { order: 1, text: '土豆和茄子切滚刀块，青椒切块。' },
      { order: 2, text: '土豆块先煎至金黄盛出。' },
      { order: 3, text: '茄块裹淀粉煎至软嫩。' },
      { order: 4, text: '爆香蒜末，倒入土豆、茄子、青椒翻炒。' },
      { order: 5, text: '加生抽、少许糖调味炒匀即可。' },
    ],
  },
]

// ==========================================
// 品牌保质期库初始数据
// （已包含在 searchBrandProduct 云函数中）
// ==========================================

const BRAND_SHELF_LIFE_DATA = [
  // 数据同 searchBrandProduct 中的 productDB
  // 可在此扩展更多品牌...
]

console.log(`✅ 初始数据准备完成:
  - 额外菜谱: ${ADDITIONAL_RECIPES.length} 道
  - 品牌数据: ${BRAND_SHELF_LIFE_DATA.length} 条
`)
