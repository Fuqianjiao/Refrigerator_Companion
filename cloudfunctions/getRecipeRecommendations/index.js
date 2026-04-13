// cloudfunctions/getRecipeRecommendations/index.js
/**
 * 菜谱推荐引擎 - 纯 TheMealDB 数据源
 * 
 * 规则：
 * - 所有菜谱数据来自 https://www.themealdb.com/ API
 * - 无本地兜底、无硬编码菜谱、无 placeholder
 * - 只展示 strMealThumb 有值的菜谱（无图 = 不推荐）
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const MEALDB_BASE = 'https://www.themealdb.com/api/json/v1/1'

/** 支持的分类列表（用于轮换推荐） */
const MEALDB_CATEGORIES = [
  'Chicken', 'Beef', 'Seafood', 'Pasta', 'Vegetarian',
  'Dessert', 'Lamb', 'Pork', 'Side', 'Misc',
]

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const {
    scenario = 'single', recipeId, searchKey, filter,
    page = 1, pageSize = 10,
    limit,
    source,
    loadMoreMealdb,
  } = event

  try {
    // === 查询单个菜谱详情 ===
    if (recipeId) {
      // 仅支持 MealDB 来源的详情查询
      if (String(recipeId).startsWith('mealdb_')) {
        const mdbDetail = await fetchMealDBRecipeDetail(recipeId)
        if (mdbDetail.success && mdbDetail.recipe) {
          // ★ 无图菜谱不返回
          if (!mdbDetail.recipe.image) {
            return { success: false, errMsg: '菜谱图片不可用', recipe: null }
          }
          const foods = await getUserFoods(openid)
          const matchResult = matchRecipeWithFoods(foods, mdbDetail.recipe, scenario)
          return { ...matchResult, source: 'mealdb' }
        }
        return { success: false, errMsg: '未找到菜谱详情', recipe: null }
      }

      // 查数据库（用户自建/收藏）
      const dbRecipe = await getSingleRecipe(recipeId, openid, scenario)
      if (dbRecipe.recipe) {
        // ★ 无图菜谱不返回
        if (!dbRecipe.recipe.image) {
          return { success: false, errMsg: '菜谱图片不可用', recipe: null }
        }
      }
      return dbRecipe
    }

    // === 列表模式：统一走 MealDB ===
    return await fetchMealDBRecipes(openid, { scenario, searchKey, filter, page, pageSize, limit })

  } catch (err) {
    console.error('❌ 菜谱推荐失败:', err)
    return { success: false, errMsg: err.message, recipes: [] }
  }
}

// ==================== 核心算法 ====================

async function getUserFoods(openid) {
  try {
    // 宽松查询：优先 fresh/expiring，如果为空则查全部（兼容各种状态值）
    const res = await db.collection('fridge_items')
      .where({
        _openid: openid,
      })
      .limit(100)
      .get()
    const allItems = res.data || []

    // 过滤掉明确已过期的，但保留其他所有可用状态
    return allItems.filter(item => item.status !== 'expired' && item.status !== 'wasted')
  } catch (e) {
    console.warn('获取食材列表失败:', e.message)
    return []
  }
}

/**
 * 同义词/多语言映射表
 * key = 标准中文名，value = 所有别名（中文 + 英文）
 * 支持中文冰箱食材 ↔ 英文 MealDB 食材的跨语言匹配
 */
