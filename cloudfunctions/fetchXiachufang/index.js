// cloudfunctions/fetchXiachufang/index.js
/**
 * 下厨房数据源 - 云函数 v3
 *
 * 基于 ruter/xiachufang-api 项目的正确 DOM 选择器重写
 * 参考: https://github.com/ruter/xiachufang-api
 *
 * 关键修正（v2→v3）：
 *  1. 封面图使用 data-src（懒加载属性），而非 src
 *  2. 列表容器: div.normal-recipe-list > ul.list > li
 *  3. 详情页标题: h1.page-title[itemprop="name"]
 *  4. 详情页评分: div.score > span.number
 *  5. 详情页步骤容器: div.steps > ol > li
 *  6. 分类数据可从页面动态抓取
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const rp = require('request-promise')

// 下厨房网站配置
const XIACHUFANG_DOMAIN = 'https://www.xiachufang.com'
const SEARCH_URL = `${XIACHUFANG_DOMAIN}/search/`

// 云存储目录前缀
const STORAGE_PREFIX = 'recipe-images/'

exports.main = async (event, context) => {
  const { action, keyword, categoryNo, recipeNo, page = 1 } = event

  console.log(`🍳 [下厨房v3] action=${action}, keyword=${keyword || '(热门)'}`)

  try {
    switch (action) {
      case 'search':
        return await searchRecipes(keyword, page)
      case 'category':
        return await getCategoryRecipes(categoryNo, page)
      case 'detail':
        return await getRecipeDetail(recipeNo)
      case 'categories':
        return await getCategories()
      default:
        return { success: false, errMsg: `未知操作: ${action}` }
    }
  } catch (err) {
    console.error('❌ 下厨房API调用失败:', err)
    return await getPopularRecipes(page)
  }
}

// ==================== 图片中转核心 ====================

/**
 * 将外部图片URL下载并上传到微信云存储
 * 仅在详情页使用，列表页走快速模式不转图
 */
async function proxyImageToStorage(externalUrl, recipeId) {
  if (!externalUrl || externalUrl === '') return ''

  try {
    let normalizedUrl = externalUrl
    if (normalizedUrl.startsWith('//')) {
      normalizedUrl = 'https:' + normalizedUrl
    }

    const urlHash = Buffer.from(normalizedUrl).toString('base64').replace(/[+/=]/g, '').slice(0, 24)
    const fileExt = normalizedUrl.match(/\.(jpg|jpeg|png|webp)(\?|$)/i)?.[1] || 'jpg'
    const cloudPath = `${STORAGE_PREFIX}${urlHash}.${fileExt}`

    const storage = cloud.storage()

    // 检查缓存
    try {
      const { fileList } = await storage.listFiles({ prefix: cloudPath, limit: 1 })
      if (fileList && fileList.length > 0 && fileList[0].status === 0) {
        const result = await storage.getTempFileURL({ fileList: [cloudPath] })
        const tempUrl = result?.fileList?.[0]?.tempFileURL
        if (tempUrl) {
          console.log(`✅ [图片缓存命中] ${cloudPath}`)
          return tempUrl
        }
      }
    } catch (e) { /* 不存在则上传 */ }

    // 下载图片
    const imageBuffer = await rp({
      uri: normalizedUrl,
      encoding: null,
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
        'Referer': 'https://www.xiachufang.com/',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
      },
      maxRedirects: 5,
    })

    // 图片校验
    const isImage = imageBuffer && imageBuffer.length > 1000 && (
      imageBuffer[0] === 0xFF || imageBuffer[0] === 0x89 || imageBuffer[0] === 0x52
    )
    if (!isImage) {
      console.warn(`⚠️ [图片无效] URL: ${normalizedUrl}, size: ${imageBuffer?.length}`)
      return ''
    }

    // 上传到云存储
    const uploadResult = await cloud.uploadFile({ cloudPath, fileContent: imageBuffer })

    if (uploadResult.fileID) {
      const urlResult = await storage.getTempFileURL({ fileList: [uploadResult.fileID] })
      const finalUrl = urlResult?.fileList?.[0]?.tempFileURL
      console.log(`✅ [图片上传成功] ${cloudPath}`)
      return finalUrl || uploadResult.fileID
    }
  } catch (e) {
    console.warn(`⚠️ [图片代理失败] ${externalUrl.slice(0, 60)}... 错误:`, e.message)
  }
  return ''
}

// ==================== HTML 解析工具函数 ====================

/**
 * 从 HTML 中提取匹配第一个正则的文本内容
 */
function extractText(html, pattern) {
  const m = html.match(pattern)
  return m ? cleanHTML(m[1]) : ''
}

/**
 * 从 HTML 中提取所有匹配正则的结果
 */
function extractAll(html, pattern) {
  const results = []
  let m
  while ((m = pattern.exec(html)) !== null) {
    results.push(m)
  }
  return results
}

/**
 * 清理 HTML 标签，返回纯文本
 */
function cleanHTML(str) {
  if (!str) return ''
  return str
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim()
}

/**
 * 提取属性值（支持 data-src 和 src）
 */
function extractAttr(htmlBlock, tag, attr) {
  // 优先 data-src（懒加载）
  let m = htmlBlock.match(new RegExp(`<${tag}[^>]*${attr}=["']([^"']+)["']`, 'i'))
  if (m) return normalizeImgUrl(m[1])

  // 如果是 img 且没找到 data-src，尝试 src
  if (tag.toLowerCase() === 'img' && attr === 'data-src') {
    m = htmlBlock.match(/<img[^>]*src=["']([^"']+)["']/i)
    if (m) return normalizeImgUrl(m[1])
  }

  return ''
}

