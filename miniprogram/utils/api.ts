/* ============================================
   🧊 FridgeMate - 云函数调用封装
   ============================================ */

interface CloudResult<T = any> {
  result: T
  errMsg: string
}

/**
 * 调用云函数的通用方法
 */
export async function callFunction<T = any>(
  name: string,
  data?: Record<string, any>
): Promise<CloudResult<T>> {
  try {
    const res = await wx.cloud.callFunction({
      name,
      data: data || {},
    })
    return res as unknown as CloudResult<T>
  } catch (err: any) {
    console.error(`☁️ 云函数 [${name}] 调用失败:`, err)
    return { result: null, errMsg: err.errMsg || '网络异常，请稍后重试' }
  }
}

// === 登录相关（四期新增）===

/**
 * 静默登录 — 获取 openid + 用户信息（无需用户授权）
 * 首次调用会自动创建用户记录
 */
export async function silentLogin() {
  return callFunction<{ success: boolean; isNewUser: boolean; user: any }>('login', {
    action: 'silentLogin',
  })
}

/**
 * 更新用户资料（昵称+头像）
 */
export async function updateUserProfile(nickName: string, avatarUrl: string) {
  return callFunction('login', {
    action: 'updateProfile',
    nickName,
    avatarUrl,
  })
}

// === 食材相关 ===

/** 添加食材 */
export async function addFoodItem(data: Record<string, any>) {
  return callFunction('addFoodItem', data)
}

/** 扫码识别 */
export async function scanBarcode(barcode: string) {
  return callFunction('scanBarcode', { barcode })
}

// === 菜谱相关 ===

/** 获取推荐菜谱 */
export async function getRecipeRecommendations(scenario?: string, options?: Record<string, any>) {
  return callFunction('getRecipeRecommendations', { scenario, ...options })
}

/** 从 TheMealDB 获取海外菜谱 */
export async function fetchMealDBRecipes(action: string, data?: Record<string, any>) {
  return callFunction('fetchMealDB', { action, ...data })
}

/** 从下厨房获取更多菜谱（已废弃，保留兼容） */
export async function fetchXiachufangRecipes(action: 'search' | 'category' | 'detail' | 'categories', data?: Record<string, any>) {
  // 已迁移到 TheMealDB，此处调用 MealDB 对应接口
  return callFunction('fetchMealDB', { action: 'searchByName', keyword: data?.keyword || data?.categoryNo || '' })
}

// === TheMealDB 海外菜谱（免费英文菜谱 API）===

/**
 * 从 TheMealDB 搜索/获取海外菜谱
 * 封装了 fetchMealDB 云函数，支持搜索、筛选、随机推荐等
 */
export async function fetchMealDB(action: string, params?: Record<string, any>) {
  return callFunction('fetchMealDB', { action, ...params })
}

/**
 * 拍照AI识别食材
 */
export async function recognizeFood(imagePath: string) {
  return callFunction('recognizeFood', { imagePath })
}

/**
 * 请求订阅消息（到期提醒）
 */
export async function requestExpirySubscribe() {
  // 模板ID需要在小程序管理后台申请
  const templateId = wx.getStorageSync('expiry_template_id') || '7NgIlrsfNldH8whWLPkoWGJV2SJnom-rjmIu9GUSK-4'
  if (!templateId) {
    return { errMsg: '订阅消息模板未配置' } as any
  }
  
  return new Promise((resolve) => {
    wx.requestSubscribeMessage({
      tmplIds: [templateId],
      success: (res) => resolve(res as any),
      fail: (err) => resolve(err as any),
    })
  })
}

/** 保存用户通知设置（是否开启到期提醒） */
export async function saveNotifySettings(enabled: boolean, daysBefore: number = 3) {
  try {
    await wx.cloud.callFunction({
      name: 'saveUserSettings',
      data: { notifyEnabled: enabled, notifyDaysBefore: daysBefore },
    })
    wx.setStorageSync('notify_enabled', enabled)
    wx.setStorageSync('notify_days_before', daysBefore)
    return { success: true }
  } catch (e: any) {
    // 本地保存兜底
    wx.setStorageSync('notify_enabled', enabled)
    wx.setStorageSync('notify_days_before', daysBefore)
    return { success: true, fallback: true }
  }
}

/** 一键清耗食材 */
export async function consumeIngredients(recipeId: string) {
  return callFunction('consumeIngredients', { recipeId })
}

// === 品牌相关 ===

/** 搜索品牌保质期 */
export async function searchBrandProduct(keyword: string) {
  return callFunction('searchBrandProduct', { keyword })
}

// === 共享相关 ===

/** 生成邀请码/创建共享组 */
export async function createInviteCode() {
  return callFunction('inviteShare', {})
}

/** 接受共享邀请（传入邀请码） */
export async function acceptInvite(inviteCode: string) {
  return callFunction('acceptInvite', { inviteCode })
}

/** 移除共享成员（需在云函数端实现） */
export async function removeSharedMember(memberOpenId: string) {
  // TODO: 创建 removeMember 云函数后接入
  return { result: null, errMsg: '暂不支持远程移除' }
}