const SYNONYMS = {
  // === 禽肉蛋类 ===
  '鸡蛋': ['鸡蛋', 'eggs', 'egg', '土鸡蛋', '柴鸡蛋', '洋鸡蛋'],
  '鸡肉': ['鸡肉', 'chicken', 'chickenbreast', '鸡胸肉', '鸡腿肉', '鸡翅', 'chickenwings', 'chickenthighs'],
  '猪肉': ['猪肉', 'pork', 'porkbelly', '五花肉', '里脊肉', '瘦肉', '猪腿肉', 'porkschnitzel', 'porkloin'],
  '牛肉': ['牛肉', 'beef', 'steak', '牛腩', '牛里脊', 'beefmince', 'groundbeef', 'beefbrisket'],
  '羊肉': ['羊肉', 'lamb', 'lambchops', '羊排'],
  '火腿': ['火腿', 'ham', 'bacon', '培根'],

  // === 海鲜类 ===
  '虾': ['虾', 'shrimp', 'prawn', '大虾', '虾仁', 'kingprawns', 'prawncrushed'],
  '鱼': ['鱼', 'fish', 'salmon', 'cod', 'tuna', '三文鱼', '鳕鱼', '金枪鱼'],
  '蟹': ['蟹', 'crab', 'crabs'],

  // === 蔬菜类 ===
  '西红柿': ['西红柿', '番茄', 'tomato', 'tomatoes', '洋柿子'],
  '土豆': ['土豆', 'potato', 'potatoes', '马铃薯', '洋芋', 'potatopeeled', 'dicedpotatoes'],
  '胡萝卜': ['胡萝卜', 'carrot', 'carrots'],
  '洋葱': ['洋葱', 'onion', 'onionchopped', 'redonion', 'onions'],
  '青椒': ['青椒', 'peppers', 'bellpepper', '甜椒', '菜椒', '尖椒', 'greenchillies', 'greenpepper', 'chillies'],
  '黄瓜': ['黄瓜', 'cucumber'],
  '生菜': ['生菜', 'lettuce', 'iceberglettuce'],
  '菠菜': ['菠菜', 'spinach'],
  '蘑菇': ['蘑菇', 'mushroom', 'mushrooms', 'buttonmushrooms'],
  '西兰花': ['西兰花', 'broccoli'],
  '卷心菜': ['卷心菜', 'cabbage', 'cabbagehead'],
  '芹菜': ['芹菜', 'celery'],
  '韭菜': ['韭菜', 'chives'],
  '茄子': ['茄子', 'aubergine', 'eggplant', 'brinjal'],
  '南瓜': ['南瓜', 'pumpkin', 'butternutsquash'],
  '玉米': ['玉米', 'corn', 'sweetcorn', 'corncob'],
  '豌豆': ['豌豆', 'peas', 'frozenpeas', 'petitpoispeas'],
  '豆角': ['豆角', 'beans', 'runnerbeans', 'frenchbeans'],
  '大蒜': ['大蒜', 'garlic', 'garliccloves', '蒜', '蒜头', '蒜瓣'],
  '生姜': ['生姜', 'ginger', 'freshginger', '姜', '老姜'],
  '葱': ['葱', 'springonion', 'scallion', 'leek', '大葱', '小葱', '香葱', '葱白'],

  // === 豆制品 & 奶制品 ===
  '豆腐': ['豆腐', 'tofu', 'firmtofu', 'silken tofu', '嫩豆腐', '老豆腐', '北豆腐', '南豆腐'],
  '牛奶': ['牛奶', 'milk', 'wholemilk', 'skimmedmilk', '纯牛奶', '鲜奶'],
  '奶油': ['奶油', 'cream', 'heavycream', 'doublecream', 'sourcream', 'creamedcheese'],
  '奶酪': ['奶酪', 'cheese', 'mozzarellacheese', 'cheddar', 'parmesan', 'gruyèrecheese', 'feta', 'halloumi'],
  '酸奶': ['酸奶', 'yogurt', 'yoghurt', 'greekyogurt', 'naturalyogurt', '酸牛奶'],

  // === 主食类 ===
  '米饭': ['米饭', 'rice', 'steamedrice', 'basmatirice', '大米饭', '米', '白米饭'],
  '面条': ['面条', 'noodles', 'spaghetti', 'pasta', 'linguine', 'penne', 'tagliatelle', 'fusilli', '挂面', '拉面', '手擀面', '意面', '意大利面'],
  '面包': ['面包', 'bread', 'ciabatta', 'baguette', 'slicedbread', 'burgerbuns', 'tortillawraps', 'naanbread', 'pittabread'],
  '面粉': ['面粉', 'flour', 'selfraisingflour', 'plainflour', 'wholemealflour', '中筋面粉', '低筋面粉', '高筋面粉', '小麦粉', '白面'],

  // === 调味料（辅助匹配） ===
  '酱油': ['酱油', 'soysauce', 'darksoysauce', 'lightsoysauce', '生抽', '老抽', '蒸鱼豉油', '味极鲜'],
  '盐': ['盐', 'salt', '食用盐', '精盐', '细盐', '加碘盐'],
  '油': ['油', 'oil', 'oliveoil', 'sunfloweroil', 'vegetableoil', 'cookingoil', '食用油', '植物油', '橄榄油', '菜籽油', '花生油', '色拉油'],
  '糖': ['糖', 'sugar', 'brown sugar', 'castersugar', 'whitesugar'],
  '醋': ['醋', 'vinegar', 'whitevinegar', 'cider vinegar', 'balsamicvinegar', 'redwinevinegar'],
  '胡椒': ['胡椒', 'pepper', 'blackpepper', 'cayennepepper'],
  '咖喱': ['咖喱', 'curry', 'currypowder', 'madrascurrypaste', 'tikkipaste'],
  '番茄酱': ['番茄酱', 'ketchup', 'tomatopuree', 'tomatopaste', 'passata', 'tinnedtomatoes'],
  '黄油': ['黄油', 'butter', 'unsaltedbutter'],
  '蜂蜜': ['蜂蜜', 'honey'],
  '柠檬': ['柠檬', 'lemon', 'lemonjuice'],
}

function normalizeName(rawName) {
  // 统一转小写 + 去空格，支持中英文混合匹配
  const trimmed = rawName.replace(/\s/g, '').toLowerCase()
  for (const [standard, aliases] of Object.entries(SYNONYMS)) {
    // 标准名本身（中文）
    if (trimmed === standard.toLowerCase()) return standard
    // 别名列表（中文 + 英文，全部转小写比较）
    const normalizedAliases = aliases.map(a => a.replace(/\s/g, '').toLowerCase())
    if (normalizedAliases.includes(trimmed)) return standard
  }
  return rawName.trim()
}

