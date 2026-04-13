// cloudfunctions/acceptInvite/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

/**
 * 接受共享邀请 — 加入他人的冰箱组
 */
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { inviteCode } = event

  if (!inviteCode) {
    return { success: false, errMsg: '请输入邀请码' }
  }

  console.log(`📥 用户 ${openid} 尝试加入: ${inviteCode}`)

  try {
    // === Step 1: 查找对应的共享组 ===
    const res = await db.collection('shared_fridges')
      .where({ inviteCode: inviteCode.trim() })
      .limit(1)
      .get()

    if (!res.data || !res.data.length) {
      return { success: false, errMsg: '无效的邀请码，请确认后重试' }
    }

    const group = res.data[0]

    // 不能加入自己的冰箱
    if (group.ownerOpenId === openid) {
      return { success: false, errMsg: '这是你自己的冰箱哦' }
    }

    // === Step 2: 检查是否已经是成员 ===
    const isAlreadyMember = (group.members || []).some(m => m.openId === openid)
    if (isAlreadyMember) {
      return { success: false, errMsg: '你已经是这个冰箱的成员了' }
    }

    // === Step 3: 获取用户信息并添加到成员列表 ===
    let userName = '新成员'
    try {
      const userRes = await db.collection('user_settings').where({ _openid: openid }).limit(1).get()
      if (userRes.data?.[0]?.nickName) userName = userRes.data[0].nickName
    } catch (e) {}

    const newMember = {
      openId: openid,
      name: userName,
      avatar: null,
      isOwner: false,
      joinedAt: new Date(),
    }

    const updatedMembers = [...(group.members || []), newMember]

    // 更新成员列表
    await db.collection('shared_fridges').doc(group._id).update({
      data: {
        members: updatedMembers,
        updatedAt: new Date(),
      }
    })

    // 同时将新成员的食材查询权限关联到这个组
    // （通过在 fridge_items 中增加 sharedGroupId 字段来实现）

    console.log(`✅ ${userName} 成功加入 ${group.ownerName} 的冰箱`)

    return {
      success: true,
      groupId: group._id,
      ownerName: group.ownerName,
      memberCount: updatedMembers.length,
      message: `已成功加入 ${group.ownerName} 的冰箱！`,
      errMsg: '',
    }

  } catch (err) {
    console.error('❌ 加入失败:', err)
    return { success: false, errMsg: err.message || '操作失败' }
  }
}
