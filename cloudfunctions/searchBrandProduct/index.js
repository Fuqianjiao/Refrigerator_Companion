// cloudfunctions/searchBrandProduct/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

/**
 * 全网搜索品牌保质期信息
 * 用户输入品牌+产品名，从多个数据源查询保质期
 */
exports.main = async (event, context) => {
  const { keyword, barcode } = event

  if (!keyword && !barcode) {
    return { success: false, errMsg: '请输入搜索关键词或条码' }
  }

  console.log(`🔍 全网搜索: keyword=${keyword}, barcode=${barcode}`)

  try {
    let results = []

    // === Step 1: 从本地品牌库搜索 ===
    if (keyword) {
      const localRes = await searchLocal(keyword)
      results = results.concat(localRes.map(r => ({ ...r, source: '本地品牌库' })))
    }

    // 如果有barcode，也用barcode查一次本地
    if (barcode && !keyword) {
      const barcodeLocalRes = await searchByBarcode(barcode)
      results = results.concat(barcodeLocalRes.map(r => ({ ...r, source: '本地品牌库' })))
    }

    // === Step 2: 调用外部API补充搜索 ===
    if (keyword) {
      try {
        const apiResults = await searchExternalAPIs(keyword)
        results = results.concat(apiResults)
      } catch (e) {
        console.warn('外部API搜索失败:', e.message)
      }
    }

    // 去重（按barcode或fullName）
    const seen = new Set()
    const uniqueResults = []
    
    for (const r of results) {
      const key = r.barcode || r.fullName || r.name
      if (!seen.has(key)) {
        seen.add(key)
        uniqueResults.push(r)
      }
    }

    console.log(`🔍 搜索完成: 共找到 ${uniqueResults.length} 条结果`)

    return {
      success: true,
      results: uniqueResults,
      total: uniqueResults.length,
      query: { keyword, barcode },
      errMsg: '',
    }
  } catch (err) {
    console.error('❌ 搜索失败:', err)
    return { success: false, errMsg: err.message || '搜索服务暂时不可用', results: [] }
  }
}

/**
 * 从本地品牌库模糊搜索
 */
async function searchLocal(keyword) {
  const res = await db.collection('brand_shelf_life')
    .where(_.or([
      { brandName: db.RegExp({ regexp: keyword, options: 'i' }) },
      { productName: db.RegExp({ regexp: keyword, options: 'i' }) },
      { fullName: db.RegExp({ regexp: keyword, options: 'i' }) },
      { barcode: db.RegExp({ regexp: keyword, options: 'i' }) }
    ]))
    .limit(10)
    .get()

  return res.data || []
}

/**
 * 通过条码搜索本地品牌库
 */
async function searchByBarcode(barcode) {
  const res = await db.collection('brand_shelf_life')
    .where({
      _.or([
        { barcode: barcode },
        { barcode: db.RegExp({ regexp: barcode.replace(/\*/g, '') }) }
      ])
    })
    .limit(5)
    .get()
  
  return res.data || []
}

/**
 * 调用外部商品数据库API
 */
async function searchExternalAPIs(keyword) {
  const results = []

  try {
    // 尝试多个公开API源
    
    // 1. 中国物品编码中心（GS1）- 商品条码信息查询
    try {
      const gs1Result = await queryGS1(keyword)
      if (gs1Result) results.push(gs1Result)
    } catch (e) {}

    // 2. 备选方案：使用已知的常见商品数据库模拟
    const commonDB = queryCommonDatabase(keyword)
    results.push(...commonDB)

  } catch (e) {
    console.warn('外部搜索异常:', e.message)
  }

  return results
}

/**
 * GS1中国 - 物品编码查询
 * 实际部署时替换为真实API调用
 */
async function queryGS1(keyword) {
  // TODO: 对接 https://www.gs1cn.org/ 或其他条码开放平台
  return null
}

/**
 * 内置常见商品数据库（作为兜底）
 * 包含大量常见食品的保质期信息
 */