function matchRecipeWithFoods(foods, recipe, scenario) {
  const ingredients = recipe.ingredients || []

  if (!ingredients.length) {
    return {
      _id: recipe._id,
      name: recipe.name,
      image: recipe.image,
      description: recipe.description,
      cookTime: recipe.cookTime,
      difficulty: recipe.difficulty,
      tags: recipe.tags || [],
      servings: recipe.servings || {},
      nutrition: recipe.nutrition,
      likes: recipe.likes || 0,
      matchRate: 0,
      matchedIngredients: [],
      missingIngredients: [],
      canCook: false,
      cookLevel: '',
      expiringBonus: 0,
    }
  }

  const foodList = foods.map(f => ({ ...f, _norm: normalizeName(f.name) }))
  const CONDIMENT_CATS = new Set(['condiment', 'beverage'])

  let totalRequired = 0
  let matchedCount = 0
  const matched = []
  const missingEssential = []
  let expiringBonus = 0

  for (const ing of ingredients) {
    if (CONDIMENT_CATS.has(ing.category)) continue
    totalRequired++

    const ingNorm = normalizeName(ing.name)
    const hitFood = foodList.find(f => {
      if (f._norm === ingNorm) return true
      if (f._norm.includes(ingNorm) || ingNorm.includes(f._norm)) return true
      return false
    })

    if (hitFood) {
      matchedCount++
      matched.push(ing.name)
      const daysLeft = getDaysUntilExpiry(hitFood)
      if (daysLeft !== null && daysLeft <= 2 && daysLeft >= 0) {
        expiringBonus += 0.3
      }
    } else {
      missingEssential.push({
        name: ing.name,
        amount: ing.amount,
        unit: ing.unit,
        category: ing.category,
        isEssential: ing.isEssential !== false,
      })
    }
  }

  const matchRate = totalRequired > 0 ? Math.round((matchedCount / totalRequired) * 100) : 0
  const canCook = matchRate >= 60

  let cookLevel = ''
  if (canCook) {
    if (matchRate >= 95) cookLevel = '完美匹配'
    else if (matchRate >= 80) cookLevel = '只差配料'
    else cookLevel = '需少量采购'
  }

  return {
    _id: recipe._id,
    name: recipe.name,
    image: recipe.image,
    description: recipe.description,
    cookTime: recipe.cookTime,
    difficulty: recipe.difficulty,
    tags: recipe.tags || [],
    servings: recipe.servings || {},
    nutrition: recipe.nutrition,
    likes: recipe.likes || 0,
    matchRate,
    matchedIngredients: matched,
    missingIngredients: missingEssential,
    missingOptional: [],
    canCook,
    cookLevel,
    expiringBonus,
  }
}

function getDaysUntilExpiry(foodItem) {
  if (typeof foodItem.fresh_days === 'number') return foodItem.fresh_days
  const expDate = foodItem.expiryDate || foodItem.expiry_date || foodItem.expireDate
  if (!expDate) return null
  try {
    const exp = new Date(expDate).getTime()
    if (isNaN(exp)) return null
    const now = Date.now()
    return Math.ceil((exp - now) / (1000 * 60 * 60 * 24))
  } catch (e) {
    return null
  }
}

async function getSingleRecipe(recipeId, openid, scenario) {
  try {
    const res = await db.collection('recipes').doc(recipeId).get()
    const recipe = res.data
    if (!recipe) return { success: false, errMsg: '菜谱不存在', recipe: null }
    const foods = await getUserFoods(openid)
    const matchResult = matchRecipeWithFoods(foods, recipe, scenario)
    return {
      recipe: { ...recipe, ...matchResult },
      success: true,
      source: 'database',
    }
  } catch (e) {
    return { success: false, errMsg: e.message, recipe: null }
  }
}

// ==================== TheMealDB 数据源 ====================

async function httpGet(url) {
  return new Promise((resolve, reject) => {
    const https = require('https')
    const req = https.get(url, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(data)) }
        catch (e) { reject(new Error('JSON解析失败: ' + e.message)) }
      })
    })
    req.on('error', reject)
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('请求超时')) })
  })
}

async function callFetchMealDB(data) {
  try {
    const res = await cloud.callFunction({
      name: 'fetchMealDB',
      data,
    })
    return res.result
  } catch (e) {
    console.warn('调用fetchMealDB失败:', e.message)
    return null
  }
}

async function fetchMealDBRecipeDetail(recipeId) {
  const idMeal = recipeId.replace('mealdb_', '')
  if (!/^\d+$/.test(idMeal)) {
    return { success: false, recipe: null }
  }
  try {
    const result = await httpGet(`${MEALDB_BASE}/lookup.php?i=${idMeal}`)
    if (result && result.meals && result.meals.length > 0) {
      const rawMeal = result.meals[0]
      const recipe = normalizeMealDBToRecipe(rawMeal)
      return { success: true, recipe }
    }
    return { success: false, recipe: null }
  } catch (e) {
    console.error('[MealDB] 获取详情失败:', e.message)
    return { success: false, recipe: null }
  }
}

