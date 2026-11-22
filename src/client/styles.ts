/**
 * dsh-vision-nexus — 设置面板样式（DSH 原生主题）
 *
 * 只使用 DSH 主题 CSS 变量（--dsw-alias-*），自动适配浅色 / 深色，不写死颜色。
 * 通过 `styles.insert(css)` 注入（Client 内置能力），随 Client run 自动清理。
 * 布局：表单控件对齐（label 列 + control 列）、卡片分区、紧凑提示文字。
 */
export const PANEL_CSS = `
.vnx-panel{color:var(--dsw-alias-label-primary);font:inherit;display:flex;flex-direction:column;gap:16px;min-width:0;container:vnx-panel/inline-size}
.vnx-panel *{box-sizing:border-box}
.vnx-section{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;min-width:0}
.vnx-section-header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l1);cursor:pointer;user-select:none;background:transparent;color:inherit;font:inherit;text-align:left;width:100%}
.vnx-section-header:hover{background:var(--dsw-alias-bg-layer-2)}
.vnx-section-title{font-size:14px;font-weight:600;display:flex;align-items:center;gap:8px}
.vnx-section-index{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);font-size:11px;color:var(--dsw-alias-label-secondary)}
.vnx-section-chevron{font-size:12px;color:var(--dsw-alias-label-secondary);transition:transform .16s}
.vnx-section-chevron.open{transform:rotate(90deg)}
.vnx-section-body{display:flex;flex-direction:column;gap:2px;padding:6px 16px 14px}
.vnx-section.collapsed .vnx-section-body{display:none}
.vnx-row{display:grid;grid-template-columns:minmax(180px,42%) 1fr;gap:12px;align-items:start;padding:9px 0;border-bottom:1px dashed var(--dsw-alias-border-l1)}
.vnx-row:last-child{border-bottom:0}
.vnx-row.block{grid-template-columns:1fr}
.vnx-label{font-size:13px;line-height:1.5;display:flex;flex-direction:column;gap:3px;min-width:0}
.vnx-label b{font-weight:500}
.vnx-hint{font-size:11px;color:var(--dsw-alias-label-secondary);line-height:1.5}
/* 插件详情页摘要位：只占一行，避免把整块表单塞进 summary 视图。 */
.vnx-panel-summary{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:2px 0}
.vnx-panel-summary .vnx-hint{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vnx-control{display:flex;flex-direction:column;gap:6px;min-width:0}
.vnx-control.inline{flex-direction:row;align-items:center;flex-wrap:wrap;gap:10px}
.vnx-input,.vnx-select{appearance:none;color:inherit;font:inherit;font-size:13px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 10px;min-height:32px;width:100%;max-width:340px}
.vnx-input:focus,.vnx-select:focus{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.vnx-input.small{max-width:120px}
.vnx-input.invalid{border-color:var(--dsw-alias-state-error-primary)}
.vnx-input[type=number]{font-variant-numeric:tabular-nums}
.vnx-select{cursor:pointer;max-width:260px}
.vnx-error{font-size:11px;color:var(--dsw-alias-state-error-primary)}
.vnx-toggle{appearance:none;position:relative;width:38px;height:22px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);cursor:pointer;flex:none;transition:background .16s}
.vnx-toggle:checked{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.vnx-toggle::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-primary);transition:transform .16s}
.vnx-toggle:checked::after{transform:translateX(16px);background:#fff}
.vnx-toggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.vnx-radio-group{display:flex;flex-wrap:wrap;gap:8px}
.vnx-radio{display:inline-flex;align-items:center;gap:6px;font-size:13px;padding:6px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;cursor:pointer;background:var(--dsw-alias-bg-layer-2)}
.vnx-radio.active{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-1)}
.vnx-radio input{accent-color:var(--dsw-alias-brand-primary);margin:0}
.vnx-slider-row{display:flex;align-items:center;gap:10px;width:100%;max-width:340px}
.vnx-slider{flex:1;accent-color:var(--dsw-alias-brand-primary)}
.vnx-slider-value{font-variant-numeric:tabular-nums;font-size:12px;min-width:48px;text-align:right;color:var(--dsw-alias-label-secondary)}
.vnx-btn{appearance:none;color:inherit;font:inherit;font-size:12px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:5px 12px;background:var(--dsw-alias-bg-layer-2);white-space:nowrap;transition:background .12s,border-color .12s}
.vnx-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-1);border-color:var(--dsw-alias-brand-primary)}
.vnx-btn:disabled{opacity:.5;cursor:default}
.vnx-btn.primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff}
.vnx-btn.danger{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.vnx-btn.small{padding:3px 9px;font-size:11px}
.vnx-btn-row{display:flex;flex-wrap:wrap;gap:8px}
.vnx-badge{display:inline-flex;align-items:center;gap:5px;font-size:11px;padding:2px 9px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary)}
.vnx-badge.ok{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}
.vnx-badge.warn{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}
.vnx-badge.error{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.vnx-dot{width:6px;height:6px;border-radius:50%;background:currentColor}
.vnx-backend{display:flex;flex-direction:column;gap:8px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px 12px;background:var(--dsw-alias-bg-layer-2)}
.vnx-backend.disabled{opacity:.55}
.vnx-backend-head{display:flex;align-items:center;gap:8px}
.vnx-grip{cursor:grab;color:var(--dsw-alias-label-secondary);font-size:14px;user-select:none;touch-action:none}
.vnx-grip:active{cursor:grabbing}
.vnx-backend-title{font-size:12px;font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vnx-backend-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
@container vnx-panel (max-width:520px){.vnx-backend-grid{grid-template-columns:1fr}.vnx-row{grid-template-columns:1fr}}
.vnx-field{display:flex;flex-direction:column;gap:3px;min-width:0}
.vnx-field label{font-size:11px;color:var(--dsw-alias-label-secondary)}
.vnx-field .vnx-input,.vnx-field .vnx-select{max-width:none;width:100%}
.vnx-health-list{display:flex;flex-direction:column;gap:8px}
.vnx-health-item{display:flex;flex-direction:column;gap:3px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:9px 11px;background:var(--dsw-alias-bg-layer-2)}
.vnx-health-line{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.vnx-health-name{font-size:13px;font-weight:500}
.vnx-health-detail{font-size:11px;color:var(--dsw-alias-label-secondary);line-height:1.5}
.vnx-health-fix{font-size:11px;color:var(--dsw-alias-state-warn-primary);line-height:1.5}
.vnx-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px}
.vnx-stat{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px 12px;background:var(--dsw-alias-bg-layer-2);display:flex;flex-direction:column;gap:4px}
.vnx-stat-label{font-size:11px;color:var(--dsw-alias-label-secondary)}
.vnx-stat-value{font-size:18px;font-weight:600;font-variant-numeric:tabular-nums}
.vnx-tools{display:flex;flex-wrap:wrap;gap:6px}
.vnx-tool-chip{font-size:11px;padding:2px 8px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);font-family:ui-monospace,monospace}
.vnx-notice{font-size:11px;line-height:1.6;border-radius:8px;padding:8px 11px}
.vnx-notice.info{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.vnx-notice.warn{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent);color:var(--dsw-alias-state-warn-primary)}
.vnx-notice.error{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);color:var(--dsw-alias-state-error-primary)}
.vnx-notice.ok{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent);color:var(--dsw-alias-state-success-primary)}
.vnx-toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;padding:10px 16px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
.vnx-save-state{font-size:11px;color:var(--dsw-alias-label-secondary)}
.vnx-save-state.error{color:var(--dsw-alias-state-error-primary)}
.vnx-save-state.ok{color:var(--dsw-alias-state-success-primary)}
.vnx-import-area{width:100%;min-height:80px;resize:vertical;font-family:ui-monospace,monospace;font-size:11px;color:inherit;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px}
`;
