// components/recipe-card/recipe-card.ts
/**
 * 菜谱卡片组件
 * 规则：只展示有图片的菜谱，无图时不渲染或隐藏
 */
import { SCENARIO_LABELS, DIFFICULTY_LABELS } from '../../utils/constants'

Component({
  properties: {
    name: { type: String, value: '' },
    image: { type: String, value: '' },
    description: { type: String, value: '' },
    cookTime: { type: Number, value: 0 },
    difficulty: { type: String, value: 'easy' },
    tags: { type: Array, value: [] as string[] },
    matchRate: { type: Number, value: 0 },
    canCook: { type: Boolean, value: false },
    cookLevel: { type: String, value: '' },
    scenario: { type: String, value: 'single' },
    servings: { type: Object, value: null as Record<string, number> | null },
    missingIngredients: { type: Array, value: [] as any[] },
  },

  data: {
    difficultyLabel: '',
    servingLabel: '',
    missingIngredientsText: '',
    imgError: false,
    // 匹配度分级派生字段
    _showCookLabel: false,
    cookLabel: '',
    matchBadgeClass: '',
  },

  observers: {
    'difficulty'() {
      this.setData({
        difficultyLabel: DIFFICULTY_LABELS[this.properties.difficulty] || '简单',
      })
    },
    'scenario, servings': function (
      this: WechatMiniprogram.Component.Instance<
        Record<string, any>,
        Record<string, any>,
        { onTap(): void }
      >,
      _scenario: string,
      _servings: any
    ) {
      const { scenario, servings } = this.properties
      if (servings && servings[scenario]) {
        const label = SCENARIO_LABELS[scenario] || ''
        this.setData({ servingLabel: `${servings[scenario]}人份 (${label})` })
      }
    },
    'missingIngredients'() {
      const names = (this.properties.missingIngredients || [])
        .map((i: any) => i.name)
        .slice(0, 3)
        .join('、')
      const extra = (this.properties.missingIngredients || []).length > 3 ? '...' : ''
      this.setData({ missingIngredientsText: names + extra })
    },
    /** 匹配度分级：根据 canCook + matchRate 计算展示标签和徽章样式 */
    'matchRate, canCook'() {
      const { matchRate, canCook } = this.properties
      let showCookLabel = false
      let cookLabel = ''
      let badgeClass = ''

      if (canCook) {
        showCookLabel = true
        badgeClass = 'recipe-card__match-badge--ready'
        if (matchRate >= 95) {
          cookLabel = '✓ 完美可做'
        } else if (matchRate >= 80) {
          cookLabel = '✓ 只差配料'
        } else {
          cookLabel = '✓ 可做'
        }
      }

      this.setData({
        _showCookLabel: showCookLabel,
        cookLabel,
        matchBadgeClass: badgeClass,
      })
    },
  },

  lifetimes: {
    attached() {
      this.setData({
        difficultyLabel: DIFFICULTY_LABELS[this.properties.difficulty] || '简单',
      })

      const { scenario, servings } = this.properties
      if (servings && servings[scenario]) {
        const label = SCENARIO_LABELS[scenario] || ''
        this.setData({ servingLabel: `${servings[scenario]}人份` })
      }

      const names = (this.properties.missingIngredients || [])
        .map((i: any) => i.name)
        .slice(0, 3)
        .join('、')
      this.setData({
        missingIngredientsText: names + ((this.properties.missingIngredients?.length || 0) > 3 ? '...' : ''),
      })
    },
  },

  methods: {
    onTap() {
      this.triggerEvent('tap', {
        name: this.properties.name,
        ...this.properties,
      })
    },

    /** 图片加载失败 → 标记错误状态（显示空白，不使用 emoji 占位） */
    onImgError() {
      console.warn(`[recipe-card] 图片加载失败: ${this.properties.name}`)
      this.setData({ imgError: true })
    },
  },
})