function normalizeMealDBToRecipe(meal) {
  const ingredients = []
  for (let i = 1; i <= 20; i++) {
    const ing = meal[`strIngredient${i}`]
    const meas = meal[`strMeasure${i}`]
    if (ing && typeof ing === 'string' && ing.trim() !== '' && ing.trim().toLowerCase() !== 'null') {
      ingredients.push({
        name: translateIngName(ing.trim()),
        category: guessMealDBCategory(ing.trim()),
        amount: parseMealDBAmount(meas),
        unit: parseMealDBUnit(meas),
        isEssential: true,
      })
    }
  }

  const instructions = (meal.strInstructions || '').trim()
  let steps = []
  if (instructions) {
    steps = instructions.split(/\r?\n/)
      .map(s => s.trim()).filter(Boolean)
      .map((text, idx) => ({ order: idx + 1, text }))
    if (steps.length <= 1) {
      const bySentence = instructions.split(/(?<=\.)\s+/).filter(s => s.trim().length > 5)
      steps = bySentence.length > 1
        ? bySentence.map((text, idx) => ({ order: idx + 1, text }))
        : [{ order: 1, text: instructions }]
    }
  } else {
    steps = [{ order: 1, text: '请查看原网页获取详细做法' }]
  }

  // 标签翻译为中文
  const tags = []
  if (meal.strCategory) tags.push(translateCategory(meal.strCategory))
  if (meal.strArea) tags.push(translateArea(meal.strArea))
  if (meal.strTags) tags.push(...meal.strTags.split(',').filter(Boolean))

  return {
    _id: `mealdb_${meal.idMeal}`,
    name: translateRecipeName(meal.strMeal || '未知菜名'),
    image: meal.strMealThumb || '',       // ★ 无图时为空字符串，后续过滤
    description: `${translateArea(meal.strArea || '')} · ${translateCategory(meal.strCategory || '')}`.replace(/^ ·|· $/, '').trim() || '来自 TheMealDB',
    cookTime: 0,
    difficulty: ingredients.length <= 5 ? 'easy' : ingredients.length <= 10 ? 'medium' : 'hard',
    tags,
    servings: { single: 2, couple: 3, family: 4 },
    nutrition: null,
    likes: 0,
    ingredients,
    steps,
    source: 'mealdb',
  }
}

function guessMealDBCategory(name) {
  const n = name.toLowerCase()
  if (/chicken|beef|pork|lamb|fish|shrimp|bacon|turkey|ham|sausage/.test(n)) return 'meat'
  if (/milk|cream|cheese|butter|yogurt/.test(n)) return 'dairy'
  if (/oil|sauce|soy|ketchup|mustard|vinegar|seasoning|spice|herb|salt|pepper|garlic|onion/.test(n)) return 'condiment'
  if (/flour|bread|pasta|rice|noodle|oats|cereal/.test(n)) return 'other'
  return 'vegetable'
}

function parseMealDBAmount(measure) {
  if (!measure || !measure.trim()) return '适量'
  const m = measure.match(/^([\d\/\.]+)/)
  if (!m) return '适量'
  const numStr = m[1].trim()
  if (numStr.includes('/')) { const [a, b] = numStr.split('/'); return parseFloat(a) / parseFloat(b) }
  return parseFloat(numStr) || '适量'
}

function parseMealDBUnit(measure) {
  if (!measure) return ''
  return measure.replace(/^[\d\/\.\s]+/, '').trim()
}

/**
 * 从 MealDB 获取菜谱列表（唯一数据源）
 * ★ 核心规则：无图（strMealThumb 为空）的菜谱直接跳过
 */
async function fetchMealDBRecipes(openid, options) {
  const { scenario, searchKey, filter, page = 1, pageSize = 10, limit } = options

  console.log(`🍽️ [MealDB] 搜索: ${searchKey || '(热门推荐)'}, 页码: ${page}`)

  let mdbResult

  try {
    if (searchKey && searchKey.trim()) {
      // 有搜索关键词 → MealDB 名称搜索
      mdbResult = await callFetchMealDB({
        action: 'searchByName',
        keyword: searchKey.trim(),
      })
    } else {
      // 无关键词 → 轮换分类获取推荐（根据页码选不同分类）
      const categoryIndex = (page - 1) % MEALDB_CATEGORIES.length
      const category = MEALDB_CATEGORIES[categoryIndex]
      console.log(`🍽️ [MealDB] 使用分类: ${category}`)
      mdbResult = await callFetchMealDB({
        action: 'filterByCategory',
        category,
      })
    }

    if (mdbResult?.success && mdbResult.data?.meals && mdbResult.data.meals.length > 0) {
      const foods = await getUserFoods(openid)

      const results = []
      for (const rawMeal of mdbResult.data.meals) {
        const recipe = normalizeMealDBToRecipe(rawMeal)

        // ★★★ 核心规则：无图片的菜谱直接跳过，不进入推荐列表 ★★★
        if (!recipe.image || !recipe.image.trim()) {
          continue
        }

        const matchResult = matchRecipeWithFoods(foods, recipe, scenario)

        if (filter === 'canCook' && !matchResult.canCook) continue

        results.push(matchResult)
      }

      results.sort((a, b) => {
        if (a.canCook !== b.canCook) return a.canCook ? -1 : 1
        const rateDiff = (b.matchRate || 0) - (a.matchRate || 0)
        if (rateDiff !== 0) return rateDiff
        const bonusDiff = (b.expiringBonus || 0) - (a.expiringBonus || 0)
        if (bonusDiff !== 0) return bonusDiff
        if (scenario === 'single') return (a.cookTime || 999) - (b.cookTime || 999)
        return 0
      })

      const finalResults = limit ? results.slice(0, limit) : results.slice((page - 1) * pageSize, page * pageSize)

      console.log(`✅ [MealDB] 原始${mdbResult.data.meals.length}道, 过滤后返回${finalResults.length}道`)

      return {
        success: true,
        recipes: finalResults,
        total: results.length,
        foodCount: foods.length,
        page,
        hasMore: results.length > page * pageSize,
        source: 'mealdb',
        errMsg: '',
      }
    }
  } catch (e) {
    console.error('❌ [MealDB] 数据获取异常:', e.message)
  }

  // MealDB 失败或无数据 → 返回空列表（不使用任何兜底数据）
  console.log('⚠️ [MealDB] 无数据，返回空列表')
  return {
    success: true,
    recipes: [],
    total: 0,
    foodCount: 0,
    page,
    hasMore: false,
    source: 'mealdb',
    errMsg: '暂无可用菜谱数据',
  }
}