/**
 * 标准化图片 URL
 */
function normalizeImgUrl(url) {
  if (!url) return ''
  if (url.startsWith('//')) return 'https:' + url
  if (url.startsWith('/')) return XIACHUFANG_DOMAIN + url
  return url
}

// ==================== 搜索菜谱 ====================

async function searchRecipes(keyword, page) {
  if (!keyword) {
    return { success: false, errMsg: '搜索关键词不能为空' }
  }

  try {
    const url = `${SEARCH_URL}?keyword=${encodeURIComponent(keyword)}&page=${page}&cat=1001`

    const html = await rp({
      uri: url,
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    })

    const recipes = parseRecipeListHTML(html)

    // 快速模式：列表不转存图片（避免超时），保留 _rawCover 给前端按需加载
    const recipesWithMeta = recipes.slice(0, 20).map((r, idx) => ({
      _id: `xcf_s_${r.no || idx}`,
      name: r.name || '未知菜谱',
      image: '',           // 快速模式无图
      description: getRecipeDesc(r.name),
      cookTime: getCookTime(r.name) || 30,
      difficulty: getDifficulty(r.name) || 'medium',
      tags: getTags(r.name),
      likes: Math.floor(Math.random() * 2000) + 300,
      servings: { single: 1, couple: 2, family: 3 },
      ingredients: [],
      steps: [],
      source: 'xiachufang_search',
      externalId: r.no,
      _rawCover: r.cover || '',  // 原始封面 URL（懒加载已处理）
    }))

    console.log(`🔍 [搜索结果] "${keyword}" → ${recipes.length} 道原始, 返回 ${recipesWithMeta.length} 道`)

    return {
      success: true,
      recipes: recipesWithMeta.filter(r => r.name && r.name !== '未知菜谱'),
      total: recipesWithMeta.length,
      source: 'xiachufang_web_v3',
      query: keyword,
    }
  } catch (e) {
    console.warn('⚠️ 搜索失败:', e.message)
    return await getPopularRecipes(page)
  }
}

// ==================== 菜谱列表解析器（核心改进） ====================

/**
 * 解析搜索/分类/热门列表页面 HTML
 *
 * 基于 xiachufang-api 的正确 DOM 结构：
 *   容器: div.normal-recipe-list > ul.list > li
 *   条目: li > div.recipe
 *     ├── a[href="/recipe/{id}/"]          → 详情链接
 *     │   └── div.cover > img[data-src]   → 封面图（懒加载！）
 *     └── div.info
 *         └── p.name > a                  → 菜名
 */
function parseRecipeListHTML(html) {
  const results = []

  // ===== 策略1: 精确匹配 xiachufang-api 的 DOM 结构 =====
  // 匹配 <li> 块中的完整菜谱卡片
  const liPattern = /<li[^>]*>([\s\S]*?)<\/li>/gi
  let liMatch

  while ((liMatch = liPattern.exec(html)) !== null && results.length < 20) {
    const block = liMatch[1]

    // 必须包含 recipe 卡片标记才处理
    if (!block.includes('class="recipe"')) continue

    const recipeData = parseSingleRecipeCard(block)
    if (recipeData) {
      results.push(recipeData)
    }
  }

  console.log(`[列表解析] 策略1精确匹配: ${results.length} 条`)

  // ===== 策略2: 如果策略1结果不足，用更宽松的 recipe-card 匹配 =====
  if (results.length < 5) {
    const loosePattern = /<a[^>]*href="\/recipe\/(\d+)"[^>]*>([\s\S]*?)<\/a>/gi
    let match
    while ((match = loosePattern.exec(html)) !== null && results.length < 20) {
      const no = match[1]
      const inner = match[2]

      // 跳过已存在的
      if (results.some(r => r.no === no)) continue

      // 提取封面图：优先 data-src，其次 src
      let cover = ''
      const dataSrcMatch = inner.match(/data-src=["']([^"']+)["']/i)
      if (dataSrcMatch) cover = dataSrcMatch[1]
      else {
        const srcMatch = inner.match(/src=["']([^"']+\.(jpg|jpeg|png|webp))["']/i)
        if (srcMatch) cover = srcMatch[1]
      }

      // 提取菜名
      const nameMatch = inner.match(/(?:title|alt)="([^"]{2,30})"/i)
        || inner.match(/>([^<]{2,20})<\/a>\s*$/)

      results.push({
        no,
        cover: normalizeImgUrl(cover),
        name: nameMatch ? cleanHTML(nameMatch[1]) : '',
      })
    }
    console.log(`[列表解析] 策略2宽松匹配后总计: ${results.length} 条`)
  }

  return results
}

/**
 * 解析单个菜谱卡片的 HTML 块
 * 对应 DOM: <li> ... div.recipe > (a > img) + (div.info > p.name > a) ...
 */
function parseSingleRecipeCard(liBlock) {
  // 1. 提取详情链接 → 获取 recipe ID
  const linkMatch = liBlock.match(/href="(\/recipe\/(\d+)\/?)"/)
  if (!linkMatch) return null
  const no = linkMatch[2]

  // 2. 提取封面图 — 核心修复：data-src（懒加载）
  let cover = ''
  // 方式A: div.cover > img[data-src]
  const dataSrcMatch = liBlock.match(/data-src=["']([^"']+)["']/i)
  if (dataSrcMatch) {
    cover = dataSrcMatch[1]
  } else {
    // 方式B: 传统的 src 属性
    const srcMatch = liBlock.match(/<img[^>]+src=["']([^"']+)["']/i)
    if (srcMatch) cover = srcMatch[1]
  }

  // 3. 提取菜名 — div.info > p.name > a 的文本
  let name = ''
  // 方式A: 标准 DOM 结构
  const nameMatchA = liBlock.match(/class="name"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i)
  if (nameMatchA) {
    name = cleanHTML(nameMatchA[1])
  } else {
    // 方式B: alt/title 属性
    const nameMatchB = liBlock.match(/(?:alt|title)="([^"]+)"/i)
    if (nameMatchB) name = cleanHTML(nameMatchB[1])
  }

  // 至少要有 ID 才返回
  return { no, cover: normalizeImgUrl(cover), name }
}

