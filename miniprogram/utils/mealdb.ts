/* ============================================
   🍽️ TheMealDB API - 类型化客户端封装
   通过 fetchMealDB 云函数代理请求
   文档: https://www.themealdb.com/api.php
   ============================================ */

// ====== 类型定义 ======

/** TheMealDB 原始餐品数据 */
export interface MealDBMeal {
  idMeal: string
  strMeal: string
  strDrinkAlternate?: string | null
  strCategory: string          // Beef / Chicken / Dessert / ...
  strArea: string              // Canadian / Chinese / French / ...
  strInstructions: string      // 烹饪步骤（英文长文本）
  strMealThumb: string         // 菜品图片 URL
  strTags?: string | null       // 标签（逗号分隔）
  strYoutube?: string | null
  /** 食材 1~20 及其用量 */
  strIngredient1?: string | null
  strMeasure1?: string | null
  strIngredient2?: string | null
  strMeasure2?: string | null
  strIngredient3?: string | null
  strMeasure3?: string | null
  strIngredient4?: string | null
  strMeasure4?: string | null
  strIngredient5?: string | null
  strMeasure5?: string | null
  strIngredient6?: string | null
  strMeasure6?: string | null
  strIngredient7?: string | null
  strMeasure7?: string | null
  strIngredient8?: string | null
  strMeasure8?: string | null
  strIngredient9?: string | null
  strMeasure9?: string | null
  strIngredient10?: string | null
  strMeasure10?: string | null
  strIngredient11?: string | null
  strMeasure11?: string | null
  strIngredient12?: string | null
  strMeasure12?: string | null
  strIngredient13?: string | null
  strMeasure13?: string | null
  strIngredient14?: string | null
  strMeasure14?: string | null
  strIngredient15?: string | null
  strMeasure15?: string | null
  strIngredient16?: string | null
  strMeasure16?: string | null
  strIngredient17?: string | null
  strMeasure17?: string | null
  strIngredient18?: string | null
  strMeasure18?: string | null
  strIngredient19?: string | null
  strMeasure19?: string | null
  strIngredient20?: string | null
  strMeasure20?: string | null
  strSource?: string | null
  strImageSource?: string | null
  strCreativeCommonsConfirmed?: string | null
  dateModified?: string | null
}

/** 分类详情 */
export interface MealDBCategory {
  idCategory: string
  strCategory: string        // Beef / Chicken / Dessert / ...
  strCategoryThumb: string   // 分类缩略图
  strCategoryDescription: string
}

/** 列表项（分类/地区/食材） */
export interface MealDBListItem {
  [key: string]: string      // e.g. { strCategory: "Beef" }
}

/** API 统一返回结构 */
export interface MealDBResult<T = any> {
  meals?: T[] | null         // 搜索/筛选结果数组
  categories?: T[] | null    // 分类列表
}

/** 云函数调用包装 */
interface CloudResponse<T = any> {
  success: boolean
  data: T
  action: string
  errMsg: string
}

// ====== 工具函数 ======

/**
 * 从原始 Meal 数据中提取 { name, measure } 数组
 * 自动遍历 strIngredient1~20 + strMeasure1~20
 */
export function extractIngredients(meal: MealDBMeal): Array<{ name: string; measure: string }> {
  const result: Array<{ name: string; measure: string }> = []

  for (let i = 1; i <= 20; i++) {
    const ingKey = `strIngredient${i}` as keyof MealDBMeal
    const measKey = `strMeasure${i}` as keyof MealDBMeal

    const ing = meal[ingKey]
    const meas = meal[measKey]

    if (ing && typeof ing === 'string' && ing.trim() !== '' && ing.trim().toLowerCase() !== 'null') {
      result.push({
        name: ing.trim(),
        measure: (meas && typeof meas === 'string' ? meas.trim() : ''),
      })
    }
  }

  return result
}

/**
 * 将英文原始菜谱转换为小程序内部格式
 * 方便直接复用现有的 recipe 渲染组件
 */
export function normalizeToRecipe(meal: MealDBMeal): FridgeMateRecipe {
  const ingredients = extractIngredients(meal)
  // 将 Instructions 按换行符 / 句号拆分为步骤
  const steps = (meal.strInstructions || '')
    .split(/\r?\n/)
    .map(s => s.trim()).filter(Boolean)
    .map((text, idx) => ({ order: idx + 1, text }))
  // 如果按行拆不出来，尝试用句号+空格拆
  if (steps.length <= 1) {
    const bySentence = (meal.strInstructions || '')
      .split(/(?<=\.)\s+/)
      .filter(s => s.trim().length > 5)
      .map((text, idx) => ({ order: idx + 1, text }))
    steps.length = 0
    steps.push(...(bySentence.length > 1 ? bySentence : [{ order: 1, text: meal.strInstructions }]))
  }

  return {
    _id: `mealdb_${meal.idMeal}`,
    name: meal.strMeal,
    image: meal.strMealThumb,
    description: `${meal.strArea} · ${meal.strCategory}`,
    cookTime: 0,  // TheMealDB 不提供烹饪时间
    difficulty: 'medium' as const,
    tags: (meal.strTags || '').split(',').filter(Boolean).concat([meal.strCategory]),
    servings: { single: 2, couple: 3, family: 4 },
    nutrition: null,
    likes: 0,
    ingredients: ingredients.map(item => ({
      name: item.name,
      category: guessCategory(item.name),
      amount: parseAmount(item.measure),
      unit: parseUnit(item.measure),
      isEssential: true,
    })),
    steps,
    source: 'mealdb',
  }
}

