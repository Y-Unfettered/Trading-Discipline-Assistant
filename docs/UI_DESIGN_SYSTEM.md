# shadcn-vue 官方基线强制规范（零定制版）

第一阶段完全冻结 shadcn-vue 官方组件、官方主题和官方视觉，不做任何个性化修改。

## 1. 锁定基线

- CLI：`shadcn-vue@2.7.4`，必须精确锁定，不允许使用 `latest`。
- 组件配置：`components.json`，style 为 `new-york`，baseColor 为 `neutral`，iconLibrary 为 `lucide`。
- 组件源码：`src/components/ui/**`，只能由锁定版 CLI 安装或覆盖生成。
- 主题：`src/style.css`，只保留官方 neutral 主题变量、Tailwind 导入和官方 base layer。

上述文件属于冻结区。修改颜色、圆角、边框、阴影、字号、动画、Props、slot、事件或 Variant 均视为违规。

## 2. 组件安装

```bash
npx shadcn-vue@2.7.4 add <component>
```

禁止手写同名组件、复制旧版本源码、混用 CLI 版本、引入其他 UI 库，或在业务层直接使用 `reka-ui` 重新封装基础控件。

## 3. 页面实现

- 表单使用 Field、Label、Input、Textarea、Number Field、Select、Checkbox、Date Picker（Calendar + Popover 官方组合）等官方组件。
- 禁止业务页面出现原生 `button`、`input`、`textarea`、`select`、`label`、`table`、`details`、`summary` 和 `kbd`。
- 操作使用 Button、Dropdown Menu 等官方组件；禁止 `div/span @click`。
- 弹窗与反馈使用 Dialog、Alert、Sonner、Tooltip、Popover、Spinner、Skeleton 等官方组件。
- 容器、空状态、折叠和数据展示使用 Card、Empty、Accordion、Tabs、Table、Progress 等官方组件。
- `div`、`main`、`section` 只负责布局，不能承担控件、卡片、提示或交互职责。

## 4. 业务 Tailwind 白名单

业务组件只允许布局类：

- `flex`、`grid`、`block`、`hidden` 及必要的 flex 布局值；
- `gap-*`、`space-*`、`m-*`、`p-*`；
- `w-*`、`h-*`、`min-*`、`max-*`；
- `items-*`、`justify-*`、`self-*`、`overflow-*`；
- `grid-cols-*`、`col-span-*`、响应式前缀；
- 官方示例中的图标尺寸，如 `size-4`。

禁止 `bg-*`、`border-*`、`rounded-*`、`shadow-*`、`ring-*`、颜色类、字体视觉类、`hover/focus/active`、`animate-*`、任意值、Tailwind `!` 覆盖和内联 `style`。

## 5. Variant

只允许官方 Variant。例如 Badge 只使用 `default`、`secondary`、`destructive`、`outline`；禁止新增 `success`、`warning`、`info`、`profit`、`loss`。

业务状态优先通过官方组件语义表达：普通状态使用 Badge `secondary/outline`，错误使用 `destructive`，提示使用 Alert。

## 6. 验收

提交前必须全部通过：

```bash
npm run check:ui
npm run typecheck
npm test
npm run build
```

`npm run check:ui` 会验证冻结文件哈希、锁定版本、配置、主题、业务组件标签、Tailwind 白名单、Variant、Input 类型、业务 CSS 和依赖边界。修改冻结区后不能通过更新哈希绕过审查；如需升级，必须单独立项并用目标版本 CLI 重新生成完整基线。
