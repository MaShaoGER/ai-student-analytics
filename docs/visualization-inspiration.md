# 数据分析表格与三维可视化参考

记录日期：2026-10-29（Asia/Shanghai）。

目标：为教学数据分析寻找有真实数据含义、同时有强烈视觉表现的三维展示。2026-10-29 最新澄清：可以牺牲读数清晰度，主体仍必须表达数量、分布或关系；纯特效不足以满足要求。优先看第 3 节的新参考与数据映射，前两节保留作为既有参考。候选不代表已经接入或确定采用。

## 1. 已收集的二维表格与图表

以下五项来自本轮参考讨论。项目用途是设计建议，具体字段和结果结构仍需实施前核对。

| 候选 | 官方预览 | 视觉与交互亮点 | 项目用途建议 | 数据条件 |
| --- | --- | --- | --- | --- |
| VTable 趋势分析表 | [趋势表](https://visactor.io/vtable/demo/business/trend)、[透视表迷你图](https://visactor.io/vtable/demo/cell-type/pivot-sparkline) | 单元格内嵌迷你折线、变化箭头，数值和趋势在同一行呈现 | 每门课程一行，展示当前均分、完成率、样本与历学期趋势 | 真实的课程×学期聚合；不同单位分列表达 |
| Perspective 深色分析工作台 | [深色多面板示例](https://perspective-dev.github.io/gallery/market-trading-desk-2.html) | 高密度表格与图表组成多面板工作台，示例随模拟数据流更新 | 借鉴布局、配色与共享数据视图，建设课程数据探索界面 | 复用同一可信结果；示例的金融字段不直接映射为教学指标 |
| Nivo Bump 排名变化图 | [Bump](https://nivo.rocks/bump/) | 彩色曲线交错，突出不同系列随时间的名次变化 | 查看课程群体指标排名的学期变化 | 同一指标、可比较课程与有序学期；悬停同时给出实际值和样本；不用作学生个人排名 |
| D3 可缩放旭日图 | [Zoomable sunburst](https://observablehq.github.io/notebook-kit/ex/d3/zoomable-sunburst) | 点击扇区平滑进入下一层，点击中心返回 | 有完整层级时查看院系→专业→课程的构成 | 真实层级与可加总数量；明确统计人数还是选课人次，不将均分当作组成 |
| D3 环形关系束图 | [Hierarchical edge bundling](https://observablehq.com/@d3/hierarchical-edge-bundling) | 关系连线沿层级汇聚，悬停突出选中节点的关联 | 探索按院系分组的课程关联、共同选课或薄弱共现 | 需要层级与真实边数据；共同样本、阈值和关联含义必须明确 |

普通分析界面的视觉建议：沿用现有玻璃界面，以蓝青作为主色、紫色强调选中项；课程颜色在排序和筛选后保持稳定。第 3 节允许进一步使用粒子流动、景深、辉光与镜头运动，同时保留主体数据的明确映射。

### 官方预览图

VTable 趋势表：

![VTable 趋势表官方预览](https://lf9-dp-fe-cms-tos.byteorg.com/obj/bit-cloud/VTable/preview/trend.png)

Perspective 深色工作台：

![Perspective 深色工作台官方预览](https://perspective-dev.github.io/projects/light/market-trading-desk-2.png)

这些图片由原站提供，可能随官方更新变化；以对应演示为准。

## 2. 三维表格与图表候选

三维方向包含空间排布的卡片表、带真实第三轴的统计图和空间关系网络。本节偏统计阅读，是第一轮候选；最新的表现型场景见第 3 节，其中空间布局可以直接服务构图和镜头表现。

### 2.1 Three.js 立体卡片表：最贴近“把表格变成立体”

- [官方演示：CSS3D Periodic Table](https://threejs.org/examples/css3d_periodictable.html)
- [官方源码](https://github.com/mrdoob/three.js/blob/dev/examples/css3d_periodictable.html)
- 演示提供 TABLE、SPHERE、HELIX、GRID 四种布局，同一组卡片可以在平面表格、球体、螺旋和立体网格之间变换。
- 项目设想：每张卡片代表一门课程，显示课程名、均分、完成率和有效样本；点击后查看课程详情。优先探索规则网格与平面布局切换，球体和螺旋适合作为可选的展示模式。
- 这里空间位置首先是布局；若位置没有统计含义，界面应明确，避免把距离解释成课程相似程度。

### 2.2 ECharts GL 三维柱状矩阵：适合课程×学期

- [官方演示：Bar3D Punch Card](https://echarts.apache.org/examples/en/editor.html?c=bar3d-punch-card&gl=1)
- [官方图库](https://echarts.apache.org/examples/en/index.html?theme=dark)
- [ECharts GL 官方仓库](https://github.com/ecomfe/echarts-gl)
- 视觉特点：二维网格中的数值变成立体柱高，可从不同角度观察。
- 项目设想：X 轴为课程、Y 轴为学期、Z 轴为均分或活动量；每次只展示一种指标，悬停给出精确值、单位和样本。配套俯视热力图和数值表。
- 分类轴采用离散柱体；课程之间不画成连续曲面。缺失或受抑制的数据不作为零柱处理。

![ECharts 三维柱状矩阵官方预览](https://echarts.apache.org/examples/data-gl/thumb/bar3d-punch-card.png)

### 2.3 Plotly 三维散点：同时探索三个指标

- [官方演示：3D Scatter](https://plotly.com/javascript/3d-scatter-plots/)
- [三维悬停与轴投影](https://plotly.com/javascript/3d-hover/)
- 视觉特点：散点分布在三维坐标空间，可结合颜色、点大小与悬停读数。
- 项目设想：以满足样本门槛的课程或群体为点，同时探索成绩、出勤率和活动量；点大小可表达有效样本，颜色可表达课程类别。
- 必须来自同一统计范围、同一粒度的三个真实指标；不能把三份无对应关系的汇总拼成点，也不能将空间聚集直接解释成因果关系。

### 2.4 三维关系星图：第一轮的空间探索方向

- [3d-force-graph 官方仓库](https://github.com/vasturiano/3d-force-graph)
- [发光效果演示](https://vasturiano.github.io/3d-force-graph/example/bloom-effect/)
- [点击节点聚焦](https://vasturiano.github.io/3d-force-graph/example/click-to-focus/)
- 组件使用 Three.js/WebGL 表达三维关系图；官方提供发光、节点聚焦、展开收起和关系高亮等独立示例。
- 项目设想：课程作为节点，真实共同选课或薄弱共现作为边；点击课程聚焦关联网络，同时在侧栏给出数值依据。
- 力导向布局的位置通常不等同于可解释的统计坐标。限制节点和边的规模，并保留暂停、还原与列表入口。各示例效果的组合需要另行实现。

### 2.5 Plotly 三维曲面：适合有序数值网格

- [官方演示：3D Surface](https://plotly.com/javascript/3d-surface-plots/)
- [结果结构：surface](https://plotly.com/javascript/reference/surface/)
- 视觉特点：将二维网格的值表现为高低起伏的曲面，还可投影等高线。
- 项目设想：有真实周次×时段活动数据时，探索学习活动密度；也可研究连续数值分箱形成的联合分布。
- 曲面需要有序、可解释的坐标与网格值；缺失处理和任何平滑/插值均需说明。课程名称这类无连续距离含义的类别优先使用柱状矩阵。

## 3. 最新标准：有数据含义的强视觉三维展示

用户进一步澄清：可以接受数据表示不够清晰，但画面必须仍然表达数据。此前将纯粒子、玻璃和波浪实验列为主要推荐，偏离了要求。接下来先核对数据来源、视觉映射及可观察的数据差异，再评价材质、动效和镜头；精确读数可以让位于整体表现。

### 3.1 新参考：每种画面都说明数据是什么

| 案例与预览 | 真实数据与来源 | 数据如何决定画面 | 表现亮点 |
| --- | --- | --- | --- |
| [GitCity：贡献城市](https://gitcity.natrajx.in/) | GitHub 公开贡献记录；[作者仓库说明](https://github.com/rishabhbhartiya/GitCity) | 每个有贡献的日期成为一栋楼，贡献越多楼越高；支持按年月周筛选 | 立体城市、不同主题和可驾驶的街景视角，让统计矩阵成为可进入的场景 |
| [Human Terrain：人口山脉](https://pudding.cool/2018/10/city_3d/) | Global Human Settlement Layer 人口栅格；原站介绍数据与处理来源，比较涉及 1975、1990、2015 等历史年份 | 地理网格人口量形成三维高低结构；可以查看历史变化 | 人口聚集形成山峰和山脉，镜头可飞向不同城市 |
| [Globe.GL：人口立体地球](https://globe.gl/example/world-population/) | 示例加载 world_population.csv 的 lat、lng、pop；[官方示例源码](https://github.com/vasturiano/globe.gl/blob/master/example/world-population/index.html) | 人口按六边形区域求和，聚合值决定柱高与颜色；源码中高度与人口和线性关联、颜色使用平方根尺度 | 星空、夜景地球与向外拔起的数据柱产生强烈空间感；示例是数据快照，未确认其统计年份 |
| [Globe.GL：国际航线光流](https://globe.gl/example/airline-routes/us-international-outbound.html) | OpenFlights 的机场坐标与航线记录；[官方源码](https://github.com/vasturiano/globe.gl/blob/master/example/airline-routes/us-international-outbound.html) | 每条弧线对应真实起终点航线，示例筛选美国出境直飞航线；悬停给出航空公司与机场代码 | 发光感弧线跨越地球、虚线持续流动；动画速度是表现参数，不代表飞行速度或客流量 |
| [Earth Nullschool：风场流线](https://earth.nullschool.net/) | GFS 等气象模型数据；[官方数据来源与解释](https://earth.nullschool.net/about) | 流线呈现风场方向与运动，叠加颜色可表达风速或温度等选定数据 | 真实数据构成持续运动的全球流场，整体形态和漩涡很有冲击力 |

优先看前三项。它们证明数值可以直接成为建筑、山脉和空间柱阵；航线与风场则说明流动也能承载真实关系或向量信息。所有样例使用的是各自领域的数据，迁移到教学分析时借鉴其视觉编码与空间表现。

### 3.2 针对本项目的三个候选

以下为项目设计建议，尚未实现；所需结果粒度和查询能力仍需实施前核对。

| 方向 | 主体数据映射 | 可以放大的视觉表现 | 数据变化时应发生的变化 |
| --- | --- | --- | --- |
| 课程数据城市 | 一栋楼对应课程×学期；楼高对应活动次数，颜色对应平均成绩；有效样本在点击详情中给出 | 玻璃建筑、发光轮廓、夜景、镜头穿行与楼群逐层升起 | 活动数据变化使相应楼高变化；换学期后对应楼群和成绩色彩更新 |
| 成绩分布山脉 | X 为分数区间，Y 为有序学期，Z 为该区间的样本数；按课程切换 | 分层山脊、发光等高线、粒子沿表面运动、镜头掠过山峰 | 低分段或高分段样本变多，对应山峰升高；跨期分布变化体现为山体迁移。需要分数区间×学期的真实聚合，不凭均分捏造形状 |
| 课程关联光流网络 | 节点对应课程；节点大小对应有效样本，连线粗细对应共同选课或薄弱共现人数；两种关系分开选择 | 三维聚团、发光连线、沿边运动的粒子、点击后镜头聚焦 | 增删关系会改变网络；共同样本变化改变连线粗细。粒子流速作为装饰时不冒充真实流转速度 |

推荐先尝试“课程数据城市”或“成绩分布山脉”：主体形状直接由统计量决定，同时给材质、镜头和入场动画足够的表现空间。空间布局可服务构图，主体高度、大小、颜色或连线至少有明确的数据含义。

### 3.3 原型筛选要求

- 每个候选都写出：数据字段、聚合粒度、视觉属性、映射方式。允许非线性尺度和艺术化处理，但要能说明对应关系。
- 换一份明显不同的数据后，主体形状、分布或关系必须随之改变；只改标题、详情文字或随机粒子颜色不算数据驱动。
- 强调主体数据的大小、分布、比较或关系；辉光、镜头、装饰性波动用于增强这些表达。
- 可以隐藏常驻坐标轴与精确读数；点击后仍能知道对象是什么、代表多少、统计范围是什么。

### 3.4 前轮特效参考：仅保留为材质与动效素材

以下案例本身未建立与教学统计的对应关系，因此不再列为主要数据展示候选：

- [Flow Field Particles](https://flowfield.niccolofanton.dev/) 与 [Dreamy Particles](https://tympanus.net/Tutorials/DreamyParticles/)：借鉴粒子运动、变形、拖尾和辉光；必须另行绑定统计分布或关系。
- [Infinite Jelly Glass](https://jelly.niccolofanton.dev/) 与 [玻璃螺旋](https://tympanus.net/Tutorials/Xylophone/)：借鉴折射材质和空间排布。
- [3D Wave Grid](https://projects.arkon.digital/threejs/wavy-cubes/)：借鉴体素入场及交互波纹；数据柱高仍需由真实值决定。
- [Refik Anadol：Unsupervised](https://refikanadolstudio.com/projects/unsupervised-machine-hallucinations-moma/)：保留为数据艺术的审美参考；不能替代本项目具体的数据映射方案。

## 4. 实施前需要保留的约定

- 图、表与解释共用可信聚合结果和结果身份；纯展示切换不重新调用模型或统计接口。
- 精确数据表、指标单位、有效样本、缺失状态和小样本规则可放在点击详情中；主舞台优先服务视觉表现。显示具体数字或导出时仍使用相同的可信数据范围。
- 三维视图提供还原视角、点击/悬停详情与二维替代入口；减少动态效果开启时停止自动旋转和持续装饰动画。
- ECharts GL 的官方 README 当前明确列出“2.x 对应 ECharts 5.x”；本项目 `package.json` 声明 ECharts `^6.0.0`。因此兼容性仍待独立验证，不能因已有 ECharts 就认定可直接接入。参见[官方兼容说明](https://github.com/ecomfe/echarts-gl#installing)。
- VTable、Perspective、Nivo、D3、Plotly、Three.js 和 3d-force-graph 在本文中都是候选。接入前比较所需依赖、体积、许可、主题与无障碍适配；也可只借鉴交互，用现有组件实现。

## 5. 与现有文档的关系及核实范围

- [原开发路线图](../AI学生数据分析系统开发路线图.md)：历史的图表升级分期，部分完成状态落后于后续记录。
- [AI 图表能力扩展](ai-chart-capabilities.md)：已有高级图表接入记录。
- [AI 对话体验路线图](ai-conversation-experience-roadmap.md)：可信结果、展示选择与图表/数值表切换约定。
- [玻璃界面层级记录](design/glass-hierarchy.md)：当前视觉层级调整的上下文。

2026-10-29 已检索官方/作者文档、演示入口与源码，并核对本地依赖声明。此前在浏览器查看过 VTable 趋势表；新增表现型参考中，已在浏览器查看 Flow Field Particles 并点击 Morph 预设确认画面变化，截图位于本地 `output/visualization-inspiration/flowfield-morph.png`（演示原站截图，非项目实装）。其余候选未逐一完成浏览器交互验收、设备性能测试或本地接入验证。官方图片用于视觉参考。本轮仅整理文档与 README 入口。

补充核实：本轮查看 GitCity 作者说明、Human Terrain 数据说明、Globe.GL 人口与航线示例源码、Earth Nullschool 数据来源；在浏览器确认人口立体地球已渲染，截图在本地 output/visualization-inspiration/world-population.png。其余新增案例未完成逐项浏览器交互验收；教学数据映射均为待实现建议。