// ==================== 分类/热门菜谱 ====================

async function getCategoryRecipes(categoryNo, page) {
  // 尝试抓取下厨房真实数据
  let targetUrl
  if (categoryNo) {
    targetUrl = `${XIACHUFANG_DOMAIN}/category/${categoryNo}/?page=${page}`
  } else {
    targetUrl = `${XIACHUFANG_DOMAIN}/explore/all/?page=${page}`
  }

  try {
    console.log(`🔥 [分类/热门] 抓取: ${targetUrl}`)
    const html = await rp({
      uri: targetUrl,
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    })

    const parsed = parseRecipeListHTML(html)
    if (parsed.length >= 3) {
      console.log(`✅ [分类/热门] 抓取到 ${parsed.length} 道真实菜谱（快速模式，无图）`)

      const recipes = parsed.slice(0, 10).map((r, idx) => ({
        _id: categoryNo ? `xcf_cat${categoryNo}_${idx}` : `xcf_hot_${r.no}`,
        name: r.name || r.no,
        image: '',
        description: getRecipeDesc(r.name),
        cookTime: getCookTime(r.name) || 30,
        difficulty: getDifficulty(r.name) || 'medium',
        tags: getTags(r.name),
        likes: Math.floor(Math.random() * 2000) + 300,
        servings: { single: 1, couple: 2, family: 3 },
        ingredients: [],
        steps: [],
        source: categoryNo ? 'xiachufang_category' : 'xiachufang_hot',
        externalId: r.no,
        _rawCover: r.cover || '',
      }))

      return {
        success: true,
        recipes,
        total: recipes.length,
        hasMore: parsed.length > 10,
        source: 'xiachufang_web_v3_fast',
      }
    }
  } catch (e) {
    console.warn(`⚠️ [分类/热门] 网页抓取失败:`, e.message)
  }

  return await getPopularRecipes(page)
}

async function getPopularRecipes(page) {
  const popularRecipes = [
    { no: '596496', name: '糖醋排骨', cover: '' },
    { no: '598558', name: '宫保鸡丁', cover: '' },
    { no: '354651', name: '红烧肉', cover: '' },
    { no: '109277', name: '可乐鸡翅', cover: '' },
    { no: '219448', name: '麻婆豆腐', cover: '' },
    { no: '547528', name: '番茄牛腩煲', cover: '' },
    { no: '303767', name: '清蒸鲈鱼', cover: '' },
    { no: '384607', name: '酸辣土豆丝', cover: '' },
    { no: '559888', name: '蛋挞', cover: '' },
    { no: '343793', name: '凉拌黄瓜', cover: '' },
    { no: '224725', name: '玉米排骨汤', cover: '' },
  ]

  const pageSize = 10
  const startIdx = (page - 1) * pageSize
  const paged = popularRecipes.slice(startIdx, startIdx + pageSize)

  const enrichedRecipes = paged.map((r, idx) => ({
    _id: `xcf_builtin_${page}_${idx}`,
    name: r.name,
    image: '',
    description: getRecipeDesc(r.name),
    cookTime: getCookTime(r.name),
    difficulty: getDifficulty(r.name),
    tags: getTags(r.name),
    likes: Math.floor(Math.random() * 1500) + 500,
    servings: { single: 1, couple: 2, family: 3 },
    ingredients: getIngredients(r.name),
    steps: getSteps(r.name),
    source: 'xiachufang_builtin',
    externalId: r.no,
  }))

  return {
    success: true,
    recipes: enrichedRecipes,
    total: popularRecipes.length,
    hasMore: startIdx + pageSize < popularRecipes.length,
    source: 'xiachufang_builtin',
  }
}

// ==================== 菜谱详情（核心改进） ====================

async function getRecipeDetail(recipeNo) {
  if (!recipeNo) {
    return { success: false, errMsg: '菜谱编号不能为空' }
  }

  try {
    const url = `${XIACHUFANG_DOMAIN}/recipe/${recipeNo}/`

    const html = await rp({
      uri: url,
      timeout: 8000,   // 缩短超时，快速失败
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
    })

    const detail = parseDetailHTML_v3(html, recipeNo)

    // ★ 快速模式：不转存图片（避免超时）
    // 删除原始URL字段（不传给前端避免混淆），image 留空由前端 emoji 降级
    delete detail.rawCover

    // 步骤图也不转存，清理 _rawImg
    if (detail.steps) {
      detail.steps = detail.steps.map(s => {
        const { _rawImg, ...rest } = s
        return { ...rest, image: null }
      })
    }

    console.log(`✅ [详情] ${detail.name} 解析完成（快速模式，无图）`)

    return { success: true, recipe: detail, source: 'xiachufang_web_v3_fast' }
  } catch (e) {
    console.warn(`获取详情失败(${recipeNo}):`, e.message)
    return { success: false, errMsg: e.message, fallback: true }
  }
}

/**
 * 解析菜详详情页面 v3
 *
 * 基于 xiachufang-api items/content.py 的正确选择器：
 *
 * 容器: div[contains(@class,"main-panel")] > div[1] (第一个子div)
 * 字段:
 *   name     → h1.page-title[itemprop="name"]
 *   cover    → div.recipe-show > div.cover > img[src]
 *   grade    → div.stats > div.score > span.number
 *   materials → div.ings > table tr (> td.name + td.unit)
 *   steps    → div.steps > ol li (> p文本 + img)
 *   tip      → div.tip
 */
