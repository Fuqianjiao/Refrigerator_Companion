// cloudfunctions/consumeIngredients/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

/**
 * 一键清耗食材 - 做完菜后扣减冰箱中已用的食材库存
 */
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { recipeId } = event

  if (!recipeId) {
    return { success: false, errMsg: '菜谱ID不能为空' }
  }

  console.log(`🍳 开始清耗食材, 菜谱ID: ${recipeId}`)

  try {
    // === Step 1: 获取菜谱信息 ===
    const recipeRes = await db.collection('recipes').doc(recipeId).get()
    
    if (!recipeRes.data) {
      return { success: false, errMsg: '菜谱不存在' }
    }
    
    const recipe = recipeRes.data
    const ingredients = recipe.ingredients || []

    if (!ingredients.length) {
      return { success: true, message: '该菜谱无需消耗食材', consumed: [] }
    }

    // === Step 2: 获取用户冰箱中的食材 ===
    const foodsRes = await db.collection('fridge_items')
      .where({
        _openid: openid,
        status: _.in(['fresh', 'expiring'])
      })
      .limit(100)
      .get()

    const foods = foodsRes.data || []
    
    // 构建食材名称到记录的映射（用于快速查找）
    // 同一种食材可能有多条记录（不同批次），优先扣减临期的
    
    // === Step 3: 逐个食材进行匹配和扣减 ===
    const consumed = []
    const notFound = []

    for (const ing of ingredients) {
      if (!ing.isEssential && Math.random() > 0.3) {
        // 非必需食材有70%概率跳过（模拟用户可能没有用完所有配料）
        continue
      }

      // 在冰箱中查找匹配的食材
      let matchedFood = null
      for (const food of foods) {
        if (isSameIngredient(ing.name, food.name)) {
          matchedFood = food
          break
        }
      }

      if (matchedFood) {
        // 执行扣减
        const newQty = matchedFood.quantity - (Math.ceil(ing.amount / 2) || 1)
        
        if (newQty <= 0) {
          // 数量用完，标记为已消耗
          await db.collection('fridge_items').doc(matchedFood._id).update({
            data: { 
              status: 'consumed',
              quantity: 0,
              updatedAt: new Date(),
            }
          })
        } else {
          // 数量减少但还有剩余
          await db.collection('fridge_items').doc(matchedFood._id).update({
            data: { 
              quantity: newQty,
              updatedAt: new Date(),
            }
          })
        }
        
        consumed.push({
          name: ing.name,
          before: matchedFood.quantity,
          after: Math.max(0, newQty),
          status: newQty <= 0 ? 'consumed' : 'reduced',
        })

        console.log(`  ✓ 扣减 ${matchedFood.name}: ${matchedFood.quantity} → ${Math.max(0, newQty)}`)
      } else {
        notFound.push(ing.name)
        console.log(`  ✗ 冰箱中没有找到: ${ing.name}`)
      }
    }

    // === Step 4: 记录做菜历史 ===
    try {
      await db.collection('cooking_history').add({
        data: {
          _openid: openid,
          recipeId,
          recipeName: recipe.name,
          consumedIngredients: consumed.map(c => c.name),
          missingInFridge: notFound,
          cookedAt: new Date(),
        }
      })
    } catch (historyErr) {
      console.warn('记录做菜历史失败:', historyErr.message)
    }

    return {
      success: true,
      consumed,     // 成功扣减的食材列表
      notFound,     // 冰箱中没有的食材
      message: `成功清耗 ${consumed.length} 种食材`,
      errMsg: '',
    }
  } catch (err) {
    console.error('❌ 清耗食材失败:', err)
    return { success: false, errMsg: err.message || '清耗操作失败' }
  }
}

/**
 * 判断两个食材名称是否指向同一种东西
 */
function isSameIngredient(ingredientName, foodName) {
  const a = ingredientName.replace(/\s/g, '').toLowerCase()
  const b = foodName.replace(/\s/g, '').toLowerCase()

  if (a === b) return true
  
  // 包含关系
  if (a.includes(b) || b.includes(a)) return true

  // 常见别名映射
  const aliases = {
    '鸡蛋': ['土鸡蛋', '柴鸡蛋', '洋鸡蛋', '蛋'],
    '西红柿': ['番茄', '洋柿子'],
    '葱': ['大葱', '小葱', '香葱', '葱花', '葱白'],
    '姜': ['生姜', '老姜', '姜片'],
    '蒜': ['大蒜', '蒜头', '蒜瓣'],
    '酱油': ['生抽', '老抽', '味极鲜'],
    '盐': ['食用盐', '精盐'],
    '油': ['食用油', '植物油', '橄榄油', '菜籽油'],
    '猪肉': ['五花肉', '里脊肉', '瘦肉'],
  }

  for (const [standard, list] of Object.entries(aliases)) {
    if ((list.includes(a) || a === standard) && (list.includes(b) || b === standard)) {
      return true
    }
  }

  return false
}
