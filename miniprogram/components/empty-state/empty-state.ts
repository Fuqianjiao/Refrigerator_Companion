// components/empty-state/empty-state.ts

Component({
  properties: {
    icon: { type: String, value: '🧊' },
    title: { type: String, value: '这里空空如也~' },
    desc: { type: String, value: '' },
    actionText: { type: String, value: '' },
  },

  methods: {
    onActionTap() {
      this.triggerEvent('action')
    },
  },
})