function parseDetailHTML_v3(html, recipeNo) {
  // ---- 1. 菜名 ----
  // 选择器: h1.page-title[itemprop="name"]
  let name = extractText(html, /<h1[^>]*class="page-title"[^>]*itemprop="name"[^>]*>([^<]+)<\/h1>/i)
  // 回退: h1#recipe-title
  if (!name) {
    name = extractText(html, /<h1[^>]*id="recipe-title"[^>]*>([^<]+)<\/h1>/i)
  }
  // 再回退: 任意 h1
  if (!name) {
    name = extractText(html, /<h1[^>]*>([^<]+)<\/h1>/i)
  }

  // ---- 2. 封面图 ----
  // 选择器: div.recipe-show > div.cover > img[src]
  let rawCover = ''
  const coverPatterns = [
    // 精确: recipe-show 容器内的封面
    /<div[^>]*class="recipe-show"[^>]*>[\s\S]*?<div[^>]*class="cover"[^>]*>[\s\S]*?<img[^>]+src="(https?:\/\/[^"]+|\/\/[^"]+)"/i,
    // 回退: 带 cover 类的 img
    /<img[^>]+class="[^"]*cover[^"]*"[^>]+src="(https?:\/\/[^"]+|\/\/[^"]+)"/i,
    // 再回退: 页面主图
    /<img[^>]+src="(https?:\/\/(img|s1|s2)\.xiachufang\.com[^"]+(?:\.jpg|\.png|\.jpeg|\.webp)[^"]*)"/i,
  ]
  for (const pat of coverPatterns) {
    const m = html.match(pat)
    if (m) { rawCover = normalizeImgUrl(m[1]); break }
  }

  // ---- 3. 评分 ----
  // 选择器: div.stats > div.score > span.number
  let gradeText = extractText(
    html,
    /<div[^>]*class="score"[^>]*>[\s\S]*?<span[^>]*class="number"[^>]*>([^<]+)<\/span>/i
  )
  // 回退: grade 类
  if (!gradeText) {
    gradeText = extractText(html, /class="[^"]*grade[^"]*"[^>]*>\s*(\d+[^\s<]*)/i)
  }
  const likes = gradeText ? (parseFloat(gradeText) * 100 || parseInt(gradeText) * 10 || 0) : 0

  // ---- 4. 小贴士 ----
  // 选择器: div.tip
  let tip = ''
  // 精确匹配 div.tip 内容
  const tipMatch = html.match(/<div[^>]*class="tip"[^>]*>([\s\S]*?)<\/div>/i)
  if (tipMatch) {
    tip = cleanHTML(tipMatch[1])
  }

  // ---- 5. 食材列表 ----
  // 选择器: div.ings > table tr (> td.name + td.unit)
  const materials = []
  // 匹配每行食材
  const matRowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  let matMatch
  const ingContainerMatch = html.match(/<div[^>]*class="ings"[^>]*>([\s\S]*?)<\/div>\s*(?:<div|$)/i)
  const ingHTML = ingContainerMatch ? ingContainerMatch[1] : html

  while ((matMatch = matRowPattern.exec(ingHTML)) !== null) {
    const row = matMatch[1]

    // 提取名称: td.name
    let ingredientName = ''
    const nameTD = row.match(/<td[^>]*class="name"[^>]*>([\s\S]*?)<\/td>/i)
    if (nameTD) {
      ingredientName = cleanHTML(nameTD[1])
    }

    // 提取用量: td.unit
    let unitText = ''
    const unitTD = row.match(/<td[^>]*class="unit"[^>]*>([^<]*)<\/td>/i)
    if (unitTD) {
      unitText = cleanHTML(unitTD[1])
    }

    if (ingredientName && ingredientName.length > 0 && ingredientName.length < 30) {
      materials.push({
        name: ingredientName,
        amount: parseFloat(unitText) || 0,
        unit: unitText.replace(/[\d.\s]/g, '') || guessUnit(unitText),
        category: guessCategory(ingredientName),
        isEssential: true,
      })
    }
  }

  // 如果标准选择器没拿到，尝试宽松匹配
  if (materials.length === 0) {
    const looseMatPattern = /<td[^>]*class="[^"]*name[^"]*"[^>]*>([^<]+)<\/td>\s*<td[^>]*class="[^"]*unit[^"]*"[^>]*>([^<]*)<\/td>/gi
    while ((matMatch = looseMatPattern.exec(html)) !== null) {
      materials.push({
        name: cleanHTML(matMatch[1]),
        amount: parseFloat(matMatch[2]) || 0,
        unit: matMatch[2].trim().replace(/[\d.\s]/g, ''),
        category: guessCategory(matMatch[1]),
        isEssential: true,
      })
    }
  }

  // ---- 6. 步骤列表 ----
  // 选择器: div.steps > ol > li
  const steps = []

  // 先找 steps 容器
  const stepsContainerMatch = html.match(/<div[^>]*class="steps"[^>]*>([\s\S]*?)<\/div>\s*(?:<div|$)/i)
  const stepsHTML = stepsContainerMatch ? stepsContainerMatch[1] : html

  // 在容器内找 ol > li 或直接 li
  const stepLiPattern = /<li[^>]*class="container"[^>]*>([\s\S]*?)<\/li>/gi
  let stepMatch
  let stepIdx = 0

  while ((stepMatch = stepLiPattern.exec(stepsHTML)) !== null) {
    stepIdx++
    const stepBlock = stepMatch[1]

    // 提取步骤文字: <p> 标签内的文本
    let text = ''
    const textMatch = stepBlock.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
    if (textMatch) {
      text = cleanHTML(textMatch[1])
    }

    // 提取步骤配图
    let img = null
    const imgMatch = stepBlock.match(/<img[^>]+src="(https?:\/\/[^"]+|\/\/[^"]+)"/i)
    if (imgMatch) {
      img = normalizeImgUrl(imgMatch[1])
    }

    if (text || img) {
      steps.push({ order: stepIdx, text: text || `第${stepIdx}步`, image: null }) // image 由调用方填充
      // 保存原始 img URL 供后续代理使用
      steps[steps.length - 1]._rawImg = img
    }
  }

  // 如果标准选择器没找到，尝试更宽松的 li 匹配
  if (steps.length === 0) {
    const looseStepLi = /<li[^>]*>([\s\S]*?)<\/li>/gi
    while ((stepMatch = looseStepLi.exec(stepsHTML)) !== null) {
      const sb = stepMatch[1]
      // 只处理包含实质内容的 li
      if (sb.includes('<p>') || sb.includes('<img')) {
        stepIdx++
        const tm = sb.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
        const im = sb.match(/<img[^>]+src="(https?:\/\/[^"]+|\/\/[^"]+)"/i)
        steps.push({
          order: stepIdx,
          text: tm ? cleanHTML(tm[1]) : `第${stepIdx}步`,
          image: null,
          _rawImg: im ? normalizeImgUrl(im[1]) : null,
        })
      }
    }
  }

  // ---- 组装结果 ----
  return {
    _id: `xcf_${recipeNo}`,
    name: name || `菜谱#${recipeNo}`,
    image: '',       // 由调用方填充
    rawCover,
    description: tip || getRecipeDesc(name),
    cookTime: steps.length > 0 ? steps.length * 5 : 20,
    difficulty: materials.length <= 4 ? 'easy' : materials.length <= 8 ? 'medium' : 'hard',
    tags: extractTags(name),
    servings: { single: 1, couple: 2, family: 3 },
    likes,
    ingredients: materials,
    steps: steps.length > 0 ? steps : [{ order: 1, text: '详细做法请查看原网页', image: null }],
    nutrition: null,
    source: 'xiachufang',
    externalId: recipeNo,
  }
}

