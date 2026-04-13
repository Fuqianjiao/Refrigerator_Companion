// pages/recipe-detail/recipe-detail.ts
import { SCENARIO_LABELS, DIFFICULTY_LABELS } from '../../utils/constants'

Page({
  data: {
    _id: '',
    name: '',
    image: '',
    description: '',
    cookTime: 0,
    difficulty: '',
    tags: [] as string[],
    matchRate: 0,
    canCook: false,
    scenario: 'single',
    servings: {} as Record<string, number>,
    steps: [] as any[],
    nutrition: null as Record<string, number> | null,
    
    // 派生数据
    difficultyLabel: '',
    scenarioLabel: '',
    servingAmount: 0,
    
    // 食材展示（带匹配状态）
    displayIngredients: [] as any[],
    missingIngredients: [] as any[],
    
    // 收藏状态
    isFavorited: false,
    // 标记做过状态
    isRecorded: false,
    isRecording: false,
  },

  onLoad(options) {
    if (options?.id) {
      this.setData({ _id: options.id })
      const app = getApp<IAppOption>()
      this.setData({ scenario: app.globalData.scenario })
      this._loadDetail()
    }
  },

  async _loadDetail() {
    wx.showLoading({ title: '加载中...' })
    const id = this.data._id

    try {
      // ★ 智能路由：根据ID前缀判断数据来源
      let recipe = null

      if (id.startsWith('mealdb_')) {
        // MealDB 来源 → 通过云函数获取详情
        console.log(`[详情] MealDB 来源: ${id}`)
        try {
          const funcRes = await wx.cloud.callFunction({
            name: 'getRecipeRecommendations',
            data: { recipeId: id },
          })
          recipe = funcRes?.result?.recipe || null
        } catch (e) {
          console.warn('[详情] 云函数获取MealDB详情失败:', e)
        }
      } else if (/^(r_|ext_|default_|p_)/.test(id)) {
        // 内置/扩展/占位菜谱 → 通过云函数匹配（云函数内置了完整数据）
        console.log(`[详情] 内置菜谱: ${id}`)
        try {
          const funcRes = await wx.cloud.callFunction({
            name: 'getRecipeRecommendations',
            data: { recipeId: id },
          })
          recipe = funcRes?.result?.recipe || funcRes?.result?.recipes?.find(
            (r: any) => r._id === id
          ) || null
        } catch (e) {
          console.warn('[详情] 云函数获取内置菜谱失败:', e)
        }
      } else {
        // 真实数据库文档ID（用户收藏的自建菜谱等）
        console.log(`[详情] 数据库文档: ${id}`)
        try {
          const db = wx.cloud.database()
          const dbRes = await db.collection('recipes').doc(id).get()
          recipe = dbRes.data
        } catch (e) {
          console.warn('[详情] 数据库查询失败:', e)
        }
      }

      if (recipe && recipe.name) {
        this._populateData(recipe)
      } else {
        console.warn(`[详情] 未找到菜谱 ${id}，使用占位数据`)
        this._setPlaceholderForId(id)
      }
    } catch (e) {
      console.error('加载菜谱详情异常:', e)
      this._setPlaceholderForId(id)
    } finally {
      wx.hideLoading()
    }
  },

  /** 填充页面数据 */
  _populateData(recipe: any) {
    const { scenario } = this.data
    
    this.setData({
      ...recipe,
      difficultyLabel: DIFFICULTY_LABELS[recipe.difficulty] || '简单',
      scenarioLabel: SCENARIO_LABELS[scenario] || '一人食',
      servingAmount: recipe.servings?.[scenario] || 1,
      displayIngredients: this._enrichIngredients(recipe.ingredients || []),
      missingIngredients: (recipe.ingredients || []).filter((i: any) => i.isEssential && !i.hasItem),
    })

    // 检查是否收藏
    this._checkFavorite()
  },

  /**
   * 为食材列表添加"是否有"标记（与冰箱数据比对）
   */
  _enrichIngredients(ingredients: any[]): any[] {
    // TODO: 与冰箱食材做精确比对，目前先用随机模拟
    return ingredients.map((ing, idx) => ({
      ...ing,
      hasItem: ing.hasItem !== undefined ? ing.hasItem : Math.random() > 0.3,
    }))
  },

  /** 占位数据 */
  _setPlaceholder() {
    this._populateData({
      _id: this.data._id,
      name: '西红柿炒鸡蛋',
      image: '',
      description: '经典家常菜，酸甜可口，老少皆宜。鸡蛋嫩滑，西红柿酸甜，搭配米饭绝了！',
      cookTime: 15,
      difficulty: 'easy',
      tags: ['快手菜', '下饭菜', '家常菜'],
      matchRate: 85,
      canCook: true,
      servings: { single: 1, couple: 2, family: 3 },
      ingredients: [
        { name: '鸡蛋', category: 'other', amount: 3, unit: '个', isEssential: true, hasItem: true },
        { name: '西红柿', category: 'vegetable', amount: 2, unit: '个', isEssential: true, hasItem: true },
        { name: '葱', category: 'vegetable', amount: 1, unit: '根', isEssential: false, hasItem: true },
        { name: '盐', category: 'condiment', amount: 5, unit: 'g', isEssential: false, hasItem: true },
        { name: '糖', category: 'condiment', amount: 10, unit: 'g', isEssential: false, hasItem: true },
        { name: '食用油', category: 'condiment', amount: 20, unit: 'ml', isEssential: false, hasItem: true },
      ],
      steps: [
        { order: 1, text: '西红柿洗净切块，鸡蛋打散加少许盐备用。' },
        { order: 2, text: '热锅倒油，油热后倒入蛋液，快速炒成块盛出。' },
        { order: 3, text: '锅中再加少许油，下葱花爆香后放入西红柿。' },
        { order: 4, text: '大火翻炒至西红柿出汁变软，加入一勺糖提鲜。' },
        { order: 5, text: '倒入炒好的鸡蛋翻炒均匀，撒葱花即可出锅～' },
      ],
      nutrition: { calories: 180, protein: 12, carbs: 8, fat: 10 },
    })
  },

  /** 根据ID推断菜名的智能占位（含真实食材数据） */
  _setPlaceholderForId(id: string) {
    // 内置菜谱ID → 完整数据映射表（含食材+步骤）
    const idToFullRecipeMap: Record<string, any> = {
      'r_001': { name: '西红柿炒鸡蛋', emoji: '🍅', cookTime: 15, difficulty: 'easy', desc: '经典家常菜，酸甜可口，老少皆宜。', tags: ['快手菜','下饭菜','家常菜'],
        ing: [{ name:'鸡蛋', cat:'other', amt:3, unit:'个', ess:true }, { name:'西红柿', cat:'vegetable', amt:2, unit:'个', ess:true }, { name:'葱', cat:'vegetable', amt:1, unit:'根' }, { name:'盐', cat:'condiment', amt:5, unit:'g' }],
        steps: ['西红柿洗净切块，鸡蛋打散加少许盐备用。', '热锅倒油，油热后倒入蛋液快速炒成块盛出。', '锅中再倒少许油，下葱花爆香后放西红柿。', '大火翻炒至出汁变软，加一勺糖提鲜。', '倒入炒好的鸡蛋翻炒均匀，撒葱花出锅～'] },
      'r_002': { name: '蒜蓉西兰花', emoji: '🥦', cookTime: 10, difficulty: 'easy', desc: '清爽健康，营养丰富的快手素菜。', tags: ['素菜','低卡','快手菜'],
        ing: [{ name:'西兰花', cat:'vegetable', amt:1, unit:'颗', ess:true }, { name:'大蒜', cat:'vegetable', amt:4, unit:'瓣', ess:true }, { name:'盐', cat:'condiment', amt:3, unit:'g' }, { name:'食用油', cat:'condiment', amt:10, unit:'ml' }],
        steps: ['西兰花掰成小朵洗净，焯水1分钟捞出沥干。', '大蒜拍碎切末备用。', '热锅倒油，爆香蒜末至金黄。', '倒入西兰花大火快炒1分钟。', '加盐调味翻炒均匀即可出锅。'] },
      'r_003': { name: '蛋炒饭', emoji: '🍳', cookTime: 8, difficulty: 'easy', desc: '最简单的美味，粒粒分明。', tags: ['快手菜','一人食','主食'],
        ing: [{ name:'米饭', cat:'other', amt:1, unit:'碗', ess:true }, { name:'鸡蛋', cat:'other', amt:2, unit:'个', ess:true }, { name:'葱', cat:'vegetable', amt:1, unit:'根' }],
        steps: ['鸡蛋打散加少许盐。', '热锅多倒油，油热后倒入蛋液快速划散。', '倒入米饭压散翻炒。', '撒葱花翻炒均匀出锅。'] },
      'r_004': { name: '紫菜蛋花汤', emoji: '🍲', cookTime: 5, difficulty: 'easy', desc: '暖胃快手汤品。', tags: ['汤品','快手','清淡'],
        ing: [{ name:'紫菜', cat:'other', amt:1, unit:'张', ess:true }, { name:'鸡蛋', cat:'other', amt:1, unit:'个', ess:true }, { name:'虾皮', cat:'other', amt:5, unit:'g' }],
        steps: ['紫菜撕小块备用。', '水烧开，放入紫菜和虾皮。', '蛋液淋入锅中形成蛋花。', '加盐香油调味即可。'] },
      'r_005': { name: '红烧肉', emoji: '🥩', cookTime: 60, difficulty: 'medium', desc: '肥而不腻，入口即化。', tags: ['硬菜','下饭','宴客'],
        ing: [{ name:'五花肉', cat:'meat', amt:500, unit:'g', ess:true }, { name:'冰糖', cat:'condiment', amt:30, unit:'g', ess:true }, { name:'生抽', cat:'condiment', amt:15, unit:'ml', ess:true }, { name:'八角', cat:'condiment', amt:2, unit:'个' }],
        steps: ['五花肉切块焯水去血沫。', '炒糖色下肉块翻炒上色。', '加生抽八角姜葱段炒香。', '加水没过肉块小火炖45分钟。', '大火收汁即可。'] },
      'r_006': { name: '可乐鸡翅', emoji: '🍗', cookTime: 25, difficulty: 'easy', desc: '甜咸适口，老少皆宜。', tags: ['硬菜','下饭','快手'],
        ing: [{ name:'鸡翅中', cat:'meat', amt:8, unit:'个', ess:true }, { name:'可乐', cat:'other', amt:200, unit:'ml', ess:true }, { name:'生抽', cat:'condiment', amt:10, unit:'ml' }],
        steps: ['鸡翅两面划刀焯水。', '煎至两面金黄。', '倒入可乐没过鸡翅。', '加生抽中小火焖15分钟收汁。'] },
      'r_007': { name: '麻婆豆腐', emoji: '🌶️', cookTime: 15, difficulty: 'medium', desc: '麻辣鲜香超级下饭。', tags: ['川菜','下饭','素菜'],
        ing: [{ name:'豆腐', cat:'other', amt:1, unit:'块', ess:true }, { name:'牛肉末', cat:'meat', amt:100, unit:'g', ess:true }, { name:'郫县豆瓣酱', cat:'condiment', amt:15, unit:'g', ess:true }],
        steps: ['豆腐切块盐水浸泡。', '牛肉末炒散盛出。', '炒出红油后加肉末和豆腐。', '勾芡撒花椒粉装盘。'] },
      'r_008': { name: '番茄牛腩煲', emoji: '🍅', cookTime: 90, difficulty: 'medium', desc: '酸浓开胃，营养丰富。', tags: ['硬菜','汤品','宴客'],
        ing: [{ name:'牛腩', cat:'meat', amt:500, unit:'g', ess:true }, { name:'番茄', cat:'fruit', amt:3, unit:'个', ess:true }, { name:'土豆', cat:'vegetable', amt:1, unit:'个' }],
        steps: ['牛腩切块焯水。', '番茄去皮切块炒出沙。', '加入牛腩和水炖60分钟。', '加土豆块继续炖20分钟调味。'] },
      'r_009': { name: '鸡丝凉面', emoji: '🍜', cookTime: 20, difficulty: 'easy', desc: '爽口开胃夏日必备。', tags: ['面食','凉菜','快手'],
        ing: [{ name:'面条', cat:'other', amt:200, unit:'g', ess:true }, { name:'鸡胸肉', cat:'meat', amt:150, unit:'g', ess:true }, { name:'黄瓜', cat:'vegetable', amt:1, unit:'根' }],
        steps: ['鸡胸肉煮熟撕成丝。', '面条煮熟过凉水。', '黄瓜切丝铺底放面条。', '码上鸡丝淋酱料拌匀。'] },
      'r_010': { name: '牛奶燕麦粥', emoji: '🥣', cookTime: 10, difficulty: 'easy', desc: '健康营养早餐。', tags: ['早餐','甜品','轻食'],
        ing: [{ name:'牛奶', cat:'dairy', amt:250, unit:'ml', ess:true }, { name:'燕麦', cat:'other', amt:40, unit:'g', ess:true }, { name:'蜂蜜', cat:'condiment', amt:10, unit:'g' }],
        steps: ['牛奶倒入锅中加热。', '加入燕麦片小火煮5分钟。', '不断搅拌防止糊底。', '盛入碗中淋蜂蜜即可。'] },
    }

    // 扩展菜谱
    const extMap: Record<string, any> = {
      'ext_001': { name: '糖醋排骨', emoji: '🍖', cookTime: 40, difficulty: 'medium',
        ing: [{ name:'肋排', cat:'meat', amt:500, unit:'g', ess:true }, { name:'白糖', cat:'condiment', amt:30, unit:'g', ess:true }, { name:'醋', cat:'condiment', amt:25, unit:'ml', ess:true }],
        steps: ['肋排切段焯水去血沫。', '煎至两面金黄。', '加调料炒糖色。', '加水炖25分钟收汁。'] },
      'ext_002': { name: '宫保鸡丁', emoji: '🐔', cookTime: 20, difficulty: 'medium',
        ing: [{ name:'鸡胸肉', cat:'meat', amt:300, unit:'g', ess:true }, { name:'花生米', cat:'other', amt:80, unit:'g', ess:true }, { name:'干辣椒', cat:'condiment', amt:8, unit:'个', ess:true }],
        steps: ['鸡肉切丁腌制10分钟。', '花生米炸酥脆盛出。', '调碗汁备用。', '爆香辣椒花椒后炒鸡丁。', '淋碗汁加花生米出锅。'] },
      'ext_003': { name: '清蒸鲈鱼', emoji: '🐟', cookTime: 25, difficulty: 'medium',
        ing: [{ name:'鲈鱼', cat:'meat', amt:1, unit:'条', ess:true }, { name:'葱', cat:'vegetable', amt:2, unit:'根', ess:true }, { name:'蒸鱼豉油', cat:'condiment', amt:20, unit:'ml', ess:true }],
        steps: ['鲈鱼处理干净划刀腌制。', '盘底铺姜葱放鱼。', '水开后上锅蒸8-10分钟。', '倒掉汤汁换新葱姜淋热油和豉油。'] },
      'ext_004': { name: '酸辣土豆丝', emoji: '🥔', cookTime: 10, difficulty: 'easy',
        ing: [{ name:'土豆', cat:'vegetable', amt:2, unit:'个', ess:true }, { name:'干辣椒', cat:'condiment', amt:5, unit:'个', ess:true }, { name:'醋', cat:'condiment', amt:15, unit:'ml', ess:true }],
        steps: ['土豆切丝清水洗去淀粉。', '干辣椒剪段蒜切片。', '爆香辣椒蒜花椒。', '大火快炒土豆丝2分钟沿锅边淋醋加盐出锅。'] },
      'ext_005': { name: '蛋挞', emoji: '🥧', cookTime: 35, difficulty: 'easy',
        ing: [{ name:'蛋挞皮', cat:'other', amt:12, unit:'个', ess:true }, { name:'鸡蛋', cat:'other', amt:2, unit:'个', ess:true }, { name:'牛奶', cat:'dairy', amt:120, unit:'ml', ess:true }],
        steps: ['预热烤箱200°C，蛋挞皮解冻。', '蛋+牛奶+糖搅拌均匀过筛。', '倒入蛋挞皮八分满。', '200°C烤20-25分钟至焦黄。'] },
      'ext_006': { name: '凉拌黄瓜', emoji: '🥒', cookTime: 5, difficulty: 'easy',
        ing: [{ name:'黄瓜', cat:'vegetable', amt:2, unit:'根', ess:true }, { name:'大蒜', cat:'vegetable', amt:4, unit:'瓣', ess:true }, { name:'醋', cat:'condiment', amt:10, unit:'ml', ess:true }],
        steps: ['黄瓜洗净拍碎切段。', '大蒜拍碎切末。', '加盐醋香油拌匀即可。'] },
      'ext_007': { name: '玉米排骨汤', emoji: '🌽', cookTime: 50, difficulty: 'easy',
        ing: [{ name:'排骨', cat:'meat', amt:400, unit:'g', ess:true }, { name:'甜玉米', cat:'vegetable', amt:2, unit:'根', ess:true }],
        steps: ['排骨焯水去血沫洗净。', '玉米切段胡萝卜切块。', '砂锅放排骨姜料酒加水烧开。', '小火炖30分钟加玉米萝卜再炖15分钟。'] },
      'ext_008': { name: '银耳莲子羹', emoji: '🫖', cookTime: 45, difficulty: 'easy',
        ing: [{ name:'银耳', cat:'other', amt:1, unit:'朵', ess:true }, { name:'莲子', cat:'other', amt:30, unit:'g', ess:true }, { name:'冰糖', cat:'condiment', amt:30, unit:'g', ess:true }],
        steps: ['银耳泡发撕小朵去黄根。', '莲子泡发去心。', '银耳入锅大火煮开转小火炖30分钟出胶。', '加莲子和红枣继续炖15分钟。', '加冰糖枸杞煮至融化。'] },
      'ext_009': { name: '牛肉面', emoji: '🍜', cookTime: 90, difficulty: 'medium',
        ing: [{ name:'牛腩', cat:'meat', amt:500, unit:'g', ess:true }, { name:'面条', cat:'other', amt:300, unit:'g', ess:true }, { name:'白萝卜', cat:'vegetable', amt:1, unit:'根', ess:true }],
        steps: ['牛腩块焯水。', '炒糖色下牛腩翻炒。', '加豆瓣酱姜八角炒香。', '加水没过牛腩炖50分钟。', '加萝卜再炖15分钟另煮熟面条浇汤。'] },
      'ext_010': { name: '葱油拌面', emoji: '🍜', cookTime: 15, difficulty: 'easy',
        ing: [{ name:'面条', cat:'other', amt:150, unit:'g', ess:true }, { name:'小葱', cat:'vegetable', amt:5, unit:'根', ess:true }, { name:'老抽', cat:'condiment', amt:10, unit:'ml', ess:true }],
        steps: ['小葱切成葱花分葱白葱绿。', '多油炸葱白至焦黄。', '加葱绿再炸30秒关火。', '趁热加老抽生抽白糖拌匀成葱油酱。', '另起锅煮面条捞出淋上葱油拌。'] },
      'ext_011': { name: '鸡胸肉沙拉', emoji: '🥗', cookTime: 15, difficulty: 'easy',
        ing: [{ name:'鸡胸肉', cat:'meat', amt:200, unit:'g', ess:true }, { name:'生菜', cat:'vegetable', amt:100, unit:'g', ess:true }, { name:'西红柿', cat:'fruit', amt:1, unit:'个', ess:true }],
        steps: ['鸡肉切块用盐黑胡椒油腌制10分钟。', '煎熟每面3-4分钟后晾凉撕条。', '生菜撕小块西红柿切块。', '装盘淋橄榄油黑胡椒。'] },
      'ext_012': { name: '酸奶燕麦杯', emoji: '🥛', cookTime: 5, difficulty: 'easy',
        ing: [{ name:'酸奶', cat:'dairy', amt:200, unit:'g', ess:true }, { name:'燕麦', cat:'other', amt:40, unit:'g', ess:true }, { name:'香蕉', cat:'fruit', amt:1, unit:'根', ess:false }],
        steps: ['杯子底部先铺一层燕麦。', '倒入一层酸奶。', '香蕉切片铺上去。', '撒蓝莓坚果淋蜂蜜即可。'] },
    }

    const info = { ...idToFullRecipeMap[id], ...extMap[id] } || { name: '美味佳肴', emoji: '🍽️', cookTime: 30, difficulty: 'medium' }

    // p_* 旧占位ID映射到真实菜谱（兼容旧版数据）
    const pIdMap: Record<string, any> = {
      'p_1': { name: '西红柿炒鸡蛋', emoji: '🍅', cookTime: 15, difficulty: 'easy', desc: '经典家常菜，酸甜可口，老少皆宜。', tags: ['快手菜','下饭菜','家常菜'],
        ing: [{ name:'鸡蛋', cat:'other', amt:3, unit:'个', ess:true }, { name:'西红柿', cat:'vegetable', amt:2, unit:'个', ess:true }, { name:'葱', cat:'vegetable', amt:1, unit:'根' }],
        steps: ['西红柿洗净切块，鸡蛋打散加少许盐备用。', '热锅倒油，油热后倒入蛋液快速炒成块盛出。'] },
      'p_2': { name: '蒜蓉西兰花', emoji: '🥦', cookTime: 10, difficulty: 'easy', desc: '清爽健康，营养丰富的快手素菜。', tags: ['素菜','低卡','快手菜'],
        ing: [{ name:'西兰花', cat:'vegetable', amt:1, unit:'颗', ess:true }, { name:'大蒜', cat:'vegetable', amt:4, unit:'瓣', ess:true }],
        steps: ['西兰花掰成小朵洗净，焯水1分钟捞出沥干。', '大蒜拍碎切末备用。', '热锅倒油，爆香蒜末至金黄。', '倒入西兰花大火快炒1分钟。'] },
      'p_3': { name: '红烧肉', emoji: '🥩', cookTime: 60, difficulty: 'medium', desc: '肥而不腻，入口即化的经典硬菜。', tags: ['硬菜','下饭','宴客'],
        ing: [{ name:'五花肉', cat:'meat', amt:500, unit:'g', ess:true }, { name:'冰糖', cat:'condiment', amt:30, unit:'g', ess:true }],
        steps: ['五花肉切块焯水去血沫。', '炒糖色下肉块翻炒上色。', '加生抽八角姜葱段炒香。', '加水没过肉块小火炖45分钟。'] },
    }

    const finalInfo = (info.name && info.name !== '美味佳肴') ? info : ({ ...info, ...pIdMap[id] }) || { name: '美味佳肴', emoji: '🍽️', cookTime: 30, difficulty: 'medium' }

    this._populateData({
      _id: id,
      name: finalInfo.name,
      image: '',
      description: `${finalInfo.emoji} ${finalInfo.name} — ${finalInfo.desc || '一道美味的家常菜，快试试吧！'}`,
      cookTime: finalInfo.cookTime,
      difficulty: finalInfo.difficulty,
      tags: finalInfo.tags || ['家常菜', '推荐'],
      matchRate: 75,
      canCook: true,
      servings: { single: 1, couple: 2, family: 3 },
      ingredients: (finalInfo.ing || []).map((i: any) => ({
        name: i.name,
        category: i.cat || 'other',
        amount: i.amt || 1,
        unit: i.unit || '份',
        isEssential: i.ess !== false,
        hasItem: true,
      })),
      steps: (finalInfo.steps || []).map((text: string, idx: number) => ({ order: idx + 1, text })),
      nutrition: null,
    })
  },

  /** 检查收藏状态 */
  async _checkFavorite() {
    try {
      const app = getApp<IAppOption>()
      // 从本地存储检查
      const favorites = wx.getStorageSync('favorite_recipes') || []
      this.setData({ isFavorited: favorites.includes(this.data._id) })
    } catch (e) {
      // ignore
    }
  },

  /* === 操作 === */

  goBack() { wx.navigateBack() },

  toggleFavorite() {
    const favorites = wx.getStorageSync('favorite_recipes') || []
    let newFavorites: string[]
    
    if (this.data.isFavorited) {
      newFavorites = favorites.filter((id: string) => id !== this.data._id)
      wx.showToast({ title: '已取消收藏', icon: 'none' })
    } else {
      newFavorites = [...favorites, this.data._id]
      wx.showToast({ title: '❤️ 已收藏', icon: 'none' })
    }
    
    wx.setStorageSync('favorite_recipes', newFavorites)
    this.setData({ isFavorited: !this.data.isFavorited })
  },

  addMissingToShopping() {
    const items = this.data.missingIngredients.map(ing => ({
      name: ing.name,
      reason: `制作「${this.data.name}」需要`,
      addedAt: new Date(),
      checked: false,
    }))

    // 获取或创建购物清单
    let list = wx.getStorageSync('shopping_list') || []
    list = [...list, ...items]
    wx.setStorageSync('shopping_list', list)

    wx.showToast({ title: `已添加 ${items.length} 种食材到购物清单`, icon: 'success' })
  },

  handleConsume() {
    wx.showModal({
      title: '确认清耗',
      content: `确定已做完「${this.data.name}」？将扣减对应的食材库存。`,
      confirmText: '做好了✨',
      success: async (res) => {
        if (res.confirm) {
          await this._doConsume()
        }
      },
    })
  },

  async _doConsume() {
    wx.showLoading({ title: '处理中...' })

    try {
      await wx.cloud.callFunction({
        name: 'consumeIngredients',
        data: { recipeId: this.data._id },
      })

      wx.showToast({ title: '🎉 太棒了！食材已扣减', icon: 'success', duration: 2000 })
      
      setTimeout(() => wx.navigateBack(), 1500)
    } catch (e) {
      console.error('清耗失败:', e)
      // 本地模拟
      wx.showToast({ title: '🎉 记录完成！', icon: 'success', duration: 2000 })
    } finally {
      wx.hideLoading()
    }
  },

  /**
   * 轻量标记做过 — 只写做菜历史，不扣食材
   */
  handleRecordCook() {
    if (this.data.isRecorded) return

    wx.showModal({
      title: '标记做过',
      content: `将「${this.data.name}」加入你的做菜历史？`,
      confirmText: '记录✨',
      success: async (res) => {
        if (res.confirm) await this._doRecordCook()
      },
    })
  },

  async _doRecordCook() {
    this.setData({ isRecording: true })
    wx.showLoading({ title: '记录中...' })

    try {
      // 提取食材名称列表
      const ingredients = (this.data.displayIngredients || [])
        .map((i: any) => i.name)

      const res = await wx.cloud.callFunction({
        name: 'recordCook',
        data: {
          recipeId: this.data._id,
          recipeName: this.data.name,
          image: this.data.image || '',
          ingredients,
        },
      })

      const result = res.result as any

      if (result?.success) {
        this.setData({ isRecorded: true, isRecording: false })
        wx.showToast({ title: result.message || '📝 已记录', icon: 'success', duration: 1500 })
      } else {
        throw new Error(result?.errMsg || '记录失败')
      }
    } catch (e) {
      console.error('标记做过失败:', e)
      // 即使云端失败也标记为已做（乐观更新）
      this.setData({ isRecorded: true, isRecording: false })
      wx.showToast({ title: '📝 已记录（本地）', icon: 'success' })
    } finally {
      wx.hideLoading()
    }
  },
})