/** 小程序内部菜谱格式 */
export interface FridgeMateRecipe {
  _id: string
  name: string
  image: string
  description: string
  cookTime: number
  difficulty: 'easy' | 'medium' | 'hard'
  tags: string[]
  servings: Record<string, number>
  nutrition: any
  likes: number
  ingredients: Array<{
    name: string
    category: string
    amount: number | string
    unit: string
    isEssential: boolean
  }>
  steps: Array<{ order: number; text: string }>
  source?: string
}

// ====== 内部工具：猜测食材分类 =====
function guessCategory(name: string): string {
  const lower = name.toLowerCase()
  if (/chicken|beef|pork|lamb|fish|shrimp|bacon|turkey|ham|sausage/.test(lower)) return 'meat'
  if (/milk|cream|cheese|butter|yogurt/.test(lower)) return 'dairy'
  if (/oil|sauce|soy|ketchup|mustard|vinegar|seasoning|spice|herb|salt|pepper|garlic|onion/.test(lower)) return 'condiment'
  if (/flour|bread|pasta|rice|noodle|oats|cereal/.test(lower)) return 'other'
  return 'vegetable'
}

function parseAmount(measure: string): number | string {
  const m = measure.match(/^([\d\/\.]+)/)
  if (!m) return '适量'
  const numStr = m[1]
  if (numStr.includes('/')) {
    const [a, b] = numStr.split('/')
    return parseFloat(a) / parseFloat(b)
  }
  return parseFloat(numStr) || '适量'
}

function parseUnit(measure: string): string {
  const cleaned = measure.replace(/^[\d\/\.\s]+/, '').trim()
  if (cleaned) return cleaned
  return ''
}

// ====== 核心：云函数调用 ======

async function callMealDB<T = any>(action: string, params?: Record<string, any>): Promise<CloudResponse<T>> {
  try {
    const res = await wx.cloud.callFunction({
      name: 'fetchMealDB',
      data: { action, ...params },
    })
    return res.result as unknown as CloudResponse<T>
  } catch (err: any) {
    console.error(`🍽️ MealDB [${action}] 失败:`, err)
    return { success: false, data: null, action, errMsg: err.errMsg || '网络异常' }
  }
}

// ====== 公开 API ======

/** 按名称搜索菜谱 */
export async function searchMealsByName(keyword: string): Promise<CloudResponse<MealDBResult<MealDBMeal>>> {
  return callMealDB('searchByName', { keyword })
}

/** 按首字母搜索菜谱 (A-Z) */
export async function searchMealsByLetter(letter: string): Promise<CloudResponse<MealDBResult<MealDBMeal>>> {
  return callMealDB('searchByFirstLetter', { letter })
}

/** 根据 ID 获取菜谱完整详情 */
export async function lookupMealById(id: string | number): Promise<CloudResponse<MealDBResult<MealDBMeal>>> {
  return callMealDB('lookupById', { id: String(id) })
}

/** 随机获取一道菜谱 */
export async function getRandomMeal(): Promise<CloudResponse<MealDBResult<MealDBMeal>>> {
  return callMealDB('random')
}

/** 获取所有分类详情（含描述和缩略图） */
export async function getCategories(): Promise<CloudResponse<{ categories: MealDBCategory[] }>> {
  return callMealDB('categories')
}

/** 获取所有分类名列表 */
export async function listCategories(): Promise<CloudResponse<{ meals: MealDBListItem[] }>> {
  return callMealDB('listCategories')
}

/** 获取所有地区（菜系）列表 */
export async function listAreas(): Promise<CloudResponse<{ meals: MealDBListItem[] }>> {
  return callMealDB('listAreas')
}

/** 获取所有食材名列表 */
export async function listIngredients(): Promise<CloudResponse<{ meals: MealDBListItem[] }>> {
  return callMealDB('listIngredients')
}

/** 按主食材筛选菜谱 */
export async function filterByIngredient(ingredient: string): Promise<CloudResponse<MealDBResult<MealDBMeal>>> {
  return callMealDB('filterByIngredient', { ingredient })
}

/** 按分类筛选菜谱 */
export async function filterByCategory(category: string): Promise<CloudResponse<MealDBResult<MealDBMeal>>> {
  return callMealDB('filterByCategory', { category })
}

/** 按地区（菜系）筛选菜谱 */
export async function filterByArea(area: string): Promise<CloudResponse<MealDBResult<MealDBMeal>>> {
  return callMealDB('filterByArea', { area })
}