/** 推测单位 */
function guessUnit(text) {
  if (!text) return '适量'
  if (/克|g/i.test(text)) return 'g'
  if (/毫升|ml/i.test(text)) return 'ml'
  if (/个|只|根|颗|片|块|瓣|勺|杯/.test(text)) return text.trim().replace(/[\d.\s]/g, '') || '个'
  return '适量'
}

// ==================== 动态分类列表 ====================

async function getCategories() {
  // 尝试从下厨房分类页面动态抓取
  try {
    const url = `${XIACHUFANG_DOMAIN}/category/`
    console.log(`📂 [分类] 尝试抓取分类页: ${url}`)

    const html = await rp({
      uri: url,
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
    })

    // 基于 xiachufang-api items/category.py 的选择器:
    // 容器: div.category-container > div > div.cates-list
    // 结构: h3(大类名) -> div[3] -> h4(小类名) + ul > li > a
    const categories = parseCategoryHTML(html)

    if (categories.length >= 3) {
      console.log(`✅ [分类] 动态抓取到 ${categories.length} 个分类`)
      return {
        success: true,
        categories,
        source: 'xiachufang_web_dynamic',
      }
    }
  } catch (e) {
    console.warn(`⚠️ [分类] 动态抓取失败:`, e.message)
  }

  // 回退: 内置分类
  return {
    success: true,
    categories: [
      { no: '1', name: '家常菜', icon: '🍳' },
      { no: '2', name: '快手菜', icon: '⚡' },
      { no: '3', name: '素食', icon: '🥬' },
      { no: '4', name: '烘焙', icon: '🥐' },
      { no: '5', name: '汤羹', icon: '🍲' },
      { no: '6', name: '凉菜', icon: '🥗' },
      { no: '7', name: '小吃', icon: '🍢' },
      { no: '8', name: '甜品', icon: '🍰' },
      { no: '9', name: '早餐', icon: '🌅' },
      { no: '10', name: '午餐', icon: '🍱' },
      { no: '11', name: '晚餐', icon: '🌙' },
      { no: '12', name: '便当', icon: '🍱' },
    ],
    source: 'built_in',
  }
}

/**
 * 解析分类页面 HTML
 *
 * 基于 xiachufang-api items/category.py 的 DOM 结构：
 *   div.category-container > div
 *     └── div.cates-list
 *         ├── h3            → 一级分类名（如"常见"）
 *         └── div[3]        → 第4个子元素
 *             ├── h4        → 二级分类名（如"热菜"）
 *             └── ul
 *                 └── li > a → 具体类别（name + href）
 */