function queryCommonDatabase(keyword) {
  // 大型内置商品保质期数据库
  const productDB = [
    // ===== 乳制品 =====
    { brandName: '蒙牛', productName: '纯牛奶', fullName: '蒙牛纯牛奶250ml', barcode: '6907992510090', shelfLifeDays: 180, category: 'dairy', storageCondition: '2-6°C冷藏保存' },
    { brandName: '蒙牛', productName: '特仑苏有机奶', fullName: '蒙牛特仑苏有机全脂牛奶250ml', shelfLifeDays: 180, category: 'dairy', storageCondition: '2-6°C冷藏保存' },
    { brandName: '伊利', productName: '金典纯牛奶', fullName: '伊利金典纯牛奶250ml', barcode: '6901209003325', shelfLifeDays: 180, category: 'dairy', storageCondition: '2-6°C冷藏保存' },
    { brandName: '光明', productName: '优倍鲜牛奶', fullName: '光明优倍巴氏鲜牛奶950ml', shelfLifeDays: 7, category: 'dairy', storageCondition: '2-6°C冷藏，开封后24h内喝完' },
    { brandName: '光明', productName: '酸奶', fullName: '光明原味酸奶135g', shelfLifeDays: 21, category: 'dairy', storageCondition: '2-6°C冷藏' },
    { brandName: '君乐宝', productName: '简醇酸奶', fullName: '君乐宝简醇零蔗糖酸奶150g', shelfLifeDays: 25, category: 'dairy', storageCondition: '2-6°C冷藏' },
    { brandName: '味全', productName: '优酸乳', fullName: '味全优酸乳草莓味245ml', shelfLifeDays: 120, category: 'dairy', storageCondition: '常温避光保存' },

    // ===== 饮料 =====
    { brandName: '农夫山泉', productName: '矿泉水', fullName: '农夫山泉饮用天然水550ml', shelfLifeDays: 365, category: 'beverage', storageCondition: '阴凉干燥处' },
    { brandName: '可口可乐', productName: '可乐', fullName: '可口可乐330ml', shelfLifeDays: 365, category: 'beverage', storageCondition: '阴凉干燥处' },
    { brandName: '百事', productName: '百事可乐', fullName: '百事可乐330ml', shelfLifeDays: 365, category: 'beverage', storageCondition: '阴凉干燥处' },
    { brandName: '康师傅', productName: '冰红茶', fullName: '康师傅冰红茶500ml', shelfLifeDays: 270, category: 'beverage', storageCondition: '阴凉干燥处' },
    { brandName: '统一', productName: '绿茶', fullName: '统一绿茶500ml', shelfLifeDays: 300, category: 'beverage', storageCondition: '阴凉干燥处' },
    { brandName: '元气森林', productName: '气泡水', fullName: '元气森林白桃气泡水480ml', shelfLifeDays: 365, category: 'beverage', storageCondition: '阴凉干燥处' },
    { brandName: '椰树', productName: '椰汁', fullName: '椰树牌椰汁245ml', shelfLifeDays: 365, category: 'beverage', storageCondition: '常温保存' },
    { brandName: '王老吉', productName: '凉茶', fullName: '王老吉凉茶310ml', shelfLifeDays: 365, category: 'beverage', storageCondition: '阴凉干燥处' },

    // ===== 调味品 =====
    { brandName: '海天', productName: '生抽酱油', fullName: '海天生抽酱油500ml', barcode: '6902083800109', shelfLifeDays: 730, category: 'condiment', storageCondition: '阴凉干燥处，开盖后冷藏' },
    { brandName: '海天', productName: '老抽', fullName: '海天老抽酱油500ml', shelfLifeDays: 730, category: 'condiment', storageCondition: '阴凉干燥处，开盖后冷藏' },
    { brandName: '李锦记', productName: '蒸鱼豉油', fullName: '李锦记蒸鱼豉油410ml', shelfLifeDays: 730, category: 'condiment', storageCondition: '阴凉干燥处' },
    { brandName: '恒顺', productName: '香醋', fullName: '恒顺香醋550ml', barcode: '6900841000240', shelfLifeDays: 1095, category: 'condiment', storageCondition: '阴凉干燥处' },
    { brandName: '厨邦', productName: '蚝油', fullName: '厨邦美味蚝油520g', shelfLifeDays: 730, category: 'condiment', storageCondition: '阴凉干燥处，开盖后需冷藏' },
    { brandName: '太太乐', productName: '鸡精', fullName: '太太乐鸡精200g', shelfLifeDays: 730, category: 'condiment', storageCondition: '密封防潮保存' },
    { brandName: '中粮', productName: '盐', fullName: '中粮食用盐400g', shelfLifeDays: 1825, category: 'condiment', storageCondition: '密封防潮' },
    { brandName: '鲁花', productName: '花生油', fullName: '鲁花5S压榨一级花生油5L', shelfLifeDays: 540, category: 'condiment', storageCondition: '避光阴凉处' },
    { brandName: '金龙鱼', productName: '食用油', fullName: '金龙鱼黄金比例调和油5L', shelfLifeDays: 540, category: 'condiment', storageCondition: '避光阴凉处' },
    { brandName: '郫县豆瓣', productName: '豆瓣酱', fullName: '郫县红油豆瓣酱500g', shelfLifeDays: 365, category: 'condiment', storageCondition: '阴凉干燥处' },
    { brandName: '老干妈', productName: '风味豆豉', fullName: '老干妈风味豆豉280g', shelfLifeDays: 365, category: 'condiment', storageCondition: '阴凉干燥处' },
    { brandName: '家乐', productName: '鸡粉', fullName: '家乐鸡粉200g', shelfLifeDays: 730, category: 'condiment', storageCondition: '密封防潮' },

    // ===== 冷冻/速食类 =====
    { brandName: '思念', productName: '猪肉水饺', fullName: '思念猪肉韭菜水饺450g', shelfLifeDays: 365, category: 'other', storageCondition: '-18°C冷冻保存' },
    { brandName: '三全', productName: '汤圆', fullName: '三全黑芝麻汤圆320g', shelfLifeDays: 365, category: 'other', storageCondition: '-18°C冷冻保存' },
    { brandName: '安井', productName: '火锅丸', fullName: '安井撒尿肉丸250g', shelfLifeDays: 270, category: 'other', storageCondition: '-18°C冷冻保存' },
    { brandName: '正大', productName: '鸡块', fullName: '正大鸡块1kg', shelfLifeDays: 365, category: 'meat', storageCondition: '-18°C冷冻保存' },
    { brandName: '圣农', productName: '鸡翅', fullName: '圣农奥尔良鸡翅1kg', shelfLifeDays: 360, category: 'meat', storageCondition: '-18°C冷冻保存' },

    // ===== 零食/其他 =====
    { brandName: '旺旺', productName: '雪饼', fullName: '旺旺雪饼84g', shelfLifeDays: 270, category: 'other', storageCondition: '阴凉干燥处' },
    { brandName: '奥利奥', productName: '饼干', fullName: '奥利奥原味97g', shelfLifeDays: 365, category: 'other', storageCondition: '阴凉干燥处' },
    { brandName: '乐事', productName: '薯片', fullName: '乐事原味薯片75g', shelfLifeDays: 180, category: 'other', storageCondition: '阴凉干燥处' },
    { brandName: '好丽友', productName: '派', fullName: '好丽友巧克力派144g(6枚)', shelfLifeDays: 180, category: 'other', storageCondition: '阴凉干燥处' },
  ]

  // 关键词匹配
  if (!keyword) return []

  const kw = keyword.toLowerCase().trim()
  const matched = []

  for (const p of productDB) {
    const fields = [p.brandName, p.productName, p.fullName, p.barcode].join(' ').toLowerCase()
    
    // 支持部分关键词匹配
    if (
      fields.includes(kw) ||
      kw.includes(p.brandName?.toLowerCase()) ||
      kw.includes(p.productName?.toLowerCase())
    ) {
      matched.push(p)
    }
  }

  return matched.slice(0, 8)
}
