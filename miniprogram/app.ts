// miniprogram/app.ts
App({
  globalData: {
    // 用户信息（登录后赋值）
    userInfo: null as any,
    // 用户 openid（登录后赋值，唯一标识）
    openid: '',
    // 是否已登录
    loggedIn: false,
    // 当前场景模式: single | couple | family
    scenario: 'single',
    // 云环境ID
    envId: 'cloud1-0grumy09dbc5ebc0',
    // 是否已初始化
    initialized: false,
  },

  onLaunch() {
    console.log('🚀 FridgeMate 启动中...')
    this.initCloud()
    this.silentLogin()  // 静默登录获取身份
    this.checkScenario()
  },

  /** 初始化云开发 */
  initCloud() {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力')
      return
    }
    wx.cloud.init({
      env: this.globalData.envId || 'cloud1-0grumy09dbc5ebc0',
      traceUser: true,
    })
    this.globalData.initialized = true
    console.log('☁️ 云开发初始化完成')
  },

  /**
   * 🔐 静默登录 — 启动时自动调用
   * 仅获取 openid，无需用户授权任何权限
   * 换手机/重装后 openid 不变（同一微信号下）
   */
  async silentLogin() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'login',
        data: { action: 'silentLogin' },
      })

      if (res.result?.success) {
        const { user, isNewUser } = res.result

        this.globalData.openid = user.openid
        this.globalData.loggedIn = true
        this.globalData.userInfo = user

        // 同步场景偏好到全局
        if (user.scenario) {
          this.globalData.scenario = user.scenario
        }

        // 缓存用户基本信息到本地（供离线使用）
        wx.setStorageSync('user_openid', user.openid)
        if (user.nickName) {
          wx.setStorageSync('cached_user_info', {
            nickName: user.nickName,
            avatarUrl: user.avatarUrl || '',
          })
        }

        console.log(`🔐 登录成功: ${isNewUser ? '新用户' : '欢迎回来'}, openid=${user.openid.substring(0,8)}...`)

        // 触发登录成功事件（页面可监听）
        if (isNewUser) {
          this.emitLoginEvent('newUser', user)
        } else {
          this.emitLoginEvent('loginSuccess', user)
        }
      } else {
        console.warn('⚠️ 静默登录返回失败:', res.result?.errMsg)
        // 尝试从本地缓存恢复
        this.restoreFromCache()
      }
    } catch (err: any) {
      console.error('❌ 静默登录异常:', err)
      this.restoreFromCache()
    }
  },

  /** 从本地缓存恢复用户状态 */
  restoreFromCache() {
    const cachedOpenid = wx.getStorageSync('user_openid')
    if (cachedOpenid) {
      this.globalData.openid = cachedOpenid
      console.log('📦 从缓存恢复 openid:', cachedOpenid.substring(0, 8))
    }
  },

  /**
   * 更新用户资料（昵称+头像）
   * 用户主动点击头像/昵称编辑按钮时调用
   */
  async updateUserInfo(nickName: string, avatarUrl: string) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'login',
        data: { action: 'updateProfile', nickName, avatarUrl },
      })

      if (res.result?.success) {
        const updatedUser = res.result.user
        this.globalData.userInfo = {
          ...this.globalData.userInfo,
          ...updatedUser,
        }

        // 更新本地缓存
        wx.setStorageSync('cached_user_info', {
          nickName: updatedUser.nickName,
          avatarUrl: updatedUser.avatarUrl || '',
        })

        return { success: true }
      }
      return { success: false, errMsg: res.result?.errMsg || '更新失败' }
    } catch (e: any) {
      return { success: false, errMsg: e.message || '网络异常' }
    }
  },

  /** 发送登录事件给所有页面 */
  emitLoginEvent(type: string, data?: any) {
    // 小程序没有全局事件总线，通过 globalData 标记 + 页面 onShow 轮询实现
    this.globalData.loginEventType = type
    this.globalData.loginEventData = data
  },

  /** 检查/恢复用户场景偏好 */
  checkScenario() {
    const saved = wx.getStorageSync('user_scenario')
    if (saved) {
      this.globalData.scenario = saved
    }
  },

  /** 设置场景模式 */
  setScenario(scenario: string) {
    this.globalData.scenario = scenario
    wx.setStorageSync('user_scenario', scenario)
  },

  /**
   * 🔓 退出登录 — 清除所有本地缓存 + 全局状态重置
   * 不清除云端数据（用户重新登录后可恢复）
   */
  logout() {
    // 清除全局状态
    this.globalData.openid = ''
    this.globalData.loggedIn = false
    this.globalData.userInfo = null
    this.globalData.loginEventType = undefined
    this.globalData.loginEventData = undefined

    // 清除本地缓存
    try {
      wx.removeStorageSync('user_openid')
      wx.removeStorageSync('cached_user_info')
      // 注意：保留 user_scenario、diet_prefs 等非身份相关设置
      console.log('🔓 已退出登录，本地缓存已清除')
    } catch (e) {
      console.warn('⚠️ 清除缓存失败:', e)
    }
  },

  /** 切换账号 — 退出后跳转登录页 */
  switchAccount() {
    this.logout()
    wx.navigateTo({ url: '/pages/login/login' })
  },
})

/** AppOption 类型声明（供其他文件引用） */
interface IAppOption {
  globalData: {
    userInfo: any
    openid: string
    loggedIn: boolean
    scenario: string
    envId: string
    initialized: boolean
    loginEventType?: string
    loginEventData?: any
  }
  initCloud(): void
  silentLogin(): void
  restoreFromCache(): void
  updateUserInfo(nickName: string, avatarUrl: string): Promise<any>
  emitLoginEvent(type: string, data?: any): void
  checkScenario(): void
  setScenario(scenario: string): void
  logout(): void
  switchAccount(): void
}