// ==================== 翻译层（英文→中文）====================

/** 常见 MealDB 菜名翻译表（覆盖高频菜品） */
const RECIPE_NAME_MAP = {
  // === 鸡肉类 ===
  'Chicken & Mushroom Hotpot': '香菇滑鸡煲',
  'Chicken Congee': '鸡肉粥',
  'Chicken Fried Rice': '鸡肉炒饭',
  'Chicken Karaage': '日式炸鸡',
  'Chicken Mandi': '曼迪烤鸡（也门）',
  'Chicken Marengo': '马伦戈炖鸡',
  'Chicken Parmentier': '鸡肉帕尔芒蒂焗烤',
  'Sweet and Sour Chicken': '糖醋鸡丁',
  'Teriyaki Chicken Casserole': '照烧鸡肉锅物',
  'Thai Green Curry': '泰式绿咖喱鸡',
  'Tandoori Chicken': '唐杜里烤鸡',
  'Chicken Alfredo Primavera': '奶油意面配鸡肉时蔬',
  'Chicken Basquaise': '巴斯克风味炖鸡',
  'Chicken Couscous': '鸡肉古斯米',
  'Chicken Enchilada Casserole': '墨西哥鸡肉卷饼',
  'Chicken Fajita Mac and Cheese': '法吉塔鸡肉通心粉',
  'Chicken Ham and Leek Pie': '鸡肉火腿韭葱派',
  'Chicken Handi': '印度手抓鸡',
  'Sticky Chicken': '蜜汁烤翅',
  'Spicy Chicken Curry': '香辣咖喱鸡',
  'Butter Chicken': '黄油咖喱鸡',
  'Kung Pao Chicken': '宫保鸡丁',
  'General Tso\'s Chicken': '左宗棠鸡',

  // === 牛肉类 ===
  'Beef & Broccoli Stir Fry': '西兰花炒牛肉',
  'Beef Cheeks Bourguignon': '勃艮第红酒烩牛脸肉',
  'Beef Lo Mein': '牛肉捞面',
  'Beef Stew': '红酒炖牛肉',
  'Beef Wellington': '威灵顿牛排',
  'Bulgogi': '韩式烤肉',
  'Pho Bo (Vietnamese Beef Noodle Soup)': '越南牛肉河粉',
  'Steak Pie': '牛排派',
  'Beef Rendang': '印尼仁当牛肉',

  // === 猪羊肉 ===
  'Pork Belly Buns': '刈包（台式）',
  'Crispy Duck with Pancakes': '北京鸭饼',
  'Lamb Rogan Josh': '罗根乔什咖喱羊',
  'Lamb Chops': '煎羊排',

  // === 海鲜类 ===
  'Fish & Chips': '炸鱼薯条',
  'Garlic Prawn Pasta': '蒜香虾仁意面',
  'Prawn Linguine': '鲜虾扁面',
  'Salmon Teriyaki': '照烧三文鱼',
  'Shrimp Chow Fun': '干炒牛河（虾仁版）',
  'Thai Fish Cakes': '泰国鱼饼',
  'Tom Kha Gai': '椰奶鸡汤',
  'Tom Yum Soup': '冬阴功汤',
  'Seafood Paella': '西班牙海鲜饭',
  'Fish Pie': '鱼肉派',
  'Grilled Sea Bass': '香烤鲈鱼',
  'Moules Marinière': '白葡萄酒煮青口贝',
  'Saltfish and Ackee': '咸鱼阿基果（牙买加）',

  // === 面食主食 ===
  'Spaghetti Carbonara': '卡邦尼意面',
  'Spaghetti Bolognese': '肉酱意面',
  'Lasagna': '千层面',
  'Macaroni and Cheese': '芝士通心粉',
  'Risotto': '意大利炖饭',
  'Pad Thai': '泰式炒河粉',
  'Fried Rice': '蛋炒饭',
  'Jambalaya': '什锦炒饭（美国南部）',
  'Paella': '西班牙海鲜饭',
  'Ramen': '日式拉面',
  'Chow Mein': '中式炒面',
  'Nasi Goreng': '印尼炒饭',
  'Bibimbap': '韩式拌饭',
  'Sushi': '寿司',
  'Sashimi': '刺身',
  'Dim Sum': '港式点心',
  'Spring Rolls': '春卷',
  'Dumplings': '饺子/包子',
  'Wonton Soup': '馄饨汤',
  'Hot and Sour Soup': '酸辣汤',
  'Egg Fried Rice': '蛋炒饭',
  'Fried Noodles': '炒面',
  'Congee': '粥',
  'Gyoza': '日式饺子',
  'Miso Soup': '味噌汤',
  'Onigiri': '饭团',
  'Tonkatsu': '炸猪排',

  // === 三明治汉堡披萨 ===
  'Hamburger': '美式汉堡',
  'Cheeseburger': '芝士汉堡',
  'Club Sandwich': '总汇三明治',
  'BLT': '培根生菜番茄三明治',
  'Pizza Margherita': '玛格丽特披萨',
  'Pizza': '意大利披萨',
  'Calzone': '折叠披萨',
  'Burrito': '墨西哥卷饼',
  'Quesadilla': '墨西哥薄饼',
  'Tacos': '塔可',
  'Nachos': '玉米片',
  'Guacamole': '鳄梨酱',
  'Pulled Pork Burger': '手撕猪肉汉堡',
  '15-minute chicken & halloumi burgers': '15分钟鸡肉哈罗米堡',
  'Chick-Fil-A Sandwich': '炸鸡三明治',

  // === 汤 & 咖喱 ===
  'French Onion Soup': '法式洋葱汤',
  'Minestrone': '蔬菜汤',
  'Goulash': '匈牙利炖肉汤',
  'Curry': '咖喱',
  'Dal': '印度豆泥',
  'Borscht': '红菜汤',
  'Miso Soup': '味噌汤',
  'Corn Chowder': '玉米浓汤',
  'Clam Chowder': '蛤蜊浓汤',
  'Tomato Soup': '番茄汤',

  // === 沙拉轻食 ===
  'Caesar Salad': '凯撒沙拉',
  'Greek Salad': '希腊沙拉',
  'Coleslaw': '凉拌卷心菜丝',
  'Quinoa Greek Salad': '藜麦希腊沙拉',
  'Tabbouleh': '塔布勒沙拉',

  // === 甜点烘焙 ===
  'Apple Pie': '苹果派',
  'Banana Pancake': '香蕉松饼',
  'Brownies': '布朗尼',
  'Cheesecake': '芝士蛋糕',
  'Chocolate Fudge': '巧克力软糖',
  'Creme Brulee': '焦糖布丁',
  'Flan': '法式布丁',
  'Ice Cream Sundae': '圣代冰淇淋',
  'Lemon Meringue Pie': '柠檬蛋白派',
  'New York Cheesecake': '纽约芝士蛋糕',
  'Panna Cotta': '意式奶冻',
  'Pavlova': '巴甫洛娃蛋白霜蛋糕',
  'Red Velvet Cake': '红丝绒蛋糕',
  'Tiramisu': '提拉米苏',
  'Tres Leches Cake': '三奶蛋糕',
  'Carrot Cake': '胡萝卜蛋糕',
  'Chocolate Soufflé': '巧克力舒芙蕾',
  'Sticky Toffee Pudding': '太妃布丁',
  'Eton Mess': '伊顿麦斯',
  'Trifle': '英式水果布丁',
  'Banana Split': '香蕉船',
  'Donuts': '甜甜圈',
  'Crepes': '可丽饼',
  'Waffles': '华夫饼',
  'Pancakes': '松饼',
  'Scones': '司康饼',
  'Croissant': '可颂面包',
  'Muffin': '马芬蛋糕',

  // === 东南亚特色 ===
  'Ayam Percik': '马来香料烤鸡',
  'Nasi Lemak': '马来西亚椰浆饭',
  'Satay': '沙爹串烧',
  'Laksa': '叻沙面',
  'Singapore Noodles': '新加坡米粉',
  'Massaman Curry': '马散曼咖喱',
  'Panang Curry': '帕南咖喱',
  'Som Tam': '青木瓜沙拉',
  'Pad See Ew': '泰式宽面',
  'Khao Pad': '泰式炒饭',

  // === 中东/南亚 ===
  'Chicken Shawarma': '鸡肉旋转烤肉',
  'Falafel': '炸鹰嘴豆丸',
  'Hummus': '鹰嘴豆泥',
  'Biryani': '印度香饭',
  'Butter Naan': '黄油馕',
  'Samosa': '三角饺',
  'Shakshuka': '北非蛋料理',
  'Fattoush': '法图什面包沙拉',
  'Kofta': '肉丸串',

  // === 其他常见 ===
  'Shepherd\'s Pie': '牧羊人派',
  'Fish and Chips': '炸鱼薯条',
  'Full English Breakfast': '全套英式早餐',
  'Omelette': '欧姆蛋',
  'Scrambled Eggs': '炒鸡蛋',
  'Poached Eggs on Toast': '水波蛋吐司',
  'Avocado Toast': '牛油果吐司',
}

