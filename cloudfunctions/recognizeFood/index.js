// cloudfunctions/recognizeFood/index.js
/**
 * 拍照AI识别食材 - 云函数
 * 
 * 识别用户拍摄的图片中的食材，返回结构化数据用于自动填表。
 *
 * 支持多种识别方案（按优先级）：
 *  1. 腾讯云AI图像识别（图像标签/物体检测）
 *  2. 微信OCR + 智能关键词匹配（备用）
 *  3. 内置常见食材库模糊匹配（兜底）
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event, context) => {
  const { imagePath, imgBase64 } = event

  console.log('📷 开始AI识别食材')

  if (!imagePath && !imgBase64) {
    return { success: false, errMsg: '请提供图片路径或base64数据' }
  }

  try {
    // === 方案1: 腾讯云AI图像识别 ===
    const aiResult = await recognizeWithTencentAI(imagePath || imgBase64)
    if (aiResult.success && aiResult.foods.length > 0) {
      console.log(`✅ AI识别成功: ${aiResult.foods.length} 种食材`)
      return { ...aiResult, method: 'tencent_ai', confidence: 'high' }
    }

    // === 方案2: 微信OCR + 智能匹配 ===
    console.log('⚠️ 尝试OCR方案...')
    const ocrResult = await recognizeWithOCR(imagePath || imgBase64)
    if (ocrResult.success && ocrResult.foods.length > 0) {
      console.log(`✅ OCR+智能匹配成功: ${ocrResult.foods.length} 种食材`)
      return { ...ocrResult, method: 'ocr_match', confidence: 'medium' }
    }

    // === 方案3: 内置食材库兜底 ===
    console.log('📋 返回常见食材建议')
    return {
      success: true,
      foods: getCommonFoodSuggestions(),
      rawText: '',
      method: 'suggestion',
      confidence: 'low',
      hint: '未能自动识别出具体食材，以下是一些常见的冰箱食材供你选择',
    }
  } catch (err) {
    console.error('❌ 食材识别失败:', err)
    return { 
      success: false, 
      errMsg: err.message || '识别服务暂时不可用，请手动输入',
      foods: getCommonFoodSuggestions(),
      method: 'error_fallback',
      hint: '自动识别遇到问题，你可以从下方列表中选择食材',
    }
  }
}

// ==================== 腾讯云AI识别 ====================

async function recognizeWithTencentAI(imageInput) {
  try {
    const result = await cloud.openapi.img.scanGoods({
      img_url: imageInput.startsWith('http') ? imageInput : undefined,
      img: !imageInput.startsWith('http') ? imageInput : undefined,
    })

    if (result.errcode === 0 && result.items) {
      const foods = mapAIFoodsToIngredients(result.items)
      if (foods.length > 0) return { success: true, foods, rawData: result }
    }
    return { success: false, foods: [] }
  } catch (e) {
    console.warn('腾讯云AI调用失败:', e.message)
    return { success: false, foods: [] }
  }
}

// ==================== OCR + 智能匹配 ====================

async function recognizeWithOCR(imageInput) {
  let fullText = ''
  
  // 尝试通用印刷体OCR
  try {
    const res1 = await cloud.openapi.ocr.printedText({
      img_url: imageInput.startsWith('http') ? imageInput : undefined,
      img: !imageInput.startsWith('http') ? imageInput : undefined,
    })
    if (res1.errcode === 0 && Array.isArray(res1.items)) {
      fullText = res1.items.map(item => item.text || '').join('')
    }
  } catch (e1) {}

  // 尝试手写体OCR
  if (!fullText.trim()) {
    try {
      const res2 = await cloud.openapi.ocr.handwriting({
        img_url: imageInput.startsWith('http') ? imageInput : undefined,
        img: !imageInput.startsWith('http') ? imageInput : undefined,
      })
      if (res2.errcode === 0 && Array.isArray(res2.items)) {
        fullText = res2.items.map(item => item.text || '').join('')
      }
    } catch (e2) {}
  }

  if (!fullText.trim()) return { success: false, foods: [], rawText: '' }

  console.log(`📝 OCR文本: ${fullText.substring(0, 80)}...`)
  
  const foods = extractFoodsFromText(fullText)
  return { success: true, foods, rawText: fullText, matchedCount: foods.length }
}

// ==================== 核心匹配算法 ====================

function mapAIFoodsToIngredients(items) {
  if (!Array.isArray(items)) return []
  const foods = []
  const seenNames = new Set()

  for (const item of items) {
    const rawName = item.name || item.tag || item.keyword || ''
    const name = normalizeFoodName(rawName)
    
    if (name && !seenNames.has(name) && isKnownFood(name)) {
      seenNames.add(name)
      const foodInfo = getFoodInfo(name)
      foods.push({
        name, displayName: rawName, category: foodInfo.category,
        confidence: item.score || Math.random() * 30 + 70,
        suggestedQuantity: foodInfo.defaultQty, suggestedUnit: foodInfo.defaultUnit,
        shelfLifeDays: foodInfo.shelfLifeDays, icon: foodInfo.icon, tips: foodInfo.tips,
      })
    }
  }

  return foods.sort((a, b) => b.confidence - a.confidence).slice(0, 10)
}

function extractFoodsFromText(text) {
  const foods = []
  const seen = new Set()

  for (const [name, info] of Object.entries(FOOD_KNOWLEDGE_BASE)) {
    if (text.includes(name) && !seen.has(name)) {
      seen.add(name)
      foods.push({
        name, displayName: name, category: info.category, confidence: 95,
        suggestedQuantity: info.defaultQty, suggestedUnit: info.defaultUnit,
        shelfLifeDays: info.shelfLifeDays, icon: info.icon, tips: info.tips,
      })
    }
    if (info.aliases) {
      for (const alias of info.aliases) {
        if (text.includes(alias) && !seen.has(name)) {
          seen.add(name)
          foods.push({
            name, displayName: alias, category: info.category, confidence: 88,
            suggestedQuantity: info.defaultQty, suggestedUnit: info.defaultUnit,
            shelfLifeDays: info.shelfLifeDays, icon: info.icon, tips: info.tips,
          })
          break
        }
      }
    }
  }

  return foods.sort((a, b) => b.confidence - a.confidence).slice(0, 8)
}

// ==================== 食材名称标准化 ====================

function normalizeFoodName(raw) {
  if (!raw) return ''
  const trimmed = raw.replace(/[\s\d\.\-\(\)\[\]（）【】]/g, '')
  
  const corrections = {
    '鸡蛋': ['蛋','土鸡蛋','柴鸡蛋'], '西红柿': ['番茄','洋柿子'],
    '土豆': ['马铃薯','洋芋'], '青椒': ['甜椒','菜椒'],
    '豆腐': ['嫩豆腐','老豆腐','北豆腐','南豆腐'],
    '猪肉': ['五花肉','里脊肉','瘦肉','猪腿肉'],
    '牛肉': ['牛腩','牛里脊'], '鸡肉': ['鸡胸肉','鸡腿肉','鸡翅'],
    '葱': ['大葱','小葱','香葱','葱花','葱段'],
    '姜': ['生姜','老姜','仔姜'], '蒜': ['大蒜','蒜头','蒜瓣'],
    '酱油': ['生抽','老抽','蒸鱼豉油'], '盐': ['食用盐','精盐'],
    '油': ['食用油','植物油','橄榄油','花生油'],
    '牛奶': ['纯牛奶','鲜奶'], '酸奶': ['酸牛奶','优酸乳'],
    '面条': ['挂面','拉面','手擀面','意面','方便面','泡面'],
    '米饭': ['大米饭','米','白米饭'], '胡萝卜': ['红萝卜'],
    '黄瓜': ['青瓜','胡瓜'], '洋葱': ['圆葱','葱头'],
    '辣椒': ['红椒','朝天椒','小米辣'], '茄子': ['茄瓜','矮瓜'],
    '菠菜': ['菠薐','波斯菜'], '白菜': ['大白菜','黄芽白','娃娃菜'],
  }

  for (const [standard, aliases] of Object.entries(corrections)) {
    if (trimmed === standard || aliases.includes(trimmed)) return standard
    if (trimmed.length > 1 && aliases.some(a => trimmed.includes(a) || a.includes(trimmed))) return standard
  }
  return trimmed.length >= 1 ? trimmed : ''
}

function isKnownFood(name) {
  if (!name) return false
  if (FOOD_KNOWLEDGE_BASE[name]) return true
  for (const info of Object.values(FOOD_KNOWLEDGE_BASE)) {
    if (info.aliases?.includes(name)) return true
  }
  if (/^(鸡|猪|牛|羊|鸭|鱼|虾|蟹|贝|蛋|肉)/.test(name)) return true
  if (/^(西|青|黄|白|胡|菠|芹|韭|笋|菇|藕|葱|姜|蒜|椒|茄|瓜|豆|菜|果|莓|蕉|橙|柠|桃|梨|杏)/.test(name)) return true
  if (/(奶|酪|浆|汁|酒|茶|醋|酱|油|糖|盐|粉|面|饭|粥|米|麦)$/.test(name)) return true
  return false
}

function getFoodInfo(name) {
  const defaultInfo = { category: 'other', defaultQty: 1, defaultUnit: '个', shelfLifeDays: 7, icon: '📦', tips: '' }
  if (!name) return defaultInfo
  
  const info = FOOD_KNOWLEDGE_BASE[name]
  if (info) return { ...defaultInfo, ...info }

  const n = name.toLowerCase()
  if (/^(猪|牛|羊|鸡|鸭|鱼|虾|蟹|肉|排|翅|腿|腩|里脊|胸|肝|肚|肠|蛋)/.test(n)) return { ...defaultInfo, category: 'meat', icon: '🥩' }
  if (/奶|酪|酸奶|乳/.test(n)) return { ...defaultInfo, category: 'dairy', icon: '🥛' }
  if (/(菜|瓜|豆|萝|芹|茄|椒|笋|菇|耳|葱|蒜|姜|韭菜|白菜|西兰花)/.test(n)) return { ...defaultInfo, category: 'vegetable', icon: '🥬' }
  if (/苹果|香蕉|橙|柠檬|草莓|葡萄|桃|梨|芒果|蓝莓|西瓜|樱桃/.test(n)) return { ...defaultInfo, category: 'fruit', icon: '🍎' }
  if (/可乐|果汁|酒|茶|咖啡|豆浆|饮料|椰汁|奶茶|汽水|水/.test(n)) return { ...defaultInfo, category: 'beverage', icon: '🥤' }
  if (/盐|糖|酱油|醋|油|酱|料|椒|粉|咖喱|芝麻|花椒|八角/.test(n)) return { ...defaultInfo, category: 'condiment', icon: '🧂' }
  if (/面|粉|米|饭|粥|燕麦|面包|馒头|饺子|馄饨|包子|饼|糕/.test(n)) return { ...defaultInfo, category: 'other', icon: '🍞' }
  return defaultInfo
}

// ==================== 兜底：常见食材建议 ====================

function getCommonFoodSuggestions() {
  return [
    { name: '鸡蛋', category: 'other', confidence: 100, suggestedQuantity: 10, suggestedUnit: '个', shelfLifeDays: 21, icon: '🥚', tips: '冷藏可放21天，建议竖着放' },
    { name: '牛奶', category: 'dairy', confidence: 98, suggestedQuantity: 1, suggestedUnit: '盒', shelfLifeDays: 7, icon: '🥛', tips: '巴氏奶需冷藏，开封后3天内喝完' },
    { name: '酸奶', category: 'dairy', confidence: 97, suggestedQuantity: 6, suggestedUnit: '杯', shelfLifeDays: 21, icon: '🥛', tips: '冷藏保存即可' },
    { name: '西红柿', category: 'vegetable', confidence: 96, suggestedQuantity: 5, suggestedUnit: '个', shelfLifeDays: 7, icon: '🍅', tips: '常温催熟，冷藏保鲜更久' },
    { name: '土豆', category: 'vegetable', confidence: 95, suggestedQuantity: 3, suggestedUnit: '个', shelfLifeDays: 14, icon: '🥔', tips: '阴凉避光处存放' },
    { name: '黄瓜', category: 'vegetable', confidence: 94, suggestedQuantity: 3, suggestedUnit: '根', shelfLifeDays: 7, icon: '🥒', tips: '用保鲜膜包好冷藏' },
    { name: '胡萝卜', category: 'vegetable', confidence: 93, suggestedQuantity: 2, suggestedUnit: '根', shelfLifeDays: 14, icon: '🥕', tips: '冷藏可放2周左右' },
    { name: '青椒', category: 'vegetable', confidence: 92, suggestedQuantity: 5, suggestedUnit: '个', shelfLifeDays: 7, icon: '🫑', tips: '冷藏保存，不要洗' },
    { name: '生菜', category: 'vegetable', confidence: 91, suggestedQuantity: 2, suggestedUnit: '颗', shelfLifeDays: 5, icon: '🥬', tips: '尽快食用，最多存3-5天' },
    { name: '大蒜', category: 'vegetable', confidence: 90, suggestedQuantity: 1, suggestedUnit: '头', shelfLifeDays: 60, icon: '🧄', tips: '阴凉干燥处可放很久' },
    { name: '苹果', category: 'fruit', confidence: 88, suggestedQuantity: 5, suggestedUnit: '个', shelfLifeDays: 14, icon: '🍎', tips: '冷藏可放2-3周' },
    { name: '香蕉', category: 'fruit', confidence: 87, suggestedQuantity: 3, suggestedUnit: '根', shelfLifeDays: 5, icon: '🍌', tips: '常温保存不要放冰箱！' },
    { name: '鸡肉', category: 'meat', confidence: 85, suggestedQuantity: 500, suggestedUnit: 'g', shelfLifeDays: 3, icon: '🍗', tips: '冷藏2天内吃完或冷冻' },
    { name: '猪肉', category: 'meat', confidence: 84, suggestedQuantity: 500, suggestedUnit: 'g', shelfLifeDays: 3, icon: '🥩', tips: '冷藏2天内吃完或冷冻' },
    { name: '牛肉', category: 'meat', confidence: 83, suggestedQuantity: 500, suggestedUnit: 'g', shelfLifeDays: 3, icon: '🥩', tips: '冷冻可存3个月' },
  ]
}

// ==================== 完整食材知识库 ====================

const FOOD_KNOWLEDGE_BASE = {
  // ===== 蛋类 =====
  '鸡蛋':     { category: 'other', defaultQty: 10, defaultUnit: '个', shelfLifeDays: 21, icon: '🥚', tips: '冷藏可放21天', aliases: ['土鸡蛋','柴鸡蛋'] },

  // ===== 蔬菜 =====
  '西红柿':   { category: 'vegetable', defaultQty: 4, defaultUnit: '个', shelfLifeDays: 7, icon: '🍅', aliases: ['番茄','洋柿子'] },
  '土豆':     { category: 'vegetable', defaultQty: 3, defaultUnit: '个', shelfLifeDays: 14, icon: '🥔', aliases: ['马铃薯','洋芋'] },
  '黄瓜':     { category: 'vegetable', defaultQty: 2, defaultUnit: '根', shelfLifeDays: 7, icon: '🥒', aliases: ['青瓜'] },
  '胡萝卜':   { category: 'vegetable', defaultQty: 2, defaultUnit: '根', shelfLifeDays: 14, icon: '🥕', aliases: ['红萝卜'] },
  '洋葱':     { category: 'vegetable', defaultQty: 2, defaultUnit: '个', shelfLifeDays: 14, icon: '🧅', aliases: ['圆葱','葱头'] },
  '青椒':     { category: 'vegetable', defaultQty: 5, defaultUnit: '个', shelfLifeDays: 7, icon: '🫑', aliases: ['甜椒','菜椒','尖椒'] },
  '西兰花':   { category: 'vegetable', defaultQty: 1, defaultUnit: '颗', shelfLifeDays: 5, icon: '🥦', aliases: ['青花菜'] },
  '生菜':     { category: 'vegetable', defaultQty: 1, defaultUnit: '颗', shelfLifeDays: 5, icon: '🥬', aliases: [] },
  '白菜':     { category: 'vegetable', defaultQty: 1, defaultUnit: '颗', shelfLifeDays: 14, icon: '🥬', aliases: ['大白菜','娃娃菜'] },
  '菠菜':     { category: 'vegetable', defaultQty: 1, defaultUnit: '把', shelfLifeDays: 5, icon: '🥬', aliases: [] },
  '茄子':     { category: 'vegetable', defaultQty: 2, defaultUnit: '个', shelfLifeDays: 7, icon: '🍆', aliases: ['茄瓜'] },
  '芹菜':     { category: 'vegetable', defaultQty: 1, defaultUnit: '把', shelfLifeDays: 7, icon: '🥬', aliases: ['西芹'] },
  '豆角':     { category: 'vegetable', defaultQty: 300, defaultUnit: 'g', shelfLifeDays: 5, icon: '🫘', aliases: ['四季豆'] },
  '冬瓜':     { category: 'vegetable', defaultQty: 1, defaultUnit: '个', shelfLifeDays: 14, icon: '🥒', aliases: [] },
  '南瓜':     { category: 'vegetable', defaultQty: 1, defaultUnit: '块', shelfLifeDays: 30, icon: '🎃', aliases: [] },
  '红薯':     { category: 'vegetable', defaultQty: 500, defaultUnit: 'g', shelfLifeDays: 14, icon: '🍠', aliases: ['地瓜','番薯'] },
  '莲藕':     { category: 'vegetable', defaultQty: 300, defaultUnit: 'g', shelfLifeDays: 7, icon: '🫒', aliases: ['藕'] },
  '苦瓜':     { category: 'vegetable', defaultQty: 1, defaultUnit: '个', shelfLifeDays: 5, icon: '🥒', aliases: ['凉瓜'] },
  '金针菇':   { category: 'vegetable', defaultQty: 150, defaultUnit: 'g', shelfLifeDays: 5, icon: '🍄', aliases: ['针菇'] },
  '香菇':     { category: 'vegetable', defaultQty: 150, defaultUnit: 'g', shelfLifeDays: 14, icon: '🍄', aliases: ['冬菇'] },
  '平菇':     { category: 'vegetable', defaultQty: 200, defaultUnit: 'g', shelfLifeDays: 5, icon: '🍄', aliases: [] },
  '木耳':     { category: 'vegetable', defaultQty: 50, defaultUnit: 'g', shelfLifeDays: 365, icon: '🍄', aliases: ['黑木耳'] },
  '大蒜':     { category: 'vegetable', defaultQty: 1, defaultUnit: '头', shelfLifeDays: 60, icon: '🧄', aliases: ['蒜头','蒜瓣'] },
  '姜':       { category: 'vegetable', defaultQty: 1, defaultUnit: '块', shelfLifeDays: 30, icon: '🫚', aliases: ['生姜','老姜'] },
  '葱':       { category: 'vegetable', defaultQty: 3, defaultUnit: '根', shelfLifeDays: 7, icon: '🧅', aliases: ['大葱','小葱','香葱'] },
  '香菜':     { category: 'vegetable', defaultQty: 1, defaultUnit: '把', shelfLifeDays: 7, icon: '🌿', aliases: ['芫荽'] },

  // ===== 水果 =====
  '苹果':     { category: 'fruit', defaultQty: 5, defaultUnit: '个', shelfLifeDays: 14, icon: '🍎', aliases: [] },
  '香蕉':     { category: 'fruit', defaultQty: 3, defaultUnit: '根', shelfLifeDays: 5, icon: '🍌', aliases: [] },
  '橙子':     { category: 'fruit', defaultQty: 4, defaultUnit: '个', shelfLifeDays: 21, icon: '🍊', aliases: ['甜橙'] },
  '柠檬':     { category: 'fruit', defaultQty: 3, defaultUnit: '个', shelfLifeDays: 30, icon: '🍋', aliases: [] },
  '草莓':     { category: 'fruit', defaultQty: 250, defaultUnit: 'g', shelfLifeDays: 3, icon: '🍓', aliases: [] },
  '西瓜':     { category: 'fruit', defaultQty: 1, defaultUnit: '个', shelfLifeDays: 5, icon: '🍉', aliases: [] },
  '芒果':     { category: 'fruit', defaultQty: 2, defaultUnit: '个', shelfLifeDays: 7, icon: '🥭', aliases: [] },
  '梨':       { category: 'fruit', defaultQty: 3, defaultUnit: '个', shelfLifeDays: 14, icon: '🍐', aliases: ['雪梨'] },
  '猕猴桃':   { category: 'fruit', defaultQty: 3, defaultUnit: '个', shelfLifeDays: 14, icon: '🥝', aliases: ['奇异果'] },
  '葡萄':     { category: 'fruit', defaultQty: 500, defaultUnit: 'g', shelfLifeDays: 7, icon: '🍇', aliases: ['提子'] },
  '樱桃':     { category: 'fruit', defaultQty: 250, defaultUnit: 'g', shelfLifeDays: 5, icon: '🍒', aliases: ['车厘子'] },
  '火龙果':   { category: 'fruit', defaultQty: 2, defaultUnit: '个', shelfLifeDays: 7, icon: '🐉', aliases: [] },
  '柚子':     { category: 'fruit', defaultQty: 1, defaultUnit: '个', shelfLifeDays: 21, icon: '🍊', aliases: [] },

  // ===== 肉类 =====
  '猪肉':     { category: 'meat', defaultQty: 500, defaultUnit: 'g', shelfLifeDays: 3, icon: '🥩', aliases: ['五花肉','里脊肉'] },
  '牛肉':     { category: 'meat', defaultQty: 500, defaultUnit: 'g', shelfLifeDays: 3, icon: '🥩', aliases: ['牛腩','牛里脊'] },
  '鸡肉':     { category: 'meat', defaultQty: 500, defaultUnit: 'g', shelfLifeDays: 3, icon: '🍗', aliases: ['鸡胸肉','鸡腿肉','鸡翅'] },
  '鸭肉':     { category: 'meat', defaultQty: 500, defaultUnit: 'g', shelfLifeDays: 3, icon: '🦆', aliases: [] },
  '鱼肉':     { category: 'meat', defaultQty: 500, defaultUnit: 'g', shelfLifeDays: 2, icon: '🐟', aliases: ['鲈鱼','三文鱼'] },
  '虾':       { category: 'meat', defaultQty: 300, defaultUnit: 'g', shelfLifeDays: 2, icon: '🦐', aliases: ['虾仁','基围虾'] },

  // ===== 乳制品 =====
  '牛奶':     { category: 'dairy', defaultQty: 1, defaultUnit: '盒/L', shelfLifeDays: 7, icon: '🥛', aliases: ['纯牛奶','鲜奶'] },
  '酸奶':     { category: 'dairy', defaultQty: 6, defaultUnit: '杯/g', shelfLifeDays: 21, icon: '🥛', aliases: ['酸牛奶','优酸乳'] },
  '奶酪':     { category: 'dairy', defaultQty: 100, defaultUnit: 'g', shelfLifeDays: 30, icon: '🧀', aliases: ['芝士'] },

  // ===== 饮料 =====
  '果汁':     { category: 'beverage', defaultQty: 1, defaultUnit: '瓶/L', shelfLifeDays: 30, icon: '🧃', aliases: [] },
  '可乐':     { category: 'beverage', defaultQty: 1, defaultUnit: '瓶/L', shelfLifeDays: 365, icon: '🥤', aliases: ['可口可乐','百事'] },
  '啤酒':     { category: 'beverage', defaultQty: 1, defaultUnit: '罐/瓶', shelfLifeDays: 365, icon: '🍺', aliases: ['青岛','雪花'] },
  '椰汁':     { category: 'beverage', defaultQty: 1, defaultUnit: 'L', shelfLifeDays: 365, icon: '🥥', aliases: ['椰树牌'] },
  '茶饮':     { category: 'beverage', defaultQty: 1, defaultUnit: '瓶/L', shelfLifeDays: 365, icon: '🍵', aliases: ['康师傅','王老吉','元气森林'] },

  // ===== 调料 =====
  '盐':       { category: 'condiment', defaultQty: 400, defaultUnit: 'g', shelfLifeDays: 1825, icon: '🧂', aliases: ['食用盐','精盐'] },
  '糖':       { category: 'condiment', defaultQty: 500, defaultUnit: 'g', shelfLifeDays: 365, icon: '🍬', aliases: ['白糖','冰糖','红糖'] },
  '酱油':     { category: 'condiment', defaultQty: 500, defaultUnit: 'ml', shelfLifeDays: 730, icon: '🫗', aliases: ['生抽','老抽'] },
  '醋':       { category: 'condiment', defaultQty: 500, defaultUnit: 'ml', shelfLifeDays: 1095, icon: '🫗', aliases: ['陈醋','香醋','恒顺'] },
  '料酒':     { category: 'condiment', defaultQty: 500, defaultUnit: 'ml', shelfLifeDays: 365, icon: '🍶', aliases: ['黄酒','花雕'] },
  '蚝油':     { category: 'condiment', defaultQty: 520, defaultUnit: 'g', shelfLifeDays: 730, icon: '🫗', aliases: ['李锦记','海天'] },
  '豆瓣酱':   { category: 'condiment', defaultQty: 500, defaultUnit: 'g', shelfLifeDays: 365, icon: '🌶️', aliases: ['郫县'] },
  '芝麻酱':   { category: 'condiment', defaultQty: 200, defaultUnit: 'g', shelfLifeDays: 270, icon: '🫘', aliases: [] },
  '番茄酱':   { category: 'condiment', defaultQty: 200, defaultUnit: 'g', shelfLifeDays: 365, icon: '🍅', aliases: [] },
  '淀粉':     { category: 'condiment', defaultQty: 200, defaultUnit: 'g', shelfLifeDays: 365, icon: '🤍', aliases: ['玉米淀粉'] },
  '鸡精':     { category: 'condiment', defaultQty: 200, defaultUnit: 'g', shelfLifeDays: 730, icon: '🧂', aliases: ['太太乐','家乐'] },

  // ===== 主食/其他 =====
  '米饭':     { category: 'other', defaultQty: 500, defaultUnit: 'g', shelfLifeDays: 3, icon: '🍚', aliases: ['大米饭','白米饭'] },
  '面条':     { category: 'other', defaultQty: 300, defaultUnit: 'g', shelfLifeDays: 180, icon: '🍜', aliases: ['挂面','拉面','意面','方便面'] },
  '面包':     { category: 'other', defaultQty: 1, defaultUnit: '个', shelfLifeDays: 7, icon: '🍞', aliases: ['吐司'] },
  '饺子':     { category: 'other', defaultQty: 20, defaultUnit: '个', shelfLifeDays: 30, icon: '🥟', aliases: ['水饺','馄饨'] },
  '汤圆':     { category: 'other', defaultQty: 15, defaultUnit: '个', shelfLifeDays: 365, icon: '🔵', aliases: ['思念','湾仔码头'] },
  '速冻食品': { category: 'other', defaultQty: 300, defaultUnit: 'g', shelfLifeDays: 365, icon: '🧊', aliases: ['水饺','汤圆','春卷','丸子'] },
}
