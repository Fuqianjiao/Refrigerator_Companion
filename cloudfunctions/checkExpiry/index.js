// cloudfunctions/checkExpiry/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

/**
 * 定时触发器 - 保质期检查
 * 每天自动执行，检查所有食材的保质期状态并更新
 * 对临期/过期的用户发送订阅消息提醒
 * 
 * 定时器配置（config.json）：
 * {
 *   "triggers": [{
 *     "name": "expiryCheckTimer",
 *     "type": "timer",
 *     "config": "0 0 9 * * * *"  // 每天早上9点执行
 *   }]
 * }
 */
exports.main = async (event, context) => {
  const source = cloud.getWXContext().SOURCE || 'manual'
  console.log(`⏰ 开始保质期检查 (来源: ${source})`)

  try {
    // === Step 1: 获取所有未过期/非已消耗的食材 ===
    // 注意：定时触发时无法获取特定用户的openid，所以需要查全部
    // 然后按用户分组处理
    
    let allItems = []
    let hasMore = true
    let offset = 0
    const batchSize = 100

    while (hasMore) {
      const res = await db.collection('fridge_items')
        .where({
          status: _.in(['fresh', 'expiring'])
        })
        .skip(offset)
        .limit(batchSize)
        .get()

      if (res.data && res.data.length > 0) {
        allItems = allItems.concat(res.data)
        offset += res.data.length
        hasMore = res.data.length >= batchSize
      } else {
        hasMore = false
      }
    }

    if (!allItems.length) {
      return { success: true, message: '没有需要检查的食材' }
    }

    console.log(`📋 共找到 ${allItems.length} 条待检查食材`)

    // === Step 2: 逐条更新状态 ===
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    
    let updatedFresh = 0
    let updatedExpiring = 0
    let updatedExpired = 0
    
    // 按用户分组收集需要通知的用户
    const notifyMap = {}  // { openid: { expiring: [...], expired: [...] } }
    const warnDays = 3  // 默认提前3天提醒

    for (const item of allItems) {
      if (!item.expiryDate) continue

      const expiryDate = new Date(item.expiryDate)
      expiryDate.setHours(0, 0, 0, 0)
      
      const diffMs = expiryDate.getTime() - today.getTime()
      const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
      
      let newStatus
      
      if (diffDays < 0) {
        newStatus = 'expired'
        updatedExpired++
        
        // 记录过期通知
        if (!notifyMap[item._openid]) notifyMap[item._openid] = { expiring: [], expired: [] }
        notifyMap[item._openid].expired.push(item.name)
        
      } else if (diffDays <= warnDays) {
        newStatus = 'expiring'
        updatedExpiring++
        
        // 记录临期通知
        if (!notifyMap[item._openid]) notifyMap[item._openid] = { expiring: [], expired: [] }
        // 只在状态从 fresh 变为 expiring 时通知（避免每天重复）
        if (item.status !== 'expiring') {
          notifyMap[item._openid].expiring.push({
            name: item.name,
            daysLeft: diffDays,
            expireAt: item.expiryDate,
          })
        }
        
      } else {
        newStatus = 'fresh'
        updatedFresh++
      }

      // 只有状态变化时才更新数据库
      if (newStatus !== item.status) {
        try {
          await db.collection('fridge_items').doc(item._id).update({
            data: { status: newStatus, updatedAt: new Date() }
          })
        } catch (e) {
          console.warn(`更新 ${item.name} 失败:`, e.message)
        }
      }
    }

    // === Step 3: 发送过期/临期提醒消息 ===
    const notificationResults = []
    
    for (const [openid, notifications] of Object.entries(notifyMap)) {
      if (notifications.expired.length > 0 || notifications.expiring.length > 0) {
        try {
          const result = await sendExpiryNotification(openid, notifications)
          notificationResults.push({ openid, ...result })
        } catch (notifyErr) {
          console.warn(`发送通知给 ${openid} 失败:`, notifyErr.message)
          notificationResults.push({ 
            openid, 
            success: false, 
            error: notifyErr.message 
          })
        }
      }
    }

    const summary = {
      success: true,
      checked: allItems.length,
      updated: { fresh: updatedFresh, expiring: updatedExpiring, expired: updatedExpired },
      notifiedUsers: Object.keys(notifyMap).length,
      notifications: notificationResults,
      executedAt: new Date(),
      source,
    }

    console.log(`✅ 保质期检查完成:`, JSON.stringify(summary))

    return summary
  } catch (err) {
    console.error('❌ 保质期检查失败:', err)
    return { success: false, error: err.message, executedAt: new Date(), source }
  }
}

/**
 * 发送订阅消息给用户
 */
async function sendExpiryNotification(openid, notifications) {
  // 获取用户的通知设置（是否开启、提前几天）
  let userSettings = null
  try {
    const res = await db.collection('user_settings').where({ _openid: openid }).limit(1).get()
    userSettings = res.data?.[0]
  } catch (e) {
    // 用户没有设置记录，默认不通知
  }

  // 如果用户关闭了通知，跳过
  if (userSettings && !userSettings.notifyEnabled) {
    return { skipped: true, reason: '用户关闭了通知' }
  }

  // 构建消息内容
  let messageContent = ''
  
  if (notifications.expired.length > 0) {
    const items = notifications.expired.slice(0, 5).join('、')
    const more = notifications.expired.length > 5 ? `等${notifications.expired.length}种` : ''
    messageContent += `⚠️ 已过期：${items}${more}\n`
  }

  if (notifications.expiring.length > 0) {
    const items = notifications.expiring.map(n => `${n.name}(${n.daysLeft}天后过期)`).slice(0, 3).join('、')
    messageContent += `⏰ 即将过期：${items}`
  }

  try {
    // 发送微信订阅消息
    // 注：需要在小程序管理后台配置好消息模板，获取模板ID
    const result = await cloud.openapi.subscribeMessage.send({
      touser: openid,
      templateId: process.env.EXPIRY_TEMPLATE_ID || '',
      page: 'pages/fridge/fridge',
      data: {
        thing1: { value: '🧊 冰箱管家' },              // 标题
        thing2: { value: messageContent.substring(0, 20) }, // 过期内容摘要
      },
      miniprogramState: 'formal',
    })

    return { sent: true, result }
  } catch (msgErr) {
    // 如果订阅消息发送失败（如模板未配置），降级为记录到数据库
    console.warn('订阅消息发送失败，降级为本地记录:', msgErr.message)
    
    // 写入通知记录表
    try {
      await db.collection('notifications').add({
        data: {
          _openid: openid,
          type: 'expiry_alert',
          content: messageContent,
          read: false,
          createdAt: new Date(),
        }
      })
    } catch (writeErr) {
      // ignore
    }
    
    return { sent: false, fallback: 'local_notification_recorded', error: msgErr.message }
  }
}