/**
 * 菜名翻译：英文 → 中文
 * 有映射的直接用，没有的返回原名 + 中文标注格式
 */
function translateRecipeName(name) {
  if (!name) return '未知菜名'
  const key = name.trim()
  if (RECIPE_NAME_MAP[key]) return RECIPE_NAME_MAP[key]

  // 关键词模式替换（处理未在映射表中的菜名）
  let result = key
    .replace(/Chicken/i, '鸡')
    .replace(/Beef/i, '牛')
    .replace(/Pork/i, '猪')
    .replace(/Lamb/i, '羊')
    .replace(/Fish/i, '鱼')
    .replace(/Shrimp|Prawns?/i, '虾')
    .replace(/Salmon/i, '三文鱼')
    .replace(/Soup/i, '汤')
    .replace(/Salad/i, '沙拉')
    .replace(/Sandwich/i, '三明治')
    .replace(/Burger/i, '汉堡')
    .replace(/Pasta|Spaghetti/i, '意面')
    .replace(/Rice|Fried rice/i, '炒饭')
    .replace(/Noodles?/i, '面')
    .replace(/Curry/i, '咖喱')
    .replace(/Pie/i, '派')
    .replace(/Cake/i, '蛋糕')
    .replace(/Roast|Baked/i, '烤')
    .replace(/Stew/i, '炖')
    .replace(/Fried/i, '炒')
    .replace(/Grilled/i, '煎')
    .replace(/with/gi, '')
    .replace(/&/g, '')

  // 如果替换后和原文名不同，说明有部分翻译，保留原文名作为参考
  if (result !== key && result.length > 2) {
    return result.trim()
  }
  return key  // 无法翻译则保留原文
}

