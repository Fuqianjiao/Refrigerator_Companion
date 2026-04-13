// pages/about/about.ts

const APP_VERSION = '2.0.0'

Page({
  data: {
    cacheSizeText: '计算中...',
    updateStatus: '' as string,
    updateText: '',
  },

  onShow() {
    this._calcCacheSize()
    this._checkUpdateStatus()
  },

  /** 计算缓存大小 */
  _calcCacheSize() {
    wx.getStorageInfo({
      success: (res) => {
        const kb = Math.round(res.currentSize / 1024 * 100) / 100
        let text = ''
        if (kb >= 1024) {
          text = (kb / 1024).toFixed(1) + ' MB'
        } else if (kb > 0) {
          text = kb.toFixed(1) + ' KB'
        } else {
          text = '暂无缓存'
        }
        this.setData({ cacheSizeText: text })
      },
      fail: () => {
        this.setData({ cacheSizeText: '获取失败' })
      },
    })
  },

  /** 检查更新状态（模拟） */
  _checkUpdateStatus() {
    // 实际可调用 wx.getUpdateManager 检测小程序更新
    this.setData({
      updateStatus: 'latest',
      updateText: '已是最新版本',
    })
  },

  /* === 菜单操作 === */

  goPrivacy() {
    wx.showModal({
      title: '隐私政策',
      content: '冰箱管家非常重视您的隐私保护。\n\n我们仅收集必要的用户信息用于提供冰箱管理服务，包括：\n- 微信昵称和头像（用于身份展示）\n- 冰箱食材数据（存储在您的云空间）\n\n我们不会将您的数据用于任何商业目的或分享给第三方。',
      confirmText: '我知道了',
      showCancel: false,
    })
  },

  goAgreement() {
    wx.showModal({
      title: '用户协议',
      content: '欢迎使用冰箱管家！\n\n使用本小程序即表示您同意以下条款：\n1. 本应用仅供个人及家庭使用\n2. 用户应对自行添加的数据真实性负责\n3. 我们保留对服务进行必要调整的权利\n4. 如有争议，以最新版协议为准',
      confirmText: '我知道了',
      showCancel: false,
    })
  },

  checkUpdate() {
    // 使用微信官方更新机制
    const updateManager = wx.getUpdateManager()
    
    updateManager.onCheckForUpdate((res: any) => {
      if (!res.hasUpdate) {
        wx.showToast({ title: '已是最新版本', icon: 'none' })
      }
    })

    updateManager.onUpdateReady(() => {
      wx.showModal({
        title: '发现新版本',
        content: '检测到有新版本，是否立即更新？',
        success: (res) => {
          if (res.confirm) {
            updateManager.applyUpdate()
          }
        },
      })
    })

    updateManager.onUpdateFailed(() => {
      wx.showToast({ title: '检查失败', icon: 'none' })
    })
  },

  clearCache() {
    const that = this
    wx.showModal({
      title: '清除缓存',
      content: '确定要清除本地缓存吗？\n（不会删除你的云端数据）',
      confirmColor: '#FF6A88',
      success: (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '清除中...' })

          // 清除非关键本地缓存
          try {
            const keysToRemove = [
              'diet_prefs',
              'favorite_recipes',
              'recent_searches',
            ]
            
            keysToRemove.forEach((key) => {
              try { wx.removeStorageSync(key) } catch (_) {}
            })

            wx.hideLoading()
            that.setData({ cacheSizeText: '已清除' })
            wx.showToast({ title: '缓存已清除', icon: 'success' })

            // 延迟重新计算
            setTimeout(() => { that._calcCacheSize() }, 1500)
          } catch (e) {
            wx.hideLoading()
            wx.showToast({ title: '清除失败', icon: 'none' })
          }
        }
      },
    })
  },
})
