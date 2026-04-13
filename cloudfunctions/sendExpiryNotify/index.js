// cloudfunctions/sendExpiryNotify/index.js
/**
 * 二期功能3：食材到期订阅消息推送
 * 
 * 功能：
 * 1. 检查用户即将到期的食材
 * 2. 发送微信订阅消息提醒
 * 3. 支持定时触发（云函数定时器）
 * 
 * 使用方式：
 * - 前端调用：检查当前到期情况 + 发送订阅消息
 * - 定时器触发：每天自动扫描所有用户的即将到期食材
 */

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// ==================== 配置区 ====================

/**
 * ⚠️ 订阅消息模板ID（需要在小程序管理后台申请）
 * 
 * 申请步骤：
 * 1. 登录 mp.weixin.qq.com → 订阅消息 → 公共模板库
 * 2. 搜索「到期提醒」或「物品过期」相关模板
 * 3. 选择合适的模板，获取 templateId
 * 4. 将 templateId 填入下方
 */
const DEFAULT_TEMPLATE_ID = process.env.EXPIRY_TEMPLATE_ID || '7NgIlrsfNldH8whWLPkoWGJV2SJnom-rjmIu9GUSK-4'

/**
 * 模板字段映射（根据你申请的模板调整）
 * 常用模板格式示例：
 * - thing1: 食材名称
 * - time2: 过期日期  
 * - thing3: 存放位置
 * - phrase4: 状态描述
 */
const TEMPLATE_FIELDS = {
  name: 'thing1',       // 食材名称字段
  date: 'time2',        // 过期日期字段
  location: 'thing3',   // 存放位置字段
  status: 'phrase4',    // 状态字段
}

// 默认提前几天提醒
const DEFAULT_DAYS_BEFORE = 3

// 最大单次推送条数（避免频率限制）
const MAX_PUSH_PER_REQUEST = 5


exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  
  const {
    action = 'check',          // check(查询) | send(发送) | batchSend(批量发送/定时器)
    daysBefore,                 // 提前多少天提醒
    templateId,                 // 自定义模板ID
    foodIds,                    // 指定检查的食材ID列表
    forceSend,                  // 强制发送（跳过订阅检查）
  } = event

  console.log(`🔔 [到期提醒] action=${action}, openid=${openid?.substring(0,8)}...`)

  switch (action) {
    case 'check':
      return await checkExpiryFoods(openid, { daysBefore, foodIds })
    
    case 'send':
      return await sendExpiryNotification(openid, { daysBefore, templateId, forceSend })
    
    case 'batchSend':
      return await batchSendNotifications(daysBefore)
    
    case 'requestSubscribe':
      // 返回模板ID供前端调用 wx.requestSubscribeMessage
      return {
        success: true,
        templateId: templateId || DEFAULT_TEMPLATE_ID,
        errMsg: '请使用此 templateId 在前端调用 wx.requestSubscribeMessage',
      }
    
    default:
      return { success: false, errMsg: `未知操作: ${action}` }
  }
}


// ==================== 核心功能 ====================

/**
 * 检查即将到期的食材
 */