/** 食材名翻译：英文 → 中文 */
function translateIngName(name) {
  const ingMap = {
    'chicken breast': '鸡胸肉', 'chicken thighs': '鸡腿肉', 'chicken wings': '鸡翅', 'whole chicken': '整鸡',
    'beef mince': '碎牛肉', 'beef brisket': '牛腩', 'steak': '牛排', 'ground beef': '碎牛肉',
    'pork belly': '五花肉', 'pork chops': '猪排', 'bacon': '培根', 'ham': '火腿', 'sausage': '香肠',
    'lamb chops': '羊排', 'lamb leg': '羊腿',
    'eggs': '鸡蛋', 'egg': '鸡蛋',
    'shrimp': '虾', 'prawns': '大虾', 'king prawns': '大虎虾', 'salmon fillet': '三文鱼片', 'cod fillet': '鳕鱼片',
    'white fish': '白肉鱼', 'tuna': '金枪鱼', 'crab sticks': '蟹棒',
    'tomatoes': '西红柿', 'tomato': '西红柿', 'canned tomatoes': '罐头番茄',
    'onion': '洋葱', 'red onion': '紫洋葱', 'spring onions': '小葱', 'leek': '韭葱',
    'garlic': '大蒜', 'garlic cloves': '蒜瓣', 'ginger': '生姜', 'fresh ginger': '生姜',
    'potato': '土豆', 'potatoes': '土豆', 'carrot': '胡萝卜', 'carrots': '胡萝卜',
    'bell pepper': '彩椒', 'green pepper': '青椒', 'red chillies': '红辣椒', 'green chillies': '青辣椒',
    'mushroom': '蘑菇', 'button mushrooms': '口蘑', 'chestnut mushrooms': '香菇',
    'broccoli': '西兰花', 'cabbage': '卷心菜', 'lettuce': '生菜', 'spinach': '菠菜',
    'cucumber': '黄瓜', 'aubergine': '茄子', 'eggplant': '茄子',
    'corn': '玉米', 'sweet corn': '甜玉米', 'peas': '豌豆', 'frozen peas': '冷冻豌豆',
    'beans': '豆角', 'runner beans': '四季豆', 'french beans': '四季豆', 'kidney beans': '芸豆',
    'rice': '米饭', 'basmati rice': '巴斯马蒂米', 'jasmine rice': '茉莉香米',
    'pasta': '意面', 'spaghetti': '细面条', 'linguine': '扁面', 'penne': '短管面',
    'tagliatelle': '宽面', 'fusilli': '螺旋面', 'noodles': '面条', 'egg noodles': '蛋面',
    'bread': '面包', 'ciabatta': '恰巴塔面包', 'baguette': '法棍', 'sliced bread': '切片面包',
    'tortilla wraps': '墨西哥薄饼', 'naan bread': '馕饼', 'pitta bread': '皮塔饼', 'burger buns': '汉堡胚',
    'flour': '面粉', 'self-raising flour': '自发粉', 'plain flour': '中筋面粉', 'wholemeal flour': '全麦面粉',
    'milk': '牛奶', 'cream': '奶油', 'heavy cream': '淡奶油', 'double cream': '双倍奶油',
    'sour cream': '酸奶油', 'creamed cheese': '奶油奶酪', 'yogurt': '酸奶', 'greek yogurt': '希腊酸奶',
    'cheese': '奶酪', 'mozzarella cheese': '马苏里拉奶酪', 'cheddar cheese': '切达奶酪',
    'parmesan cheese': '帕玛森奶酪', 'gruyère cheese': '格鲁耶尔奶酪', 'feta cheese': '菲达奶酪',
    'halloumi': '哈罗米奶酪', 'butter': '黄油', 'unsalted butter': '无盐黄油',
    'oil': '食用油', 'olive oil': '橄榄油', 'vegetable oil': '植物油', 'sunflower oil': '葵花籽油',
    'soy sauce': '酱油', 'light soy sauce': '生抽', 'dark soy sauce': '老抽',
    'salt': '盐', 'sugar': '糖', 'brown sugar': '红糖', 'caster sugar': '细砂糖', 'honey': '蜂蜜',
    'vinegar': '醋', 'white vinegar': '白醋', 'balsamic vinegar': '黑醋', 'cider vinegar': '苹果醋',
    'black pepper': '黑胡椒', 'cayenne pepper': '辣椒粉',
    'ketchup': '番茄酱', 'tomato purée': '番茄膏', 'tomato paste': '番茄酱', 'passata': '番茄泥',
    'curry powder': '咖喱粉', 'madras curry paste': '马德拉斯咖喱酱', 'tikki paste': '蒂卡酱',
    'paprika': '红椒粉', 'turmeric': '姜黄粉', 'cumin': '孜然', 'coriander': '香菜',
    'oregano': '牛至', 'basil': '罗勒', 'thyme': '百里香', 'rosemary': '迷迭香',
    'bay leaf': '月桂叶', 'parsley': '欧芹', 'mint': '薄荷', 'dill': '莳萝',
    'stock': '高汤', 'chicken stock': '鸡高汤', 'vegetable stock': '蔬菜高汤',
    'coconut milk': '椰浆', 'coconut cream': '椰子奶油',
    'lemon': '柠檬', 'lemon juice': '柠檬汁', 'lime': '青柠',
    'sesame oil': '芝麻油', 'sesame seeds': '芝麻',
    'peanut butter': '花生酱', 'peanuts': '花生', 'cashews': '腰果', 'almonds': '杏仁',
    'walnuts': '核桃', 'pine nuts': '松子',
    'tortillas': '墨西哥薄饼', 'pita bread': '皮塔饼', 'wraps': '卷饼',
    'breadcrumbs': '面包糠', 'croutons': '烤面包丁',
    'mayonnaise': '蛋黄酱', 'mustard': '芥末酱', 'horseradish': '辣根酱',
    ' Worcestershire sauce': '伍斯特酱', 'hoisin sauce': '海鲜酱', 'sriracha': '是拉差辣酱',
    'chili sauce': '辣椒酱', 'sweet chilli sauce': '甜辣酱', 'oyster sauce': '蚝油',
    'sesame seeds': '芝麻', 'chia seeds': '奇亚籽', 'flaxseed': '亚麻籽',
    'quinoa': '藜麦', 'couscous': '古斯米', 'bulgur': '小麦粒',
    'baking powder': '泡打粉', 'baking soda': '小苏打', 'yeast': '酵母',
    'vanilla extract': '香草精', 'cocoa powder': '可可粉', 'dark chocolate': '黑巧克力',
    'white chocolate': '白巧克力', 'chocolate chips': '巧克力豆',
    'jelly': '果冻', 'gelatin sheets': '吉利丁片', 'icing sugar': '糖粉',
  }

  const n = name.toLowerCase().trim()
  if (ingMap[n]) return ingMap[n]
  // 模糊匹配：去掉复数 s 和空格后匹配
  const normalized = n.replace(/\s+/g, '').replace(/s$/, '')
  for (const [eng, chn] of Object.entries(ingMap)) {
    if (eng.replace(/\s+/g, '') === normalized || eng.replace(/s$/, '').replace(/\s+/g, '') === normalized) {
      return chn
    }
  }
  return name  // 未匹配到返回原文
}

