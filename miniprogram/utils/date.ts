/* ============================================
   🧊 FridgeMate - 日期工具
   ============================================ */

/**
 * 格式化日期为 YYYY-MM-DD
 */
export function formatDate(date: Date | string | number): string {
  const d = new Date(date)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * 格式化为友好显示：X月X日
 */
export function formatFriendly(date: Date | string): string {
  const d = new Date(date)
  const month = d.getMonth() + 1
  const day = d.getDate()
  return `${month}月${day}日`
}

/**
 * 计算两个日期之间的天数差
 * @param date 目标日期
 * @param from 参考日期（默认今天）
 */
export function daysBetween(date: Date | string, from: Date = new Date()): number {
  const target = new Date(date)
  const ref = new Date(from)
  // 重置时分秒，只比较日期
  target.setHours(0, 0, 0, 0)
  ref.setHours(0, 0, 0, 0)
  const diff = target.getTime() - ref.getTime()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

/**
 * 根据生产日期+保质期天数计算过期日期
 */
export function calcExpiryDate(productionDate: string, shelfLifeDays: number): string {
  const prod = new Date(productionDate)
  prod.setDate(prod.getDate() + shelfLifeDays)
  return formatDate(prod)
}

/**
 * 获取保质期状态
 * @param expiryDate 过期日期字符串 YYYY-MM-DD
 * @param warnDays 提前几天算临期（默认3天）
 */
export function getExpiryStatus(expiryDate: string, warnDays = 3): string {
  const days = daysBetween(expiryDate)
  if (days < 0) return 'expired'
  if (days <= warnDays) return 'expiring'
  return 'fresh'
}

/**
 * 获取剩余天数的友好描述
 */
export function getExpiryText(expiryDate: string): string {
  const days = daysBetween(expiryDate)
  if (days < 0) {
    return `已过期 ${Math.abs(days)} 天`
  }
  if (days === 0) {
    return '今天过期'
  }
  if (days === 1) {
    return '明天过期'
  }
  if (days <= 3) {
    return `仅剩 ${days} 天`
  }
  return `还剩 ${days} 天`
}
