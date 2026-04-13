/* ============================================
   🧊 FridgeMate - 食材-菜谱匹配算法
   ============================================ */

import { EXPIRY_STATUS } from './constants'

/** 食材项（精简版，用于匹配） */
export interface FoodItem {
  name: string
  category: string
  status: string
}

/** 菜谱食材 */
export interface RecipeIngredient {
  name: string
  category: string
  amount: number
  unit: string
  isEssential: boolean
}

/** 菜谱（用于匹配计算） */
export interface RecipeForMatch {
  _id: string
  name: string
  ingredients: RecipeIngredient[]
  cookTime?: number
  difficulty?: string
  tags?: string[]
  servings?: Record<string, number>
}

/** 匹配结果 */
export interface MatchResult {
  recipeId: string
  matchRate: number           // 匹配百分比 0-100
  matchedIngredients: string[] // 已匹配的食材名
  missingIngredients: RecipeIngredient[] // 缺少的食材（只含必需的）
  missingOptional: RecipeIngredient[]    // 缺少但非必需的食材
  canCook: boolean          // 是否可以制作（必需食材全有）
}

/**
 * 同义词映射表 — 提高匹配准确率
 * key = 标准名称, value = 可能的别名列表
 */
const SYNONYMS: Record<string, string[]> = {
  '鸡蛋': ['鸡蛋', '土鸡蛋', '柴鸡蛋', '洋鸡蛋'],
  '西红柿': ['西红柿', '番茄', '洋柿子'],
  '土豆': ['土豆', '马铃薯', '洋芋'],
  '青椒': ['青椒', '甜椒', '菜椒'],
  '豆腐': ['豆腐', '嫩豆腐', '老豆腐', '北豆腐', '南豆腐'],
  '猪肉': ['猪肉', '五花肉', '里脊肉', '瘦肉', '猪腿肉'],
  '牛肉': ['牛肉', '牛腩', '牛里脊'],
  '鸡肉': ['鸡肉', '鸡胸肉', '鸡腿肉', '鸡翅', '整鸡'],
  '葱': ['葱', '大葱', '小葱', '香葱', '葱白'],
  '姜': ['姜', '生姜', '老姜', '仔姜'],
  '蒜': ['蒜', '大蒜', '蒜头', '蒜瓣'],
  '酱油': ['酱油', '生抽', '老抽', '蒸鱼豉油'],
  '盐': ['盐', '食用盐', '精盐', '细盐'],
  '油': ['油', '食用油', '植物油', '橄榄油', '菜籽油', '花生油'],
  '米饭': ['米饭', '大米饭', '米'],
  '面条': ['面条', '挂面', '拉面', '手擀面', '意面'],
  '牛奶': ['牛奶', '纯牛奶', '鲜奶'],
  '酸奶': ['酸奶', '酸牛奶', '优酸乳'],
}

/**
 * 标准化食材名称 — 将别名统一为标准名称
 */
function normalizeName(rawName: string): string {
  const trimmed = rawName.replace(/\s/g, '')
  for (const [standard, aliases] of Object.entries(SYNONYMS)) {
    if (trimmed === standard || aliases.includes(trimmed)) {
      return standard
    }
  }
  return trimmed
}

/**
 * 模糊匹配两个食材名称是否相同
 * 支持包含关系：如 "鸡蛋" 和 "土鸡蛋" 视为同一物
 */
function isSameFood(nameA: string, nameB: string): boolean {
  const normA = normalizeName(nameA)
  const normB = normalizeName(nameB)

  if (normA === normB) return true

  // 包含关系检测
  if (normA.includes(normB) || normB.includes(normA)) {
    return true
  }

  return false
}

/**
 * 计算冰箱食材与菜谱的匹配度
 * @param foods 冰箱中的食材列表（只传 fresh/expiring 状态的）
 * @param recipe 待匹配的菜谱
 * @returns 匹配结果
 */