async function checkExpiryFoods(openid, options = {}) {
  const { daysBefore = DEFAULT_DAYS_BEFORE, foodIds } = options
  const now = new Date()
  
  try {
    let query = {
      _openid: openid,
      consumed: false,
    }

    if (foodIds && Array.isArray(foodIds) && foodIds.length > 0) {
      query._id = _.in(foodIds)
    }

    const res = await db.collection('fridge_items').where(query).get()
    let foods = res.data || []

    // 分类计算状态
    const result = {
      expired: [],        // 已过期
      expiringSoon: [],   // 即将到期（N天内）
      safe: [],           // 安全
      summary: {
        total: foods.length,
        expiredCount: 0,
        expiringCount: 0,
        safeCount: 0,
        daysBefore,
        checkDate: now.toISOString(),
      }
    }

    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const thresholdDate = new Date(today.getTime() + daysBefore * 24 * 60 * 60 * 1000)

    for (const food of foods) {
      if (!food.expiryDate) {
        result.safe.push(food)
        result.summary.safeCount++
        continue
      }

      const expiryDate = new Date(food.expiryDate)
      
      // 清除时间部分，只比较日期
      const expiryOnly = new Date(expiryDate.getFullYear(), expiryDate.getMonth(), expiryDate.getDate())

      if (expiryOnly < today) {
        // 已过期
        const daysExpired = Math.floor((today.getTime() - expiryOnly.getTime()) / (24 * 60 * 60 * 1000))
        result.expired.push({
          ...food,
          _status: 'expired',
          daysExpired,
          urgency: daysExpired > 7 ? 'high' : daysExpired > 3 ? 'medium' : 'low',
        })
        result.summary.expiredCount++
      } else if (expiryOnly <= thresholdDate) {
        // 即将到期
        const daysLeft = Math.ceil((expiryOnly.getTime() - today.getTime()) / (24 * 60 * 60 * 1000))
        result.expiringSoon.push({
          ...food,
          _status: 'expiringSoon',
          daysLeft,
          urgency: daysLeft === 0 ? 'high' : daysLeft <= 2 ? 'medium' : 'low',
        })
        result.summary.expiringCount++
      } else {
        result.safe.push(food)
        result.summary.safeCount++
      }
    }

    // 按紧急程度排序
    result.expired.sort((a, b) => b.daysExpired - a.daysExpired)
    result.expiringSoon.sort((a, b) => a.daysLeft - b.daysLeft)

    console.log(`✅ [到期检查] 总${result.summary.total}项, 过期${result.summary.expiredCount}, 即将到期${result.summary.expiringCount}`)

    return {
      success: true,
      ...result,
      hasUrgentItems: result.summary.expiredCount > 0 || result.expiringSoon.filter(f => f.urgency === 'high').length > 0,
      errMsg: '',
    }
  } catch (e) {
    console.error('❌ 到期检查失败:', e)
    return { success: false, errMsg: e.message, expired: [], expiringSoon: [], safe: [] }
  }
}

/**
 * 发送单条订阅消息
 * @param {string} openid - 用户openid
 * @param {object} food - 食材数据
 * @param {string} tid - 模板ID
 */
async function pushSingleMessage(openid, food, tid) {
  if (!tid) {
    console.warn('⚠️ 未配置模板ID，无法发送消息')
    return { success: false, reason: 'no_template' }
  }

  try {
    const now = new Date()
    const expiryDate = food.expiryDate ? new Date(food.expiryDate) : null
    
    // 构建模板数据
    const data = {}
    data[TEMPLATE_FIELDS.name] = { value: (food.name || '未知食材').substring(0, 20) }
    data[TEMPLATE_FIELDS.date] = { value: expiryDate ? formatDate(expiryDate) : '未设置' }
    data[TEMPLATE_FIELDS.location] = { value: getLocationLabel(food.location) || '冰箱' }
    
    if (food._status === 'expired') {
      data[TEMPLATE_FIELDS.status] = { value: `已过期${food.daysExpired || 0}天` }
    } else if (food._status === 'expiringSoon') {
      data[TEMPLATE_FIELDS.status] = { value: `${food.daysLeft || 0}天后到期` }
    } else {
      data[TEMPLATE_FIELDS.status] = { value: '正常' }
    }

    const res = await cloud.openapi.subscribeMessage.send({
      touser: openid,
      templateId: tid,
      page: `pages/home/home?tab=fridge`,
      data,
      miniprogramState: 'formal', // developer | trial | formal
    })

    console.log(`📨 [推送] ${food.name}:`, res.errCode === 0 ? '成功' : res.errMsg)
    return { success: res.errCode === 0, errCode: res.errCode, errMsg: res.errMsg }
  } catch (e) {
    console.error('❌ 推送失败:', e.message)
    return { success: false, errMsg: e.message }
  }
}

/**
 * 发送到期提醒通知（给单个用户）
 */
