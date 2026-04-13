// cloudfunctions/recordCook/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

/**
 * 标记做过 — 轻量记录做菜历史（不扣食材库存）
 * 
 * 用途：用户在菜谱详情页点击"标记做过"时调用，
 *       只写入 cooking_history 集合，不操作 fridge_items。
 *
 * 入参：
 *   - recipeId: string    菜谱 ID
 *   - recipeName: string  菜名
 *   - image: string        菜谱封面图 URL
 *   - ingredients?: string[]  消耗的食材列表（可选，前端传入）
 *
 * 返回：
 *   - success, errMsg
 *   - _id: 新记录的 ID
 */
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  const { recipeId, recipeName, image, ingredients } = event

  // 必填校验
  if (!recipeName || !recipeName.trim()) {
    return { success: false, errMsg: '菜谱名称不能为空' }
  }

  console.log(`📝 记录做菜: 「${recipeName}」 by ${openid}`)

  try {
    // 写入 cooking_history 集合
    const res = await db.collection('cooking_history').add({
      data: {
        _openid: openid,
        recipeId: recipeId || '',
        recipeName: recipeName.trim(),
        image: image || '',           // 存储图片URL方便直接展示
        consumedIngredients: ingredients || [],
        missingInFridge: [],           // 轻量模式不扣食材，此字段为空
        source: 'manual',             // 标记来源：手动记录（区别于 consumeIngredients 的 auto）
        cookedAt: new Date(),          // 服务端时间
        createdAt: new Date(),
      },
    })

    console.log(`✅ 做菜记录已保存: id=${res._id}`)

    return {
      success: true,
      _id: res._id,
      message: `「${recipeName.trim()}」已加入做菜历史`,
      errMsg: '',
    }
  } catch (err) {
    console.error('❌ 记录做菜失败:', err)
    return { success: false, errMsg: err.message || '服务器内部错误' }
  }
}
