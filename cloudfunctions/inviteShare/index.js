// cloudfunctions/inviteShare/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

/**
 * 生成6位随机邀请码
 */
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
}

/**
 * 邀请他人共享冰箱
 * 生成邀请码，记录邀请信息
 */
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  console.log(`📤 [inviteShare] 开始, openid=${openid || '(空)'}`)

  if (!openid) {
    console.error('❌ [inviteShare] openid 为空!')
    return { success: false, errMsg: '用户身份识别失败，请重新登录' }
  }

  try {
    const inviteCode = 'FRIDGE-' + generateCode()
    console.log(`📝 [inviteShare] 生成 inviteCode=${inviteCode}`)

    // === Step 1: 检查是否已存在共享组 ===
    let existingData = null
    try {
      const existingRes = await db.collection('shared_fridges')
        .where({ ownerOpenId: openid })
        .limit(1)
        .get()
      console.log(`✅ [inviteShare] 查询成功, 条数=${existingRes.data?.length || 0}`)
      existingData = existingRes.data?.length > 0 ? existingRes.data[0] : null
    } catch (queryErr) {
      console.warn(`⚠️ [inviteShare] 查询异常(可能集合不存在): ${queryErr.message}`)
      // 集合不存在时视为无记录，后续 .add() 会自动创建
      existingData = null
    }

    let fridgeGroup

    if (existingData) {
      // 已有共享组，更新邀请码
      fridgeGroup = existingData
      console.log(`🔄 [inviteShare] 更新已有组 groupId=${fridgeGroup._id}`)
      await db.collection('shared_fridges').doc(fridgeGroup._id).update({
        data: { inviteCode, updatedAt: new Date() }
      })
    } else {
      // 创建新的共享组
      console.log(`➕ [inviteShare] 创建新共享组`)

      // 获取用户基本信息（可选，失败不影响主流程）
      let ownerName = '冰箱主人'
      try {
        const userRes = await db.collection('user_settings').where({ _openid: openid }).limit(1).get()
        if (userRes.data?.[0]?.nickName) ownerName = userRes.data[0].nickName
        console.log(`👤 [inviteShare] ownerName=${ownerName}`)
      } catch (e) {
        console.warn(`⚠️ [inviteShare] 查询 user_settings 失败(忽略): ${e.message || e}`)
      }

      const res = await db.collection('shared_fridges').add({
        data: {
          ownerOpenId: openid,
          ownerName,
          inviteCode,
          members: [{
            openId: openid,
            name: ownerName,
            avatar: null,
            isOwner: true,
            joinedAt: new Date(),
          }],
          pendingInvites: [],
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        }
      })

      fridgeGroup = { _id: res._id }
      console.log(`✅ [inviteShare] 创建成功 groupId=${res._id}`)
    }

    const result = {
      success: true,
      inviteCode,
      groupId: fridgeGroup._id,
      message: `邀请码已生成：${inviteCode}`,
      errMsg: '',
    }
    console.log(`🎉 [inviteShare] 返回结果: ${JSON.stringify(result)}`)
    return result

  } catch (err) {
    console.error('❌ [inviteShare] 异常:', err.message || err)
    return { success: false, errMsg: err.message || '创建邀请失败' }
  }
}
