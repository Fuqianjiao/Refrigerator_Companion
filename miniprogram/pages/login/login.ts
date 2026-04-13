// pages/login/login.ts
// 登录页面 — 仅保留微信一键登录（手机号注册能力已下线）

const app = getApp<IAppOption>()

Page({
  data: {
    step: 'init',          // 'init' | 'profile'
    tempAvatarUrl: '',     // 用户选择的临时头像
    tempNickName: '',      // 用户输入的临时昵称
    loading: false,
  },

  onLoad() {
    // 已登录 → 直接返回
    if (app.globalData.openid && app.globalData.loggedIn) {
      this._goBack()
      return
    }
  },

  onShow() {
    // 每次显示时检查状态（从退出后回来时）
    if (app.globalData.openid && app.globalData.loggedIn) {
      this._goBack()
    }
  },

  // ==================== 微信登录流程 ====================

  /** 第一步：点击微信一键登录 */
  async startWechatLogin() {
    wx.showLoading({ title: '正在登录...' })
    
    try {
      // 调用云函数获取 openid（云端自动从微信获取用户身份）
      const res = await wx.cloud.callFunction({
        name: 'login',
        data: { action: 'silentLogin' },
      })

      if (!res.result?.success) {
        throw new Error(res.result?.errMsg || '登录失败')
      }

      const { user, isNewUser } = res.result

      // ⭐ 关键修复：立即将登录状态写入全局（之前这里没写！）
      app.globalData.openid = user.openid
      app.globalData.loggedIn = true
      app.globalData.userInfo = user

      // 缓存到本地
      wx.setStorageSync('user_openid', user.openid)
      if (user.nickName) {
        wx.setStorageSync('cached_user_info', {
          nickName: user.nickName,
          avatarUrl: user.avatarUrl || '',
        })
      }

      console.log(`🔐 [登录页] 拿到openid=${user.openid.substring(0,8)}..., isNewUser=${isNewUser}`)

      if (user.nickName && user.avatarUrl) {
        // 老用户已有资料，直接完成
        wx.hideLoading()
        this._onLoginSuccess(user)
      } else {
        // 新用户 → 进入设置头像昵称步骤（此时已登录，只是缺资料）
        wx.hideLoading()
        this.setData({ step: 'profile' })
      }
    } catch (err: any) {
      console.error('❌ 登录失败:', err)
      wx.hideLoading()
      wx.showToast({ title: '登录失败，请重试', icon: 'none' })
    }
  },

  /** 选择头像回调 */
  onChooseAvatar(e: any) {
    const avatarUrl = e.detail.avatarUrl
    if (avatarUrl) {
      console.log('📷 选择了头像')
      this.setData({ tempAvatarUrl: avatarUrl })
    }
  },

  /** 昵称输入 */
  onNickInput(e: any) {
    this.setData({ tempNickName: e.detail.value })
  },

  /** 确认登录（保存头像+昵称） */
  async onConfirmLogin() {
    const { tempNickName, tempAvatarUrl } = this.data
    
    if (!tempNickName.trim()) {
      wx.showToast({ title: '请输入昵称', icon: 'none' })
      return
    }

    wx.showLoading({ title: '保存中...' })
    this.setData({ loading: true })

    try {
      // 上传头像到云端（如果有的话）
      let finalAvatarUrl = tempAvatarUrl
      if (tempAvatarUrl) {
        try {
          const uploadRes = await wx.cloud.uploadFile({
            cloudPath: `avatars/${app.globalData.openid}_${Date.now()}.jpg`,
            filePath: tempAvatarUrl,
          })
          finalAvatarUrl = uploadRes.fileID
        } catch (e) {
          console.log('⚠️ 头像上传失败，使用本地路径')
        }
      }

      // 更新云端用户资料
      await app.updateUserInfo(tempNickName.trim(), finalAvatarUrl)

      // 同步全局数据
      app.globalData.userInfo = {
        ...app.globalData.userInfo,
        nickName: tempNickName.trim(),
        avatarUrl: finalAvatarUrl,
      }

      wx.hideLoading()
      
      this._onLoginSuccess(app.globalData.userInfo)
    } catch (err: any) {
      console.error('❌ 保存资料失败:', err)
      wx.hideLoading()
      wx.showToast({ title: '保存失败', icon: 'none' })
      this.setData({ loading: false })
    }
  },

  /** 跳过设置头像昵称 */
  onSkipProfile() {
    this._onLoginSuccess(app.globalData.userInfo || {})
  },

  // ==================== 静默/访客登录 ====================

  /** 访客模式：不授权任何东西，仅获取 openid */
  async onSilentLogin() {
    wx.showLoading({ title: '加载中...' })
    
    try {
      await app.silentLogin()
      wx.hideLoading()

      if (app.globalData.openid) {
        this._onLoginSuccess(app.globalData.userInfo || {})
      } else {
        wx.showToast({ title: '登录失败', icon: 'none' })
      }
    } catch (err: any) {
      wx.hideLoading()
      wx.showToast({ title: '网络异常', icon: 'none' })
    }
  },

  // ==================== 通用方法 ====================

  /** 登录成功处理 — 确保全局状态已同步后再跳转 */
  _onLoginSuccess(user?: any) {
    // ⭐ 关键修复：双重保险，确保 globalData 已更新
    if (user && user.openid) {
      app.globalData.openid = user.openid
      app.globalData.loggedIn = true
      if (!app.globalData.userInfo || !app.globalData.userInfo.nickName) {
        app.globalData.userInfo = { ...app.globalData.userInfo, ...user }
      }
    }

    // 触发全局事件，让其他页面（如 profile）知道登录状态变了
    app.emitLoginEvent('loginSuccess', app.globalData.userInfo)

    wx.showToast({ title: '✅ 登录成功', icon: 'success' })
    setTimeout(() => {
      this._goBack()
    }, 800)
  },

  /** 返回上一页 */
  _goBack() {
    const pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack()
    } else {
      wx.switchTab({ url: '/pages/profile/profile' })
    }
  },
})