/** 菜系分类翻译 */
function translateCategory(cat) {
  const map = {
    'Beef': '牛肉', 'Chicken': '鸡肉', 'Lamb': '羊肉', 'Pork': '猪肉',
    'Seafood': '海鲜', 'Vegetarian': '素食', 'Vegan': '纯素',
    'Pasta': '意面/面食', 'Side': '配菜', 'Dessert': '甜点', 'Misc': '其他',
    'Breakfast': '早餐', 'Starter': '开胃菜', 'Goat': '山羊肉',
    'Indian': '印度菜', 'Italian': '意大利菜', 'Chinese': '中餐',
    'Japanese': '日本料理', 'Thai': '泰餐', 'Mexican': '墨西哥菜',
    'American': '美式', 'British': '英式', 'French': '法式', 'Spanish': '西班牙菜',
    'Middle Eastern': '中东料理', 'African': '非洲菜', 'Caribbean': '加勒比菜',
  }
  return map[cat] || cat
}

/** 地区/国家翻译 */
function translateArea(area) {
  const map = {
    'American': '美式', 'British': '英式', 'Canadian': '加拿大', 'Chinese': '中式',
    'Dutch': '荷兰', 'Egyptian': '埃及', 'French': '法式', 'Greek': '希腊',
    'Indian': '印度', 'Irish': '爱尔兰', 'Italian': '意式', 'Jamaican': '牙买加',
    'Japanese': '日式', 'Kenyan': '肯尼亚', 'Malaysian': '马来西亚', 'Mexican': '墨西哥',
    'Moroccan': '摩洛哥', 'Polish': '波兰', 'Portuguese': '葡萄牙', 'Russian': '俄式',
    'Scottish': '苏格兰', 'Spanish': '西班牙', 'Swedish': '瑞典', 'Thai': '泰式',
    'Tunisian': '突尼斯', 'Turkish': '土耳其', 'Vietnamese': '越南', 'Unknown': '',
  }
  return map[area] || area
}
