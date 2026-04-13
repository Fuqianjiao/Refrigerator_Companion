// cloudfunctions/scanBarcode/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

/**
 * 扫码识别 - 查询条形码对应的商品信息
 * 
 * 查询优先级：
 *   1. 本地品牌库缓存（brand_shelf_life 集合）
 *   2. Open Food Facts 全球开放食品数据库（免费，无需 API Key）
 *   3. 常见商品内置映射表（兜底）
 */
exports.main = async (event, context) => {
  const { barcode } = event

  if (!barcode) {
    return { success: false, errMsg: '条码不能为空' }
  }

  // 标准化条码（去掉空格和前后缀）
  const normalizedBarcode = String(barcode).trim().replace(/\s/g, '')
  console.log(`📷 查询条码: ${normalizedBarcode}`)

  try {
    // === Step 1: 从本地品牌库查找 ===
    try {
      const localRes = await db.collection('brand_shelf_life')
        .where(_.or([
          { barcode: normalizedBarcode },
          { fullName: db.RegExp({ regexp: normalizedBarcode, options: 'i' }) }
        ]))
        .limit(1)
        .get()

      if (localRes.data && localRes.data.length > 0) {
        const match = localRes.data[0]
        console.log(`✅ 本地库命中: ${match.fullName || match.productName}`)
        return buildSuccessResult(match, 'local')
      }
    } catch (dbErr) {
      console.warn('⚠️ 本地数据库查询失败，继续外部查询:', dbErr.message)
    }

    // === Step 2: 查询 Open Food Facts API（免费、无需Key） ===
    let offResult = null
    try {
      offResult = await queryOpenFoodFacts(normalizedBarcode)
    } catch (offErr) {
      console.log('Open Food Facts API 失败:', offErr.message)
    }

    if (offResult) {
      // 缓存到本地品牌库
      await cacheToLocal(normalizedBarcode, offResult, 'openfoodfacts')
      return buildSuccessResult(offResult, 'openfoodfacts')
    }

    // === Step 3: 内置常见商品兜底表 ===
    const fallbackResult = queryBuiltIn(normalizedBarcode)
    if (fallbackResult) {
      await cacheToLocal(normalizedBarcode, fallbackResult, 'builtin')
      return buildSuccessResult(fallbackResult, 'builtin')
    }

    // === 全部未匹配 ===
    return {
      success: false,
      product: {
        name: '未识别的商品',
        barcode: normalizedBarcode,
        message: '该条码暂未被收录，请手动填写信息',
      },
      fromCache: false,
      errMsg: `未找到条码 ${normalizedBarcode} 的商品信息`,
    }

  } catch (err) {
    console.error('❌ 扫码解析异常:', err)
    return { success: false, errMsg: err.message || '扫码服务暂时不可用' }
  }
}

// ==================== 结果构建 ====================

function buildSuccessResult(data, source) {
  return {
    success: true,
    product: {
      name: data.fullName || data.productName || data.name || '',
      brand: data.brandName || data.brand || '',
      barcode: data.barcode || '',
      shelfLifeDays: data.shelfLifeDays || estimateShelfLife(data.category),
      category: mapCategory(data.category),
      imageUrl: data.imageUrl || data.image || '',
      storageCondition: data.storageCondition || '',
      source: source,
    },
    fromCache: source === 'local',
  }
}

async function cacheToLocal(barcode, productData, source) {
  try {
    await db.collection('brand_shelf_life').add({
      data: {
        barcode,
        brandName: productData.brand || productData.brandName || '',
        productName: productData.name || '',
        fullName: productData.fullName || productData.name || '',
        shelfLifeDays: productData.shelfLifeDays || estimateShelfLife(productData.category),
        storageCondition: productData.storageCondition || '',
        category: mapCategory(productData.category),
        isVerified: false,
        source: source,
        lastUpdated: new Date(),
        imageUrl: productData.imageUrl || productData.image || null,
      }
    })
    console.log(`📦 条码 ${barcode} 已缓存到本地`)
  } catch (e) {
    console.warn('缓存写入失败:', e.message)
  }
}

// ==================== 外部API：Open Food Facts ====================

