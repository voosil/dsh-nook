// 硬编码色值门禁：tokens.css 是唯一允许原始色值的文件（Nook 色卡）。
// 其余 CSS 一律使用 var(--nook-color-*)；功能色/透明色同样禁止 rgb/hsl/oklch 等函数。
export default {
  rules: {
    'color-no-hex': true,
    'function-disallowed-list': ['rgb', 'rgba', 'hsl', 'hsla', 'oklch', 'oklab', 'hwb', 'lab', 'lch', 'color'],
  },
  overrides: [
    {
      files: ['packages/ui-kit/styles/tokens.css'],
      rules: {
        'color-no-hex': null,
        'function-disallowed-list': null,
      },
    },
  ],
}