export function matchRecipe(foods: FoodItem[], recipe: RecipeForMatch): MatchResult {
  if (!recipe.ingredients || !Array.isArray(recipe.ingredients) || recipe.ingredients.length === 0) {
    return {
      recipeId: recipe._id,
      matchRate: 0,
      matchedIngredients: [],
      missingIngredients: [],
      missingOptional: [],
      canCook: false,
    }
  }

  const availableNames = new Set(
    foods
      .filter(f => f.status !== EXPIRY_STATUS.EXPIRED && f.status !== EXPIRY_STATUS.CONSUMED)
      .map(f => f.name)
  )

  let matchedCount = 0
  let totalEssential = 0
  const matched: string[] = []
  const missingEssential: RecipeIngredient[] = []
  const missingOptional: RecipeIngredient[] = []

  for (const ing of recipe.ingredients) {
    if (ing.isEssential) {
      totalEssential++
      const found = Array.from(availableNames).some(f => isSameFood(ing.name, f))
      if (found) {
        matchedCount++
        matched.push(ing.name)
      } else {
        missingEssential.push(ing)
      }
    } else {
      // 非必需食材也检查一下
      const found = Array.from(availableNames).some(f => isSameFood(ing.name, f))
      if (!found) {
        missingOptional.push(ing)
      }
    }
  }

  // 如果没有标记 isEssential 的食材，则把所有食材都当必需品处理
  const effectiveTotal = totalEssential > 0 ? totalEssential : recipe.ingredients.length
  const effectiveMatched = totalEssential > 0 ? matchedCount : matchedCount + (
    recipe.ingredients.filter(i => !i.isEssential).length -
    recipe.ingredients.filter(i => !i.isEssential && Array.from(availableNames).some(f => isSameFood(i.name, f))).length
  )
  
  // 更精确的计算：重新算所有食材
  let realMatched = 0
  for (const ing of recipe.ingredients) {
    if (Array.from(availableNames).some(f => isSameFood(ing.name, f))) {
      realMatched++
    }
  }

  const matchRate = effectiveTotal > 0 
    ? Math.round((matchedCount / effectiveTotal) * 100) 
    : Math.round((realMatched / Math.max(recipe.ingredients.length, 1)) * 100)

  return {
    recipeId: recipe._id,
    matchRate,
    matchedIngredients: matched,
    missingIngredients: missingEssential,
    missingOptional: missingOptional,
    canCook: missingEssential.length === 0,
  }
}

/**
 * 批量匹配多个菜谱并排序
 * @param foods 冰箱食材
 * @param recipes 菜谱列表
 * @param scenario 场景模式
 * @returns 排序后的匹配结果列表
 */
export function batchMatch(
  foods: FoodItem[],
  recipes: RecipeForMatch[],
  scenario?: string
): { recipe: RecipeForMatch; match: MatchResult }[] {
  const results: { recipe: RecipeForMatch; match: MatchResult }[] = []

  for (const recipe of recipes) {
    const m = matchRecipe(foods, recipe)
    // 过滤掉完全无法制作的（匹配率太低的）
    if (m.matchRate >= 20 || m.canCook) {
      results.push({ recipe, match: m })
    }
  }

  // 排序规则：
  // 1. 可以做的优先
  // 2. 匹配率高的优先
  // 3. 烹饪时间短的优先
  results.sort((a, b) => {
    if (a.match.canCook !== b.match.canCook) {
      return a.match.canCook ? -1 : 1
    }
    if (b.match.matchRate !== a.match.matchRate) {
      return b.match.matchRate - a.match.matchRate
    }
    return (a.recipe.cookTime || 999) - (b.recipe.cookTime || 999)
  })

  // 按场景偏好微调
  if (scenario === 'single') {
    // 一人食：快手菜优先
    results.sort((a, b) => (a.recipe.cookTime || 999) - (b.recipe.cookTime || 999))
  }

  return results
}