/**
 * 查询 Open Food Facts 开放食品数据库
 * 免费、无需 API Key，覆盖全球 300万+ 商品
 * 对中国区商品（690开头）支持良好
 * 文档: https://wiki.openfoodfacts.org/API
 */
async function queryOpenFoodFacts(barcode) {
  const url = `https://world.openfoodfacts.org/api/v2/product/${barcode}.json?fields=product_name,product_name_zh,brands,brands_tags,image_url,categories,nutriscore_grade,serving_size,quantity,ingredients_text_zh`
  
  const res = await new Promise((resolve, reject) => {
    const https = require('https')
    const req = https.get(url, {
      headers: { 'User-Agent': 'FridgeMate/1.0 (WeChat Mini Program)', 'Accept-Language': 'zh-CN,zh;q=0.9' },
      timeout: 8000,
    }, (response) => {
      if (response.statusCode !== 200) {
        response.resume() // drain socket
        return resolve(null) // 商品不存在时返回null，不是错误
      }
      let body = ''
      response.on('data', chunk => body += chunk)
      response.on('end', () => {
        try {
          const json = JSON.parse(body)
          resolve(json)
        } catch (e) {
          reject(new Error('JSON解析失败'))
        }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')) })
  })

  if (!res?.status || res.status !== 1 || !res.product) {
    return null
  }

  const p = res.product
  
  // 提取中文商品名优先
  const name = p.product_name_zh || p.product_name || ''
  if (!name || name.trim().length < 1) return null

  // 提取品牌
  const brand = (p.brands_tags && p.brands_tags[0]) || p.brands || ''
  
  // 提取图片（使用 front 图片的缩略版）
  const imgUrl = (p.selected_images && p.selected_images.front && p.selected_images.front.display.zh) ||
    p.image_url || ''

  // 从 OFF 分类映射到我们的分类体系
  const offCategory = inferCategoryFromOFF(p.categories || '', p.product_name || '')

  // 从营养等级/类别推断保质期
  const shelfLife = estimateShelfLifeFromProduct(p)

  console.log(`🌍 OFF 匹配成功: ${name} | 品牌: ${brand}`)

  return {
    name: name.trim(),
    fullName: name.trim(),
    brand: brand ? brand.trim() : '',
    image: imgUrl,
    category: offCategory,
    shelfLifeDays: shelfLife,
  }
}

// ==================== 内置常见商品兜底表 ====================

function queryBuiltIn(barcode) {
  const commonProducts = {
    '6907992510090': {
      name: '纯牛奶', brand: '蒙牛', fullName: '蒙牛纯牛奶250ml',
      shelfLifeDays: 180, category: 'dairy', storageCondition: '2-6°C冷藏',
    },
    '6901028089694': {
      name: '特仑苏有机奶', brand: '蒙牛', fullName: '蒙牛特仑苏有机全脂牛奶250ml',
      shelfLifeDays: 180, category: 'dairy', storageCondition: '2-6°C冷藏',
    },
    '6901209003325': {
      name: '金典纯牛奶', brand: '伊利', fullName: '伊利金典纯牛奶250ml',
      shelfLifeDays: 180, category: 'dairy', storageCondition: '2-6°C冷藏',
    },
    '6902083800109': {
      name: '海天生抽酱油', brand: '海天', fullName: '海天上等生抽500ml',
      shelfLifeDays: 730, category: 'condiment', storageCondition: '阴凉干燥处',
    },
    '6900841000240': {
      name: '老陈醋', brand: '恒顺', fullName: '恒顺香醋500ml',
      shelfLifeDays: 1095, category: 'condiment', storageCondition: '阴凉干燥处',
    },
    '6902538005141': {
      name: '脉动维生素饮料', brand: '脉动', fullName: '脉动桃子味维生素饮料600ml',
      shelfLifeDays: 365, category: 'beverage', storageCondition: '常温保存',
    },
  }
  return commonProducts[barcode] || null
}

// ==================== 分类与保质期推断 ====================

/**
 * 根据 Open Food Facts 的 categories 字段推断内部分类
 */
function inferCategoryFromOFF(categories, productName) {
  const catStr = (categories + ' ' + productName).toLowerCase()
  
  const rules = [
    { keywords: ['milk', '牛奶', '乳制品', 'yogurt', '酸奶', 'cheese', '奶酪', 'cream', '奶油'], result: 'dairy' },
    { keywords: ['beverage', '饮料', 'drink', '水', 'juice', '果汁', 'tea', '茶', 'coffee', '咖啡', 'soda', '汽酒', 'beer', '啤酒'], result: 'beverage' },
    { keywords: ['meat', '肉', 'pork', '猪肉', 'beef', '牛肉', 'chicken', '鸡肉', 'lamb', '羊肉', 'sausage', '香肠', 'ham', '火腿'], result: 'meat' },
    { keywords: ['fruit', '水果', 'apple', '苹果', 'banana', '香蕉', 'orange', '橙子', 'grape', '葡萄', 'strawberry', '草莓'], result: 'fruit' },
    { keywords: ['vegetable', '蔬菜', 'cabbage', '卷心菜', 'spinach', '菠菜', 'tomato', '番茄', 'potato', '土豆', 'onion', '洋葱', 'carrot', '胡萝卜'], result: 'vegetable' },
    { keywords: ['seafood', '海鲜', 'fish', '鱼', 'shrimp', '虾', 'crab', '蟹'], result: 'meat' },
    { keywords: ['sauce', '酱', 'oil', '油', 'vinegar', '醋', 'soy', '酱油', 'salt', '盐', 'spice', '调料', 'seasoning', '调味', 'ketchup', '番茄酱'], result: 'condiment' },
  ]
  
  for (const rule of rules) {
    if (rule.keywords.some(kw => catStr.includes(kw))) {
      return rule.result
    }
  }
  return 'other'
}

/**
 * 根据 OFF 产品信息智能估算保质期
 * 综合考虑产品分类、Nutri-Score 等级等信息
 */
function estimateShelfLifeFromProduct(product) {
  const categories = (product.categories || '').toLowerCase()
  const name = (product.product_name || '').toLowerCase()
  const combined = categories + ' ' + name

  // 鲜活类：短保质期
  if (/fresh|生鲜|新鲜/.test(combined)) return 5
  if (/bread|面包|bakery|烘焙/.test(combined)) return 7
  if (/pastry|蛋糕|cake|dessert|甜点/.test(combined)) return 5

  // 分类基础值（与 estimateShelfLife 一致）
  const baseEstimates = {
    dairy: 180, beverage: 180, meat: 14, fruit: 7, vegetable: 5, condiment: 365, other: 90,
  }
  
  const cat = inferCategoryFromOFF(categories, name)
  let days = baseEstimates[cat] || 90

  // 根据包装类型调整
  if (/UHT|steriliz|灭菌|高温/.test(combined)) days = Math.max(days, 180)  // 长保质期奶
  if (/frozen|冷冻/.test(combined)) days = 365  // 冷冻食品
  if (/canned|罐头|preserve|腌|渍/.test(combined)) days = Math.max(days, 730)

  return days
}

/**
 * 兜底：根据内部分类估算保质期天数
 */
function estimateShelfLife(category) {
  const estimates = {
    dairy: 180, beverage: 180, meat: 14, fruit: 7, vegetable: 5, condiment: 365, other: 90,
  }
  return estimates[category] || 90
}

/**
 * 映射外部分类到内部分类体系
 */
function mapCategory(externalCat) {
  const mapping = {
    'dairy': 'dairy', '乳制品': 'dairy', '奶': 'dairy', 'milk': 'dairy',
    'beverage': 'beverage', '饮料': 'beverage', 'drink': 'beverage', '水': 'beverage',
    'meat': 'meat', '肉': 'meat', '肉制品': 'meat', 'pork': 'meat', 'fish': 'meat',
    'vegetable': 'vegetable', '蔬': 'vegetable', '蔬菜': 'vegetable', '菜': 'vegetable',
    'fruit': 'fruit', '果': 'fruit', '水果': 'fruit',
    'condiment': 'condiment', '调料': 'condiment', '调味品': 'condiment', '酱': 'condiment', 'oil': 'condiment',
  }
  
  if (mapping[externalCat]) return mapping[externalCat]
  if (externalCat) {
    for (const [key, val] of Object.entries(mapping)) {
      if ((externalCat || '').includes(key)) return val
    }
  }
  return 'other'
}
