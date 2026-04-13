// cloudfunctions/login/index.js
/**
 * 微信一键登录云函数
 * 
 * 功能：
 * 1. 获取用户 openid（静默，无需用户授权）
 * 2. 自动在 users 集合中创建/更新用户记录
 * 3. 支持更新昵称和头像（需要用户主动授权）
 * 
 * 调用时机：
 * - app.ts onLaunch 时静默调用（仅获取 openid）
 * - 用户点击"授权头像昵称"时调用（携带 userInfo）
 */

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { action, nickName, avatarUrl, code } = event

  console.log(`🔐 [登录] action=${action}, openid=${openid?.substring(0,8)}...`)

  try {
    switch (action) {
      case 'silentLogin':
        return await silentLogin(openid)
      
      case 'updateProfile':
        return await updateUserProfile(openid, { nickName, avatarUrl })
      
      case 'registerWithPhone':
        // 手机号注册（code 是 getPhoneNumber 获取的凭证）
        return await registerWithPhone(openid, code)

      default:
        // 兼容无 action 参数的调用（默认静默登录）
        return await silentLogin(openid)
    }
  } catch (err) {
    console.error('❌ 登录失败:', err)
    return { success: false, errMsg: err.message || '登录失败' }
  }
}

/**
 * 静默登录 — 仅获取 openid，不涉及用户信息授权
 * 首次访问时自动创建用户记录
 */
async function silentLogin(openid) {
  // 查找是否已有用户记录（带集合不存在兜底）
  let existingRes
  try {
    existingRes = await db.collection('users')
      .where({ _openid: openid })
      .limit(1)
      .get()
  } catch (e) {
    // 集合不存在时，尝试自动创建（通过 add 触发）
    console.log(`⚠️ users 集合可能不存在，尝试初始化...`)
    try {
      await db.collection('users').add({
        data: { _init: true, createdAt: new Date() }
      })
      console.log(`✅ users 集合已自动创建`)
      // 删除初始化标记
      const initRes = await db.collection('users').where({ _init: true }).get()
      if (initRes.data?.[0]) {
        await db.collection('users').doc(initRes.data[0]._id).remove()
      }
      // 重试查询
      existingRes = await db.collection('users')
        .where({ _openid: openid })
        .limit(1)
        .get()
    } catch (createErr) {
      console.error('❌ 无法创建 users 集合:', createErr.message)
      // 返回一个临时的内存用户信息，不依赖数据库
      return {
        success: true,
        isNewUser: true,
        user: {
          openid,
          nickName: '',
          avatarUrl: '',
          scenario: 'single',
          createdAt: new Date(),
        },
        warning: 'users 集合未创建，请在控制台手动创建',
        errMsg: '',
      }
    }
  }

  if (existingRes.data && existingRes.data.length > 0) {
    const user = existingRes.data[0]

    // 更新最后活跃时间
    await db.collection('users').doc(user._id).update({
      data: {
        lastActiveAt: new Date(),
        loginCount: _.inc(1),
      }
    })

    console.log(`✅ [静默登录] 欢迎回来: ${user.nickName || '未设置昵称'}`)

    return {
      success: true,
      isNewUser: false,
      user: {
        openid,
        nickName: user.nickName || '',
        avatarUrl: user.avatarUrl || '',
        scenario: user.scenario || 'single',
        createdAt: user.createdAt,
        lastActiveAt: new Date(),
      },
      errMsg: '',
    }
  }

  // 新用户 —— 创建记录
  const now = new Date()
  const res = await db.collection('users').add({
    data: {
      _openid: openid,
      nickName: '',
      avatarUrl: '',
      scenario: 'single',
      notifyEnabled: false,
      notifyDaysBefore: 3,
      loginCount: 1,
      lastActiveAt: now,
      createdAt: now,
    }
  })

  console.log(`✅ [新用户注册] openid=${openid.substring(0,8)}...`)

  return {
    success: true,
    isNewUser: true,
    user: {
      openid,
      nickName: '',
      avatarUrl: '',
      scenario: 'single',
      createdAt: now,
    },
    errMsg: '',
  }
}