function parseCategoryHTML(html) {
  const categories = []

  // 查找 cates-list 容器
  const catesListMatch = html.match(/class="cates-list"[^>]*>([\s\S]*?)(?=<\/div>\s*(?:<\/div>|$))/i)
  if (!catesListMatch) return categories

  // 提取一级分类标题 (h3)
  const h3Pattern = /<h3[^>]*>([^<]+)<\/h3>/gi
  let h3Match
  let catIdx = 0

  // 收集所有 h4 和其后的 ul 列表
  const h4Pattern = /<h4[^>]*>([^<]+)<\/h4>[\s\S]*?<ul[^>]*>([\s\S]*?)<\/ul>/gi
  let h4Match

  // 找到每个二级分组
  while ((h4Match = h4Pattern.exec(catesListMatch[1])) !== null) {
    const subCatName = cleanHTML(h4Match[1])
    const ulContent = h4Match[2]

    // 提取该组下的所有类别链接
    const linkPattern = /<li><a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a><\/li>/gi
    let linkMatch
    while ((linkMatch = linkPattern.exec(ulContent)) !== null) {
      const catHref = linkMatch[1]
      const catName = cleanHTML(linkMatch[2])

      // 从 URL 中提取分类编号: /category/xxx/
      const noMatch = catHref.match(/\/category\/(\d+)\//)
      const catNo = noMatch ? noMatch[1] : String(catIdx++)

      categories.push({
        no: catNo,
        name: catName,
        parentName: subCatName,
        icon: getCategoryIcon(catName),
      })
    }
  }

  return categories
}

/** 为分类名称分配 emoji 图标 */
function getCategoryIcon(name) {
  const n = (name || '').toLowerCase()
  if (/肉|排骨|鸡翅|牛肉|猪肉|鸡/.test(n)) return '🍖'
  if (/鱼|虾|蟹|海鲜|鲈鱼|带鱼/.test(n)) return '🐟'
  if (/汤|羹|粥|汁/.test(n)) return '🍲'
  if (/素|蔬|菜|瓜|豆|菌|藻/.test(n)) return '🥬'
  if (/蛋|糕|包|饼|面|饭|粉|饺|面包|吐司/.test(n)) return '🍞'
  if (/甜|布丁|果冻|慕斯|冰淇淋|糖水/.test(n)) return '🍰'
  if (/饮|奶|茶|果汁|豆浆|酒/.test(n)) return '🧋'
  if (/凉|拌|沙拉|腌|泡/.test(n)) return '🥗'
  if (/小|串|炸|烤|锅|丸/.test(n)) return '🍢'
  if (/早餐|早|晨/.test(n)) return '🌅'
  if (/烘|焙|烤|蛋糕|饼干|曲奇|蛋挞|酥/.test(n)) return '🥐'
  if (/快|简|便|速|10分|15分/.test(n)) return '⚡'
  if (/火锅|干锅|烧烤|聚会/.test(n)) return '🎉'
  return '🍳'
}

// ==================== 辅助数据（保持不变） ====================

function getRecipeDesc(name) {
  const descMap = {
    '糖醋排骨': '酸甜可口，外酥里嫩，大人小孩都爱吃',
    '宫保鸡丁': '经典川菜，麻辣鲜香，超级下饭！',
    '红烧肉': '肥而不腻，入口即化的经典硬菜',
    '可乐鸡翅': '甜咸适口，连骨头都香到舔干净！',
    '麻婆豆腐': '麻辣鲜香，米饭的最佳搭档',
    '番茄牛腩煲': '酸甜浓郁的番茄配上软烂入味的牛腩',
    '清蒸鲈鱼': '鲜嫩美味，营养丰富，做法简单又有面子',
    '酸辣土豆丝': '国民级家常菜，酸辣爽脆，零失败',
    '蛋挞': '外酥里嫩，奶香浓郁，比肯德基还好吃',
    '凉拌黄瓜': '清爽解腻，5分钟搞定开胃小菜',
    '玉米排骨汤': '甜香鲜美，老少皆宜的营养汤品',
  }
  return descMap[name] || '一道美味的家常菜'
}

function getCookTime(name) {
  const timeMap = {
    '酸辣土豆丝': 10, '凉拌黄瓜': 5, '蛋炒饭': 8,
    '宫保鸡丁': 20, '可乐鸡翅': 25, '麻婆豆腐': 15,
    '清蒸鲈鱼': 25, '糖醋排骨': 40, '蛋挞': 35,
    '玉米排骨汤': 50, '红烧肉': 60, '番茄牛腩煲': 90,
  }
  return timeMap[name] || 30
}

function getDifficulty(name) {
  const easy = ['酸辣土豆丝', '凉拌黄瓜', '蛋炒饭', '可乐鸡翅']
  const hard = ['红烧肉', '番茄牛腩煲', '牛肉面']
  if (easy.includes(name)) return 'easy'
  if (hard.includes(name)) return 'hard'
  return 'medium'
}

function getTags(name) {
  const tagMap = {
    '糖醋排骨': ['下饭菜', '硬菜', '家常菜'],
    '宫保鸡丁': ['川菜', '下饭菜', '快手'],
    '红烧肉': ['硬菜', '下饭', '宴客菜'],
    '可乐鸡翅': ['下饭菜', '家常菜', '孩子最爱'],
    '麻婆豆腐': ['下饭菜', '川菜', '家常菜'],
    '番茄牛腩煲': ['汤品', '硬菜', '暖身'],
    '清蒸鲈鱼': ['海鲜', '清淡', '宴客菜'],
    '酸辣土豆丝': ['素菜', '快手菜', '下饭'],
    '蛋挞': ['烘焙', '甜品', '下午茶'],
    '凉拌黄瓜': ['凉菜', '低卡', '快手'],
    '玉米排骨汤': ['汤品', '营养', '家常'],
  }
  return tagMap[name] || ['家常菜']
}

function getIngredients(name) {
  const ingMap = {
    '糖醋排骨': [
      { name: '肋排', category: 'meat', amount: 500, unit: 'g', isEssential: true },
      { name: '白糖', category: 'condiment', amount: 30, unit: 'g', isEssential: true },
      { name: '醋', category: 'condiment', amount: 25, unit: 'ml', isEssential: true },
      { name: '料酒', category: 'beverage', amount: 15, unit: 'ml', isEssential: false },
    ],
    '宫保鸡丁': [
      { name: '鸡胸肉', category: 'meat', amount: 300, unit: 'g', isEssential: true },
      { name: '花生米', category: 'other', amount: 80, unit: 'g', isEssential: true },
      { name: '干辣椒', category: 'condiment', amount: 8, unit: '个', isEssential: true },
      { name: '生抽', category: 'condiment', amount: 15, unit: 'ml', isEssential: true },
    ],
    '红烧肉': [
      { name: '五花肉', category: 'meat', amount: 500, unit: 'g', isEssential: true },
      { name: '冰糖', category: 'condiment', amount: 30, unit: 'g', isEssential: true },
      { name: '生抽', category: 'condiment', amount: 20, unit: 'ml', isEssential: true },
      { name: '八角', category: 'condiment', amount: 2, unit: '颗', isEssential: false },
    ],
    '可乐鸡翅': [
      { name: '鸡翅', category: 'meat', amount: 8, unit: '只', isEssential: true },
      { name: '可乐', category: 'beverage', amount: 200, unit: 'ml', isEssential: true },
      { name: '酱油', category: 'condiment', amount: 15, unit: 'ml', isEssential: true },
    ],
    '麻婆豆腐': [
      { name: '豆腐', category: 'vegetable', amount: 1, unit: '盒', isEssential: true },
      { name: '猪肉末', category: 'meat', amount: 100, unit: 'g', isEssential: true },
      { name: '豆瓣酱', category: 'condiment', amount: 15, unit: 'g', isEssential: true },
    ],
    '番茄牛腩煲': [
      { name: '牛腩', category: 'meat', amount: 500, unit: 'g', isEssential: true },
      { name: '西红柿', category: 'vegetable', amount: 3, unit: '个', isEssential: true },
      { name: '番茄酱', category: 'condiment', amount: 30, unit: 'g', isEssential: false },
    ],
    '清蒸鲈鱼': [
      { name: '鲈鱼', category: 'meat', amount: 1, unit: '条', isEssential: true },
      { name: '葱', category: 'vegetable', amount: 2, unit: '根', isEssential: true },
      { name: '蒸鱼豉油', category: 'condiment', amount: 20, unit: 'ml', isEssential: true },
    ],
    '酸辣土豆丝': [
      { name: '土豆', category: 'vegetable', amount: 2, unit: '个', isEssential: true },
      { name: '干辣椒', category: 'condiment', amount: 5, unit: '个', isEssential: true },
      { name: '醋', category: 'condiment', amount: 15, unit: 'ml', isEssential: true },
    ],
    '蛋挞': [
      { name: '蛋挞皮', category: 'other', amount: 12, unit: '个', isEssential: true },
      { name: '鸡蛋', category: 'other', amount: 2, unit: '个', isEssential: true },
      { name: '牛奶', category: 'dairy', amount: 120, unit: 'ml', isEssential: true },
    ],
    '凉拌黄瓜': [
      { name: '黄瓜', category: 'vegetable', amount: 2, unit: '根', isEssential: true },
      { name: '大蒜', category: 'vegetable', amount: 4, unit: '瓣', isEssential: true },
      { name: '醋', category: 'condiment', amount: 10, unit: 'ml', isEssential: true },
    ],
    '玉米排骨汤': [
      { name: '排骨', category: 'meat', amount: 400, unit: 'g', isEssential: true },
      { name: '甜玉米', category: 'vegetable', amount: 2, unit: '根', isEssential: true },
      { name: '姜', category: 'vegetable', amount: 3, unit: '片', isEssential: false },
    ],
  }
  return ingMap[name] || [{ name: '食材', category: 'other', amount: 1, unit: '份', isEssential: true }]
}

function getSteps(name) {
  const stepMap = {
    '糖醋排骨': [
      { order: 1, text: '肋排切成小段，冷水下锅焯水去血沫捞出沥干。' },
      { order: 2, text: '锅中倒油，将排骨煎至两面金黄。' },
      { order: 3, text: '加入料酒、生抽、老抽翻炒上色。' },
      { order: 4, text: '加水没过排骨，大火烧开转小火炖25分钟。' },
      { order: 5, text: '加白糖、醋、番茄酱，大火收汁至浓稠即可。' },
    ],
    '宫保鸡丁': [
      { order: 1, text: '鸡胸肉切丁，加盐、料酒、淀粉腌制10分钟。' },
      { order: 2, text: '花生米炸至金黄酥脆盛出备用。' },
      { order: 3, text: '调碗汁：生抽+醋+糖+淀粉+少许水拌匀。' },
      { order: 4, text: '热锅冷油，爆香干辣椒和花椒。' },
      { order: 5, text: '倒入鸡丁炒至变白，加入葱蒜末炒香。' },
      { order: 6, text: '淋入碗汁翻炒均匀，最后加入花生米即可出锅。' },
    ],
    '红烧肉': [
      { order: 1, text: '五花肉切成3cm见方的块，冷水下锅焯水去血沫捞出。' },
      { order: 2, text: '锅中少油，小火炒化冰糖至焦糖色。' },
      { order: 3, text: '倒入肉块翻炒上色，加料酒去腥。' },
      { order: 4, text: '加生抽、老抽调色，加水没过肉。' },
      { order: 5, text: '放入香料，大火烧开转小火炖40分钟。' },
      { order: 6, text: '最后大火收汁，撒上葱花出锅。' },
    ],
    '可乐鸡翅': [
      { order: 1, text: '鸡翅两面划几刀，焯水去腥捞出。' },
      { order: 2, text: '煎锅少油，将鸡翅煎至两面金黄。' },
      { order: 3, text: '倒入可乐没过鸡翅，加酱油、姜片。' },
      { order: 4, text: '大火烧开转中小火焖煮15分钟。' },
      { order: 5, text: '开大火收浓汤汁即可。' },
    ],
    '麻婆豆腐': [
      { order: 1, text: '豆腐切小块，盐水焯一下捞出。' },
      { order: 2, text: '热锅炒散肉末至变色，加豆瓣酱炒出红油。' },
      { order: 3, text: '加水烧开，放入豆腐轻轻推匀。' },
      { order: 4, text: '水淀粉勾芡收浓汤汁。' },
      { order: 5, text: '撒花椒粉、辣椒粉、葱花即可。' },
    ],
    '番茄牛腩煲': [
      { order: 1, text: '牛腩切小块焯水去血沫。' },
      { order: 2, text: '西红柿顶部划十字，开水烫一下去皮切块。' },
      { order: 3, text: '锅中炒香姜片，放牛腩翻炒加料酒。' },
      { order: 4, text: '加水没过牛腩，炖40分钟至软烂。' },
      { order: 5, text: '加入西红柿和番茄酱，再炖20分钟。' },
    ],
    '清蒸鲈鱼': [
      { order: 1, text: '鲈鱼处理干净，两面划几刀，抹上料酒和盐腌10分钟。' },
      { order: 2, text: '盘底铺姜片葱段，放上鱼，鱼身上再放几片姜。' },
      { order: 3, text: '水开后上锅蒸8-10分钟（视鱼大小调整）。' },
      { order: 4, text: '倒掉蒸出的水，捡去旧葱姜，铺上新葱丝姜丝。' },
      { order: 5, text: '淋蒸鱼豉油，烧热油浇在葱丝上即可～滋啦一声超香！' },
    ],
    '酸辣土豆丝': [
      { order: 1, text: '土豆切成细丝，用清水冲洗两遍去除淀粉，沥干备用。' },
      { order: 2, text: '干辣椒剪成段，蒜切片备用。' },
      { order: 3, text: '热锅多倒点油，爆香干辣椒、花椒和蒜片。' },
      { order: 4, text: '倒入土豆丝大火快炒2分钟至断生。' },
      { order: 5, text: '沿锅边淋入醋，加盐调味翻炒均匀即可出锅。' },
    ],
    '蛋挞': [
      { order: 1, text: '烤箱预热200°C。蛋挞皮提前解冻。' },
      { order: 2, text: '鸡蛋打散加入牛奶、淡奶油、白糖搅拌均匀。' },
      { order: 3, text: '过筛一遍让蛋挞液更细腻。' },
      { order: 4, text: '将蛋挞液倒入蛋挞皮中，约八分满。' },
      { order: 5, text: '送入烤箱中层200°C烤20-25分钟至上焦黄即可。' },
    ],
    '凉拌黄瓜': [
      { order: 1, text: '黄瓜洗净拍碎切段（拍出来的更入味）。' },
      { order: 2, text: '大蒜拍碎切末放在黄瓜上。' },
      { order: 3, text: '加入盐、醋、香油拌匀。' },
      { order: 4, text: '可以根据喜好加点辣椒油或花椒油。' },
    ],
    '玉米排骨汤': [
      { order: 1, text: '排骨冷水下锅焯水去血沫，捞出洗净。' },
      { order: 2, text: '玉米切段，胡萝卜滚刀切块。' },
      { order: 3, text: '砂锅中放入排骨、姜片、料酒，加足量水。' },
      { order: 4, text: '大火烧开后转小火炖30分钟。' },
      { order: 5, text: '放入玉米和胡萝卜继续炖15分钟，加盐调味即可。' },
    ],
  }
  return stepMap[name] || [{ order: 1, text: '请查看完整做法步骤', image: null }]
}

// ==================== 工具函数 ====================

function extractTags(content) {
  const name = (content || '').toLowerCase()
  const tags = []

  if (/汤|羹|汁/.test(name)) tags.push('汤品')
  if (/蛋糕|面包|饼|塔|酥|饼干|曲奇|蛋挞/.test(name)) tags.push('烘焙')
  if (/沙拉|蔬果|果盘|拌/.test(name)) tags.push('轻食')
  if (/火锅|串|烧烤|烤|炸/.test(name)) tags.push('聚会')
  if (/粥|饭|粉|面|米线|意面/.test(name)) tags.push('主食')
  if (/糖|巧克力|布丁|慕斯|奶油|奶冻|冰淇淋/.test(name)) tags.push('甜品')
  if (/蒸|清|白灼|凉拌|水煮/.test(name)) tags.push('清淡')
  if (/辣|麻|椒|川|湘/.test(name)) tags.push('下饭')

  if (tags.length === 0) tags.push('家常菜')
  return tags.slice(0, 3)
}

function guessCategory(name) {
  const n = (name || '').toLowerCase()

  if (/猪|牛|羊|鸡|鸭|鱼|虾|蟹|肉|排|翅|腿|腩|里脊|.肉/.test(n)) return 'meat'
  if (/奶|酪|酸奶|奶油|乳/.test(n)) return 'dairy'
  if (/菜|瓜|豆|萝|菠|芹|茄|椒|笋|葱|蒜|姜|韭菜|白菜|西兰花|芦笋/.test(n)) return 'vegetable'
  if (/苹果|香蕉|橙|柠檬|草莓|葡萄|桃|梨|芒果|猕猴桃|西瓜|蓝莓/.test(n)) return 'fruit'
  if (/可乐|果汁|酒|茶|咖啡|豆浆|牛奶|饮料|椰汁|奶茶/.test(n)) return 'beverage'
  if (/盐|糖|酱油|醋|油|酱|料|椒|粉|咖喱|蕃|芝麻/.test(n)) return 'condiment'

  return 'other'
}