async function sendExpiryNotification(openid, options = {}) {
  const { daysBefore = DEFAULT_DAYS_BEFORE, templateId, forceSend } = options
  const tid = templateId || DEFAULT_TEMPLATE_ID

  // Step 1: 检查到期食材
  const checkResult = await checkExpiryFoods(openid, { daysBefore })

  if (!checkResult.success) {
    return checkResult
  }

  // 收集需要推送的食材（优先级高的先推）
  const urgentFoods = [
    ...checkResult.expired.slice(0, 3),     // 最多3个过期的
    ...checkResult.expiringSoon.filter(f => f.urgency === 'high').slice(0, 2),
  ]

  if (urgentFoods.length === 0) {
    return {
      success: true,
      pushed: 0,
      message: '🎉 太棒了！没有即将到期的食材',
      ...checkResult.summary,
    }
  }

  // Step 2: 发送订阅消息
  const results = []
  let successCount = 0

  for (const food of urgentFoods.slice(0, MAX_PUSH_PER_REQUEST)) {
    const pushRes = await pushSingleMessage(openid, food, tid)
    results.push({ foodName: food.name, ...pushRes })
    if (pushRes.success) successCount++
  }

  // Step 3: 记录推送日志（可选）
  try {
    await db.collection('notify_logs').add({
      data: {
        openid,
        type: 'expiry_reminder',
        totalCount: urgentFoods.length,
        successCount,
        failCount: urgentFoods.length - successCount,
        createdAt: db.serverDate(),
      },
    })
  } catch (logErr) {
    console.warn('写入日志失败:', logErr.message)
  }

  return {
    success: true,
    pushed: successCount,
    total: urgentFoods.length,
    results,
    summary: checkResult.summary,
    errMsg: '',
  }
}

/**
 * 批量发送通知（供定时触发器使用）
 * 扫描所有有开启提醒的用户，发送到期提醒
 */
async function batchSendNotifications(daysBefore = DEFAULT_DAYS_BEFORE) {
  console.log('⏰ [定时任务] 开始批量发送到期提醒...')
  
  const startTime = Date.now()
  let totalProcessed = 0
  let totalPushed = 0

  try {
    // 获取所有开启了通知设置的用户
    // 注意：这里假设用户设置存在 user_settings 集合中
    // 如果没有独立的集合，可以改为遍历所有有食材的用户
    
    // 方案1：从 user_settings 查找开启通知的用户
    const usersRes = await db.collection('user_settings')
      .where({ notifyEnabled: true })
      .limit(100)
      .get()

    const users = usersRes.data || []

    if (users.length === 0) {
      console.log('⚠️ [定时任务] 没有找到开启通知的用户')
      return {
        success: true,
        processed: 0,
        pushed: 0,
        message: '没有用户开启通知',
        duration: Date.now() - startTime,
      }
    }

    console.log(`📋 [定时任务] 找到 ${users.length} 个开启通知的用户`)

    for (const user of users) {
      try {
        const userOpenid = user._openid || user.openid
        if (!userOpenid) continue

        const notifyDays = user.notifyDaysBefore || daysBefore
        const tid = user.templateId || DEFAULT_TEMPLATE_ID

        const result = await sendExpiryNotification(userOpenid, {
          daysBefore: notifyDays,
          templateId: tid,
          forceSend: true,
        })

        totalProcessed++
        totalPushed += result.pushed || 0

        // 避免触发频率限制，稍微延迟
        await new Promise(r => setTimeout(r, 200))
      } catch (userErr) {
        console.error(`❌ 处理用户 ${user._openid?.substring(0,8)} 失败:`, userErr.message)
      }
    }

    const duration = Date.now() - startTime
    console.log(`✅ [定时任务] 完成! 处理${totalProcessed}人, 推送${totalPushed}条, 耗时${duration}ms`)

    return {
      success: true,
      processed: totalProcessed,
      pushed: totalPushed,
      duration,
      errMsg: '',
    }
  } catch (e) {
    console.error('❌ [定时任务] 失败:', e)
    return { success: false, errMsg: e.message, processed: totalProcessed, pushed: totalPushed }
  }
}


// ==================== 工具函数 ====================

/** 格式化日期为 YYYY-MM-DD */
function formatDate(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 获取存放位置的中文标签 */
function getLocationLabel(loc) {
  const map = {
    fridge: '冷藏室',
    freezer: '冷冻室',
    pantry: '常温储藏',
    other: '其他',
  }
  return map[loc] || loc || '冰箱'
}
