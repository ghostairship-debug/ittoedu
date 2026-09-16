export const documentMathCases = [
  { name: '分式与嵌套根式', latex: String.raw`\frac{1+\sqrt{x}}{x^2}`, edit: '修改分母指数', tags: ['f', 'rad', 'sSup'] },
  { name: '平方根与高次根', latex: String.raw`\sqrt{x+1}+\sqrt[3]{8}`, edit: '将根指数 3 改为 4', tags: ['rad', 'deg'] },
  { name: '上下标', latex: String.raw`x^2+a_i+T_i^{n+1}`, edit: '分别修改上标和下标', tags: ['sSup', 'sSub', 'sSubSup'] },
  { name: '符号与关系', latex: String.raw`\Delta U=\alpha\cdot x\pm\beta,\quad x\leq1`, edit: '修改系数和关系符', tags: ['r'] },
  { name: '求和', latex: String.raw`\sum_{i=1}^{n}{i^2}`, edit: '修改上限和被求和项', tags: ['nary', 'sub', 'sup', 'sSup'] },
  { name: '乘积', latex: String.raw`\prod_{i=1}^{n}{a_i}`, edit: '修改上限和乘积项', tags: ['nary', 'sSub'] },
  { name: '积分', latex: String.raw`\int_0^1{x^2\,\mathrm{d}x}`, edit: '修改上限和被积式，检查直立 d', tags: ['nary', 'sSup'] },
  { name: '对齐推导', latex: String.raw`\begin{aligned}U&=IR\\I&=\frac{U}{R}\end{aligned}`, edit: '修改第二行分母并检查等号对齐', tags: ['eqArr', 'aln', 'f'] },
  { name: '分段函数', latex: String.raw`f(x)=\begin{cases}x^2&\text{当 }x\geq0\\-x&\text{当 }x<0\end{cases}`, edit: '分别修改条件与表达式', tags: ['d', 'm', 'mr', 'nor'] },
  { name: '矩阵', latex: String.raw`\left(\begin{matrix}1&\frac{1}{2}\\\sqrt{x}&a_i\end{matrix}\right)`, edit: '修改右上格分母，检查其他格', tags: ['d', 'm', 'mr', 'f', 'rad', 'sSub'] },
] as const