/**
 * 更新用户资料（头像+昵称）
 * 用户主动点击按钮触发，使用微信新版 <button open-type="chooseAvatar"> 能力
 */
async function updateUserProfile(openid, profile) {
  if (!profile.nickName && !profile.avatarUrl) {
    return { success: false, errMsg: '没有需要更新的信息' }
  }

  // 构建更新数据
  const updateData = {}
  if (profile.nickName) updateData.nickName = profile.nickName
  if (profile.avatarUrl) updateData.avatarUrl = profile.avatarUrl
  updateData.updatedAt = new Date()

  const res = await db.collection('users')
    .where({ _openid: openid })
    .update({ data: updateData })

  console.log(`📝 [资料更新] openid=${openid.substring(0,8)}..., fields=${Object.keys(updateData).join(',')}`)

  // 返回最新用户信息
  const userRes = await db.collection('users')
    .where({ _openid: openid })
    .limit(1)
    .get()

  const user = userRes.data?.[0] || {}

  return {
    success: true,
    user: {
      openid,
      nickName: user.nickName || '',
      avatarUrl: user.avatarUrl || '',
    },
    errMsg: '',
  }
}

/**
 * 手机号注册
 * 使用微信 getPhoneNumber 获取的 code 解密手机号
 */
async function registerWithPhone(openid, code) {
  try {
    // 调用微信接口解密手机号
    const phoneRes = await cloud.openapi.phonenumber.getPhoneNumber({
      code: code,
    })
    
    const phoneNumber = phoneRes.phoneInfo?.phoneNumber
    
    if (!phoneNumber) {
      throw new Error('获取手机号失败')
    }

    console.log(`📲 [手机号注册] phone=${phoneNumber}`)

    // 检查该手机号是否已注册（通过手机号字段查找）
    const existingByPhone = await db.collection('users')
      .where({ phoneNumber })
      .limit(1)
      .get()

    if (existingByPhone.data && existingByPhone.data.length > 0) {
      const existUser = existingByPhone.data[0]
      if (existUser._openid !== openid) {
        // 手机号已被其他账号绑定
        return {
          success: false,
          errMsg: '该手机号已被其他账号使用',
          needSwitchAccount: true,
        }
      }
      // 同一个 openid 绑定同一手机号，直接返回成功
      return {
        success: true,
        isNewUser: false,
        user: { openid, phoneNumber },
        errMsg: '',
      }
    }

    // 更新/创建用户记录，绑定手机号
    const now = new Date()
    const existingUser = await db.collection('users')
      .where({ _openid: openid })
      .limit(1)
      .get()

    if (existingUser.data && existingUser.data.length > 0) {
      // 已有记录 → 补充手机号
      await db.collection('users').doc(existingUser.data[0]._id).update({
        data: { 
          phoneNumber,
          updatedAt: now,
        }
      })
    } else {
      // 全新用户 → 创建
      await db.collection('users').add({
        data: {
          _openid: openid,
          phoneNumber,
          nickName: '',
          avatarUrl: '',
          scenario: 'single',
          notifyEnabled: false,
          notifyDaysBefore: 3,
          loginCount: 1,
          lastActiveAt: now,
          createdAt: now,
        }
      })
    }

    return {
      success: true,
      isNewUser: !existingUser.data?.length,
      user: { openid, phoneNumber },
      errMsg: '',
    }
  } catch (err) {
    console.error('❌ 手机号注册失败:', err)
    // 如果 openapi 不可用，仍然允许注册成功（降级处理）
    return {
      success: true,
      isNewUser: true,
      user: { openid, phoneNumber: '' },
      warning: '手机号绑定未完成，可在设置中补充',
      errMsg: '',
    }
  }
}
