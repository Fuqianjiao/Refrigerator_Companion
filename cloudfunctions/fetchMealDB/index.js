// cloudfunctions/fetchMealDB/index.js
// ============================================
//  TheMealDB API 代理云函数
//  文档: https://www.themealdb.com/api.php
//  Base URL: https://www.themealdb.com/api/json/v1/1/
// ============================================

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const BASE_URL = 'https://www.themealdb.com/api/json/v1/1'

/**
 * 通用 HTTP GET 请求
 */
async function httpGet(url) {
  return new Promise((resolve, reject) => {
    const https = require('https')
    const req = https.get(url, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch (e) {
          reject(new Error('JSON解析失败: ' + e.message))
        }
      })
    })
    req.on('error', reject)
    req.setTimeout(10000, () => {
      req.destroy()
      reject(new Error('请求超时'))
    })
  })
}

/**
 * 主入口
 * 
 * 支持的 action:
 * - searchByName     按菜名搜索          参数: keyword
 * - searchByFirstLetter 按首字母搜索       参数: letter (单字母)
 * - lookupById       按ID获取详情         参数: id (数字)
 * - random           随机获取一道菜       无参数
 * - categories       获取所有分类         无参数
 * - listCategories   列出所有分类名       无参数
 * - listAreas        列出所有地区(菜系)   无参数
 * - listIngredients  列出所有食材名       无参数
 * - filterByIngredient 按主食材筛选       参数: ingredient
 * - filterByCategory  按分类筛选          参数: category
 * - filterByArea      按地区筛选          参数: area
 */
exports.main = async (event, context) => {
  const { action, ...params } = event

  console.log(`🍽️ [MealDB] action=${action}, params=`, JSON.stringify(params))

  try {
    let url = ''
    let result

    switch (action) {
      // ===== 搜索类 =====
      case 'searchByName': {
        const q = encodeURIComponent(params.keyword || '')
        if (!q) throw new Error('搜索关键词不能为空')
        url = `${BASE_URL}/search.php?s=${q}`
        break
      }

      case 'searchByFirstLetter': {
        const letter = (params.letter || 'a').charAt(0).toUpperCase()
        if (!/^[A-Z]$/.test(letter)) throw new Error('letter 必须是单个英文字母')
        url = `${BASE_URL}/search.php?f=${letter}`
        break
      }

      // ===== 查询类 =====
      case 'lookupById': {
        const id = params.id
        if (!id) throw new Error('菜品ID不能为空')
        url = `${BASE_URL}/lookup.php?i=${id}`
        break
      }

      case 'random':
        url = `${BASE_URL}/random.php`
        break

      // ===== 分类列表 =====
      case 'categories':
        url = `${BASE_URL}/categories.php`
        break

      case 'listCategories':
        url = `${BASE_URL}/list.php?c=list`
        break

      case 'listAreas':
        url = `${BASE_URL}/list.php?a=list`
        break

      case 'listIngredients':
        url = `${BASE_URL}/list.php?i=list`
        break

      // ===== 筛选类 =====
      case 'filterByIngredient': {
        const ing = (params.ingredient || '').replace(/ /g, '_')
        if (!ing) throw new Error('食材名称不能为空')
        url = `${BASE_URL}/filter.php?i=${encodeURIComponent(ing)}`
        break
      }

      case 'filterByCategory': {
        const cat = params.category || ''
        if (!cat) throw new Error('分类名称不能为空')
        url = `${BASE_URL}/filter.php?c=${encodeURIComponent(cat)}`
        break
      }

      case 'filterByArea': {
        const area = params.area || ''
        if (!area) throw new Error('地区名称不能为空')
        url = `${BASE_URL}/filter.php?a=${encodeURIComponent(area)}`
        break
      }

      default:
        throw new Error(`不支持的操作: ${action}`)
    }

    if (!url) throw new Error('URL 构建失败')

    console.log(`🍽️ [MealDB] 请求: ${url}`)
    result = await httpGet(url)

    // 统一返回格式
    return {
      success: true,
      data: result,
      action,
      errMsg: '',
    }
  } catch (err) {
    console.error('❌ [MealDB] 错误:', err.message)
    return {
      success: false,
      data: null,
      action,
      errMsg: err.message || 'MealDB 请求异常',
    }
  }
}
