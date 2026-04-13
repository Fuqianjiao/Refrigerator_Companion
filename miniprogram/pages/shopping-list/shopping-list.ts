// pages/shopping-list/shopping-list.ts

interface ShoppingItem {
  name: string
  reason: string
  addedAt: Date
  checked: boolean
}

Page({
  data: {
    items: [] as ShoppingItem[],
    uncheckedCount: 0,
    checkedCount: 0,
    showAdd: false,
    newItemName: '',
    loading: false,
  },

  onShow() {
    this._loadList()
  },

  _loadList() {
    const items = wx.getStorageSync('shopping_list') || []
    const unchecked = items.filter((i: ShoppingItem) => !i.checked).length
    const checked = items.filter((i: ShoppingItem) => i.checked).length

    this.setData({
      items,
      uncheckedCount: unchecked,
      checkedCount: checked,
    })
  },

  toggleCheck(e: WechatMiniprogram.TouchEvent) {
    const idx = e.currentTarget.dataset.index
    const items = [...this.data.items]
    items[idx].checked = !items[idx].checked
    
    // 保存到本地
    wx.setStorageSync('shopping_list', items)
    this._loadList() // 刷新计数
  },

  removeItem(e: WechatMiniprogram.TouchEvent) {
    const idx = e.currentTarget.dataset.index
    const items = [...this.data.items]
    items.splice(idx, 1)
    
    wx.setStorageSync('shopping_list', items)
    this._loadList()

    wx.showToast({ title: '已移除', icon: 'none' })
  },

  clearChecked() {
    wx.showModal({
      title: '清除已完成',
      content: '确定要清除所有已勾选的物品吗？',
      success: (res) => {
        if (res.confirm) {
          const remaining = this.data.items.filter(i => !i.checked)
          wx.setStorageSync('shopping_list', remaining)
          this._loadList()
          wx.showToast({ title: '已清除 ✓', icon: 'none' })
        }
      },
    })
  },

  showAddInput() { this.setData({ showAdd: true, newItemName: '' }) },
  hideAddInput() { this.setData({ showAdd: false }) },

  onNewItemInput(e: WechatMiniprogram.Input) { this.setData({ newItemName: e.detail.value }) },

  addItem() {
    const name = this.data.newItemName.trim()
    if (!name) return

    const items = [
      ...this.data.items,
      { name, reason: '', addedAt: new Date(), checked: false } as ShoppingItem,
    ]
    
    wx.setStorageSync('shopping_list', items)
    this.setData({ showAdd: false, newItemName: '' })
    this._loadList()
  },
})
