// components/scene-switcher/scene-switcher.ts
import { SCENARIOS } from '../../utils/constants'

Component({
  properties: {
    current: { type: String, value: 'single' },
  },

  data: {
    scenes: [
      {
        value: SCENARIOS.SINGLE,
        label: '一人食',
        icon: '🍱',
        iconActive: '🍱',
      },
      {
        value: SCENARIOS.COUPLE,
        label: '两人食',
        icon: '💑',
        iconActive: '💕',
      },
      {
        value: SCENARIOS.FAMILY,
        label: '家庭餐',
        icon: '🏠',
        iconActive: '🏡',
      },
    ],
  },

  methods: {
    onSwitch(e: WechatMiniprogram.TouchEvent) {
      const { value } = e.currentTarget.dataset
      if (value && value !== this.properties.current) {
        this.setData({ current: value })
        this.triggerEvent('change', { value })
      }
    },
  },
})
